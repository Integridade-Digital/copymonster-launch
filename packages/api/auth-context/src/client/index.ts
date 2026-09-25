/**
 * CopyMonster Typert Client Context adapter: sends the signed-in caller's
 * bearer token as the `authToken` argument of every `context: 'auth'` Remote
 * call.
 *
 * A Remote method that declares `context: 'auth'` reaches the browser as a
 * scoped projection, and the client Gateway refuses to invoke it without a
 * Client Context adapter for that key. This half is that adapter: it reads the
 * access token the page published and hands it to the Gateway, which puts it in
 * the RPC payload. The Host half then resolves the token to an identity.
 *
 * The page publishes the token through a `__DSH_AUTH__` global, mirroring how
 * `__DSH_TRANSPORT__` carries host-owned transport facts into the browser
 * plugins. The adapter reads it per invocation rather than caching a session, so
 * a sign-out or refresh takes effect on the next call without a reload.
 * @module @deepseek-ai/dsh-api-auth-context/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthToken } from '../types.ts'

export type { AuthToken, UserIdentity, UserRole } from '../types.ts'

/** Stable Cordis plugin name for the browser half. */
export const name = 'auth-client'

/** Services required before the Client Context adapter can be registered. */
export const inject = ['typert']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Bearer token one `auth`-scoped invocation resolved against. */
    authToken?: AuthToken
  }
}

/** Session facts the page publishes for this adapter. */
export interface ClientAuthSession {
  /** Supabase access token of the signed-in caller; absent while signed out. */
  accessToken?: AuthToken
}

/** Page global carrying {@link ClientAuthSession}; absent until the app publishes it. */
interface ClientAuthGlobal {
  __DSH_AUTH__?: ClientAuthSession
}

/** Read the access token the page currently publishes. */
function publishedAccessToken(): AuthToken | undefined {
  const published = (globalThis as ClientAuthGlobal).__DSH_AUTH__?.accessToken
  return published === undefined || published === '' ? undefined : published
}

/**
 * Client plugin body: publish the page's access token as the `auth` wire identity.
 * @param ctx - client Cordis context.
 */
export function apply(ctx: Context): void {
  const applicationRoot = ctx.root
  ctx.typert.contexts.registerClient('auth', {
    identity: candidate => candidate.root === applicationRoot ? publishedAccessToken() : undefined,
    resolve: token => token === publishedAccessToken() ? ctx.extend({ authToken: token }) : undefined,
  })
}
