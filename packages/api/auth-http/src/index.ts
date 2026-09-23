/**
 * CopyMonster HTTP auth surface: node:http routes registered on `ctx.webServer`.
 *
 * - `GET /api/auth/me` reports the caller identity behind a bearer token.
 * - `GET /enter` redirects to the DSH authenticated URL, so a person reaches
 *   the Web GUI from a stable bookmark instead of transcribing the per-process
 *   launch token by hand. Named routes bypass the index trust fence, so this
 *   route needs no token of its own.
 *
 * A Cordis function plugin: `inject` waits for the webserver, auth service, and
 * connection, and `apply` registers routes through `ctx.effect(...)` so they
 * unwind with the fiber.
 * @module @deepseek-ai/dsh-api-auth-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-auth-context'
import { BEARER_PREFIX } from '@deepseek-ai/dsh-constants'
import type { AuthIdentityResponse, AuthErrorResponse } from './types.ts'

export type { AuthErrorResponse, AuthIdentityResponse } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'auth-http'

/** Services required before the routes can be registered. */
export const inject = ['webServer', 'auth', 'connection']

/** Path that reports the resolved caller identity. */
const ME_PATH = '/api/auth/me'

/** Stable-bookmark entry that redirects to the authenticated GUI URL. */
const ENTER_PATH = '/enter'

/** Extract the bearer token from an Authorization header value. */
function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || !value.startsWith(BEARER_PREFIX)) return undefined
  const token = value.slice(BEARER_PREFIX.length).trim()
  return token === '' ? undefined : token
}

/** Write one JSON response and end it. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** First value of a possibly repeated header. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Handle `GET /api/auth/me`: resolve the bearer token to a CopyMonster identity.
 * @param ctx - plugin Context carrying the auth service.
 * @param req - the incoming request.
 * @param res - the response to write.
 */
async function handleMe(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    const body: AuthErrorResponse = { error: 'method-not-allowed' }
    sendJson(res, 405, body)
    return
  }

  const token = bearerToken(req.headers.authorization)
  if (token === undefined) {
    const body: AuthIdentityResponse = { authenticated: false }
    sendJson(res, 401, body)
    return
  }

  const identity = await ctx.auth.resolveIdentity(token)
  if (identity === undefined) {
    const body: AuthIdentityResponse = { authenticated: false, error: 'invalid-or-expired-token' }
    sendJson(res, 401, body)
    return
  }

  const body: AuthIdentityResponse = { authenticated: true, identity }
  sendJson(res, 200, body)
}

/**
 * Handle `GET /enter`: redirect to the process's authenticated GUI URL.
 *
 * The forwarded scheme is honored so the redirect stays https behind the
 * Cloudflare tunnel; the browser receives the launch token and mints the
 * session cookie without the visitor ever typing it.
 * @param ctx - plugin Context carrying the connection service.
 * @param req - the incoming request.
 * @param res - the redirect response.
 */
function handleEnter(ctx: Context, req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body: AuthErrorResponse = { error: 'method-not-allowed' }
    sendJson(res, 405, body)
    return
  }

  const host = firstHeader(req.headers.host)
  if (host === undefined || host === '') {
    const body: AuthErrorResponse = { error: 'missing-host' }
    sendJson(res, 400, body)
    return
  }

  const scheme = firstHeader(req.headers['x-forwarded-proto']) ?? 'http'
  res.writeHead(303, {
    'cache-control': 'no-store',
    'location': ctx.connection.authenticatedUrl(`${scheme}://${host}`),
    'referrer-policy': 'no-referrer',
  })
  res.end()
}

/**
 * Register the CopyMonster HTTP auth routes on the composing webserver.
 * @param ctx - plugin Context carrying `webServer`, `auth`, and `connection`.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ME_PATH,
    handler: (req, res) => handleMe(ctx, req, res),
  }), `auth-http: ${ME_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ENTER_PATH,
    handler: (req, res) => { handleEnter(ctx, req, res) },
  }), `auth-http: ${ENTER_PATH}`)
}
