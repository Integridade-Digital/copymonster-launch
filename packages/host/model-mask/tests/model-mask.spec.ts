import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmAdapter, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  apply,
  buildVirtualAdapter,
  Config,
  inject,
  name,
  type VirtualAdapterDeps,
  VIRTUAL_MODEL,
  VIRTUAL_MODEL_NAME,
  VIRTUAL_PROVIDER,
} from '../src/index.ts'

async function mount(config: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  // The `llm` service must be mounted so `ctx.llm` and adapter registration work.
  await ctx.plugin({
    name: 'llm',
    inject: [] as const,
    apply: (inner: Context) => {
      new LlmRuntime(inner)
    },
  })
  const plugin = {
    inject,
    name,
    Config,
    apply: (inner: Context, cfg: Config) => {
      apply(inner, cfg)
    },
  }
  await ctx.plugin(plugin, config)
  return ctx
}

function mockCtx(captured: GenerateOptions[]): Context {
  const stream = async function * (options: GenerateOptions): AsyncIterable<StreamChunk> {
    captured.push({ ...options })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'hi' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  return {
    llm: { stream },
    logger: { debug: () => {}, warn: () => {}, error: () => {} },
  } as unknown as Context
}

describe('model-mask', () => {
  it('registers the virtual provider route', async () => {
    const ctx = await mount({
      primaryProvider: 'primary-provider',
      primaryModel: 'primary-model',
    })
    const ids = ctx.llm.listProviders().map(p => p.id)
    expect(ids).toContain(VIRTUAL_PROVIDER)
  })

  it('advertises only the virtual model for the virtual provider', async () => {
    const ctx = await mount({
      primaryProvider: 'primary-provider',
      primaryModel: 'primary-model',
    })
    const models = await ctx.llm.listModels(VIRTUAL_PROVIDER)
    expect(models).toEqual([
      { provider: VIRTUAL_PROVIDER, id: VIRTUAL_MODEL, name: VIRTUAL_MODEL_NAME },
    ])
  })

  it('resolves virtual model metadata without naming the real route', async () => {
    const ctx = await mount({
      primaryProvider: 'primary-provider',
      primaryModel: 'primary-model',
    })
    const info = await ctx.llm.resolveModelInfo(VIRTUAL_PROVIDER, VIRTUAL_MODEL)
    expect(info.provider).toBe(VIRTUAL_PROVIDER)
    expect(info.id).toBe(VIRTUAL_MODEL)
    expect(info.name).toBe(VIRTUAL_MODEL_NAME)
    expect(info.provider).not.toBe('primary-provider')
  })

  it('resolves the virtual alias to the primary route at stream time', async () => {
    const captured: GenerateOptions[] = []
    const adapter: LlmAdapter = buildVirtualAdapter({
      ctx: mockCtx(captured),
      primaryProvider: 'primary-provider',
      primaryModel: 'primary-model',
    } satisfies VirtualAdapterDeps)
    const stream = adapter.stream({
      provider: VIRTUAL_PROVIDER,
      model: VIRTUAL_MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      signal: new AbortController().signal,
    })
    const received: StreamChunk[] = []
    for await (const chunk of stream) {
      received.push(chunk)
    }
    expect(received.at(-1)?.type).toBe('finish')
    expect(captured).toHaveLength(1)
    expect(captured[0]!.provider).toBe('primary-provider')
    expect(captured[0]!.model).toBe('primary-model')
    expect(captured[0]!.provider).not.toBe(VIRTUAL_PROVIDER)
    expect(captured[0]!.model).not.toBe(VIRTUAL_MODEL)
  })

  it('keeps the virtual alias on a resolved call config', async () => {
    const ctx = await mount({
      primaryProvider: 'primary-provider',
      primaryModel: 'primary-model',
    })
    const config = await ctx.llm.resolveCallConfig({
      provider: VIRTUAL_PROVIDER,
      model: VIRTUAL_MODEL,
    })
    expect(config.provider).toBe(VIRTUAL_PROVIDER)
    expect(config.model).toBe(VIRTUAL_MODEL)
  })

  it('uses default virtual values when optional fields are omitted', async () => {
    const ctx = await mount({
      primaryProvider: 'primary-provider',
      primaryModel: 'primary-model',
    })
    const ids = ctx.llm.listProviders().map(p => p.id)
    expect(ids).toContain('copymonster')
    const models = await ctx.llm.listModels('copymonster')
    expect(models[0]?.name).toBe('Model CopyMonster')
  })
})

describe('model-mask failover', () => {
  it('fails over to fallback model on 429 rate limit before first chunk', async () => {
    const attempts: string[] = []
    const mockContext = {
      llm: {
        stream: async function * (opts: GenerateOptions): AsyncIterable<StreamChunk> {
          attempts.push(`${opts.provider}/${opts.model}`)
          if (opts.provider === 'primary-provider') {
            const err = new Error('Rate limit exceeded')
            ;(err as unknown as { status: number }).status = 429
            throw err
          }
          yield { type: 'text-delta', index: 0, text: 'fallback response' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as Context

    const adapter = buildVirtualAdapter({
      ctx: mockContext,
      getPolicy: () => ({
        primaryProvider: 'primary-provider',
        primaryModel: 'primary-model',
        fallbackProvider: 'fallback-provider',
        fallbackModel: 'fallback-model',
        fallbackPolicy: { enabled: true },
      }),
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: VIRTUAL_PROVIDER,
      model: VIRTUAL_MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      signal: new AbortController().signal,
    })) {
      chunks.push(chunk)
    }

    expect(attempts).toEqual(['primary-provider/primary-model', 'fallback-provider/fallback-model'])
    expect(chunks).toHaveLength(2)
    expect((chunks[0] as { text?: string }).text).toBe('fallback response')
  })

  it('fails over to fallback model on 503 gateway error before first chunk', async () => {
    const attempts: string[] = []
    const mockContext = {
      llm: {
        stream: async function * (opts: GenerateOptions): AsyncIterable<StreamChunk> {
          attempts.push(`${opts.provider}/${opts.model}`)
          if (opts.provider === 'primary-provider') {
            const err = new Error('Service Unavailable')
            ;(err as unknown as { status: number }).status = 503
            throw err
          }
          yield { type: 'text-delta', index: 0, text: 'recovered' }
        },
      },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as Context

    const adapter = buildVirtualAdapter({
      ctx: mockContext,
      getPolicy: () => ({
        primaryProvider: 'primary-provider',
        primaryModel: 'primary-model',
        fallbackProvider: 'fallback-provider',
        fallbackModel: 'fallback-model',
      }),
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: VIRTUAL_PROVIDER,
      model: VIRTUAL_MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      signal: new AbortController().signal,
    })) {
      chunks.push(chunk)
    }

    expect(attempts).toEqual(['primary-provider/primary-model', 'fallback-provider/fallback-model'])
    expect((chunks[0] as { text?: string }).text).toBe('recovered')
  })

  it('does NOT fail over on 401 unauthorized / auth error', async () => {
    const attempts: string[] = []
    const mockContext = {
      llm: {
        stream: async function * (opts: GenerateOptions): AsyncIterable<StreamChunk> {
          attempts.push(`${opts.provider}/${opts.model}`)
          const err = new Error('Invalid API key')
          ;(err as unknown as { status: number }).status = 401
          throw err
        },
      },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as Context

    const adapter = buildVirtualAdapter({
      ctx: mockContext,
      getPolicy: () => ({
        primaryProvider: 'primary-provider',
        primaryModel: 'primary-model',
        fallbackProvider: 'fallback-provider',
        fallbackModel: 'fallback-model',
      }),
    })

    let caught: unknown
    try {
      for await (const _ of adapter.stream({
        provider: VIRTUAL_PROVIDER,
        model: VIRTUAL_MODEL,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
        signal: new AbortController().signal,
      })) {
        // do nothing
      }
    } catch (e) {
      caught = e
    }

    expect(caught).toBeDefined()
    expect(attempts).toEqual(['primary-provider/primary-model'])
  })

  it('does NOT fail over once the first chunk has been emitted', async () => {
    const attempts: string[] = []
    const mockContext = {
      llm: {
        stream: async function * (opts: GenerateOptions): AsyncIterable<StreamChunk> {
          attempts.push(`${opts.provider}/${opts.model}`)
          yield { type: 'text-delta', index: 0, text: 'first chunk' }
          // Transient failure occurs after the first chunk
          const err = new Error('500 server error mid-stream')
          ;(err as unknown as { status: number }).status = 500
          throw err
        },
      },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as Context

    const adapter = buildVirtualAdapter({
      ctx: mockContext,
      getPolicy: () => ({
        primaryProvider: 'primary-provider',
        primaryModel: 'primary-model',
        fallbackProvider: 'fallback-provider',
        fallbackModel: 'fallback-model',
      }),
    })

    const chunks: StreamChunk[] = []
    let caught: unknown
    try {
      for await (const chunk of adapter.stream({
        provider: VIRTUAL_PROVIDER,
        model: VIRTUAL_MODEL,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
        signal: new AbortController().signal,
      })) {
        chunks.push(chunk)
      }
    } catch (e) {
      caught = e
    }

    expect(caught).toBeDefined()
    // First chunk was emitted
    expect(chunks).toHaveLength(1)
    expect((chunks[0] as { text?: string }).text).toBe('first chunk')
    // Fallback was never called mid-stream
    expect(attempts).toEqual(['primary-provider/primary-model'])
  })

  it('does NOT fail over when fallback policy is disabled', async () => {
    const attempts: string[] = []
    const mockContext = {
      llm: {
        stream: async function * (opts: GenerateOptions): AsyncIterable<StreamChunk> {
          attempts.push(`${opts.provider}/${opts.model}`)
          const err = new Error('Rate limit')
          ;(err as unknown as { status: number }).status = 429
          throw err
        },
      },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as Context

    const adapter = buildVirtualAdapter({
      ctx: mockContext,
      getPolicy: () => ({
        primaryProvider: 'primary-provider',
        primaryModel: 'primary-model',
        fallbackProvider: 'fallback-provider',
        fallbackModel: 'fallback-model',
        fallbackPolicy: { enabled: false },
      }),
    })

    let caught: unknown
    try {
      for await (const _ of adapter.stream({
        provider: VIRTUAL_PROVIDER,
        model: VIRTUAL_MODEL,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
        signal: new AbortController().signal,
      })) {
        // do nothing
      }
    } catch (e) {
      caught = e
    }

    expect(caught).toBeDefined()
    expect(attempts).toEqual(['primary-provider/primary-model'])
  })
})
