import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { MODEL_MASK_STATUS_PATH, handleModelMaskStatus } from '../src/model-mask-status.ts'

vi.mock('../src/payout-executor.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/payout-executor.ts')>(),
  isPlatformOperator: (identity: { isAdmin?: boolean }) => Promise.resolve(identity.isAdmin === true),
}))

interface Captured {
  status: number
  body: unknown
}

function resDouble(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: undefined }
  const res = {
    writeHead(status: number) {
      captured.status = status
      return this
    },
    end(chunk?: unknown) {
      captured.body = typeof chunk === 'string' ? JSON.parse(chunk) : chunk
    },
  } as unknown as ServerResponse
  return { res, captured }
}

function reqDouble(method: string, authorization?: string): IncomingMessage {
  return { method, headers: authorization === undefined ? {} : { authorization } } as unknown as IncomingMessage
}

function ctxWith(options: {
  readonly identity?: { userId: string; isAdmin?: boolean } | undefined
  readonly routes?: { primaryRoute: { provider: string; model: string }; fallbackChain: Array<{ provider: string; model: string }> }
}): Context {
  const ctx = new Context()
  ctx.provide('auth', {
    resolveIdentity: () => Promise.resolve(options.identity),
  } as never)
  if (options.routes !== undefined) {
    ctx.provide('modelMask', { currentRoutes: () => options.routes } as never)
  }
  return ctx
}

const operator = { userId: 'u1', isAdmin: true }
const routes = {
  primaryRoute: { provider: 'mistral', model: 'mistral-large' },
  fallbackChain: [{ provider: 'deepseek-official', model: 'deepseek-chat' }],
}

describe('GET /api/admin/model-mask', () => {
  it('reports the alias and the live routes to an operator', async () => {
    const { res, captured } = resDouble()
    await handleModelMaskStatus(ctxWith({ identity: operator, routes }), reqDouble('GET', 'Bearer token'), res)
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({
      alias: { provider: 'copymonster', model: 'copy-monster-default' },
      primaryRoute: { provider: 'mistral', model: 'mistral-large' },
      fallbackChain: [{ provider: 'deepseek-official', model: 'deepseek-chat' }],
    })
  })

  it('reports no primary route when the catalog is empty', async () => {
    const { res, captured } = resDouble()
    await handleModelMaskStatus(
      ctxWith({ identity: operator, routes: { primaryRoute: { provider: 'none', model: 'none' }, fallbackChain: [] } }),
      reqDouble('GET', 'Bearer token'),
      res,
    )
    expect(captured.body).toMatchObject({ primaryRoute: null, fallbackChain: [] })
  })

  it('rejects a non-operator before reading any route', async () => {
    const { res, captured } = resDouble()
    await handleModelMaskStatus(ctxWith({ identity: { userId: 'u2' }, routes }), reqDouble('GET', 'Bearer token'), res)
    expect(captured.status).toBe(403)
    expect(captured.body).toMatchObject({ error: 'forbidden' })
  })

  it('rejects a request without a bearer token', async () => {
    const { res, captured } = resDouble()
    await handleModelMaskStatus(ctxWith({ identity: operator, routes }), reqDouble('GET'), res)
    expect(captured.status).toBe(401)
  })

  it('rejects an unresolvable identity', async () => {
    const { res, captured } = resDouble()
    await handleModelMaskStatus(ctxWith({ identity: undefined, routes }), reqDouble('GET', 'Bearer token'), res)
    expect(captured.status).toBe(401)
    expect(captured.body).toMatchObject({ error: 'invalid_identity' })
  })

  it('rejects a non-GET method', async () => {
    const { res, captured } = resDouble()
    await handleModelMaskStatus(ctxWith({ identity: operator, routes }), reqDouble('POST', 'Bearer token'), res)
    expect(captured.status).toBe(405)
  })

  it('reports a Host without the mask mounted', async () => {
    const { res, captured } = resDouble()
    await handleModelMaskStatus(ctxWith({ identity: operator }), reqDouble('GET', 'Bearer token'), res)
    expect(captured.status).toBe(404)
  })

  it('serves the documented route path', () => {
    expect(MODEL_MASK_STATUS_PATH).toBe('/api/admin/model-mask')
  })
})
