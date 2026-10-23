/** Shared bearer-token parsing for CopyMonster HTTP routes and RPC guards. */
import { BEARER_PREFIX } from '@deepseek-ai/dsh-constants'

/**
 * Extract the token from one Authorization header value.
 * @param value - raw header value, or undefined when the header is absent.
 * @returns the non-empty token after the `Bearer` prefix, or undefined.
 */
export function bearerToken(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith(BEARER_PREFIX)) return undefined
  const token = value.slice(BEARER_PREFIX.length).trim()
  return token === '' ? undefined : token
}
