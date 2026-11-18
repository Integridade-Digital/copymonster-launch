import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, type LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { SessionController } from '../src/index.ts'
import { VIRTUAL_MODEL, VIRTUAL_PROVIDER } from '../src/catalog.ts'

function llmAdapter(provider: string, models: readonly string[]): LlmAdapter {
  return new (class extends LlmAdapter {
    override providerInfo() {
      return { id: provider, name: provider }
    }
    override async listModels(): Promise<LlmModelInfo[]> {
      return models.map(id => ({ provider, id, name: id }))
    }
    override async *stream(): AsyncGenerator<never> {
      return
    }
  })()
}

interface Routes {
  readonly primaryRoute: { provider: string; model: string }
  readonly fallbackChain: Array<{ provider: string; model: string }>
}

async function controllerWith(routes?: Routes): Promise<SessionController> {
  const ctx = new Context()
  await ctx.plugin({
    name: 'llm',
    inject: [] as const,
    apply: (inner: Context) => { new LlmRuntime(inner) },
  })
  ctx.llm.registerAdapter(['mistral'], llmAdapter('mistral', ['mistral-large']))
  if (routes !== undefined) ctx.provide('modelMask', { currentRoutes: () => routes } as never)
  return new SessionController(ctx, {})
}

describe('session modelMaskStatus', () => {
  it('reports the tenant alias and the mask resolved routes', async () => {
    const controller = await controllerWith({
      primaryRoute: { provider: 'mistral', model: 'mistral-large' },
      fallbackChain: [{ provider: 'deepseek-official', model: 'deepseek-chat' }],
    })
    expect(controller.modelMaskStatus()).toEqual({
      alias: { provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL },
      primaryRoute: { provider: 'mistral', model: 'mistral-large' },
      fallbackChain: [{ provider: 'deepseek-official', model: 'deepseek-chat' }],
    })
  })

  it('reports no primary route for an empty chain', async () => {
    const controller = await controllerWith({
      primaryRoute: { provider: 'none', model: 'none' },
      fallbackChain: [],
    })
    expect(controller.modelMaskStatus().primaryRoute).toBeNull()
  })

  it('reports the alias alone when the mask is not mounted', async () => {
    const controller = await controllerWith()
    expect(controller.modelMaskStatus()).toEqual({
      alias: { provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL },
      primaryRoute: null,
      fallbackChain: [],
    })
  })
})
