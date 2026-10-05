import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { buildModelCatalog } from '../src/catalog.ts'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: {
    rpc: vi.fn(),
  },
}))

interface MockProvider {
  id: string
  name: string
}

interface MockModel {
  id: string
  name: string
  description?: string
}

function createMockLlm(
  providers: MockProvider[],
  modelsMap: Record<string, MockModel[]>,
  resolvedMap: Record<string, Record<string, unknown>>,
) {
  return {
    listProviders: () => providers,
    listModels: (providerId: string) => Promise.resolve(modelsMap[providerId] ?? []),
    resolveModelInfo: (providerId: string, modelId: string) =>
      Promise.resolve(resolvedMap[`${providerId}/${modelId}`] ?? { id: modelId, name: modelId }),
  }
}

describe('buildModelCatalog metadata merge (Bloco 8.1.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('banco tem metadata de gpt-4o; runtime tem gpt-4o com capabilities antigas -> capabilities do banco prevalecem', async () => {
    const dbProviders = [
      {
        id: '10000000-0000-0000-0000-000000000001',
        name: 'OpenAI',
        provider_type: 'openai',
        is_active: true,
        models: [
          {
            id: '20000000-0000-0000-0000-000000000001',
            model_id: 'gpt-4o',
            display_name: 'GPT-4o (OpenAI Admin)',
            context_window: 128000,
            cost_input_1k: 0.005,
            cost_output_1k: 0.015,
            capabilities: { vision: true, tools: true, audio: true },
            is_default_for_plans: ['starter', 'pro'],
            allowed_plans: ['starter', 'pro', 'legend'],
          },
        ],
      },
    ]

    vi.mocked(supabaseAdminClient.rpc).mockResolvedValue({
      data: dbProviders,
      error: null,
    } as unknown as { data: unknown; error: unknown })

    const ctx = new Context()
    const mockLlm = createMockLlm(
      [{ id: 'openai', name: 'OpenAI' }],
      { openai: [{ id: 'gpt-4o', name: 'gpt-4o legacy' }] },
      {
        'openai/gpt-4o': {
          id: 'gpt-4o',
          name: 'gpt-4o legacy',
          capabilities: { vision: false, tools: false },
          context: { contextWindow: 8192 },
        },
      },
    )
    ctx.provide('llm', mockLlm as never)
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'openai', model: 'gpt-4o' }),
    } as never)

    const catalog = await buildModelCatalog(ctx)
    expect(catalog.groups).toHaveLength(1)
    const openaiGroup = catalog.groups[0]
    expect(openaiGroup).toBeDefined()
    expect(openaiGroup!.id).toBe('openai')
    expect(openaiGroup!.models).toHaveLength(1)

    const gpt4o = openaiGroup!.models[0]
    expect(gpt4o).toBeDefined()
    expect(gpt4o!.id).toBe('gpt-4o')
    expect(gpt4o!.name).toBe('GPT-4o (OpenAI Admin)')
    expect(gpt4o!.capabilities).toEqual({ vision: true, tools: true, audio: true })
    expect(gpt4o!.contextWindow).toBe(128000)
    expect(gpt4o!.costInput1k).toBe(0.005)
    expect(gpt4o!.costOutput1k).toBe(0.015)
    expect(gpt4o!.isDefaultForPlans).toEqual(['starter', 'pro'])
    expect(gpt4o!.allowedPlans).toEqual(['starter', 'pro', 'legend'])
  })

  it('banco tem modelo que NAO existe no runtime -> ignorado', async () => {
    const dbProviders = [
      {
        id: '10000000-0000-0000-0000-000000000001',
        name: 'OpenAI',
        provider_type: 'openai',
        is_active: true,
        models: [
          {
            id: '20000000-0000-0000-0000-000000000099',
            model_id: 'gpt-5-unsupported',
            display_name: 'GPT-5 Unsupported',
            capabilities: { reasoning: true },
          },
        ],
      },
    ]

    vi.mocked(supabaseAdminClient.rpc).mockResolvedValue({
      data: dbProviders,
      error: null,
    } as unknown as { data: unknown; error: unknown })

    const ctx = new Context()
    const mockLlm = createMockLlm(
      [{ id: 'openai', name: 'OpenAI' }],
      { openai: [{ id: 'gpt-4o', name: 'gpt-4o' }] },
      { 'openai/gpt-4o': { id: 'gpt-4o', name: 'gpt-4o' } },
    )
    ctx.provide('llm', mockLlm as never)
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'openai', model: 'gpt-4o' }),
    } as never)

    const catalog = await buildModelCatalog(ctx)
    expect(catalog.groups[0]!.models).toHaveLength(1)
    expect(catalog.groups[0]!.models[0]!.id).toBe('gpt-4o')
  })

  it('runtime tem modelo que NAO existe no banco -> mantido', async () => {
    const dbProviders = [
      {
        id: '10000000-0000-0000-0000-000000000001',
        name: 'OpenAI',
        provider_type: 'openai',
        is_active: true,
        models: [],
      },
    ]

    vi.mocked(supabaseAdminClient.rpc).mockResolvedValue({
      data: dbProviders,
      error: null,
    } as unknown as { data: unknown; error: unknown })

    const ctx = new Context()
    const mockLlm = createMockLlm(
      [{ id: 'openai', name: 'OpenAI' }],
      { openai: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }] },
      { 'openai/gpt-4o-mini': { id: 'gpt-4o-mini', name: 'GPT-4o Mini' } },
    )
    ctx.provide('llm', mockLlm as never)
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'openai', model: 'gpt-4o-mini' }),
    } as never)

    const catalog = await buildModelCatalog(ctx)
    expect(catalog.groups[0]!.models).toHaveLength(1)
    expect(catalog.groups[0]!.models[0]!.id).toBe('gpt-4o-mini')
    expect(catalog.groups[0]!.models[0]!.name).toBe('GPT-4o Mini')
  })

  it('RPC falha -> fallback silencioso para ctx.llm puro', async () => {
    vi.mocked(supabaseAdminClient.rpc).mockRejectedValue(new Error('Postgres connection failed'))

    const ctx = new Context()
    const mockLlm = createMockLlm(
      [{ id: 'openai', name: 'OpenAI' }],
      { openai: [{ id: 'gpt-4o', name: 'GPT-4o' }] },
      { 'openai/gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' } },
    )
    ctx.provide('llm', mockLlm as never)
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'openai', model: 'gpt-4o' }),
    } as never)

    const catalog = await buildModelCatalog(ctx)
    expect(catalog.groups[0]!.models).toHaveLength(1)
    expect(catalog.groups[0]!.models[0]!.id).toBe('gpt-4o')
    expect(catalog.groups[0]!.models[0]!.name).toBe('GPT-4o')
  })
})
