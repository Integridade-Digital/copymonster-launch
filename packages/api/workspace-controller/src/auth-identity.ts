/**
 * Presence-safe read of the caller identity a Remote method runs under.
 *
 * A `context: 'auth'` Remote method receives a `ctx.extend({ authIdentity })`
 * overlay, so the identity is an own property of that Context. An unscoped
 * method runs on a Context that declares no such property or service, and the
 * Context proxy's `get` trap throws `cannot get property "authIdentity" without
 * inject` for it. `Reflect.has` consults the target's own properties and then
 * the declared service table, so it reports presence without invoking that trap
 * and without guessing a value for a missing declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Read the authenticated caller identity when the Context carries one.
 * @param ctx - Host context the Remote method is running under.
 * @returns the authenticated identity, or `undefined` when the call is unscoped.
 */
export function getAuthIdentity(ctx: Context): UserIdentity | undefined {
  // Use the context proxy to access authIdentity (works for both own properties and services)
  return 'authIdentity' in ctx ? ctx.authIdentity : undefined
}

/**
 * Read the authenticated caller identity, refusing a call that carries none.
 *
 * Every Workspace read and write resolves its confined root from this identity,
 * so an unscoped call has no root to confine to. This method raises a `workspace`
 * Remote failure instead of falling back to a shared or process-wide directory.
 * @param ctx - Host context the Remote method is running under.
 * @returns the authenticated identity.
 * @throws RemoteError with code `workspace/unauthorized` when the Context carries
 * no identity, which happens for an unscoped call or a path-local invocation.
 */
export function requireAuthIdentity(ctx: Context): UserIdentity {
  const identity = getAuthIdentity(ctx)
  if (identity === undefined) {
    throw new RemoteError('workspace/unauthorized', 'This operation requires an authenticated caller identity.', {})
  }
  return identity
}
