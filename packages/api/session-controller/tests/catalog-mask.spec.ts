import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, type LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent/types'
import { sanitizeProviderFailureMessage } from '../src/provider-error.ts'
import {
  buildModelCatalog,
  modelAvailable,
  VIRTUAL_MODEL,
  VIRTUAL_MODEL_NAME,
  VIRTUAL_PROVIDER,
} from '../src/catalog.ts'

function llmAdapter(models: LlmModelInfo[]): LlmAdapter {
  return new (class extends LlmAdapter {
    override async listModels() {
      return models
    }
    override async resolveModel() {
      return { provider: 'provider', id: models[0]?.id ?? 'model', name: models[0]?.name ?? 'Model' }
    }
    override async *stream(): AsyncGenerator<never> {
      return
    }
  })()
}

async function mountWithLlm(models: LlmModelInfo[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin({
    name: 'llm',
    inject: [] as const,
    apply: (inner: Context) => {
      new LlmRuntime(inner)
    },
  })
  ctx.llm.registerAdapter(['provider'], llmAdapter(models))
  return ctx
}

async function mountEmptyLlm(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin({
    name: 'llm',
    inject: [] as const,
    apply: (inner: Context) => {
      new LlmRuntime(inner)
    },
  })
  return ctx
}

describe('session-controller model catalog masking', () => {
  const selection: ModelSelection = { provider: 'provider', model: 'model' }

  it('tenant catalog exposes only the virtual CopyMonster model', async () => {
    const ctx = await mountWithLlm([{ provider: 'provider', id: 'model', name: 'Model' }])
    const catalog = await buildModelCatalog(ctx, selection, false)
    expect(catalog.groups).toHaveLength(1)
    expect(catalog.groups[0]!.id).toBe(VIRTUAL_PROVIDER)
    expect(catalog.groups[0]!.name).toBe(VIRTUAL_MODEL_NAME)
    expect(catalog.groups[0]!.models).toHaveLength(1)
    expect(catalog.groups[0]!.models[0]!.id).toBe(VIRTUAL_MODEL)
    expect(catalog.groups[0]!.models[0]!.name).toBe(VIRTUAL_MODEL_NAME)
    expect(catalog.routableProviders).toEqual([VIRTUAL_PROVIDER])
    expect(catalog.failures).toEqual([])
    expect(catalog.default).toEqual({ provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL })
    // The real provider must not leak into the tenant payload.
    expect(catalog.routableProviders).not.toContain('provider')
  })

  it('admin catalog exposes the full real provider catalog', async () => {
    const ctx = await mountWithLlm([{ provider: 'provider', id: 'model', name: 'Model' }])
    const catalog = await buildModelCatalog(ctx, selection, true)

    expect(catalog.groups).toHaveLength(1)
    expect(catalog.groups[0]!.id).toBe('provider')
    expect(catalog.groups[0]!.models).toHaveLength(1)
    expect(catalog.groups[0]!.models[0]!.id).toBe('model')
    expect(catalog.routableProviders).toContain('provider')
    expect(catalog.default).toEqual(selection)
  })

  it('modelAvailable recognizes the virtual alias', async () => {
    const ctx = new Context()
    expect(await modelAvailable(ctx, { provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL })).toBe(true)
  })

  it('modelAvailable rejects an unknown provider', async () => {
    const ctx = await mountEmptyLlm()
    expect(await modelAvailable(ctx, { provider: 'no-such-provider', model: 'no-such-model' })).toBe(false)
  })

  it('modelAvailable accepts a registered real provider model', async () => {
    const ctx = await mountWithLlm([{ provider: 'provider', id: 'model', name: 'Model' }])
    expect(await modelAvailable(ctx, selection)).toBe(true)
  })

  it('sanitizes provider failure messages into the stable unavailable copy', () => {
    const leaked = sanitizeProviderFailureMessage('503: service unavailable from deepseek-official')
    expect(leaked).not.toBe('503: service unavailable from deepseek-official')
    expect(leaked).not.toContain('deepseek-official')
    expect(leaked).not.toContain('503')
  })
})
