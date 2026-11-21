import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmAdapter, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  apply,
  buildVirtualAdapter,
  Config,
  inject,
  isEligibleFailoverError,
  name,
  resolveRouteChain,
  VIRTUAL_MODEL,
  VIRTUAL_MODEL_NAME,
  VIRTUAL_PROVIDER,
  redactSensitiveKey,
} from '../src/index.ts'

const CHUNKS: StreamChunk[] = [
  { type: 'text-delta', index: 0, text: 'hi' },
  { type: 'finish', reason: { kind: 'stop' } },
]

interface FakeProvider {
  readonly id: string
  readonly name: string
  readonly models: readonly string[]
}

/** Build a fake registry: `listProviders()` plus `listModels(provider)`. */
function registry(providers: readonly FakeProvider[]) {
  return {
    listProviders: () => providers.map(p => ({ id: p.id, name: p.name })),
    listModels: async (provider: string) => {
      const found = providers.find(p => p.id === provider)
      if (found === undefined) throw new Error(`provider "${provider}" unavailable`)
      return found.models.map(id => ({ provider, id, name: id }))
    },
  }
}

/** Adapter over a fake registry whose provider `primary` fails with `failure`. */
function failoverAdapter(options: {
  readonly providers: readonly FakeProvider[]
  readonly defaultSelection: { provider: string; model: string }
  readonly failing: readonly string[]
  readonly failure: Error
  readonly fallbackPolicy?: { enabled?: boolean; maxAttempts?: number }
}): { adapter: LlmAdapter; attempts: string[] } {
  const attempts: string[] = []
  const ctx = {
    llm: {
      ...registry(options.providers),
      stream: async function * (opts: GenerateOptions): AsyncIterable<StreamChunk> {
        attempts.push(`${opts.provider}/${opts.model}`)
        if (options.failing.includes(opts.provider)) throw options.failure
        yield * CHUNKS
      },
    },
    agentDefaultModel: { currentSelection: () => options.defaultSelection },
    logger: { debug: () => {}, warn: () => {}, error: () => {} },
  } as never
  const adapter = buildVirtualAdapter({
    ctx,
    getPolicy: () => ({
      virtualProvider: VIRTUAL_PROVIDER,
      virtualModel: VIRTUAL_MODEL,
      virtualModelName: VIRTUAL_MODEL_NAME,
      ...options.fallbackPolicy === undefined ? {} : { fallbackPolicy: options.fallbackPolicy },
      applyToTenantsOnly: true,
    }),
  })
  return { adapter, attempts }
}

/** Collect an adapter's chunks for the virtual alias. */
async function collect(adapter: LlmAdapter): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream({
    provider: VIRTUAL_PROVIDER,
    model: VIRTUAL_MODEL,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    signal: new AbortController().signal,
  })) chunks.push(chunk)
  return chunks
}

async function mount(config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  // The `llm` service must be mounted so `ctx.llm` and adapter registration work.
  await ctx.plugin({
    name: 'llm',
    inject: [] as const,
    apply: (inner: Context) => {
      new LlmRuntime(inner)
    },
  })
  await ctx.plugin({
    name: 'agent-default-model',
    inject: [] as const,
    apply: (inner: Context) => {
      inner.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'none', model: 'none' }) } as never)
    },
  })
  await ctx.plugin({
    inject,
    name,
    Config,
    apply: (inner: Context, cfg: Config) => { apply(inner, cfg) },
  }, config)
  return ctx
}

describe('model-mask catalog', () => {
  it('redactSensitiveKey masks sensitive api keys in error strings', () => {
    expect(redactSensitiveKey('sk-or-v1-abcdef1234567890')).toBe('[REDACTED_KEY]')
    expect(redactSensitiveKey('upstream error: invalid auth sk-ant-api03-secret')).toBe('upstream error: invalid auth [REDACTED_KEY]')
    expect(redactSensitiveKey('openai error sk-proj-12345 with fallback dsk-67890')).toBe('openai error [REDACTED_KEY] with fallback [REDACTED_KEY]')
  })

  it('registers the virtual provider route with no configured provider', async () => {
    const ctx = await mount()
    expect(ctx.llm.listProviders().map(p => p.id)).toContain(VIRTUAL_PROVIDER)
  })

  it('advertises only the virtual model for the virtual provider', async () => {
    const ctx = await mount()
    expect(await ctx.llm.listModels(VIRTUAL_PROVIDER)).toEqual([
      { provider: VIRTUAL_PROVIDER, id: VIRTUAL_MODEL, name: VIRTUAL_MODEL_NAME },
    ])
  })

  it('resolves virtual model metadata without naming any real route', async () => {
    const ctx = await mount()
    const info = await ctx.llm.resolveModelInfo(VIRTUAL_PROVIDER, VIRTUAL_MODEL)
    expect(info).toMatchObject({ provider: VIRTUAL_PROVIDER, id: VIRTUAL_MODEL, name: VIRTUAL_MODEL_NAME })
  })

  it('keeps the virtual alias on a resolved call config', async () => {
    const ctx = await mount()
    const config = await ctx.llm.resolveCallConfig({ provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL })
    expect(config).toMatchObject({ provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL })
  })
})

describe('resolveRouteChain', () => {
  const ctxWith = (providers: readonly FakeProvider[], defaultSelection: { provider: string; model: string }) => ({
    llm: registry(providers),
    agentDefaultModel: { currentSelection: () => defaultSelection },
    logger: { warn: () => {} },
  }) as never

  it('prefers the deployment default when it matches an available model', async () => {
    const { primaryRoute, fallbackChain } = await resolveRouteChain(ctxWith(
      [
        { id: 'p1', name: 'P1', models: ['m1'] },
        { id: 'p2', name: 'P2', models: ['m2'] },
      ],
      { provider: 'p2', model: 'm2' },
    ))
    expect(primaryRoute).toEqual({ provider: 'p2', model: 'm2' })
    expect(fallbackChain).toEqual([{ provider: 'p1', model: 'm1' }])
  })

  it('uses the first available model when the default is not advertised', async () => {
    const { primaryRoute, fallbackChain } = await resolveRouteChain(ctxWith(
      [
        { id: 'p1', name: 'P1', models: ['m1'] },
        { id: 'p2', name: 'P2', models: ['m2'] },
      ],
      { provider: 'gone', model: 'gone' },
    ))
    expect(primaryRoute).toEqual({ provider: 'p1', model: 'm1' })
    expect(fallbackChain).toEqual([{ provider: 'p2', model: 'm2' }])
  })

  it('orders every model of every provider into the chain', async () => {
    const { primaryRoute, fallbackChain } = await resolveRouteChain(ctxWith(
      [
        { id: 'p1', name: 'P1', models: ['m1a', 'm1b'] },
        { id: 'p2', name: 'P2', models: ['m2'] },
      ],
      { provider: 'p1', model: 'm1b' },
    ))
    expect(primaryRoute).toEqual({ provider: 'p1', model: 'm1b' })
    expect(fallbackChain).toEqual([
      { provider: 'p1', model: 'm1a' },
      { provider: 'p2', model: 'm2' },
    ])
  })

  it('skips a provider whose catalog lookup fails', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'broken', name: 'Broken' }, { id: 'good', name: 'Good' }],
        listModels: async (provider: string) => {
          if (provider === 'broken') throw new Error('endpoint down')
          return [{ provider, id: 'm', name: 'm' }]
        },
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'broken', model: 'm' }) },
      logger: { warn: () => {} },
    } as never
    const { primaryRoute, fallbackChain } = await resolveRouteChain(ctx)
    expect(primaryRoute).toEqual({ provider: 'good', model: 'm' })
    expect(fallbackChain).toEqual([])
  })

  it('excludes the virtual mask provider from candidate routes', async () => {
    const { primaryRoute, fallbackChain } = await resolveRouteChain(ctxWith(
      [
        { id: VIRTUAL_PROVIDER, name: VIRTUAL_MODEL_NAME, models: [VIRTUAL_MODEL] },
        { id: 'real-provider', name: 'Real Provider', models: ['real-model'] },
      ],
      { provider: 'real-provider', model: 'real-model' },
    ))
    expect(primaryRoute).toEqual({ provider: 'real-provider', model: 'real-model' })
    expect(fallbackChain).toEqual([])
  })

  it('returns the sentinel when no model is advertised', async () => {
    const { primaryRoute, fallbackChain } = await resolveRouteChain(ctxWith([], { provider: 'x', model: 'y' }))
    expect(primaryRoute).toEqual({ provider: 'none', model: 'none' })
    expect(fallbackChain).toEqual([])
  })

  const twoProviders = [
    { id: 'deepseek-official', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: 'openrouter', name: 'OpenRouter', models: ['openrouter/free'] },
  ]

  it('leads with the administrator-pinned primary route', async () => {
    const { primaryRoute, fallbackChain } = await resolveRouteChain(
      ctxWith(twoProviders, { provider: 'deepseek-official', model: 'deepseek-chat' }),
      { primaryProvider: 'openrouter', primaryModel: 'openrouter/free' },
    )
    expect(primaryRoute).toEqual({ provider: 'openrouter', model: 'openrouter/free' })
    expect(fallbackChain).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-chat' },
      { provider: 'deepseek-official', model: 'deepseek-reasoner' },
    ])
  })

  it('puts the administrator-pinned contingency route first in the fallback chain', async () => {
    const { primaryRoute, fallbackChain } = await resolveRouteChain(
      ctxWith(twoProviders, { provider: 'deepseek-official', model: 'deepseek-chat' }),
      {
        primaryProvider: 'deepseek-official',
        primaryModel: 'deepseek-chat',
        fallbackProvider: 'openrouter',
        fallbackModel: 'openrouter/free',
      },
    )
    expect(primaryRoute).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect(fallbackChain).toEqual([
      { provider: 'openrouter', model: 'openrouter/free' },
      { provider: 'deepseek-official', model: 'deepseek-reasoner' },
    ])
  })

  it('falls back to the live catalog when the pin is incomplete', async () => {
    const { primaryRoute } = await resolveRouteChain(
      ctxWith(twoProviders, { provider: 'openrouter', model: 'openrouter/free' }),
      { primaryProvider: 'deepseek-official', primaryModel: '' },
    )
    expect(primaryRoute).toEqual({ provider: 'openrouter', model: 'openrouter/free' })
  })

  it('ignores a pin the catalog does not advertise', async () => {
    const { primaryRoute, fallbackChain } = await resolveRouteChain(
      ctxWith(twoProviders, { provider: 'openrouter', model: 'openrouter/free' }),
      { primaryProvider: 'removed-provider', primaryModel: 'gone', fallbackProvider: 'removed', fallbackModel: 'gone' },
    )
    expect(primaryRoute).toEqual({ provider: 'openrouter', model: 'openrouter/free' })
    expect(fallbackChain).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-chat' },
      { provider: 'deepseek-official', model: 'deepseek-reasoner' },
    ])
  })

  it('keeps the default chain when the pin equals the default route', async () => {
    const { primaryRoute, fallbackChain } = await resolveRouteChain(
      ctxWith(twoProviders, { provider: 'deepseek-official', model: 'deepseek-chat' }),
      {
        primaryProvider: 'deepseek-official',
        primaryModel: 'deepseek-chat',
        fallbackProvider: 'deepseek-official',
        fallbackModel: 'deepseek-chat',
      },
    )
    expect(primaryRoute).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect(fallbackChain).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-reasoner' },
      { provider: 'openrouter', model: 'openrouter/free' },
    ])
  })
})

describe('model-mask routing', () => {
  it('resolves the alias to the first real route without exposing it', async () => {
    const { adapter, attempts } = failoverAdapter({
      providers: [{ id: 'mistral', name: 'Mistral', models: ['mistral-large'] }],
      defaultSelection: { provider: 'mistral', model: 'mistral-large' },
      failing: [],
      failure: new Error('unused'),
    })
    const chunks = await collect(adapter)
    expect(attempts).toEqual(['mistral/mistral-large'])
    expect(chunks.at(-1)?.type).toBe('finish')
  })

  it('picks up a provider added after mount, with no configuration', async () => {
    const providers: FakeProvider[] = [{ id: 'deepseek-official', name: 'DeepSeek', models: ['deepseek-chat'] }]
    const attempts: string[] = []
    const ctx = {
      llm: {
        listProviders: () => providers.map(p => ({ id: p.id, name: p.name })),
        listModels: async (provider: string) => {
          const found = providers.find(p => p.id === provider)
          if (found === undefined) throw new Error('unavailable')
          return found.models.map(id => ({ provider, id, name: id }))
        },
        stream: async function * (opts: GenerateOptions): AsyncIterable<StreamChunk> {
          attempts.push(`${opts.provider}/${opts.model}`)
          yield * CHUNKS
        },
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }) },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    } as never
    const adapter = buildVirtualAdapter({
      ctx,
      getPolicy: () => ({ virtualProvider: VIRTUAL_PROVIDER, virtualModel: VIRTUAL_MODEL }),
    })
    await collect(adapter)
    expect(attempts).toEqual(['deepseek-official/deepseek-chat'])

    // The administrator adds Mistral in Settings > Models.
    providers.push({ id: 'mistral', name: 'Mistral', models: ['mistral-large'] })
    ctx.agentDefaultModel.currentSelection = () => ({ provider: 'mistral', model: 'mistral-large' })
    attempts.length = 0
    await collect(adapter)
    expect(attempts).toEqual(['mistral/mistral-large'])
  })
})

describe('model-mask failover', () => {
  const twoProviders: readonly FakeProvider[] = [
    { id: 'primary', name: 'Primary', models: ['pm'] },
    { id: 'fallback', name: 'Fallback', models: ['fm'] },
  ]
  const defaults = { provider: 'primary', model: 'pm' }

  it.each([
    ['429 rate limit', Object.assign(new Error('Rate limit exceeded'), { status: 429 })],
    ['503 gateway', Object.assign(new Error('Service Unavailable'), { status: 503 })],
    ['401 rejected key', Object.assign(new Error('API key is invalid'), { status: 401 })],
    ['402 payment required / out of credits', Object.assign(new Error('Payment Required'), { status: 402 })],
    ['insufficient quota message', new Error('insufficient_quota: You exceeded your current quota')],
    ['insufficient balance message', new Error('User has insufficient balance or credits')],
  ])('fails over to the next model on %s before the first chunk', async (_label, failure) => {
    const { adapter, attempts } = failoverAdapter({
      providers: twoProviders,
      defaultSelection: defaults,
      failing: ['primary'],
      failure,
    })
    const chunks = await collect(adapter)
    expect(attempts).toEqual(['primary/pm', 'fallback/fm'])
    expect(chunks).toHaveLength(CHUNKS.length)
  })

  it('walks the whole chain up to maxAttempts', async () => {
    const { adapter, attempts } = failoverAdapter({
      providers: [
        { id: 'a', name: 'A', models: ['am'] },
        { id: 'b', name: 'B', models: ['bm'] },
        { id: 'c', name: 'C', models: ['cm'] },
      ],
      defaultSelection: { provider: 'a', model: 'am' },
      failing: ['a', 'b'],
      failure: Object.assign(new Error('rate limit'), { status: 429 }),
      fallbackPolicy: { enabled: true, maxAttempts: 3 },
    })
    await collect(adapter)
    expect(attempts).toEqual(['a/am', 'b/bm', 'c/cm'])
  })

  it('stops at maxAttempts instead of trying the whole chain', async () => {
    const { adapter, attempts } = failoverAdapter({
      providers: [
        { id: 'a', name: 'A', models: ['am'] },
        { id: 'b', name: 'B', models: ['bm'] },
        { id: 'c', name: 'C', models: ['cm'] },
      ],
      defaultSelection: { provider: 'a', model: 'am' },
      failing: ['a', 'b', 'c'],
      failure: Object.assign(new Error('rate limit'), { status: 429 }),
      fallbackPolicy: { enabled: true, maxAttempts: 2 },
    })
    await expect(collect(adapter)).rejects.toThrow()
    expect(attempts).toEqual(['a/am', 'b/bm'])
  })

  it('still fails fast on 400 and 403 without trying another route', async () => {
    for (const status of [400, 403]) {
      const { adapter, attempts } = failoverAdapter({
        providers: twoProviders,
        defaultSelection: defaults,
        failing: ['primary'],
        failure: Object.assign(new Error('forbidden'), { status }),
      })
      await expect(collect(adapter)).rejects.toThrow()
      expect(attempts).toEqual(['primary/pm'])
    }
    expect(isEligibleFailoverError(Object.assign(new Error('x'), { status: 401 }))).toBe(true)
  })

  it('does NOT fail over once the first chunk has been emitted', async () => {
    const attempts: string[] = []
    const ctx = {
      llm: {
        ...registry(twoProviders),
        stream: async function * (opts: GenerateOptions): AsyncIterable<StreamChunk> {
          attempts.push(`${opts.provider}/${opts.model}`)
          yield { type: 'text-delta', index: 0, text: 'first chunk' }
          throw Object.assign(new Error('500 server error mid-stream'), { status: 500 })
        },
      },
      agentDefaultModel: { currentSelection: () => defaults },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    } as never
    const adapter = buildVirtualAdapter({
      ctx,
      getPolicy: () => ({ virtualProvider: VIRTUAL_PROVIDER, virtualModel: VIRTUAL_MODEL }),
    })
    const chunks: StreamChunk[] = []
    await expect((async () => {
      for await (const chunk of adapter.stream({ provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL } as GenerateOptions)) {
        chunks.push(chunk)
      }
    })()).rejects.toThrow()
    expect(chunks).toHaveLength(1)
    expect(attempts).toEqual(['primary/pm'])
  })

  it('does NOT fail over when fallback policy is disabled', async () => {
    const { adapter, attempts } = failoverAdapter({
      providers: twoProviders,
      defaultSelection: defaults,
      failing: ['primary'],
      failure: Object.assign(new Error('rate limit'), { status: 429 }),
      fallbackPolicy: { enabled: false },
    })
    await expect(collect(adapter)).rejects.toThrow()
    expect(attempts).toEqual(['primary/pm'])
  })

  it('reports an unmounted route when no model is available at all', async () => {
    // The sentinel names the empty-catalog state; the real runtime refuses an
    // unregistered provider, so the tenant sees a failure instead of silence.
    const attempts: string[] = []
    const ctx = {
      llm: {
        listProviders: () => [],
        listModels: async () => [],
        stream: async function * (opts: GenerateOptions): AsyncIterable<StreamChunk> {
          attempts.push(`${opts.provider}/${opts.model}`)
          throw new Error(`no adapter registered for provider "${opts.provider}"`)
        },
      },
      agentDefaultModel: { currentSelection: () => defaults },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    } as never
    const adapter = buildVirtualAdapter({
      ctx,
      getPolicy: () => ({ virtualProvider: VIRTUAL_PROVIDER, virtualModel: VIRTUAL_MODEL }),
    })
    await expect(collect(adapter)).rejects.toThrow(/no adapter registered/)
    expect(attempts).toEqual(['none/none'])
  })
})
