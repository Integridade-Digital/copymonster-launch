/**
 * CopyMonster Affiliate Commission Processor.
 *
 * Handles affiliate sales tracking, commission calculations, holding periods,
 * and refunds/reversals with strict double-entry ledger integration and idempotency.
 * @module @deepseek-ai/dsh-api-auth-http/affiliate-processor
 */

import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function arrayField(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key]
  return Array.isArray(value) ? value : []
}

function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Access a Supabase table in either a dedicated schema or with schema prefix.
 * Supports PostgREST `.schema(schemaName).from(tableName)` when available,
 * with fallback to `.from(`${schemaName}.${tableName}`)`.
 */
export function getTable(client: any, schema: 'affiliate' | 'finance', table: string) {
  if (typeof client?.schema === 'function') {
    try {
      const s = client.schema(schema)
      if (s && typeof s.from === 'function') {
        return s.from(table)
      }
    } catch {
      // fallback
    }
  }
  return client.from(`${schema}.${table}`)
}

/**
 * Extract affiliate ID from Stripe invoice metadata or line item metadata.
 */
export function extractAffiliateIdFromInvoice(invoice: Record<string, unknown>): string | undefined {
  const metadata = asObject(invoice['metadata'])
  const lines = arrayField(asObject(invoice['lines']), 'data')
  const lineMetadata = lines.length > 0 ? asObject(asObject(lines[0])['metadata']) : {}
  const subDetails = asObject(invoice['subscription_details'])
  const subMetadata = asObject(subDetails['metadata'])

  const candidate = optionalString(metadata, 'affiliate_id')
    ?? optionalString(metadata, 'affiliateId')
    ?? optionalString(lineMetadata, 'affiliate_id')
    ?? optionalString(lineMetadata, 'affiliateId')
    ?? optionalString(subMetadata, 'affiliate_id')
    ?? optionalString(subMetadata, 'affiliateId')

  if (!candidate || !UUID_REGEX.test(candidate)) {
    return undefined
  }
  return candidate.toLowerCase()
}

/**
 * Process affiliate commission when an invoice is paid (`invoice.paid` / `invoice.payment_succeeded`).
 *
 * 1. Checks for `affiliate_id` metadata. Returns early if missing or invalid.
 * 2. Enforces idempotency via `stripe_event_id` and `stripe_invoice_id`.
 * 3. Verifies partner status (must be active and KYC approved).
 * 4. Resolves the active commission rule (percentage and retention days).
 * 5. Calculates commission and records it in `affiliate.commissions` with status `HOLDING`.
 * 6. Generates in-app notification in `affiliate.notifications`.
 *
 * @param invoice - Stripe invoice object.
 * @param stripeEventId - Unique Stripe event identifier for idempotency.
 * @param client - Supabase client (defaults to supabaseAdminClient).
 */
export async function processAffiliateCommissionFromInvoice(
  invoice: Record<string, unknown>,
  stripeEventId: string,
  client: any = supabaseAdminClient,
): Promise<{ status: string; commissionId?: string } | void> {
  const affiliateId = extractAffiliateIdFromInvoice(invoice)
  if (!affiliateId) {
    return { status: 'ignored_no_affiliate' }
  }

  const invoiceId = optionalString(invoice, 'id')

  // 1. Idempotency checks: by event ID first
  if (stripeEventId) {
    const { data: existingEvent } = await getTable(client, 'affiliate', 'commissions')
      .select('id')
      .eq('stripe_event_id', stripeEventId)
      .maybeSingle()

    if (existingEvent) {
      return { status: 'already_processed_event', commissionId: existingEvent.id }
    }
  }

  // Check by invoice ID if available
  if (invoiceId) {
    const { data: existingInvoice } = await getTable(client, 'affiliate', 'commissions')
      .select('id')
      .eq('stripe_invoice_id', invoiceId)
      .maybeSingle()

    if (existingInvoice) {
      return { status: 'already_processed_invoice', commissionId: existingInvoice.id }
    }
  }

  // 2. Validate Affiliate Profile
  const { data: profile } = await getTable(client, 'affiliate', 'profiles')
    .select('id, active, kyc_status')
    .eq('id', affiliateId)
    .maybeSingle()

  if (!profile || !profile.active || profile.kyc_status !== 'APPROVED') {
    const reason = !profile
      ? 'Profile not found'
      : (!profile.active ? 'Profile inactive' : `KYC status: ${profile.kyc_status}`)

    await getTable(client, 'affiliate', 'audit_logs').insert({
      action: 'COMMISSION_REJECTED_UNAUTHORIZED',
      target_type: 'affiliate_profile',
      target_id: affiliateId,
      reason,
      metadata: { invoiceId, eventId: stripeEventId },
    })

    return { status: 'rejected_unauthorized' }
  }

  // 3. Resolve active commission rule
  const { data: rule } = await getTable(client, 'affiliate', 'commission_rules')
    .select('percentage, retention_days')
    .eq('is_current', true)
    .eq('active', true)
    .maybeSingle()

  const percentage = Number(rule?.percentage ?? 30.0)
  const retentionDays = Number(rule?.retention_days ?? 35)

  // 4. Calculate commission on gross amount paid (Stripe amount_paid is in cents)
  const amountPaidCents = Number(invoice['amount_paid'] ?? 0)
  const grossAmount = amountPaidCents / 100
  const commissionAmount = Number(((grossAmount * percentage) / 100).toFixed(2))

  if (commissionAmount <= 0) {
    return { status: 'ignored_zero_amount' }
  }

  const eligibleAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString()

  // 5. Persist commission record in HOLDING
  const { data: insertedCommission } = await getTable(client, 'affiliate', 'commissions')
    .insert({
      affiliate_id: profile.id,
      stripe_event_id: stripeEventId,
      stripe_invoice_id: invoiceId ?? null,
      amount_gross: grossAmount,
      commission_amount: commissionAmount,
      status: 'HOLDING',
      eligible_at: eligibleAt,
    })
    .select('id')
    .single()

  const commissionId = insertedCommission?.id

  // 6. Notify affiliate
  await getTable(client, 'affiliate', 'notifications').insert({
    affiliate_id: profile.id,
    type: 'COMMISSION_EARNED',
    title: 'New commission registered!',
    message: `You earned a commission of $${commissionAmount.toFixed(2)} USD currently in retention holding.`,
    metadata: { gross: grossAmount, retentionDays, invoiceId, commissionId },
  })

  return { status: 'commission_created', commissionId }
}

/**
 * Process affiliate refund or chargeback when a charge is refunded (`charge.refunded`).
 *
 * 1. Resolves `stripe_invoice_id` from the charge object.
 * 2. Locates the commission record. If not found or already REFUNDED, returns early.
 * 3. If commission was ELIGIBLE (already approved into balance), issues a compensatory DEBIT entry in `finance.ledger_entries`.
 * 4. Updates commission status to `REFUNDED`.
 * 5. Sends a notification and registers an audit log entry.
 *
 * @param charge - Stripe charge object.
 * @param client - Supabase client (defaults to supabaseAdminClient).
 */
export async function processAffiliateRefundFromCharge(
  charge: Record<string, unknown>,
  client: any = supabaseAdminClient,
): Promise<{ status: string; commissionId?: string } | void> {
  const invoiceId = optionalString(charge, 'invoice')
    ?? optionalString(asObject(charge['metadata']), 'invoice_id')
    ?? optionalString(asObject(charge['metadata']), 'stripe_invoice_id')

  if (!invoiceId) {
    return { status: 'ignored_no_invoice' }
  }

  // 1. Locate commission by stripe_invoice_id
  const { data: commission } = await getTable(client, 'affiliate', 'commissions')
    .select('id, affiliate_id, commission_amount, status')
    .eq('stripe_invoice_id', invoiceId)
    .maybeSingle()

  if (!commission) {
    return { status: 'commission_not_found' }
  }

  if (commission.status === 'REFUNDED') {
    return { status: 'already_refunded', commissionId: commission.id }
  }

  const previousStatus = commission.status
  const commissionAmount = Number(commission.commission_amount)

  // 2. Compensatory ledger reversal if already released as ELIGIBLE
  if (previousStatus === 'ELIGIBLE') {
    await getTable(client, 'finance', 'ledger_entries').insert({
      affiliate_id: commission.affiliate_id,
      amount: commissionAmount,
      entry_type: 'DEBIT',
      reference_type: 'REFUND',
      reference_id: commission.id,
      description: `Reversal of commission credit due to Stripe refund (invoice ${invoiceId})`,
      active: true,
    })
  }

  // 3. Mark commission as REFUNDED
  await getTable(client, 'affiliate', 'commissions')
    .update({
      status: 'REFUNDED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', commission.id)

  // 4. Send notification
  await getTable(client, 'affiliate', 'notifications').insert({
    affiliate_id: commission.affiliate_id,
    type: 'COMMISSION_REFUNDED',
    title: 'Commission refunded',
    message: `A commission of $${commissionAmount.toFixed(2)} USD was refunded and cancelled.`,
    metadata: { invoiceId, commissionId: commission.id, previousStatus },
  })

  // 5. Audit log
  await getTable(client, 'affiliate', 'audit_logs').insert({
    action: 'COMMISSION_REFUNDED',
    target_type: 'commission',
    target_id: commission.id,
    reason: `Stripe charge refunded for invoice ${invoiceId}`,
    metadata: {
      chargeId: optionalString(charge, 'id'),
      invoiceId,
      previousStatus,
      reversalLedgerEntry: previousStatus === 'ELIGIBLE',
    },
  })

  return { status: 'commission_refunded', commissionId: commission.id }
}
