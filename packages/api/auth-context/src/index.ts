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
import type { TypertContext } from '@deepseek-ai/dsh-typert-protocol'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'
import { DEFAULT_TENANT_SLUG } from '@deepseek-ai/dsh-constants'
import type { AuthToken, UserIdentity, UserRole } from './types.ts'

export type { AuthToken, UserIdentity, UserRole } from './types.ts'

/** Stable Cordis plugin/service name. */
export const name = 'auth'

/** Merge-declared Context kind resolved by {@link AuthService.resolveContext}. */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertContextMap {
    /** CopyMonster identity derived from the caller's bearer token. */
    auth: TypertContext<AuthToken>
  }
}

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
 * `ctx.auth`: resolve bearer tokens to CopyMonster identities.
 *
 * A resolution failure is not an exception for Typert lookups — the adapter
 * returns `undefined` so Gateway answers the stable `context-not-found` fault.
 * Direct callers (HTTP routes) get `undefined` too and decide their own status.
 */
export class AuthService extends Service {
  static inject = ['typert']

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
   * @param token - Supabase-issued JWT presented by the caller.
   * @returns the identity, or `undefined` when the token is absent, invalid,
   *   expired, or no longer maps to a known profile and tenant.
   */
  async resolveIdentity(token: AuthToken): Promise<UserIdentity | undefined> {
    if (token.length === 0) return undefined

    const { data: authData, error: authError } = await supabaseAdminClient.auth.getUser(token)
    if (authError !== null || authData.user === null) return undefined
    const user = authData.user

    const { data: profile, error: profileError } = await supabaseAdminClient
      .from('users')
      .select('id, email, full_name, whatsapp, avatar_url')
      .eq('id', user.id)
      .single()
    if (profileError !== null || profile === null) return undefined

    const { data: tenant, error: tenantError } = await supabaseAdminClient
      .from('tenants')
      .select('id')
      .eq('slug', DEFAULT_TENANT_SLUG)
      .eq('status', 'active')
      .single()
    if (tenantError !== null || tenant === null) return undefined

    const { data: roleRow } = await supabaseAdminClient
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle()

    const role = (roleRow?.role ?? 'anonymous') as UserRole

    return {
      userId: user.id,
      tenantId: tenant.id,
      role,
      email: profile.email ?? user.email ?? '',
      ...profile.full_name === null || profile.full_name === '' ? {} : { fullName: profile.full_name },
      ...profile.whatsapp === null || profile.whatsapp === '' ? {} : { whatsapp: profile.whatsapp },
      ...profile.avatar_url === null || profile.avatar_url === '' ? {} : { avatarUrl: profile.avatar_url },
    }
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
