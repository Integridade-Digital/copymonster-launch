import { describe, expect, it } from 'vitest'
import { captureAffiliateRef, getAffiliateRef, isValidAffiliateRef } from '../src/lib/affiliate'

const validRef = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    setItem: (key: string, value: string) => values.set(key, value),
    getItem: (key: string) => values.get(key) ?? null,
  }
}

describe('affiliate referral attribution', () => {
  it('accepts UUID references and rejects malformed values', () => {
    expect(isValidAffiliateRef(validRef)).toBe(true)
    expect(isValidAffiliateRef('not-a-uuid')).toBe(false)
    expect(isValidAffiliateRef(null)).toBe(false)
  })

  it('captures valid ?ref values and ignores invalid ones', () => {
    const storage = memoryStorage()
    captureAffiliateRef(`?ref=${validRef}`, storage)
    expect(getAffiliateRef(storage)).toBe(validRef)
    captureAffiliateRef('?ref=javascript%3Aalert(1)', storage)
    expect(getAffiliateRef(storage)).toBe(validRef)
  })

  it('normalizes the saved identifier and does not return corrupted storage', () => {
    const storage = memoryStorage()
    storage.setItem('affiliate_ref', validRef.toUpperCase())
    expect(getAffiliateRef(storage)).toBe(validRef)
    storage.setItem('affiliate_ref', 'broken')
    expect(getAffiliateRef(storage)).toBeNull()
  })
})
