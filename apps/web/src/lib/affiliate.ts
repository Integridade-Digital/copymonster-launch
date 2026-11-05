/** Client-safe affiliate attribution helpers. */
export const AFFILIATE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidAffiliateRef(value: string | null): value is string {
  return Boolean(value && AFFILIATE_UUID_PATTERN.test(value))
}

export function captureAffiliateRef(search: string, storage: Pick<Storage, 'setItem'>): void {
  const candidate = new URLSearchParams(search).get('ref')
  if (isValidAffiliateRef(candidate)) storage.setItem('affiliate_ref', candidate.toLowerCase())
}

export function getAffiliateRef(storage: Pick<Storage, 'getItem'>): string | null {
  const candidate = storage.getItem('affiliate_ref')
  return isValidAffiliateRef(candidate) ? candidate.toLowerCase() : null
}
