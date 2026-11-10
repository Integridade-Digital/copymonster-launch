import {
  processAffiliateCommissionFromInvoice,
  processAffiliateRefundFromCharge,
} from './affiliate-processor.ts'
import { resolveCheckoutAttribution } from './affiliate-attribution.ts'
/**
 * CopyMonster Stripe Billing and Webhook handlers.
 * Runs on ctx.webServer using native fetch and node:crypto (zero external dependencies).
 * @module @deepseek-ai/dsh-api-auth-http/billing
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import crypto from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { hasSupabaseAdminClient, supabaseAdminClient, type Database } from '@deepseek-ai/dsh-supabase-client'
import { BEARER_PREFIX } from '@deepseek-ai/dsh-constants'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

/**
 * Main app that owns the service-role key and the Stripe credentials.
 *
 * A tenant DSH holds neither, so its billing routes forward here instead of
 * duplicating a privileged write path inside untrusted code.
 */
const MAIN_APP_URL = process.env.COPYMONSTER_MAIN_APP_URL ?? 'https://app.copymonster.co'

/**
 * Browser-facing platform origin. Checkout and portal redirects always name
 * this origin, never a caller-supplied URL or the request's Host header.
 */
const PUBLIC_APP_URL = process.env.COPYMONSTER_PUBLIC_URL ?? 'https://app.copymonster.co'

/**
 * Log one billing failure, keeping the detail server-side.
 *
 * Stripe, Supabase, and PayPal errors carry request ids, keys, amounts, and
 * customer data. The client receives only a stable code; the operator gets the
 * code plus a redacted message and error name.
 *
 * @param code - stable public error code returned to the caller.
 * @param err - the thrown value.
 */
function logBillingFailure(code: string, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err
  const detail = err instanceof Error ? redactSecrets(err.message) : ''
  console.error(JSON.stringify({ level: 'error', scope: 'billing', code, name, detail }))
}

/**
 * Remove credential-shaped substrings from a log line.
 * @param text - candidate message.
 * @returns the message with key-like tokens masked.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+/g, '$1_$2_[redacted]')
    .replace(/\bwhsec_[A-Za-z0-9]+/g, 'whsec_[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
}

/**
 * Forward one billing request to the main app unchanged.
 *
 * The body is read as raw bytes so a Stripe signature still verifies upstream,
 * and the caller's `Authorization` and `Stripe-Signature` headers travel with
 * it. The main app re-validates the Supabase JWT itself.
 * @param req - incoming billing request.
 * @param res - response to write with the upstream status and body.
 * @param path - billing route to forward to.
 */
async function forwardToMainApp(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const body = Buffer.concat(chunks)

  const headers: Record<string, string> = {
    'content-type': req.headers['content-type'] ?? 'application/json',
  }
  const authorization = req.headers.authorization
  if (authorization !== undefined) headers.authorization = authorization
  const signature = req.headers['stripe-signature']
  if (typeof signature === 'string') headers['stripe-signature'] = signature

  try {
    const upstream = await fetch(`${MAIN_APP_URL}${path}`, {
      method: req.method ?? 'POST',
      headers,
      body,
    })
    const text = await upstream.text()
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    })
    res.end(text)
  } catch {
    sendJson(res, 502, { error: 'billing_upstream_unavailable' })
  }
}

/** Helper to extract bearer token from headers. */
function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || !value.startsWith(BEARER_PREFIX)) return undefined
  const token = value.slice(BEARER_PREFIX.length).trim()
  return token === '' ? undefined : token
}

/** Helper to send JSON responses. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Inclusive cap on one billing request body. */
export const MAX_RAW_BODY_BYTES = 1024 * 1024

/** A request body above {@link MAX_RAW_BODY_BYTES}. */
export class PayloadTooLargeError extends Error {
  /** @param limit - byte cap the body exceeded. */
  constructor(readonly limit: number) {
    super(`request body exceeds ${String(limit)} bytes`)
    this.name = 'PayloadTooLargeError'
  }
}

/**
 * Read the raw body stream, refusing a body above the cap.
 * @param req - incoming request.
 * @param maxBytes - inclusive byte cap.
 * @returns the complete body.
 * @throws PayloadTooLargeError once the stream passes the cap.
 */
export function readRawBody(req: IncomingMessage, maxBytes = MAX_RAW_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const cleanup = (): void => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.byteLength
      if (bytes > maxBytes) {
        cleanup()
        reject(new PayloadTooLargeError(maxBytes))
        req.destroy()
        return
      }
      chunks.push(buffer)
    }
    const onEnd = (): void => {
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

/**
 * Read a billing body and answer 413 when it exceeds the cap.
 * @param req - incoming request.
 * @param res - response owned on refusal.
 * @returns the body, or undefined after the refusal was written.
 */
async function readBoundedBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer | undefined> {
  try {
    return await readRawBody(req)
  } catch (error: unknown) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large', limit: error.limit })
      return undefined
    }
    throw error
  }
}

/**
 * Narrow one parsed JSON value to a JSON object.
 * @param value - a value read from a parsed request or webhook payload.
 * @returns the value as an object, or an empty object when it is not one.
 */
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Read a nested JSON object from a parsed payload. */
function objectField(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return asObject(source[key])
}

/** Read a nested JSON array from a parsed payload. */
function arrayField(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key]
  return Array.isArray(value) ? value : []
}

/** Read a non-empty string field from a parsed payload. */
function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Read a boolean field from a parsed payload. */
function optionalBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * Parse a request body as a JSON object.
 * @param raw - the raw request body.
 * @returns the parsed object, or undefined when the body is empty, malformed, or not a JSON object.
 */
function parseJsonObject(raw: Buffer): Record<string, unknown> | undefined {
  if (raw.length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

/** Helper to make authenticated requests to Stripe REST API. */
async function callStripe(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
  stripeKey: string,
): Promise<Record<string, unknown>> {
  const formBody: string[] = []
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined) {
      formBody.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`)
    }
  }

  const res = await fetch(`${STRIPE_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody.join('&'),
  })

  const json = await res.json()
  if (!res.ok) {
    const errorMsg = json?.error?.message || `Stripe API error (${res.status})`
    throw new Error(errorMsg)
  }
  return json
}

/**
 * Validates Stripe webhook HMAC-SHA256 signature using constant-time comparison.
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSeconds = 300,
): boolean {
  try {
    const parts = signatureHeader.split(',')
    let timestamp = ''
    const signatures: string[] = []

    for (const part of parts) {
      const [k, v] = part.trim().split('=')
      if (k === 't' && v !== undefined) timestamp = v
      if (k === 'v1' && v !== undefined) signatures.push(v)
    }

    if (!timestamp || signatures.length === 0) return false

    const now = Math.floor(Date.now() / 1000)
    const eventTime = parseInt(timestamp, 10)
    if (isNaN(eventTime) || Math.abs(now - eventTime) > toleranceSeconds) {
      return false
    }

    const payloadToSign = `${timestamp}.${rawBody.toString('utf8')}`
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payloadToSign)
      .digest('hex')

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
    for (const sig of signatures) {
      const sigBuffer = Buffer.from(sig, 'utf8')
      if (sigBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Handle POST /api/billing/checkout: Create Stripe Checkout Session.
 */
export async function handleCheckout(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!hasSupabaseAdminClient()) {
    await forwardToMainApp(req, res, '/api/billing/checkout')
    return
  }
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

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    sendJson(res, 500, { error: 'stripe_secret_key_not_configured' })
    return
  }

  // The body is caller-supplied; parse it only to enforce the byte cap. The
  // affiliate is never read from here: a client could name any profile id and
  // redirect another affiliate's commission. Only the signed attribution
  // cookie from GET /api/affiliate/referral names the affiliate.
  const raw = await readBoundedBody(req, res)
  if (raw === undefined) return

  const attribution = await resolveCheckoutAttribution({
    cookieHeader: req.headers.cookie,
    buyerUserId: identity.userId,
    secret: process.env.COPYMONSTER_AFFILIATE_SECRET,
  })
  const affiliateId = attribution.ok ? attribution.affiliateId : undefined

  try {
    // 1. Check or create Stripe Customer
    const { data: tenant, error: tenantErr } = await supabaseAdminClient
      .from('tenants')
      .select('id, stripe_customer_id, name, plan_id')
      .eq('id', identity.tenantId)
      .single()

    if (tenantErr || !tenant) {
      sendJson(res, 404, { error: 'tenant_not_found' })
      return
    }

    // 2. The price is the tenant's plan, never a client-supplied value.
    if (!tenant.plan_id) {
      sendJson(res, 400, {
        error: 'plan_not_billable',
        message: 'Your workspace has no billable plan yet. Choose a plan to continue.',
      })
      return
    }
    const { data: plan, error: planErr } = await supabaseAdminClient
      .from('plans')
      .select('stripe_price_id')
      .eq('id', tenant.plan_id)
      .single()
    const priceId = planErr === null ? plan?.stripe_price_id : undefined
    if (typeof priceId !== 'string' || priceId === '') {
      sendJson(res, 400, {
        error: 'plan_not_billable',
        message: 'This plan is not available for checkout yet. Please contact support.',
      })
      return
    }

    let customerId = tenant.stripe_customer_id
    if (!customerId) {
      const customer = await callStripe('/customers', {
        email: identity.email,
        name: identity.fullName || tenant.name || 'CopyMonster Customer',
        'metadata[tenant_id]': identity.tenantId,
        'metadata[user_id]': identity.userId,
      }, stripeKey)
      const createdCustomerId = optionalString(customer, 'id')
      if (createdCustomerId === undefined) {
        sendJson(res, 502, { error: 'stripe_customer_id_missing' })
        return
      }
      customerId = createdCustomerId

      await supabaseAdminClient
        .from('tenants')
        .update({ stripe_customer_id: createdCustomerId })
        .eq('id', identity.tenantId)
    }

    // 3. Create Checkout Session. Redirects always return to the platform
    // origin, so a caller cannot turn checkout into an open redirect.
    const sessionParams: Record<string, string | number | boolean | undefined> = {
      customer: customerId,
      mode: 'subscription',
      'payment_method_types[0]': 'card',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: `${PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_APP_URL}/billing/cancel`,
      'metadata[tenant_id]': identity.tenantId,
      'metadata[user_id]': identity.userId,
      'subscription_data[metadata][tenant_id]': identity.tenantId,
    }

    if (affiliateId !== undefined) {
      sessionParams['metadata[affiliate_id]'] = affiliateId
      sessionParams['subscription_data[metadata][affiliate_id]'] = affiliateId
    }

    const session = await callStripe('/checkout/sessions', sessionParams, stripeKey)

    sendJson(res, 200, { url: session.url, sessionId: session.id })
  } catch (err: unknown) {
    logBillingFailure('BILLING_CHECKOUT_FAILED', err)
    sendJson(res, 500, { error: 'BILLING_CHECKOUT_FAILED' })
  }
}

/**
 * Handle POST /api/billing/portal: Create Stripe Customer Portal Session.
 */
export async function handlePortal(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!hasSupabaseAdminClient()) {
    await forwardToMainApp(req, res, '/api/billing/portal')
    return
  }
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

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    sendJson(res, 500, { error: 'stripe_secret_key_not_configured' })
    return
  }

  const raw = await readBoundedBody(req, res)
  if (raw === undefined) return

  try {
    const { data: tenant, error: tenantErr } = await supabaseAdminClient
      .from('tenants')
      .select('stripe_customer_id')
      .eq('id', identity.tenantId)
      .single()

    if (tenantErr || !tenant || !tenant.stripe_customer_id) {
      sendJson(res, 400, { error: 'no_stripe_customer_registered' })
      return
    }

    const portal = await callStripe('/billing_portal/sessions', {
      customer: tenant.stripe_customer_id,
      return_url: `${PUBLIC_APP_URL}/settings/plans`,
    }, stripeKey)

    sendJson(res, 200, { url: portal.url })
  } catch (err: unknown) {
    logBillingFailure('BILLING_PORTAL_FAILED', err)
    sendJson(res, 500, { error: 'BILLING_PORTAL_FAILED' })
  }
}

/**
 * Handle POST /api/billing/webhook: Process incoming Stripe events.
 */

/** Parse Stripe timestamp (seconds or ISO string) to an ISO 8601 string. */
function parseTimestampToIso(value: unknown): string | undefined {
  if (typeof value === 'number' && !isNaN(value) && value > 0) {
    return new Date(value * 1000).toISOString()
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value)
    if (!isNaN(num) && num > 0) {
      return new Date(num * 1000).toISOString()
    }
    const d = new Date(value)
    if (!isNaN(d.getTime())) {
      return d.toISOString()
    }
  }
  return undefined
}

export async function handleWebhook(_ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!hasSupabaseAdminClient()) {
    await forwardToMainApp(req, res, '/api/billing/webhook')
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  const rawBody = await readBoundedBody(req, res)
  if (rawBody === undefined) return

  if (!webhookSecret) {
    sendJson(res, 500, { error: 'stripe_webhook_secret_not_configured' })
    return
  }

  if (!sig || typeof sig !== 'string' || !verifyStripeSignature(rawBody, sig, webhookSecret)) {
    sendJson(res, 400, { error: 'invalid_webhook_signature' })
    return
  }

  const payload = parseJsonObject(rawBody)
  if (payload === undefined) {
    sendJson(res, 400, { error: 'invalid_payload' })
    return
  }
  const object = objectField(objectField(payload, 'data'), 'object')
  const eventType = optionalString(payload, 'type') ?? ''

  try {
    switch (eventType) {
      case 'checkout.session.completed': {
        const subscriptionData = objectField(object, 'subscription_data')
        const tenantId = optionalString(objectField(object, 'metadata'), 'tenant_id')
          ?? optionalString(objectField(subscriptionData, 'metadata'), 'tenant_id')

        const rawPeriodEnd = object['current_period_end'] ?? subscriptionData['current_period_end']
        const currentPeriodEnd = parseTimestampToIso(rawPeriodEnd)

        if (tenantId !== undefined) {
          const tenantUpdates: Database['public']['Tables']['tenants']['Update'] = {
            stripe_customer_id: optionalString(object, 'customer') ?? null,
            stripe_subscription_id: optionalString(object, 'subscription') ?? null,
            subscription_status: 'active',
            trial_used: true,
            updated_at: new Date().toISOString(),
          }
          if (currentPeriodEnd !== undefined) {
            tenantUpdates.current_period_end = currentPeriodEnd
          }

          await supabaseAdminClient
            .from('tenants')
            .update(tenantUpdates)
            .eq('id', tenantId)
        }
        break
      }

      case 'customer.subscription.updated': {
        const [firstItem] = arrayField(objectField(object, 'items'), 'data')
        const price = objectField(asObject(firstItem), 'price')
        const priceId = optionalString(price, 'id')

        let planId: string | undefined
        if (priceId !== undefined) {
          // `priceId` comes from the webhook payload; a PostgREST `.or()` string
          // would let a value containing `,` or `)` add its own filter terms. Two
          // equality lookups keep the value a literal operand.
          const { data: matchedPlan } = await supabaseAdminClient
            .from('plans')
            .select('id')
            .eq('stripe_price_id_monthly', priceId)
            .maybeSingle()
          const { data: annualPlan } = matchedPlan
            ? { data: null }
            : await supabaseAdminClient
                .from('plans')
                .select('id')
                .eq('stripe_price_id_annual', priceId)
                .maybeSingle()
          const plan = matchedPlan ?? annualPlan
          if (plan) planId = plan.id
        }

        const updates: Database['public']['Tables']['tenants']['Update'] = {
          updated_at: new Date().toISOString(),
        }
        const status = optionalString(object, 'status')
        if (status !== undefined) updates.subscription_status = status
        const cancelAtPeriodEnd = optionalBoolean(object, 'cancel_at_period_end')
        if (cancelAtPeriodEnd !== undefined) updates.cancel_at_period_end = cancelAtPeriodEnd
        const interval = optionalString(objectField(price, 'recurring'), 'interval')
        if (interval !== undefined) updates.subscription_interval = interval
        if (planId !== undefined) updates.plan_id = planId

        const currentPeriodEnd = parseTimestampToIso(object['current_period_end'])
        if (currentPeriodEnd !== undefined) {
          updates.current_period_end = currentPeriodEnd
        }

        const customerId = optionalString(object, 'customer')
        if (customerId !== undefined) {
          await supabaseAdminClient
            .from('tenants')
            .update(updates)
            .eq('stripe_customer_id', customerId)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const customerId = optionalString(object, 'customer')
        if (customerId !== undefined) {
          await supabaseAdminClient
            .from('tenants')
            .update({
              subscription_status: 'canceled',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_customer_id', customerId)
        }
        break
      }

      case 'invoice.payment_succeeded':
      case 'invoice.paid': {
        // On recurring subscription cycle renewal, reset current cycle token meter
        const customerId = optionalString(object, 'customer')
        if (optionalString(object, 'billing_reason') === 'subscription_cycle' && customerId !== undefined) {
          await supabaseAdminClient
            .from('tenants')
            .update({
              current_period_tokens_used: 0,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_customer_id', customerId)
        }

        // Process affiliate commission if invoice carries affiliate_id metadata
        const eventId = optionalString(payload, 'id') ?? ''
        await processAffiliateCommissionFromInvoice(object, eventId)
        break
      }

      case 'charge.refunded': {
        await processAffiliateRefundFromCharge(object)
        break
      }

      case 'invoice.payment_failed': {
        const customerId = optionalString(object, 'customer')
        if (customerId !== undefined) {
          await supabaseAdminClient
            .from('tenants')
            .update({
              subscription_status: 'past_due',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_customer_id', customerId)
        }
        break
      }

      default:
        // Event types this handler does not act on are acknowledged so Stripe stops retrying them.
        break
    }

    sendJson(res, 200, { received: true })
  } catch (err: unknown) {
    logBillingFailure('BILLING_WEBHOOK_FAILED', err)
    sendJson(res, 500, { error: 'BILLING_WEBHOOK_FAILED' })
  }
}

export {
  processAffiliateCommissionFromInvoice,
  processAffiliateRefundFromCharge,
} from './affiliate-processor.ts'
