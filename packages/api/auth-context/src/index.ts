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
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'
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
  }
}

/** Wire field and type symbol the strict generator binds to the `auth` Context. */
const AUTH_CONTEXT_WIRE = 'authToken'
const AUTH_CONTEXT_WIRE_TYPE = '@copymonster/auth#AuthToken'

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
 * Read a non-empty string claim from a JWT payload.
 * @param claims - decoded JWT payload.
 * @param key - claim name.
 * @returns the claim value, or `undefined` when absent, blank, or not a string.
 */
function readStringClaim(claims: Record<string, unknown>, key: string): string | undefined {
  const value = claims[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Narrow the `user_role` claim to a role an identity may be issued with.
 *
 * `anonymous` is refused along with any value outside {@link UserRole}: a
 * caller whose only membership is anonymous has no tenant to act within, so it
 * resolves to no identity rather than a downgraded one.
 * @param claim - raw `user_role` claim value.
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
   * The active tenant and role come from the `tenant_id` and `user_role` claims
   * that the Supabase Custom Access Token Hook writes into the JWT, so the
   * Custom Access Token Hook decides the membership and this service only
   * confirms the tenant is still usable. A token that names no tenant, names no
   * role, names the `anonymous` role, or names a tenant that is not `active`
   * resolves to `undefined`: an authenticated user without a usable membership
   * gets no identity rather than a downgraded one.
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

    const { data: authData, error: authError } = await supabaseAdminClient.auth.getUser(token)
    if (authError !== null || authData.user === null) return undefined
    const user = authData.user

    const claims = decodeJwtPayload(token)
    if (claims === undefined) return undefined

    const claimTenantId = readStringClaim(claims, 'tenant_id')
    if (claimTenantId === undefined) return undefined

    const claimRole = readStringClaim(claims, 'user_role')
    if (claimRole === undefined) return undefined
    const role = toUserRole(claimRole)
    if (role === undefined) return undefined

    const { data: tenant, error: tenantError } = await supabaseAdminClient
      .from('tenants')
      .select('id')
      .eq('id', claimTenantId)
      .eq('status', 'active')
      .maybeSingle()
    if (tenantError !== null || tenant === null) return undefined

    const { data: profile, error: profileError } = await supabaseAdminClient
      .from('users')
      .select('id, email, full_name, whatsapp, avatar_url')
      .eq('id', user.id)
      .single()
    if (profileError !== null || profile === null) return undefined

    const identity: UserIdentity = {
      userId: user.id,
      tenantId: claimTenantId,
      role,
      email: profile.email ?? user.email ?? '',
      ...profile.full_name === null || profile.full_name === '' ? {} : { fullName: profile.full_name },
      ...profile.whatsapp === null || profile.whatsapp === '' ? {} : { whatsapp: profile.whatsapp },
      ...profile.avatar_url === null || profile.avatar_url === '' ? {} : { avatarUrl: profile.avatar_url },
    }

    // Determine TTL: 60s, capped by JWT `exp` if present and smaller
    let ttlMs = AuthService.CACHE_TTL_MS
    if (typeof claims.exp === 'number') {
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
    return this.ctx.extend({ authIdentity: identity })
  }
}

export default AuthService
