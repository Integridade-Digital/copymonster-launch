/**
 * Presence-safe read of the caller identity a `@RemoteScope('auth')` Session
 * method runs under.
 *
 * A `context: 'auth'` Remote method receives a `ctx.extend({ authIdentity })`
 * overlay, so the identity is an own property of that Context. An unscoped
 * method runs on a Context that declares no such property, and the Context
 * proxy's `get` trap throws `cannot get property "authIdentity" without
 * inject` for it. `in` consults own properties and the declared table without
 * invoking that trap, so it reports presence safely.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Read the authenticated caller identity, refusing a call that carries none.
 *
 * Session creation confines its working directory to this identity's sandbox,
 * so an unscoped call has no root to confine to. This method raises a `session`
 * Remote failure instead of falling back to a shared or process-wide directory.
 * @param ctx - Host context the Remote method is running under.
 * @returns the authenticated identity.
 * @throws RemoteError with code `session/unauthorized` when the Context carries
 * no identity, which happens for an unscoped call.
 */
export function requireAuthIdentity(ctx: Context): UserIdentity {
  const identity = 'authIdentity' in ctx ? ctx.authIdentity : undefined
  if (identity === undefined) {
    throw new RemoteError('session/unauthorized', 'session.create requires an authenticated caller identity.', {})
  }
  return identity
}
