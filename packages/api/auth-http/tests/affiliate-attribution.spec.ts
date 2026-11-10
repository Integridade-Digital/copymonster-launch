import { describe, expect, it } from 'vitest'
import {
  AFFILIATE_REFERRAL_TTL_SECONDS,
  createAttributionToken,
  readAttributionCookie,
  resolveCheckoutAttribution,
  verifyAttributionToken,
} from '../src/affiliate-attribution.ts'

const SECRET = 'test-affiliate-secret-at-least-32-characters'
const OTHER_SECRET = 'another-affiliate-secret-32-characters!!'
const AFFILIATE_ID = '11111111-1111-4111-8111-111111111111'
const BUYER_ID = '22222222-2222-4222-8222-222222222222'
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0)

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AFFILIATE_ID,
    user_id: '33333333-3333-4333-8333-333333333333',
    active: true,
    kyc_status: 'APPROVED',
    ...overrides,
  }
}

function clientWith(row: Record<string, unknown> | null): { client: any; audits: Array<Record<string, unknown>> } {
  const audits: Array<Record<string, unknown>> = []
  const client = {
    schema: () => ({
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
            }),
          }
        }
        if (table === 'audit_logs') {
          return { insert: async (value: Record<string, unknown>) => { audits.push(value); return { data: null, error: null } } }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }),
  }
  return { client, audits }
}

describe('affiliate attribution tokens', () => {
  it('round-trips a token signed with the same secret', () => {
    const token = createAttributionToken(AFFILIATE_ID, SECRET, NOW)
    expect(verifyAttributionToken(token, SECRET, NOW)).toEqual({ ok: true, affiliateId: AFFILIATE_ID })
  })

  it('rejects a token signed with another secret', () => {
    const token = createAttributionToken(AFFILIATE_ID, OTHER_SECRET, NOW)
    expect(verifyAttributionToken(token, SECRET, NOW)).toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('rejects a token whose affiliate id was edited', () => {
    const token = createAttributionToken(AFFILIATE_ID, SECRET, NOW)
    const [encoded, signature] = token.split('.')
    const payload = Buffer.from(encoded ?? '', 'base64').toString('utf8')
    const tampered = Buffer.from(payload.replace(AFFILIATE_ID, '99999999-9999-4999-8999-999999999999')).toString('base64url')
    expect(verifyAttributionToken(`${tampered}.${signature}`, SECRET, NOW)).toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('rejects an expired token', () => {
    const token = createAttributionToken(AFFILIATE_ID, SECRET, NOW)
    const later = NOW + (AFFILIATE_REFERRAL_TTL_SECONDS + 1) * 1000
    expect(verifyAttributionToken(token, SECRET, later)).toEqual({ ok: false, reason: 'expired_token' })
  })

  it('reads only the attribution cookie', () => {
    expect(readAttributionCookie('sid=abc; affiliate_ref=tok.en; theme=dark')).toBe('tok.en')
    expect(readAttributionCookie('sid=abc')).toBeUndefined()
    expect(readAttributionCookie(undefined)).toBeUndefined()
    expect(readAttributionCookie('affiliate_ref=')).toBeUndefined()
  })
})

describe('resolveCheckoutAttribution', () => {
  const token = createAttributionToken(AFFILIATE_ID, SECRET, NOW)

  it('earns the commission for a signed cookie naming an eligible affiliate', async () => {
    const { client, audits } = clientWith(profileRow())
    const decision = await resolveCheckoutAttribution({
      cookieHeader: `affiliate_ref=${token}`,
      buyerUserId: BUYER_ID,
      secret: SECRET,
      client,
      nowMs: NOW,
    })
    expect(decision).toEqual({ ok: true, affiliateId: AFFILIATE_ID })
    expect(audits).toHaveLength(0)
  })

  it('creates no commission without a cookie', async () => {
    const { client, audits } = clientWith(profileRow())
    const decision = await resolveCheckoutAttribution({
      cookieHeader: undefined,
      buyerUserId: BUYER_ID,
      secret: SECRET,
      client,
      nowMs: NOW,
    })
    expect(decision).toEqual({ ok: false, reason: 'invalid_token' })
    expect(audits).toHaveLength(0)
  })

  it('rejects a forged cookie and records the refusal', async () => {
    const { client, audits } = clientWith(profileRow())
    const decision = await resolveCheckoutAttribution({
      cookieHeader: 'affiliate_ref=forged.signature',
      buyerUserId: BUYER_ID,
      secret: SECRET,
      client,
      nowMs: NOW,
    })
    expect(decision).toEqual({ ok: false, reason: 'invalid_token' })
    expect(audits).toHaveLength(0)
  })

  it('rejects self-referral and audits it', async () => {
    const { client, audits } = clientWith(profileRow({ user_id: BUYER_ID }))
    const decision = await resolveCheckoutAttribution({
      cookieHeader: `affiliate_ref=${token}`,
      buyerUserId: BUYER_ID,
      secret: SECRET,
      client,
      nowMs: NOW,
    })
    expect(decision).toEqual({ ok: false, reason: 'self_referral' })
    expect(audits[0]).toMatchObject({ action: 'REFERRAL_ATTRIBUTION_REFUSED', reason: 'self_referral' })
  })

  it('rejects an inactive affiliate', async () => {
    const { client, audits } = clientWith(profileRow({ active: false }))
    const decision = await resolveCheckoutAttribution({
      cookieHeader: `affiliate_ref=${token}`,
      buyerUserId: BUYER_ID,
      secret: SECRET,
      client,
      nowMs: NOW,
    })
    expect(decision).toEqual({ ok: false, reason: 'affiliate_inactive' })
    expect(audits[0]).toMatchObject({ reason: 'affiliate_inactive' })
  })

  it('rejects an affiliate whose KYC is not approved', async () => {
    const { client } = clientWith(profileRow({ kyc_status: 'PENDING' }))
    const decision = await resolveCheckoutAttribution({
      cookieHeader: `affiliate_ref=${token}`,
      buyerUserId: BUYER_ID,
      secret: SECRET,
      client,
      nowMs: NOW,
    })
    expect(decision).toEqual({ ok: false, reason: 'affiliate_kyc_pending' })
  })

  it('rejects an unknown affiliate', async () => {
    const { client, audits } = clientWith(null)
    const decision = await resolveCheckoutAttribution({
      cookieHeader: `affiliate_ref=${token}`,
      buyerUserId: BUYER_ID,
      secret: SECRET,
      client,
      nowMs: NOW,
    })
    expect(decision).toEqual({ ok: false, reason: 'unknown_affiliate' })
    expect(audits[0]).toMatchObject({ reason: 'unknown_affiliate' })
  })

  it('fails closed when the deployment has no signing secret', async () => {
    const { client } = clientWith(profileRow())
    const decision = await resolveCheckoutAttribution({
      cookieHeader: `affiliate_ref=${token}`,
      buyerUserId: BUYER_ID,
      secret: undefined,
      client,
      nowMs: NOW,
    })
    expect(decision).toEqual({ ok: false, reason: 'invalid_token' })
  })
})

describe('checkout attribution source', () => {
  it('never reads the affiliate from the request body', async () => {
    const fs = await import('node:fs/promises')
    const source = await fs.readFile(new URL('../src/billing.ts', import.meta.url), 'utf8')
    expect(source).not.toContain("'affiliateId'")
    expect(source).toContain('resolveCheckoutAttribution')
  })
})
