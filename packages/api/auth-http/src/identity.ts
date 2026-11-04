/**
 * Deployment identity handshake: verify the signed caller identity the
 * per-tenant proxy attaches to every browser request.
 *
 * The proxy authenticates the browser session and signs
 * `{ sub, tenant, role, isAdmin, iat, exp }` with an Ed25519 private key. The
 * tenant holds only the public key, so a process inside the tenant can verify
 * the identity but cannot mint one. A request that carries the header but
 * fails verification is refused instead of falling back to the local owner.
 * @module @deepseek-ai/dsh-api-auth-http/identity
 */

import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import type { ConnectionPrincipalResolver, ConnectionTrustRequest } from '@deepseek-ai/dsh-client-connection'
import type { Principal } from '@deepseek-ai/dsh-typert-protocol'

/** Header carrying the proxy-signed caller identity. */
export const IDENTITY_HEADER = 'x-dsh-identity'

/** Clock tolerance for a proxy and tenant on the same host. */
const CLOCK_SKEW_MS = 60_000

/** Claims the proxy signs for one browser request. */
interface IdentityClaims {
  /** Supabase `auth.users` identity. */
  readonly sub: string
  /** Tenant the caller acts within. */
  readonly tenant: string
  /** Role held inside the tenant. */
  readonly role: 'owner' | 'admin' | 'member' | 'anonymous'
  /** Platform-operator flag. */
  readonly isAdmin: boolean
  /** Issued-at, milliseconds since the epoch. */
  readonly iat: number
  /** Expiry, milliseconds since the epoch. */
  readonly exp: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - value.length % 4) % 4)
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
}

function headerValue(headers: ConnectionTrustRequest['headers'], name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : value?.[0]
}

function claimsOf(decoded: unknown): IdentityClaims | undefined {
  if (!isRecord(decoded)) return undefined
  const { sub, tenant, role, isAdmin, iat, exp } = decoded
  if (typeof sub !== 'string' || sub === '' || typeof tenant !== 'string' || tenant === '') return undefined
  if (role !== 'owner' && role !== 'admin' && role !== 'member' && role !== 'anonymous') return undefined
  if (typeof isAdmin !== 'boolean') return undefined
  if (typeof iat !== 'number' || !Number.isSafeInteger(iat)) return undefined
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) return undefined
  return { sub, tenant, role, isAdmin, iat, exp }
}

/**
 * Build the resolver that verifies {@link IDENTITY_HEADER}.
 * @param publicKey - base64 SPKI Ed25519 public key the proxy signs with.
 * @param now - clock reading, injectable for tests.
 * @returns resolver for `ctx.connection.principals`.
 */
export function createIdentityResolver(publicKey: string, now: () => number = Date.now): ConnectionPrincipalResolver {
  const key: KeyObject = createPublicKey({
    key: Buffer.from(publicKey, 'base64'),
    format: 'der',
    type: 'spki',
  })
  return {
    resolve(request) {
      const raw = headerValue(request.headers, IDENTITY_HEADER)
      // Configured means every request must carry a verified identity: a
      // browser session that reaches the tenant without one is refused rather
      // than admitted as the local owner.
      if (raw === undefined || raw === '') return { rejection: 401 }
      const [encoded, signature] = raw.split('.')
      if (encoded === undefined || signature === undefined || raw.split('.').length !== 2) {
        return { rejection: 401 }
      }
      const payload = decodeBase64Url(encoded)
      const signatureBytes = decodeBase64Url(signature)
      if (payload === undefined || signatureBytes === undefined) return { rejection: 401 }
      if (!verify(null, Buffer.from(encoded), key, signatureBytes)) return { rejection: 401 }
      let decoded: unknown
      try {
        decoded = JSON.parse(payload.toString('utf8'))
      } catch {
        return { rejection: 401 }
      }
      const claims = claimsOf(decoded)
      if (claims === undefined) return { rejection: 401 }
      const current = now()
      if (claims.exp <= current || claims.iat > current + CLOCK_SKEW_MS) return { rejection: 401 }
      const principal: Principal = {
        kind: 'user',
        userId: claims.sub,
        tenantId: claims.tenant,
        role: claims.role,
        isAdmin: claims.isAdmin,
      }
      return { principal }
    },
  }
}
