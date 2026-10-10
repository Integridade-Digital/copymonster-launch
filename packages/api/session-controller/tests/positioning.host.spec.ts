import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController, type ApiSessionAgentResult } from '../src/agent.ts'
import { SessionCommandController, sessionTenantMap, type TenantQuotaCheck } from '../src/commands.ts'
import { installSessionReadTestServices } from './test-remote.ts'

const { rpcMock, fromMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), fromMock: vi.fn() }))

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: { rpc: rpcMock, from: fromMock },
}))

const identity: UserIdentity = {
  userId: 'user-x',
  tenantId: 'tenant-x',
  role: 'member',
  email: 'user-x@example.com',
}

const allowQuota: TenantQuotaCheck = () =>
  Promise.resolve({ allowed: true, reason: 'ok', remainingTokens: 1_000_000 })

/** Rows the positioning_mappings default lookup returns. */
let defaultRows: unknown[] = []

/** from() dispatch: the tenants gate reads single(); the DNA default reads limit(). */
function installFromMock(): void {
  fromMock.mockImplementation((table: string) => {
    if (table === 'positioning_mappings') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ limit: () => Promise.resolve({ data: defaultRows, error: null }) }),
            }),
          }),
        }),
      }
    }
    return {
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    }
  })
}

/** The Session type the tenant map is keyed on, derived from the map itself. */
type MappedSession = Parameters<typeof sessionTenantMap.get>[0]

/** ensureSession/resolveAgent fake that remembers each fake Session object. */
function harnessAgents(): { agents: ApiSessionAgentController; sessionOf(id: string): MappedSession } {
  const sessions = new Map<string, MappedSession>()
  const agents = {
    ensureSession: (sessionId: SessionId) => {
      let session = sessions.get(String(sessionId))
      if (session === undefined) {
        // `header` without `cwd` makes assertSessionInSandbox return early.
        session = { id: sessionId, header: { id: sessionId } } as MappedSession
        sessions.set(String(sessionId), session)
      }
      return Promise.resolve({ id: sessionId, session } as unknown as Agent)
    },
    resolveAgent: (sessionId: SessionId): Promise<ApiSessionAgentResult> => {
      const session = sessions.get(String(sessionId))
      if (session === undefined) {
        return Promise.resolve({
          error: new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId }),
        })
      }
      return Promise.resolve({ agent: { id: sessionId, session } as unknown as Agent })
    },
    composeAgent: () => Promise.resolve({ setup: () => {} }),
    presetForSession: () => undefined,
    presetForObservation: () => undefined,
  } as unknown as ApiSessionAgentController
  return { agents, sessionOf: id => sessions.get(id)! }
}

async function baseContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  return ctx
}

async function expectFailure(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code })
}

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
  defaultRows = []
  installFromMock()
  rpcMock.mockResolvedValue({ data: null, error: null })
})

describe('session positioning selection', () => {
  it('create inherits the caller default completed mapping when none was named', async () => {
    defaultRows = [{ id: 'map-default' }]
    const ctx = await baseContext()
    const { agents, sessionOf } = harnessAgents()
    const controller = new SessionCommandController(ctx, agents, 'enforce', allowQuota)
    const value = await controller.create({} as never, identity)
    expect(sessionTenantMap.get(sessionOf(String(value.sessionId)))?.positioningMappingId)
      .toBe('map-default')
  })

  it('create keeps the explicit choice over the default', async () => {
    defaultRows = [{ id: 'map-default' }]
    const ctx = await baseContext()
    const { agents, sessionOf } = harnessAgents()
    const controller = new SessionCommandController(ctx, agents, 'enforce', allowQuota)
    const value = await controller.create({ positioningMappingId: 'map-explicit' } as never, identity)
    expect(sessionTenantMap.get(sessionOf(String(value.sessionId)))?.positioningMappingId)
      .toBe('map-explicit')
  })

  it('create runs DNA-free when no default is marked', async () => {
    const ctx = await baseContext()
    const { agents, sessionOf } = harnessAgents()
    const controller = new SessionCommandController(ctx, agents, 'enforce', allowQuota)
    const value = await controller.create({} as never, identity)
    expect(sessionTenantMap.get(sessionOf(String(value.sessionId)))?.positioningMappingId)
      .toBeUndefined()
  })

  it('selectPositioning applies a completed mapping that belongs to the caller', async () => {
    const ctx = await baseContext()
    const { agents, sessionOf } = harnessAgents()
    const controller = new SessionCommandController(ctx, agents, 'enforce', allowQuota)
    const created = await controller.create({} as never, identity)
    rpcMock.mockResolvedValue({ data: [{ id: 'map-1', status: 'completed' }], error: null })
    const applied = await controller.selectPositioning(
      { sessionId: created.sessionId, positioningMappingId: 'map-1' }, identity)
    expect(applied.positioningMappingId).toBe('map-1')
    expect(sessionTenantMap.get(sessionOf(String(created.sessionId)))?.positioningMappingId)
      .toBe('map-1')
  })

  it('selectPositioning rejects a mapping the caller cannot read', async () => {
    const ctx = await baseContext()
    const { agents } = harnessAgents()
    const controller = new SessionCommandController(ctx, agents, 'enforce', allowQuota)
    const created = await controller.create({} as never, identity)
    rpcMock.mockResolvedValue({ data: [], error: null })
    await expectFailure(controller.selectPositioning(
      { sessionId: created.sessionId, positioningMappingId: 'map-foreign' }, identity),
    'session/positioning-not-found')
  })

  it('selectPositioning rejects a mapping that is not completed', async () => {
    const ctx = await baseContext()
    const { agents } = harnessAgents()
    const controller = new SessionCommandController(ctx, agents, 'enforce', allowQuota)
    const created = await controller.create({} as never, identity)
    rpcMock.mockResolvedValue({ data: [{ id: 'map-1', status: 'in_progress' }], error: null })
    await expectFailure(controller.selectPositioning(
      { sessionId: created.sessionId, positioningMappingId: 'map-1' }, identity),
    'session/positioning-not-completed')
  })

  it('selectPositioning without an id clears a previously chosen mapping', async () => {
    defaultRows = [{ id: 'map-default' }]
    const ctx = await baseContext()
    const { agents, sessionOf } = harnessAgents()
    const controller = new SessionCommandController(ctx, agents, 'enforce', allowQuota)
    const created = await controller.create({} as never, identity)
    rpcMock.mockResolvedValue({ data: [{ id: 'map-1', status: 'completed' }], error: null })
    await controller.selectPositioning(
      { sessionId: created.sessionId, positioningMappingId: 'map-1' }, identity)
    const cleared = await controller.selectPositioning({ sessionId: created.sessionId }, identity)
    expect(cleared.positioningMappingId).toBeUndefined()
    expect(sessionTenantMap.get(sessionOf(String(created.sessionId)))?.positioningMappingId)
      .toBeUndefined()
  })
})
