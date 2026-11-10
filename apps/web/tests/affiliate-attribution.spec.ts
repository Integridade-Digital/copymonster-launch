import { describe, expect, it } from 'vitest'
import { isValidAffiliateRef, referralAttributionUrl } from '../src/lib/affiliate'

const validRef = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

describe('affiliate referral attribution', () => {
  it('accepts UUID references and rejects malformed values', () => {
    expect(isValidAffiliateRef(validRef)).toBe(true)
    expect(isValidAffiliateRef('not-a-uuid')).toBe(false)
    expect(isValidAffiliateRef(null)).toBe(false)
  })

  it('builds the cookie-issuing URL for a valid referral', () => {
    expect(referralAttributionUrl(validRef, 'https://app.copymonster.co/register'))
      .toBe(`/api/affiliate/referral?ref=${validRef}&next=https%3A%2F%2Fapp.copymonster.co%2Fregister`)
  })

  it('normalizes the referral id to lower case', () => {
    expect(referralAttributionUrl(validRef.toUpperCase(), 'https://app.copymonster.co/'))
      .toBe(`/api/affiliate/referral?ref=${validRef}&next=https%3A%2F%2Fapp.copymonster.co%2F`)
  })

  it('returns null so an invalid referral is never sent to the server', () => {
    expect(referralAttributionUrl('javascript:alert(1)', 'https://app.copymonster.co/')).toBeNull()
    expect(referralAttributionUrl(null, 'https://app.copymonster.co/')).toBeNull()
  })
})
