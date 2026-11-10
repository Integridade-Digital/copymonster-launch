import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_PAYOUT_AMOUNT, revalidateBeforePayout } from '../src/payout-executor.ts'

const AFFILIATE_ID = '550e8400-e29b-41d4-a716-446655440000'
const PAYOUT_ID = '660e8400-e29b-41d4-a716-446655440001'

interface State {
  profile?: Record<string, unknown> | null
  rule?: Record<string, unknown> | null
  balance?: Array<Record<string, unknown>>
  settled?: Record<string, unknown> | null
}

function client(state: State) {
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'affiliate.profiles') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state.profile ?? null, error: null }) }),
        }),
      }
    }
    if (table === 'affiliate.commission_rules') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: state.rule ?? { min_payout_amount: 50 }, error: null }) }),
          }),
        }),
      }
    }
    if (table === 'finance.ledger_entries') {
      return {
        select: (columns: string) => columns === 'amount, entry_type'
          ? {
              eq: () => ({
                eq: async () => ({ data: state.balance ?? [{ amount: 1000, entry_type: 'CREDIT' }], error: null }),
              }),
            }
          : {
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: state.settled ?? null, error: null }) }),
              }),
            },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from }
}

const approvedProfile = {
  id: AFFILIATE_ID,
  paypal_email: 'partner@example.com',
  active: true,
  kyc_status: 'APPROVED',
}

const payout = {
  id: PAYOUT_ID,
  affiliate_id: AFFILIATE_ID,
  amount: 100,
  paypal_email_snapshot: 'partner@example.com',
}

describe('revalidateBeforePayout', () => {
  it('accepts a payout that still satisfies every rule', async () => {
    const { from } = client({ profile: approvedProfile })
    await expect(revalidateBeforePayout({ from }, payout, undefined)).resolves.toEqual({ ok: true })
  })

  it('refuses when another payout consumed the balance after the request', async () => {
    const { from } = client({ profile: approvedProfile, balance: [{ amount: 30, entry_type: 'CREDIT' }] })
    await expect(revalidateBeforePayout({ from }, payout, undefined))
      .resolves.toEqual({ ok: false, reason: 'insufficient_balance' })
  })

  it('refuses when the affiliate changed the PayPal e-mail after the request', async () => {
    const { from } = client({ profile: { ...approvedProfile, paypal_email: 'other@example.com' } })
    await expect(revalidateBeforePayout({ from }, payout, undefined))
      .resolves.toEqual({ ok: false, reason: 'paypal_email_changed' })
  })

  it('refuses when the commission rule raised the minimum', async () => {
    const { from } = client({ profile: approvedProfile, rule: { min_payout_amount: 500 } })
    await expect(revalidateBeforePayout({ from }, payout, undefined))
      .resolves.toEqual({ ok: false, reason: 'below_minimum' })
  })

  it('refuses an amount above the per-payout ceiling', async () => {
    const { from } = client({ profile: approvedProfile })
    await expect(revalidateBeforePayout({ from }, { ...payout, amount: DEFAULT_MAX_PAYOUT_AMOUNT + 1 }, undefined))
      .resolves.toEqual({ ok: false, reason: 'above_ceiling' })
  })

  it('honours a caller-supplied ceiling', async () => {
    const { from } = client({ profile: approvedProfile })
    await expect(revalidateBeforePayout({ from }, payout, 50))
      .resolves.toEqual({ ok: false, reason: 'above_ceiling' })
  })

  it('refuses an affiliate that was deactivated or lost KYC approval', async () => {
    const inactive = client({ profile: { ...approvedProfile, active: false } })
    await expect(revalidateBeforePayout({ from: inactive.from }, payout, undefined))
      .resolves.toEqual({ ok: false, reason: 'affiliate_inactive' })

    const pending = client({ profile: { ...approvedProfile, kyc_status: 'PENDING' } })
    await expect(revalidateBeforePayout({ from: pending.from }, payout, undefined))
      .resolves.toEqual({ ok: false, reason: 'kyc_not_approved' })
  })

  it('refuses a payout that already produced a ledger debit', async () => {
    const { from } = client({ profile: approvedProfile, settled: { id: 'ledger-1' } })
    await expect(revalidateBeforePayout({ from }, payout, undefined))
      .resolves.toEqual({ ok: false, reason: 'already_settled' })
  })

  it('refuses a non-positive amount', async () => {
    const { from } = client({ profile: approvedProfile })
    await expect(revalidateBeforePayout({ from }, { ...payout, amount: 0 }, undefined))
      .resolves.toEqual({ ok: false, reason: 'invalid_amount' })
  })
})
