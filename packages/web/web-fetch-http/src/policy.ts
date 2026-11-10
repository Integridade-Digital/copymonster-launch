/**
 * URL validation and content-type classification for the local HTTP(S) fetch
 * provider — the pure, network-free half. The provider's `fetch()` composes
 * these with transport (redirect following, byte caps, decoding).
 *
 * @module @deepseek-ai/dsh-web-fetch-http/policy
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** Maximum accepted request URL length enforced by the fetch provider. */
export const WEB_FETCH_MAX_URL_LENGTH = 2048

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Parse a request URL and enforce network-independent transport restrictions:
 * HTTP(S) only and no embedded credentials. The provider applies this before
 * resolving a destination.
 *
 * @param input - the raw URL string from the fetch request.
 * @returns the parsed `URL`.
 */
export function parseFetchUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Validate a request URL against the provider's complete pre-network policy:
 * bounded length plus the restrictions enforced by {@link parseFetchUrl}.
 * Public-address resolution and connection pinning run after this check.
 *
 * @param input - the raw URL string from the fetch request.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string): URL {
  if (input.length > WEB_FETCH_MAX_URL_LENGTH) {
    throw new WebError(`URL exceeds the maximum length of ${WEB_FETCH_MAX_URL_LENGTH}`, 'WEB_INVALID_URL')
  }
  return parseFetchUrl(input)
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call.
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Whether an IPv4 address is public unicast.
 *
 * Refused: this-network (`0.0.0.0/8`), private (`10/8`, `172.16/12`,
 * `192.168/16`), loopback (`127/8`), link-local and cloud metadata
 * (`169.254/16`), multicast (`224/4`), reserved (`240/4`) and broadcast.
 *
 * @param address - dotted-quad IPv4 address.
 * @returns true only for a globally routable unicast address.
 */
export function isPublicIpv4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map(part => Number(part))
  if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  const [a = 0, b = 0] = octets

  if (a === 0 || a === 10 || a === 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
  if (a >= 224) return false // multicast, reserved, broadcast
  return true
}

/**
 * Expand an IPv6 address into its eight 16-bit groups.
 *
 * Handles `::` compression and a trailing dotted-quad. Returns undefined when
 * the text is not an IPv6 address.
 *
 * @param address - IPv6 address text.
 * @returns the eight groups, or undefined when unparseable.
 */
function expandIpv6(address: string): number[] | undefined {
  const withoutZone = address.split('%')[0] ?? ''
  if (withoutZone === '') return undefined

  const halves = withoutZone.split('::')
  if (halves.length > 2) return undefined

  const parseGroups = (text: string): number[] | undefined => {
    if (text === '') return []
    const groups: number[] = []
    for (const part of text.split(':')) {
      if (part.includes('.')) {
        const octets = part.split('.').map(octet => Number(octet))
        if (octets.length !== 4 || octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return undefined
        const [o0 = 0, o1 = 0, o2 = 0, o3 = 0] = octets
        groups.push((o0 << 8) | o1, (o2 << 8) | o3)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return undefined
      groups.push(parseInt(part, 16))
    }
    return groups
  }

  const head = parseGroups(halves[0] ?? '')
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : []
  if (head === undefined || tail === undefined) return undefined
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length
    if (fill < 0) return undefined
    return [...head, ...new Array<number>(fill).fill(0), ...tail]
  }
  return head.length === 8 ? head : undefined
}

/**
 * Whether an IPv6 address is public unicast.
 *
 * Refused: loopback (`::1`), unspecified (`::`), IPv4-mapped/translated forms
 * whose IPv4 part is not public, unique-local (`fc00::/7`), link-local
 * (`fe80::/10`), multicast (`ff00::/8`), and the deprecated site-local space.
 *
 * @param address - IPv6 address text.
 * @returns true only for a globally routable unicast address.
 */
export function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address)
  if (groups === undefined) return false
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups

  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) forms embed an IPv4
  // address that must pass the IPv4 rules, so a mapped 127.0.0.1 is still refused.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    const embedded = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`
    if (g5 === 0xffff) return isPublicIpv4(embedded)
    // `::` and `::1` fall out here: both embed an address that is not public.
    return g6 !== 0 || g7 > 1 ? isPublicIpv4(embedded) : false
  }

  if ((g0 & 0xffc0) === 0xfe80) return false // link-local fe80::/10
  if ((g0 & 0xfe00) === 0xfc00) return false // unique-local fc00::/7
  if ((g0 & 0xff00) === 0xff00) return false // multicast ff00::/8
  if ((g0 & 0xffc0) === 0xfec0) return false // site-local fec0::/10 (deprecated)
  return true
}

/**
 * Whether a hostname is a literal IP address.
 * @param hostname - URL hostname, in brackets when IPv6.
 * @returns the literal form, or undefined for a DNS name.
 */
export function literalIpAddress(hostname: string): string | undefined {
  const text = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (text.includes(':')) return /^[0-9a-f:.%]+$/i.test(text) ? text : undefined
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(text) ? text : undefined
}

/**
 * Reject a URL whose destination is not a public address reachable from this host.
 *
 * DNS names pass here: their addresses are known only after resolution, so the
 * provider resolves them and checks every answer with {@link isPublicAddress}.
 * A literal IP is checked immediately, which also covers `http://[::1]/` and
 * `http://169.254.169.254/` before any connection is attempted.
 *
 * @param url - a URL already validated by {@link validateFetchUrl}.
 * @returns the URL, unchanged.
 */
export function assertPublicDestination(url: URL): URL {
  const literal = literalIpAddress(url.hostname)
  if (literal !== undefined && !isPublicAddress(literal)) {
    throw new WebError(
      `blocked address "${literal}": only public destinations are reachable`,
      'WEB_BLOCKED_URL',
    )
  }
  return url
}

/**
 * Whether an resolved address is public unicast.
 * @param address - IPv4 or IPv6 address text.
 * @returns true only for a globally routable unicast address.
 */
export function isPublicAddress(address: string): boolean {
  return address.includes(':') ? isPublicIpv6(address) : isPublicIpv4(address)
}

/**
 * Pick the address a request connects to, or refuse the destination.
 *
 * Every answer must be public: a name that resolves to any private address is
 * refused outright rather than connected to a "good" one, because the server
 * chooses which answer it serves.
 *
 * @param addresses - every resolved address for the hostname.
 * @returns the first address, used to pin the connection.
 */
export function pinnedAddress(addresses: readonly string[]): string {
  if (addresses.length === 0) {
    throw new WebError('hostname did not resolve to any address', 'WEB_PROVIDER_ERROR')
  }
  for (const address of addresses) {
    if (!isPublicAddress(address)) {
      throw new WebError(
        `blocked address "${address}": only public destinations are reachable`,
        'WEB_BLOCKED_URL',
      )
    }
  }
  return addresses[0] ?? ''
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent. The provider feeds this label to `TextDecoder`
 * so a non-UTF-8 response is decoded with its declared encoding rather than
 * silently mangled into replacement characters.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the lower-cased charset label, or `undefined` when none is declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
 * none is declared. Throws {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when
 * the label is present but not a charset `TextDecoder` recognizes — better to
 * fail loudly than return mojibake.
 *
 * @param charset - the declared charset label (from {@link parseCharset}), or
 *   `undefined` to default to UTF-8.
 * @returns a decoder for the declared (or defaulted) encoding.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder('utf-8')
  try {
    return new TextDecoder(charset)
  } catch (error: unknown) {
    throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}
