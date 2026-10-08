import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { handleHealthz } from '../src/health.ts'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: {
    from: vi.fn(),
  },
}))

interface Captured {
  status: number
  body: string
  headers: Record<string, unknown>
}

function resDouble(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: '', headers: {} }
  const res = {
    writeHead(status: number, headers: Record<string, unknown>) {
      captured.status = status
      captured.headers = headers
      return this
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) captured.body = String(chunk)
    },
  } as unknown as ServerResponse
  return { res, captured }
}

function reqDouble(method: string): IncomingMessage {
  return { method } as unknown as IncomingMessage
}

function ping(error: unknown): void {
  const select = vi.fn().mockResolvedValue({ data: null, count: 1, error })
  ;(supabaseAdminClient.from as unknown as Mock).mockReturnValue({ select })
}

function catalog(providers: readonly string[], models: readonly string[]): unknown {
  return {
    listProviders: () => providers.map(id => ({ id, name: id })),
    listModels: (provider: string) => Promise.resolve(models.map(id => ({ id, provider }))),
  }
}

function ctxWithCatalog(service?: unknown): Context {
  const ctx = new Context()
  if (service !== undefined) ctx.provide('llm', service as never)
  return ctx
}

describe('GET /api/healthz', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 healthy when Supabase and the catalog check out', async () => {
    ping(null)
    const { res, captured } = resDouble()
    await handleHealthz(ctxWithCatalog(catalog(['deepseek'], ['deepseek-flash'])), reqDouble('GET'), res)
    expect(captured.status).toBe(200)
    const body = JSON.parse(captured.body) as {
      status: string
      timestamp: string
      checks: { supabase: string; catalog: string; latency_ms: number }
    }
    expect(body.status).toBe('healthy')
    expect(body.checks).toMatchObject({ supabase: 'ok', catalog: 'ok' })
    expect(typeof body.timestamp).toBe('string')
    expect(typeof body.checks.latency_ms).toBe('number')
  })

  it('returns 503 when the Supabase ping fails', async () => {
    ping({ message: 'down' })
    const { res, captured } = resDouble()
    await handleHealthz(ctxWithCatalog(catalog(['deepseek'], ['deepseek-flash'])), reqDouble('GET'), res)
    expect(captured.status).toBe(503)
    expect(JSON.parse(captured.body).checks.supabase).toBe('fail')
  })

  it('returns 503 when the catalog has no providers', async () => {
    ping(null)
    const { res, captured } = resDouble()
    await handleHealthz(ctxWithCatalog(catalog([], [])), reqDouble('GET'), res)
    expect(captured.status).toBe(503)
    expect(JSON.parse(captured.body).checks.catalog).toBe('fail')
  })

  it('returns 503 when the llm service is absent', async () => {
    ping(null)
    const { res, captured } = resDouble()
    await handleHealthz(ctxWithCatalog(), reqDouble('GET'), res)
    expect(captured.status).toBe(503)
    expect(JSON.parse(captured.body).status).toBe('unhealthy')
  })

  it('rejects non-GET methods with 405', async () => {
    const { res, captured } = resDouble()
    await handleHealthz(ctxWithCatalog(), reqDouble('POST'), res)
    expect(captured.status).toBe(405)
    expect(JSON.parse(captured.body).error).toBe('method-not-allowed')
  })
})
