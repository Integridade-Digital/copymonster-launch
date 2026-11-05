/**
 * CopyMonster Affiliate Payout Executor and Request Service.
 *
 * Implements atomic payout requests, optimistic concurrency locking,
 * PayPal Payouts integration, double-entry ledger DEBIT entries, and audit trail.
 * @module @deepseek-ai/dsh-api-auth-http/payout-executor
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'
import { BEARER_PREFIX } from '@deepseek-ai/dsh-constants'
import { getTable, UUID_REGEX } from './affiliate-processor.ts'
import { createPaypalPayout } from './paypal-payout.ts'

export const AFFILIATE_PAYOUT_REQUEST_PATH = '/api/affiliate/payout/request'
export const AFFILIATE_PAYOUT_REQUEST_ALIAS = '/api/affiliate/request-affiliate-payout'
export const ADMIN_PAYOUT_EXECUTE_PATH = '/api/admin/affiliate/payout/execute'
export const ADMIN_PAYOUT_EXECUTE_ALIAS = '/api/admin/admin-execute-payout'

/** Helper to extract bearer token from headers */
function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || !value.startsWith(BEARER_PREFIX)) return undefined
  const token = value.slice(BEARER_PREFIX.length).trim()
  return token === '' ? undefined : token
}

/** Write JSON response */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Read request body */
async function readBodyJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Calculate the affiliate's current ledger balance (available, total credited, total debited).
 */
export async function getAffiliateBalance(
  affiliateId: string,
  client: any = supabaseAdminClient,
): Promise<{ credit: number; debit: number; available: number }> {
  const { data: entries, error } = await getTable(client, 'finance', 'ledger_entries')
    .select('amount, entry_type')
    .eq('affiliate_id', affiliateId)
    .eq('active', true)

  if (error || !entries) {
    return { credit: 0, debit: 0, available: 0 }
  }

  let credit = 0
  let debit = 0
  for (const entry of entries) {
    const amt = Number(entry.amount) || 0
    if (entry.entry_type === 'CREDIT') {
      credit += amt
    } else if (entry.entry_type === 'DEBIT') {
      debit += amt
    }
  }

  const available = Number(Math.max(0, credit - debit).toFixed(2))
  return {
    credit: Number(credit.toFixed(2)),
    debit: Number(debit.toFixed(2)),
    available,
  }
}

export interface RequestPayoutParams {
  userId: string
  amount: number
  client?: any
}

export interface RequestPayoutResult {
  success: boolean
  payout?: Record<string, unknown>
  error?: string
  minAmount?: number
  available?: number
  existingPayoutId?: string
}

/**
 * Request an affiliate payout (called by partner user).
 *
 * Enforces:
 * 1. Profile existence and approved KYC (kyc_status = 'APPROVED')
 * 2. Valid PayPal email snapshot in profile
 * 3. Minimum payout amount according to active commission rule (default $50.00)
 * 4. No other payout request currently in progress (REQUESTED, APPROVED, PROCESSING)
 * 5. Requested amount <= available ledger balance
 */
export async function requestAffiliatePayout(
  params: RequestPayoutParams,
): Promise<RequestPayoutResult> {
  const client = params.client ?? supabaseAdminClient
  const amount = Number(params.amount)

  if (!params.userId) {
    return { success: false, error: 'user_id_required' }
  }

  if (isNaN(amount) || amount <= 0) {
    return { success: false, error: 'invalid_amount' }
  }

  // 1. Locate affiliate profile
  const { data: profile } = await getTable(client, 'affiliate', 'profiles')
    .select('id, user_id, full_name, paypal_email, kyc_status, active')
    .eq('user_id', params.userId)
    .eq('active', true)
    .maybeSingle()

  if (!profile) {
    return { success: false, error: 'profile_not_found' }
  }

  if (profile.kyc_status !== 'APPROVED') {
    return { success: false, error: 'kyc_not_approved' }
  }

  if (!profile.paypal_email || typeof profile.paypal_email !== 'string' || !profile.paypal_email.includes('@')) {
    return { success: false, error: 'paypal_email_missing_or_invalid' }
  }

  // 2. Validate against active commission rule (minimum payout amount)
  const { data: rule } = await getTable(client, 'affiliate', 'commission_rules')
    .select('min_payout_amount')
    .eq('is_current', true)
    .eq('active', true)
    .maybeSingle()

  const minPayout = Number(rule?.min_payout_amount ?? 50.0)
  if (amount < minPayout) {
    return { success: false, error: 'amount_below_minimum', minAmount: minPayout }
  }

  // 3. Ensure no concurrent payout request is already open
  const { data: existingPayouts } = await getTable(client, 'finance', 'payout_requests')
    .select('id, status')
    .eq('affiliate_id', profile.id)
    .eq('active', true)
    .in('status', ['REQUESTED', 'APPROVED', 'PROCESSING'])

  if (existingPayouts && existingPayouts.length > 0) {
    return {
      success: false,
      error: 'payout_already_in_progress',
      existingPayoutId: existingPayouts[0].id,
    }
  }

  // 4. Validate available balance from ledger
  const balance = await getAffiliateBalance(profile.id, client)
  if (amount > balance.available) {
    return {
      success: false,
      error: 'insufficient_balance',
      available: balance.available,
      minAmount: minPayout,
    }
  }

  // 5. Insert new payout request in REQUESTED status
  const payoutRecord = {
    affiliate_id: profile.id,
    amount: Number(amount.toFixed(2)),
    paypal_email_snapshot: profile.paypal_email,
    status: 'REQUESTED',
    active: true,
  }

  const { data: inserted, error: insertError } = await getTable(client, 'finance', 'payout_requests')
    .insert(payoutRecord)
    .select('id, affiliate_id, amount, paypal_email_snapshot, status, created_at')
    .single()

  if (insertError || !inserted) {
    return { success: false, error: insertError?.message ?? 'insert_failed' }
  }

  // 6. Notify affiliate
  await getTable(client, 'affiliate', 'notifications').insert({
    affiliate_id: profile.id,
    type: 'PAYOUT_REQUESTED',
    title: 'Solicitação de saque enviada',
    message: `Sua solicitação de saque no valor de $${amount.toFixed(2)} USD foi registrada e está aguardando aprovação.`,
    metadata: { payoutId: inserted.id, amount },
  })

  return { success: true, payout: inserted }
}

export interface ExecutePayoutOptions {
  adminUserId?: string
  client?: any
}

export interface ExecutePayoutResult {
  success: boolean
  payoutId?: string
  batchId?: string
  error?: string
  status?: string
}

/**
 * Execute an approved payout request via PayPal (called by administrator).
 *
 * Enforces:
 * 1. Payout request exists and status is REQUESTED or APPROVED.
 * 2. Optimistic concurrency lock: transitions status to 'PROCESSING'.
 * 3. PayPal Payouts API execution (real or PAYPAL_MOCK).
 * 4. On PayPal success: updates status to 'EXECUTED', sets batchId, and records
 *    compensatory DEBIT entry in finance.ledger_entries (reference_type = 'PAYOUT').
 * 5. On PayPal failure: updates status to 'FAILED', logs audit error.
 */
export async function executePayout(
  payoutId: string,
  options?: ExecutePayoutOptions,
): Promise<ExecutePayoutResult> {
  const client = options?.client ?? supabaseAdminClient

  if (!payoutId || !UUID_REGEX.test(payoutId)) {
    return { success: false, error: 'invalid_payout_id' }
  }

  // 1. Fetch payout request
  const { data: payout, error: fetchError } = await getTable(client, 'finance', 'payout_requests')
    .select('id, affiliate_id, amount, paypal_email_snapshot, status, active')
    .eq('id', payoutId)
    .eq('active', true)
    .maybeSingle()

  if (fetchError || !payout) {
    return { success: false, error: 'payout_not_found' }
  }

  if (payout.status !== 'REQUESTED' && payout.status !== 'APPROVED') {
    return {
      success: false,
      error: `payout_not_eligible_status_${payout.status.toLowerCase()}`,
    }
  }

  // 2. Optimistic Concurrency Lock: UPDATE status = 'PROCESSING'
  const { data: locked, error: lockError } = await getTable(client, 'finance', 'payout_requests')
    .update({
      status: 'PROCESSING',
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId)
    .in('status', ['REQUESTED', 'APPROVED'])
    .select('id, affiliate_id, amount, paypal_email_snapshot, status')
    .maybeSingle()

  if (lockError || !locked) {
    return { success: false, error: 'concurrent_lock_failed' }
  }

  // 3. Dispatch to PayPal Payouts
  const paypalResult = await createPaypalPayout({
    payoutId: payout.id,
    amount: Number(payout.amount),
    paypalEmail: payout.paypal_email_snapshot,
    currency: 'USD',
    note: 'CopyMonster Affiliate Payout',
  })

  // 4. Handle PayPal Failure
  if (!paypalResult.success || !paypalResult.batchId) {
    const failureReason = paypalResult.error ?? 'paypal_execution_failed'

    await getTable(client, 'finance', 'payout_requests')
      .update({
        status: 'FAILED',
        rejection_reason: failureReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payoutId)

    await getTable(client, 'affiliate', 'audit_logs').insert({
      action: 'PAYOUT_FAILED',
      target_type: 'payout_request',
      target_id: payoutId,
      admin_user_id: options?.adminUserId ?? null,
      reason: failureReason,
      metadata: { payoutId, amount: payout.amount, error: failureReason },
    })

    return {
      success: false,
      payoutId,
      error: failureReason,
    }
  }

  const batchId = paypalResult.batchId

  // 5. Handle PayPal Success: transition to EXECUTED and record DEBIT in ledger
  await getTable(client, 'finance', 'payout_requests')
    .update({
      status: 'EXECUTED',
      paypal_payout_batch_id: batchId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId)

  // Double-entry ledger DEBIT entry (protected by unique index idx_ledger_payout_unique)
  await getTable(client, 'finance', 'ledger_entries').insert({
    affiliate_id: payout.affiliate_id,
    amount: Number(payout.amount),
    entry_type: 'DEBIT',
    reference_type: 'PAYOUT',
    reference_id: payout.id,
    description: `PayPal Payout to ${payout.paypal_email_snapshot} (batch: ${batchId})`,
    active: true,
  })

  // Notify affiliate
  await getTable(client, 'affiliate', 'notifications').insert({
    affiliate_id: payout.affiliate_id,
    type: 'PAYOUT_EXECUTED',
    title: 'Saque enviado com sucesso!',
    message: `Seu saque no valor de $${Number(payout.amount).toFixed(2)} USD foi enviado via PayPal. Identificador do lote: ${batchId}.`,
    metadata: { payoutId, batchId, amount: payout.amount },
  })

  // Record audit log
  await getTable(client, 'affiliate', 'audit_logs').insert({
    action: 'PAYOUT_EXECUTED',
    target_type: 'payout_request',
    target_id: payoutId,
    admin_user_id: options?.adminUserId ?? null,
    reason: `PayPal batch ${batchId} executed successfully`,
    metadata: { payoutId, batchId, amount: payout.amount, email: payout.paypal_email_snapshot },
  })

  return {
    success: true,
    payoutId,
    batchId,
    status: 'EXECUTED',
  }
}

/**
 * Handle POST /api/affiliate/payout/request
 */
export async function handleRequestAffiliatePayout(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  const token = bearerToken(req.headers.authorization)
  if (!token) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  const identity = await ctx.auth.resolveIdentity(token)
  if (!identity || !identity.userId) {
    sendJson(res, 401, { error: 'invalid_identity' })
    return
  }

  const body = await readBodyJson(req)
  if (!body) {
    sendJson(res, 400, { error: 'invalid_json' })
    return
  }

  const amount = Number(body.amount)
  if (isNaN(amount) || amount <= 0) {
    sendJson(res, 400, { error: 'invalid_amount' })
    return
  }

  const result = await requestAffiliatePayout({
    userId: identity.userId,
    amount,
  })

  if (!result.success) {
    sendJson(res, 400, result)
    return
  }

  sendJson(res, 201, result)
}

/**
 * Handle POST /api/admin/affiliate/payout/execute
 */
export async function handleAdminExecutePayout(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  const token = bearerToken(req.headers.authorization)
  if (!token) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  const identity = await ctx.auth.resolveIdentity(token)
  if (!identity) {
    sendJson(res, 401, { error: 'invalid_identity' })
    return
  }

  // Operator access check: isAdmin || role in ('admin', 'owner')
  const isOperator = identity.isAdmin === true || identity.role === 'admin' || identity.role === 'owner'
  if (!isOperator) {
    sendJson(res, 403, { error: 'forbidden' })
    return
  }

  const body = await readBodyJson(req)
  if (!body) {
    sendJson(res, 400, { error: 'invalid_json' })
    return
  }

  const payoutId = typeof body.payoutId === 'string' ? body.payoutId.trim() : undefined
  if (!payoutId || !UUID_REGEX.test(payoutId)) {
    sendJson(res, 400, { error: 'invalid_payout_id' })
    return
  }

  const result = await executePayout(payoutId, {
    adminUserId: identity.userId,
  })

  if (!result.success) {
    sendJson(res, 400, result)
    return
  }

  sendJson(res, 200, result)
}
