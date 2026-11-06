/**
 * dsh-experimental-zernio-mcp — HTTP routes for the settings panel.
 *
 * Every route is loopback-only, plus the configured public origin when the
 * reverse proxy presents it. The OAuth callback accepts a cross-site top-level
 * navigation from Zernio but still requires a loopback socket and a trusted
 * Host header.
 *
 * @module
 */

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { auth } from '@modelcontextprotocol/client'
import type { OAuthFlow } from './oauth.ts'
import { MCP_URL, type StoreView, type ZernioMcpStore } from './store.ts'
import type { ZernioSupervisor } from './mcp.ts'

/** Route paths. */
export const ZERNIO_MCP_API = {
  status: '/api/dsh-zernio-mcp/status',
  oauthStart: '/api/dsh-zernio-mcp/oauth/start',
  oauthCallback: '/api/dsh-zernio-mcp/oauth/callback',
  oauthFinish: '/api/dsh-zernio-mcp/oauth/finish',
  oauthRefresh: '/api/dsh-zernio-mcp/oauth/refresh',
  test: '/api/dsh-zernio-mcp/test',
  clear: '/api/dsh-zernio-mcp/clear',
} as const

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** Dependencies shared by every route. */
export interface RouteDependencies {
  store: ZernioMcpStore
  flow: OAuthFlow
  supervisor: ZernioSupervisor
  /** Callback URL the active flow uses, resolved at request time. */
  callbackUrl: () => string
  /** Public origin the reverse proxy presents, without a trailing slash. */
  publicOrigin: string | undefined
  /** Host port the loopback callback URL names, resolved at request time. */
  getPort: () => number
}

/** Whether a hostname is one the plugin accepts. */
function trustedHost(hostname: string, publicOrigin: string | undefined): boolean {
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]') return true
  if (publicOrigin === undefined) return false
  try {
    return new URL(publicOrigin).hostname === hostname
  } catch {
    return false
  }
}

/** Whether the request socket is loopback. */
function isLoopbackSocket(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Strict fence for the non-callback routes. */
function isLoopbackRequest(request: IncomingMessage, publicOrigin: string | undefined): boolean {
  if (!isLoopbackSocket(request)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!trustedHost(hostUrl.hostname, publicOrigin)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Callback fence: loopback socket and trusted host, any origin. */
function isCallbackRequest(request: IncomingMessage, publicOrigin: string | undefined): boolean {
  if (!isLoopbackSocket(request)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  try {
    return trustedHost(new URL(`http://${host}`).hostname, publicOrigin)
  } catch {
    return false
  }
}

/**
 * Resolve the callback URL the active flow should register.
 * @param request - OAuth start request (only its Host header is read).
 * @param port - loopback Host port.
 * @param publicOrigin - configured public origin, if any.
 * @returns an absolute callback URL.
 */
export function resolveCallbackUrl(
  request: { headers: IncomingHttpHeaders },
  port: number,
  publicOrigin: string | undefined,
): string {
  const host = request.headers.host
  if (typeof host === 'string') {
    try {
      const hostUrl = new URL(`http://${host}`)
      if (hostUrl.hostname === '127.0.0.1' || hostUrl.hostname === 'localhost' || hostUrl.hostname === '[::1]') {
        return `http://${host}${ZERNIO_MCP_API.oauthCallback}`
      }
      if (publicOrigin !== undefined) {
        const origin = new URL(publicOrigin)
        if (origin.hostname === hostUrl.hostname) return `${origin.origin}${ZERNIO_MCP_API.oauthCallback}`
      }
    } catch {
      // Fall through to the loopback callback.
    }
  }
  return `http://127.0.0.1:${port}${ZERNIO_MCP_API.oauthCallback}`
}

/** One JSON response. */
function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  response.end(JSON.stringify(body))
}

/** Escape text inserted into the callback page. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** One HTML response (used only by the OAuth callback page). */
function writeHtml(response: ServerResponse, status: number, title: string, body: string): void {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'
    + escapeHtml(title)
    + '</title><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;background:#f6f7f9;color:#1f2328}.card{background:#fff;border:1px solid #e2e5e9;border-radius:12px;padding:32px 40px;max-width:520px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.7;margin:0}</style></head><body><div class="card"><h1>'
    + escapeHtml(title)
    + '</h1><p>'
    + escapeHtml(body)
    + '</p></div></body></html>'
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  response.end(html)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array)
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/** Extract a string query parameter. */
function queryParam(request: IncomingMessage, name: string): string {
  try {
    return new URL(request.url ?? '', 'http://localhost').searchParams.get(name) ?? ''
  } catch {
    return ''
  }
}

/** One route registration. */
export interface ZernioRoute {
  kind: 'exact'
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
}

/**
 * Build every `/api/dsh-zernio-mcp` route (exact paths).
 * @param deps - store, OAuth flow, MCP supervisor, and callback settings.
 * @returns the route list.
 */
export function makeRoutes(deps: RouteDependencies): ZernioRoute[] {
  const { store, flow, supervisor, callbackUrl, publicOrigin, getPort } = deps
  const guard = (request: IncomingMessage, response: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(request, publicOrigin)) {
      writeJson(response, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (request.method !== method) {
      writeJson(response, 405, { error: `method not allowed: ${request.method ?? 'unknown'}` })
      return false
    }
    return true
  }
  const statusView = async (): Promise<StoreView & { connected: boolean; toolCount: number }> => ({
    ...await store.view(callbackUrl()),
    connected: supervisor.isConnected(),
    toolCount: supervisor.toolCount(),
  })
  return [
    {
      kind: 'exact',
      path: ZERNIO_MCP_API.status,
      handler: async (request, response) => {
        if (!guard(request, response, 'GET')) return
        writeJson(response, 200, await statusView())
      },
    },
    {
      kind: 'exact',
      path: ZERNIO_MCP_API.oauthStart,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return
        try {
          const resolved = resolveCallbackUrl(request, getPort(), publicOrigin)
          const { authorizeUrl } = await flow.begin(resolved)
          writeJson(response, 200, { ok: true, authorizeUrl, callbackUrl: resolved })
        } catch (error) {
          writeJson(response, 200, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: ZERNIO_MCP_API.oauthCallback,
      handler: async (request, response) => {
        if (!isCallbackRequest(request, publicOrigin)) {
          writeHtml(response, 403, 'Authorization failed', 'The callback request came from a non-local address and was rejected.')
          return
        }
        const code = queryParam(request, 'code')
        const state = queryParam(request, 'state')
        const error = queryParam(request, 'error')
        const iss = queryParam(request, 'iss')
        if (error !== '') {
          flow.abort()
          writeHtml(response, 400, 'Authorization failed', `Zernio returned an error: ${error}. Retry or use the manual code paste option.`)
          return
        }
        if (code === '') {
          writeHtml(response, 400, 'Authorization failed', 'The callback has no code parameter.')
          return
        }
        const result = await flow.complete(code, state, iss)
        if (!result.ok) {
          writeHtml(response, 400, 'Authorization failed', result.message)
          return
        }
        void supervisor.start().catch(() => {})
        writeHtml(
          response,
          200,
          'Authorization successful',
          'Zernio MCP authorization is complete and the token is saved. You can close this page and return to the CopyMonster Settings panel or continue the conversation.',
        )
      },
    },
    {
      kind: 'exact',
      path: ZERNIO_MCP_API.oauthFinish,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return
        const body = await readJsonBody(request)
        if (body === undefined) {
          writeJson(response, 400, { error: 'invalid JSON body' })
          return
        }
        let code = typeof body.code === 'string' ? body.code.trim() : ''
        if (code === '' && typeof body.redirectUrl === 'string') {
          try {
            code = new URL(body.redirectUrl).searchParams.get('code') ?? ''
          } catch {
            code = ''
          }
        }
        if (code === '') {
          writeJson(response, 400, { error: 'Missing code (or could not extract the code from redirectUrl)' })
          return
        }
        const result = await flow.complete(code, '')
        if (result.ok) void supervisor.start().catch(() => {})
        writeJson(response, 200, {
          ok: result.ok,
          message: result.message,
          view: await statusView(),
        })
      },
    },
    {
      kind: 'exact',
      path: ZERNIO_MCP_API.oauthRefresh,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return
        const provider = flow.activeProvider
        if (provider === null) {
          writeJson(response, 200, {
            ok: false,
            message: 'No active OAuth provider (after a service restart, test the connection to trigger a refresh).',
            view: await statusView(),
          })
          return
        }
        try {
          const result = await auth(provider, { serverUrl: MCP_URL })
          writeJson(response, 200, {
            ok: result === 'AUTHORIZED',
            message: result === 'AUTHORIZED' ? 'Token refreshed successfully.' : 'Refresh did not finish.',
            view: await statusView(),
          })
        } catch (error) {
          writeJson(response, 200, {
            ok: false,
            message: 'Refresh failed: ' + (error instanceof Error ? error.message : String(error)),
            view: await statusView(),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: ZERNIO_MCP_API.test,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return
        if (!(await store.view(callbackUrl())).authorized) {
          writeJson(response, 200, {
            ok: false,
            error: 'Not authorized: click Authorize first.',
            view: await statusView(),
          })
          return
        }
        try {
          if (!supervisor.isConnected()) await supervisor.start()
          const tools = await supervisor.listTools()
          writeJson(response, 200, {
            ok: true,
            message: `Connection successful; found ${tools.length} Zernio MCP tools.`,
            tools,
            view: await statusView(),
          })
        } catch (error) {
          writeJson(response, 200, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            view: await statusView(),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: ZERNIO_MCP_API.clear,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return
        flow.abort()
        await supervisor.dispose()
        await store.clearAll()
        writeJson(response, 200, {
          ok: true,
          message: 'Cleared the Zernio MCP token and client registration.',
          view: await statusView(),
        })
      },
    },
  ]
}
