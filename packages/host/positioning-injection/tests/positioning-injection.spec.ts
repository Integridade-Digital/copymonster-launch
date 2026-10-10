import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { sessionTenantMap } from '@deepseek-ai/dsh-api-session-controller'
import type { PositioningMappingRow } from '@deepseek-ai/dsh-supabase-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POSITIONING_SECTION, apply, inject, name } from '../src/index.ts'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock('../src/persistence.ts', () => ({ fetchPositioningMapping: fetchMock }))

type MappedSession = Parameters<typeof sessionTenantMap.get>[0]

function completedRow(overrides: Partial<PositioningMappingRow> = {}): PositioningMappingRow {
  return {
    id: 'map-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    name: 'My first DNA',
    product_name: 'Signature course',
    block_1_public: 'Solo founders launching their first digital product',
    block_2_pains: null,
    block_3_solution: null,
    block_4_differentiators: null,
    block_5_awareness_stage: null,
    block_6_urgency: null,
    block_7_social_proof: null,
    block_8_objections: null,
    block_9_emotional: null,
    block_10_transformation: null,
    block_11_voice: 'Direct, no hype',
    block_12_promises: 'Ship in 30 days',
    status: 'completed',
    current_block: 12,
    is_default: true,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: '2026-10-10T00:00:00Z',
    completed_at: '2026-10-10T00:00:00Z',
    ...overrides,
  }
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin({ name, inject, apply })
  return ctx
}

/**
 * Mint one scope whose key is a fake Agent carrying `session`, mirroring the
 * agent loop's `createScope(loopCtx, this)`.
 */
async function mintAgentScope(ctx: Context, session: MappedSession): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, { session }) },
    { inject: ['systemPrompt'] },
  ))
  return scope
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('positioning injection', () => {
  it('leaves the global assembly untouched without a scope', async () => {
    const ctx = await mount()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.map(section => section.name)).not.toContain(POSITIONING_SECTION)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('runs DNA-free when the session carries no positioning mapping id', async () => {
    const ctx = await mount()
    const session = {} as MappedSession
    sessionTenantMap.set(session, { tenantId: 'tenant-1', userId: 'user-1' })
    const scope = await mintAgentScope(ctx, session)

    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(assembly.sections.map(section => section.name)).not.toContain(POSITIONING_SECTION)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('runs DNA-free when the session is unknown to the tenant map', async () => {
    const ctx = await mount()
    const scope = await mintAgentScope(ctx, {} as MappedSession)

    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(assembly.sections.map(section => section.name)).not.toContain(POSITIONING_SECTION)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prepends the positioning context above a scoped persona for a completed mapping', async () => {
    const ctx = await mount()
    const session = {} as MappedSession
    sessionTenantMap.set(session, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      positioningMappingId: 'map-1',
    })
    const scope = await mintAgentScope(ctx, session)
    scope.ctx.systemPrompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: 0,
      text: 'You are a coding agent powered by the underlying model.',
    })
    fetchMock.mockResolvedValue(completedRow())

    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(assembly.sections[0]?.name).toBe(POSITIONING_SECTION)
    const rendered = renderPrompt(assembly)
    expect(rendered).toContain('POSITIONING CONTEXT (Your Brand DNA)')
    expect(rendered).toContain('Solo founders launching their first digital product')
    expect(rendered).toContain('Direct, no hype')
    expect(rendered).toContain('You are a coding agent powered by the underlying model.')
    expect(rendered.indexOf('POSITIONING CONTEXT')).toBeLessThan(
      rendered.indexOf('You are a coding agent'))
  })

  it('skips injection for a mapping that is not completed', async () => {
    const ctx = await mount()
    const session = {} as MappedSession
    sessionTenantMap.set(session, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      positioningMappingId: 'map-1',
    })
    const scope = await mintAgentScope(ctx, session)
    fetchMock.mockResolvedValue(completedRow({ status: 'in_progress' }))

    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(assembly.sections.map(section => section.name)).not.toContain(POSITIONING_SECTION)
  })

  it('skips injection when the mapping cannot be read', async () => {
    const ctx = await mount()
    const session = {} as MappedSession
    sessionTenantMap.set(session, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      positioningMappingId: 'map-1',
    })
    const scope = await mintAgentScope(ctx, session)
    fetchMock.mockResolvedValue(undefined)

    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(assembly.sections.map(section => section.name)).not.toContain(POSITIONING_SECTION)
  })

  it('fetches once per session and serves later turns from the cache', async () => {
    const ctx = await mount()
    const session = {} as MappedSession
    sessionTenantMap.set(session, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      positioningMappingId: 'map-1',
    })
    const scope = await mintAgentScope(ctx, session)
    fetchMock.mockResolvedValue(completedRow())

    await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches when the session switches mapping id', async () => {
    const ctx = await mount()
    const session = {} as MappedSession
    sessionTenantMap.set(session, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      positioningMappingId: 'map-1',
    })
    const scope = await mintAgentScope(ctx, session)
    fetchMock.mockResolvedValue(completedRow())

    await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    sessionTenantMap.set(session, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      positioningMappingId: 'map-2',
    })
    await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('map-2', 'user-1')
  })
})
