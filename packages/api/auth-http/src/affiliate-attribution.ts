/**
 * Affiliate attribution for Stripe checkout.
 *
 * The browser never names the affiliate that earns a commission. A referral
 * visit resolves to a short-lived HMAC-signed token bound to the visitor's
 * HttpOnly cookie, and checkout reads only that cookie.
 *
 * Token format: `<payload>.<signature>`, both base64url.
 *
 * payload:  `<affiliateId>.<issuedAtEpochSeconds>`
 * signature: HMAC-SHA256 over the payload, keyed by the referral secret
 *
 * The signature makes a hand-edited affiliate id useless, and the timestamp
 * bounds how long a captured token keeps earning.
 * @module @deepseek-ai/dsh-api-auth-http/affiliate-attribution
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { supabaseAdminClient, type SupabaseClientType } from '@deepseek-ai/dsh-supabase-client'
import { getTable, UUID_REGEX } from './affiliate-processor.ts'

/** Path that resolves a referral view into an attribution cookie. */
export const AFFILIATE_REFERRAL_PATH = '/api/affiliate/referral'

/** Cookie carrying the signed attribution token. */
export const AFFILIATE_REFERRAL_COOKIE = 'affiliate_ref'

/**
 * How long an attribution token stays valid, in seconds.
 *
 * A visitor who follows a referral link and buys later keeps attribution for
 * this window; a stale token stops earning after it.
 */
export const AFFILIATE_REFERRAL_TTL_SECONDS = 30 * 24 * 60 * 60

/** Reasons an attribution is refused, reported in audit rows and responses. */
export type AttributionRejection =
  | 'unknown_affiliate'
  | 'affiliate_inactive'
  | 'affiliate_kyc_pending'
  | 'self_referral'
  | 'invalid_token'
  | 'expired_token'

interface AttributionDecision {
  readonly ok: boolean
  readonly affiliateId?: string
  readonly reason?: AttributionRejection
}

/** Secret used to sign attribution tokens. */
function referralSecret(): string | undefined {
  const secret = process.env.COPYMONSTER_AFFILIATE_SECRET
  return secret !== undefined && secret.length >= 32 ? secret : undefined
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest())
}

/**
 * Build a signed attribution token for one affiliate.
 * @param affiliateId - affiliate profile id.
 * @param secret - signing secret.
 * @param nowMs - issuance time in milliseconds; defaults to the current time.
 * @returns the token to store in the visitor's cookie.
 */
export function createAttributionToken(affiliateId: string, secret: string, nowMs = Date.now()): string {
  const payload = `${affiliateId}.${Math.floor(nowMs / 1000)}`
  return `${base64url(Buffer.from(payload, 'utf8'))}.${sign(payload, secret)}`
}

/**
 * Verify a signed attribution token and read the affiliate it names.
 *
 * The signature is compared in constant time; an edited affiliate id, a token
 * signed with another secret, or one older than
 * {@link AFFILIATE_REFERRAL_TTL_SECONDS} is refused.
 *
 * @param token - cookie value.
 * @param secret - signing secret.
 * @param nowMs - verification time in milliseconds; defaults to the current time.
 * @returns an ok decision naming the affiliate, or the rejection reason.
 */
export function verifyAttributionToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): AttributionDecision {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'invalid_token' }

  const encoded = token.slice(0, dot)
  const provided = fromBase64url(token.slice(dot + 1))
  if (provided === undefined) return { ok: false, reason: 'invalid_token' }

  const payload = fromBase64url(encoded)?.toString('utf8')
  if (payload === undefined) return { ok: false, reason: 'invalid_token' }

  const expected = fromBase64url(sign(payload, secret))
  if (expected === undefined || expected.length !== provided.length) {
    return { ok: false, reason: 'invalid_token' }
  }
  if (!timingSafeEqual(expected, provided)) return { ok: false, reason: 'invalid_token' }

  const [affiliateId, issuedAtText] = payload.split('.')
  const issuedAt = Number(issuedAtText)
  if (affiliateId === undefined || !UUID_REGEX.test(affiliateId) || !Number.isFinite(issuedAt)) {
    return { ok: false, reason: 'invalid_token' }
  }
  if (Math.floor(nowMs / 1000) - issuedAt > AFFILIATE_REFERRAL_TTL_SECONDS) {
    return { ok: false, reason: 'expired_token' }
  }

  return { ok: true, affiliateId: affiliateId.toLowerCase() }
}

/**
 * Read the attribution cookie from a request.
 * @param cookieHeader - raw `cookie` header value.
 * @returns the raw token, or undefined when the visitor has no attribution.
 */
export function readAttributionCookie(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    if (part.slice(0, eq).trim() !== AFFILIATE_REFERRAL_COOKIE) continue
    const value = part.slice(eq + 1).trim()
    return value === '' ? undefined : value
  }
  return undefined
}

/**
 * Resolve the affiliate that may earn a commission for this checkout.
 *
 * Checks the signature first, then the affiliate's own eligibility, then that
 * the buyer is not the affiliate. Every refusal is written to
 * `affiliate.audit_logs` without personal data.
 *
 * @param options - cookie header, buying identity, and Supabase client.
 * @returns an ok decision naming the affiliate, or the rejection reason.
 */
export async function resolveCheckoutAttribution(options: {
  cookieHeader: string | undefined
  buyerUserId: string
  secret: string | undefined
  client?: SupabaseClientType
  nowMs?: number
}): Promise<AttributionDecision> {
  const token = readAttributionCookie(options.cookieHeader)
  if (token === undefined) return { ok: false, reason: 'invalid_token' }
  if (options.secret === undefined) return { ok: false, reason: 'invalid_token' }

  const verified = verifyAttributionToken(token, options.secret, options.nowMs)
  if (!verified.ok || verified.affiliateId === undefined) return verified
  const affiliateId = verified.affiliateId

  const client = options.client ?? supabaseAdminClient
  const profiles = getTable(client, 'affiliate', 'profiles') as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>
      }
    }
  }
  const { data: profile } = await profiles
    .select('id, user_id, active, kyc_status')
    .eq('id', affiliateId)
    .maybeSingle()

  if (profile === null) {
    await recordAttributionRefusal(client, affiliateId, 'unknown_affiliate')
    return { ok: false, reason: 'unknown_affiliate' }
  }
  if (profile['active'] !== true) {
    await recordAttributionRefusal(client, affiliateId, 'affiliate_inactive')
    return { ok: false, reason: 'affiliate_inactive' }
  }
  if (profile['kyc_status'] !== 'APPROVED') {
    await recordAttributionRefusal(client, affiliateId, 'affiliate_kyc_pending')
    return { ok: false, reason: 'affiliate_kyc_pending' }
  }
  if (profile['user_id'] === options.buyerUserId) {
    await recordAttributionRefusal(client, affiliateId, 'self_referral')
    return { ok: false, reason: 'self_referral' }
  }

  return { ok: true, affiliateId }
}

async function recordAttributionRefusal(
  client: SupabaseClientType,
  affiliateId: string,
  reason: AttributionRejection,
): Promise<void> {
  const audits = getTable(client, 'affiliate', 'audit_logs') as {
    insert: (row: Record<string, unknown>) => Promise<unknown>
  }
  await audits.insert({
    action: 'REFERRAL_ATTRIBUTION_REFUSED',
    target_type: 'affiliate_profile',
    target_id: affiliateId,
    reason,
    metadata: {},
  })
}

/**
 * Handle `GET /api/affiliate/referral?ref=<uuid>`.
 *
 * The public landing page points here with the affiliate id from a referral
 * link. The route validates the affiliate, then sets the signed attribution
 * cookie and redirects to the app; an unknown or ineligible affiliate is
 * refused without setting a cookie.
 */
export async function handleAffiliateReferral(
  _ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
    return
  }

  const url = new URL(req.url ?? '/', 'https://app.copymonster.co')
  const candidate = url.searchParams.get('ref')?.trim().toLowerCase()
  if (candidate === undefined || candidate === '' || !UUID_REGEX.test(candidate)) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'invalid_referral' }))
    return
  }

  const secret = referralSecret()
  if (secret === undefined) {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'referral_disabled' }))
    return
  }

  const profiles = getTable(supabaseAdminClient, 'affiliate', 'profiles') as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>
      }
    }
  }
  const { data: profile } = await profiles
    .select('id, active, kyc_status')
    .eq('id', candidate)
    .maybeSingle()

  if (profile === null || profile['active'] !== true || profile['kyc_status'] !== 'APPROVED') {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'unknown_referral' }))
    return
  }

  const token = createAttributionToken(candidate, secret)
  res.writeHead(302, {
    location: '/',
    'set-cookie': `${AFFILIATE_REFERRAL_COOKIE}=${token}; Max-Age=${AFFILIATE_REFERRAL_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  })
  res.end()
}
