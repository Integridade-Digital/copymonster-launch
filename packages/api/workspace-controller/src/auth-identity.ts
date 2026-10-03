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

/**
 * Read the authenticated caller identity when the Context carries one.
 * @param ctx - Host context the Remote method is running under.
 * @returns the authenticated identity, or `undefined` when the call is unscoped.
 */
export function getAuthIdentity(ctx: Context): UserIdentity | undefined {
  return Reflect.has(ctx, 'authIdentity') ? ctx.authIdentity : undefined
}
