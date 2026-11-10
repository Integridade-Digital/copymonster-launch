/**
 * Client-safe affiliate helpers.
 *
 * Attribution is not computed in the browser: the signed `affiliate_ref`
 * cookie is set by `GET /api/affiliate/referral?ref=<uuid>` and read by the
 * checkout handler on the server. The referral link can still be built here.
 */
export const AFFILIATE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidAffiliateRef(value: string | null): value is string {
  return Boolean(value && AFFILIATE_UUID_PATTERN.test(value))
}

/**
 * Link a visitor to an affiliate through the signed attribution cookie.
 * @param affiliateId - affiliate profile id from the referral link.
 * @param href - current location href; the redirect returns here.
 * @returns the URL that issues the cookie, or null when the id is not a UUID.
 */
export function referralAttributionUrl(affiliateId: string | null, href: string): string | null {
  if (!isValidAffiliateRef(affiliateId)) return null
  const params = new URLSearchParams({ ref: affiliateId.toLowerCase(), next: href })
  return `/api/affiliate/referral?${params.toString()}`
}
