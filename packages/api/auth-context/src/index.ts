/**
 * CopyMonster auth service (`ctx.auth`) and its Typert Host Context adapter.
 *
 * The service resolves a Supabase bearer token to a {@link UserIdentity} and
 * registers the `auth` Typert Context kind, so a Remote method that declares
 * `context: 'auth'` runs against a child Context carrying `authIdentity`.
 * Registration rides `ctx.inject(['typert'], ...)`, so it appears when the
 * Typert registry is available and unwinds with this plugin — no Express, no
 * middleware chain, no method decorators.
 * @module @deepseek-ai/dsh-api-auth-context
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { createUserClient } from '@deepseek-ai/dsh-supabase-client'
import type { AuthToken, UserIdentity, UserRole } from './types.ts'

export type { AuthToken, UserIdentity, UserRole } from './types.ts'

/** Stable Cordis plugin/service name. */
export const name = 'auth'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** CopyMonster identity service. */
    auth: AuthService
    /** Set on the child Context returned by {@link AuthService.resolveContext}. */
    authIdentity?: UserIdentity
    /**
     * Bearer token the caller presented, set on the same child Context as
     * {@link Context.authIdentity} so a scoped Remote method can build a
     * caller-scoped Supabase client instead of borrowing the service role.
     */
    authToken?: AuthToken
  }
}

/** Wire field and type symbol the strict generator binds to the `auth` Context. */
const AUTH_CONTEXT_WIRE = 'authId'
const AUTH_CONTEXT_WIRE_TYPE = '@deepseek-ai/dsh-api-auth-context/types#AuthToken'

/**
 * Cache entry for a resolved user identity.
 */
interface CachedIdentity {
  identity: UserIdentity
  expiresAt: number
}

/**
 * Decode the payload of a compact JWS.
 *
 * The signature is not checked here: {@link AuthService.resolveIdentity} first
 * asks `supabaseAdminClient.auth.getUser` to validate the token, and only reads
 * claims from a token that Supabase accepted.
 * @param token - compact JWS presented by the caller.
 * @returns the payload object, or `undefined` when the token is not a
 *   well-formed compact JWS carrying a JSON object payload.
 */
function decodeJwtPayload(token: AuthToken): Record<string, unknown> | undefined {
  const segment = token.split('.')[1]
  if (segment === undefined) return undefined

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  return payload as Record<string, unknown>
}

/**
 * Narrow a stored membership role to a role an identity may be issued with.
 *
 * `anonymous` is refused along with any value outside {@link UserRole}: a
 * caller whose only membership is anonymous has no tenant to act within, so it
 * resolves to no identity rather than a downgraded one.
 * @param claim - raw `role` value from `get_my_profile()`.
 * @returns the matching role, or `undefined` for `anonymous` and for any value
 *   outside the vocabulary.
 */
function toUserRole(claim: string): UserRole | undefined {
  switch (claim) {
    case 'owner':
      return 'owner'
    case 'admin':
      return 'admin'
    case 'member':
      return 'member'
    default:
      return undefined
  }
}

/**
 * `ctx.auth`: resolve bearer tokens to CopyMonster identities.
 *
 * A resolution failure is not an exception for Typert lookups — the adapter
 * returns `undefined` so Gateway answers the stable `context-not-found` fault.
 * Direct callers (HTTP routes) get `undefined` too and decide their own status.
 */
export class AuthService extends Service {
  static inject = ['typert']

  /** In-memory LRU cache of resolved identities with a 60-second TTL. */
  private readonly identityCache = new Map<string, CachedIdentity>()
  private static readonly CACHE_TTL_MS = 60_000
  private static readonly MAX_CACHE_ENTRIES = 1_000

  /**
   * @param ctx - owning plugin Context.
   */
  constructor(ctx: Context) {
    super(ctx, 'auth')
    ctx.inject(['typert'], (typeCtx) => {
      typeCtx.typert.contexts.registerHost('auth', {
        wire: AUTH_CONTEXT_WIRE,
        wireTypeSymbol: AUTH_CONTEXT_WIRE_TYPE,
        resolve: token => this.resolveContext(token),
      })
    })
  }

  /**
   * Resolve one bearer token to the caller identity.
   *
   * The tenant, role and platform-operator flag come from `get_my_profile()`,
   * read with the caller's own token, so this service needs no service-role
   * key and cannot widen its own scope. A token whose profile names no tenant,
   * names no role, names the `anonymous` role, or names a tenant that is not
   * `active` resolves to `undefined`: an authenticated user without a usable
   * membership gets no identity rather than a downgraded one.
   *
   * Hits the local in-memory LRU cache first to prevent repeated round-trips to Supabase.
   * @param token - Supabase-issued JWT presented by the caller.
   * @returns the identity, or `undefined` when the token is absent, invalid,
   *   expired, carries no usable tenant or role claim, names a tenant that is
   *   not active, or no longer maps to a known profile.
   */
  async resolveIdentity(token: AuthToken): Promise<UserIdentity | undefined> {
    if (token.length === 0) return undefined

    const now = Date.now()
    const cached = this.identityCache.get(token)
    if (cached !== undefined) {
      if (now < cached.expiresAt) {
        // Refresh position in Map for LRU behavior
        this.identityCache.delete(token)
        this.identityCache.set(token, cached)
        return cached.identity
      }
      this.identityCache.delete(token)
    }

    // `get_my_profile()` is SECURITY DEFINER and reads `auth.uid()`, so the
    // caller's own token is enough. PostgREST validates the JWT before the
    // function runs, so an invalid or expired token yields an error here.
    const { data: profile, error } = await createUserClient(token).rpc('get_my_profile')
    if (error !== null || profile === null) return undefined

    const tenant = profile.tenant
    if (tenant === null || tenant.status !== 'active') return undefined

    const role = toUserRole(profile.role ?? '')
    if (role === undefined) return undefined

    const identity: UserIdentity = {
      userId: profile.user.id,
      tenantId: tenant.id,
      role,
      email: profile.user.email ?? '',
      ...profile.is_admin === true ? { isAdmin: true } : {},
      ...profile.user.full_name === null || profile.user.full_name === '' ? {} : { fullName: profile.user.full_name },
      ...profile.user.whatsapp === null || profile.user.whatsapp === '' ? {} : { whatsapp: profile.user.whatsapp },
      ...profile.user.avatar_url === null || profile.user.avatar_url === '' ? {} : { avatarUrl: profile.user.avatar_url },
    }

    // Determine TTL: 60s, capped by JWT `exp` if present and smaller
    const claims = decodeJwtPayload(token)
    let ttlMs = AuthService.CACHE_TTL_MS
    if (claims !== undefined && typeof claims.exp === 'number') {
      const expRemainingMs = claims.exp * 1000 - now
      if (expRemainingMs > 0 && expRemainingMs < ttlMs) {
        ttlMs = expRemainingMs
      }
    }

    // Evict oldest entry if at max capacity
    if (this.identityCache.size >= AuthService.MAX_CACHE_ENTRIES) {
      const oldestKey = this.identityCache.keys().next().value
      if (oldestKey !== undefined) {
        this.identityCache.delete(oldestKey)
      }
    }

    this.identityCache.set(token, {
      identity,
      expiresAt: now + ttlMs,
    })

    return identity
  }

  /**
   * Clears the in-memory identity cache.
   * Useful for test isolation or explicit revocation.
   */
  clearCache(): void {
    this.identityCache.clear()
  }

  /**
   * Resolve one bearer token to the child Context a scoped Remote method runs in.
   *
   * The child is a plain `ctx.extend(...)` overlay carrying `authIdentity`;
   * it creates no fiber and holds no registrations, so it needs no teardown.
   * @param token - Supabase-issued JWT presented by the caller.
   * @returns the identity-carrying Context, or `undefined` when unresolved.
   */
  async resolveContext(token: AuthToken): Promise<Context | undefined> {
    const identity = await this.resolveIdentity(token)
    if (identity === undefined) return undefined
    return this.ctx.extend({ authIdentity: identity, authToken: token })
  }
}

export default AuthService
