/**
 * CopyMonster Stripe Billing and Webhook handlers.
 * Runs on ctx.webServer using native fetch and node:crypto (zero external dependencies).
 * @module @deepseek-ai/dsh-api-auth-http/billing
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import crypto from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'
import { BEARER_PREFIX } from '@deepseek-ai/dsh-constants'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

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

/** Helper to read the raw body stream from an IncomingMessage. */
export function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Helper to make authenticated requests to Stripe REST API. */
async function callStripe(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
  stripeKey: string
): Promise<any> {
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
  toleranceSeconds = 300
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

  let body: any
  try {
    const raw = await readRawBody(req)
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    sendJson(res, 400, { error: 'invalid_json_body' })
    return
  }

  const { priceId, successUrl, cancelUrl } = body
  if (!priceId || typeof priceId !== 'string') {
    sendJson(res, 400, { error: 'missing_price_id' })
    return
  }

  try {
    // 1. Check or create Stripe Customer
    const { data: tenant, error: tenantErr } = await supabaseAdminClient
      .from('tenants')
      .select('id, stripe_customer_id, name')
      .eq('id', identity.tenantId)
      .single()

    if (tenantErr || !tenant) {
      sendJson(res, 404, { error: 'tenant_not_found' })
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
      customerId = customer.id

      await supabaseAdminClient
        .from('tenants')
        .update({ stripe_customer_id: customerId })
        .eq('id', identity.tenantId)
    }

    const host = req.headers.host || 'localhost:3000'
    const protocol = req.headers['x-forwarded-proto'] || 'http'
    const defaultSuccess = `${protocol}://${host}/billing/success?session_id={CHECKOUT_SESSION_ID}`
    const defaultCancel = `${protocol}://${host}/billing/cancel`

    // 2. Create Checkout Session
    const session = await callStripe('/checkout/sessions', {
      customer: customerId,
      mode: 'subscription',
      'payment_method_types[0]': 'card',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: successUrl || defaultSuccess,
      cancel_url: cancelUrl || defaultCancel,
      'metadata[tenant_id]': identity.tenantId,
      'metadata[user_id]': identity.userId,
      'subscription_data[metadata][tenant_id]': identity.tenantId,
    }, stripeKey)

    sendJson(res, 200, { url: session.url, sessionId: session.id })
  } catch (err: any) {
    sendJson(res, 500, { error: err.message || 'failed_to_create_checkout_session' })
  }
}

/**
 * Handle POST /api/billing/portal: Create Stripe Customer Portal Session.
 */
export async function handlePortal(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  let body: any = {}
  try {
    const raw = await readRawBody(req)
    if (raw.length > 0) body = JSON.parse(raw.toString('utf8'))
  } catch {
    // optional body
  }

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

    const host = req.headers.host || 'localhost:3000'
    const protocol = req.headers['x-forwarded-proto'] || 'http'
    const defaultReturn = `${protocol}://${host}/settings/plans`

    const portal = await callStripe('/billing_portal/sessions', {
      customer: tenant.stripe_customer_id,
      return_url: body.returnUrl || defaultReturn,
    }, stripeKey)

    sendJson(res, 200, { url: portal.url })
  } catch (err: any) {
    sendJson(res, 500, { error: err.message || 'failed_to_create_portal_session' })
  }
}

/**
 * Handle POST /api/billing/webhook: Process incoming Stripe events.
 */
export async function handleWebhook(_ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  const rawBody = await readRawBody(req)

  if (webhookSecret) {
    if (!sig || typeof sig !== 'string' || !verifyStripeSignature(rawBody, sig, webhookSecret)) {
      sendJson(res, 400, { error: 'invalid_webhook_signature' })
      return
    }
  }

  let event: any
  try {
    event = JSON.parse(rawBody.toString('utf8'))
  } catch {
    sendJson(res, 400, { error: 'invalid_payload' })
    return
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const tenantId = session.metadata?.tenant_id || session.subscription_data?.metadata?.tenant_id
        const customerId = session.customer
        const subscriptionId = session.subscription

        if (tenantId) {
          await supabaseAdminClient
            .from('tenants')
            .update({
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              subscription_status: 'active',
              trial_used: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', tenantId)
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const customerId = sub.customer
        const status = sub.status
        const cancelAtPeriodEnd = sub.cancel_at_period_end
        const interval = sub.items?.data?.[0]?.price?.recurring?.interval || 'month'
        const priceId = sub.items?.data?.[0]?.price?.id

        let planId: string | undefined
        if (priceId) {
          const { data: matchedPlan } = await supabaseAdminClient
            .from('plans')
            .select('id')
            .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_annual.eq.${priceId}`)
            .maybeSingle()
          if (matchedPlan) planId = matchedPlan.id
        }

        const updates: Record<string, any> = {
          subscription_status: status,
          cancel_at_period_end: cancelAtPeriodEnd,
          subscription_interval: interval,
          updated_at: new Date().toISOString(),
        }
        if (planId) updates.plan_id = planId

        await supabaseAdminClient
          .from('tenants')
          .update(updates)
          .eq('stripe_customer_id', customerId)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const customerId = sub.customer

        await supabaseAdminClient
          .from('tenants')
          .update({
            subscription_status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object
        // On recurring subscription cycle renewal, reset current cycle token meter
        if (invoice.billing_reason === 'subscription_cycle') {
          const customerId = invoice.customer
          await supabaseAdminClient
            .from('tenants')
            .update({
              current_period_tokens_used: 0,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_customer_id', customerId)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object
        const customerId = invoice.customer
        await supabaseAdminClient
          .from('tenants')
          .update({
            subscription_status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId)
        break
      }
    }

    sendJson(res, 200, { received: true })
  } catch (err: any) {
    sendJson(res, 500, { error: err.message || 'webhook_processing_failed' })
  }
}
