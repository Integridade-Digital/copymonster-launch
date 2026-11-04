/**
 * Caller identity for the settings and credential surfaces.
 *
 * A method that declares `@RemoteScope('auth')` receives `authIdentity` on its
 * Context. A direct Remote method does not, so it reads the Peer principal the
 * Gateway fixed for the call instead. An in-process call has neither: it is
 * trusted Host code, not a Remote caller.
 * @module @deepseek-ai/dsh-api-settings-controller/authz
 */

import type { Context } from '@deepseek-ai/cordis'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Narrow the Context overlay value without asserting the Context type. */
function isUserIdentity(value: unknown): value is UserIdentity {
  return typeof value === 'object' && value !== null
    && 'userId' in value && 'tenantId' in value && 'role' in value
}

/**
 * Read the authenticated identity a scoped method runs under.
 * @param ctx - Host context the Remote method is running under.
 * @returns the identity, or undefined for a direct or in-process call.
 */
export function getAuthIdentity(ctx: Context): UserIdentity | undefined {
  if (!Reflect.has(ctx, 'authIdentity')) return undefined
  const identity: unknown = Reflect.get(ctx, 'authIdentity')
  return isUserIdentity(identity) ? identity : undefined
}

/**
 * Decide whether the caller may change deployment-level settings or secrets.
 *
 * Fails closed for a Remote caller: a browser Peer whose principal is a member
 * is refused even when the method carries no `auth` scope. A local owner Peer
 * and an in-process call stay allowed.
 * @param ctx - Host context the operation is running under.
 * @returns true only for an owner, a tenant admin, a platform operator, or an
 * in-process caller.
 */
export function callerIsAdmin(ctx: Context): boolean {
  const identity = getAuthIdentity(ctx)
  if (identity !== undefined) {
    return identity.role === 'owner' || identity.role === 'admin' || identity.isAdmin === true
  }
  const principal = ctx.invocation?.peer.principal
  if (principal === undefined) return true
  if (principal.kind === 'owner') return true
  return principal.kind === 'user'
    && (principal.role === 'owner' || principal.role === 'admin' || principal.isAdmin)
}
