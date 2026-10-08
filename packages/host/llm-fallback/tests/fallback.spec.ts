import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, LlmFailure } from '@deepseek-ai/dsh-llm'
import { apply, inject, name } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const RULE = { primary: 'deepseek-official', fallbackProvider: 'openrouter', fallbackModel: 'openrouter/free' }
const BASE: LlmCallConfig = { provider: 'deepseek-official', model: 'deepseek-flash' }

async function mount(rules: Config['rules'] = [RULE]): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  const plugin = { inject, name, apply: (inner: Context, config: Config) => { apply(inner, config) } }
  const fiber = ctx.plugin(plugin, { rules })
  await fiber
  return { ctx, agent: {} as Agent }
}

function failure(code: string): LlmFailure {
  return { message: `failed: ${code}`, code } as LlmFailure
}

function requestError(
  ctx: Context,
  agent: Agent,
  opts: {
    provider?: string
    code?: string
    turn?: number
    downstream?: RequestErrorAction
    aborted?: boolean
  } = {},
): Promise<RequestErrorAction> {
  const controller = new AbortController()
  if (opts.aborted === true) controller.abort()
  return ctx.waterfall(
    'agent/request-error',
    {
      agent,
      turn: opts.turn ?? 1,
      step: 0,
      provider: opts.provider ?? 'deepseek-official',
      failure: failure(opts.code ?? 'SERVER'),
      retryPolicy: undefined,
      signal: controller.signal,
    },
    () => Promise.resolve(opts.downstream),
  )
}

function request(ctx: Context, agent: Agent, base: LlmCallConfig, turn = 1): Promise<LlmCallConfig> {
  return ctx.waterfall(
    'agent/request',
    { agent, turn, step: 0, signal: new AbortController().signal },
    () => Promise.resolve(base),
  )
}

describe('llm-fallback', () => {
  it('fails over to the fallback route once the downstream stops retrying', async () => {
    const { ctx, agent } = await mount()
    expect(await requestError(ctx, agent, { downstream: undefined })).toEqual({ kind: 'retry' })
    expect(await request(ctx, agent, BASE)).toEqual({ provider: 'openrouter', model: 'openrouter/free' })
  })

  it('leaves a same-route retry to the downstream policy', async () => {
    const { ctx, agent } = await mount()
    expect(await requestError(ctx, agent, { downstream: { kind: 'retry' } })).toEqual({ kind: 'retry' })
    expect(await request(ctx, agent, BASE)).toEqual(BASE)
  })

  it('ignores failure codes outside the rule', async () => {
    const { ctx, agent } = await mount()
    expect(await requestError(ctx, agent, { code: 'QUOTA' })).toBeUndefined()
    expect(await request(ctx, agent, BASE)).toEqual(BASE)
  })

  it('ignores providers without a rule', async () => {
    const { ctx, agent } = await mount()
    expect(await requestError(ctx, agent, { provider: 'other-provider' })).toBeUndefined()
    expect(await request(ctx, agent, BASE)).toEqual(BASE)
  })

  it('returns to the primary route on a later turn', async () => {
    const { ctx, agent } = await mount()
    await requestError(ctx, agent, { turn: 1 })
    expect(await request(ctx, agent, BASE, 2)).toEqual(BASE)
  })

  it('does not fail over when the signal is aborted', async () => {
    const { ctx, agent } = await mount()
    expect(await requestError(ctx, agent, { aborted: true })).toBeUndefined()
    expect(await request(ctx, agent, BASE)).toEqual(BASE)
  })

  it('is a no-op with no rules', async () => {
    const { ctx, agent } = await mount([])
    expect(await requestError(ctx, agent)).toBeUndefined()
    expect(await request(ctx, agent, BASE)).toEqual(BASE)
  })

  it('drops the primary reasoning effort on the fallback route', async () => {
    const { ctx, agent } = await mount()
    await requestError(ctx, agent)
    const selected = await request(ctx, agent, {
      provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high',
    } as LlmCallConfig)
    expect(selected).toEqual({ provider: 'openrouter', model: 'openrouter/free' })
  })
})
