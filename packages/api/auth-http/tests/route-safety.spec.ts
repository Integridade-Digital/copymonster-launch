/** Exact-route fence and rejection containment. */
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'

interface Mounted {
  readonly route: (req: IncomingMessage, res: ServerResponse) => void
  readonly dispose: () => Promise<void>
}

async function mount(options: {
  trustRejection?: () => 401 | 403 | undefined
  resolveIdentity?: () => Promise<never>
} = {}): Promise<Mounted> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
  const ctx = new Context()
  ctx.provide('webServer', {
    register: (route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => {
      routes.set(route.path, route.handler)
      return () => { routes.delete(route.path) }
    },
  } as never)
  ctx.provide('connection', {
    trustRejection: options.trustRejection ?? (() => undefined),
    principals: { register: () => () => {} },
    rpc: { guard: () => () => {} },
  } as never)
  ctx.provide('auth', {
    resolveIdentity: options.resolveIdentity ?? (async () => undefined),
  } as never)
  ctx.provide('remoteAccess', { registerPolicy: () => () => {} } as never)
  ctx.provide('typert', { local: { list: () => [] } } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply }, {
    rateLimit: { windowMs: 60_000, max: 30 },
    identityPublicKey: '',
    trustedProxyAddresses: [],
  })
  await fiber.await()
  const route = routes.get('/api/auth/me')
  if (route === undefined) throw new Error('route not registered')
  return { route, dispose: () => fiber.dispose() }
}

function request(): IncomingMessage {
  const stream = Readable.from([]) as IncomingMessage
  Object.assign(stream, {
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: 'Bearer token' },
    socket: { remoteAddress: '127.0.0.1' },
  })
  return stream
}

function response(): { res: ServerResponse; status: () => number; body: () => string } {
  let status = 0
  let body = ''
  const res = {
    headersSent: false,
    writeHead: (code: number) => { status = code; res.headersSent = true },
    end: (chunk?: unknown) => { if (chunk !== undefined) body += String(chunk) },
    destroy: () => {},
  }
  return { res: res as unknown as ServerResponse, status: () => status, body: () => body }
}

describe('auth-http exact routes', () => {
  it('refuses an untrusted authority before the handler runs', async () => {
    const mounted = await mount({ trustRejection: () => 403 })
    try {
      const out = response()
      mounted.route(request(), out.res)
      expect(out.status()).toBe(403)
    } finally {
      await mounted.dispose()
    }
  })

  it('answers 500 instead of an unhandled rejection when the handler fails', async () => {
    const mounted = await mount({ resolveIdentity: async () => { throw new Error('auth unavailable') } })
    try {
      const out = response()
      mounted.route(request(), out.res)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(out.status()).toBe(500)
      expect(out.body()).toContain('internal_error')
    } finally {
      await mounted.dispose()
    }
  })
})
