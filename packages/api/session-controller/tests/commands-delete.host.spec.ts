import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import { resolveUserSandboxRoot } from '@deepseek-ai/dsh-workspace'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController, type TenantQuotaCheck } from '../src/commands.ts'
import { installSessionReadTestServices } from './test-remote.ts'

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

const identity: UserIdentity = {
  userId: 'user-x',
  tenantId: 'tenant-x',
  role: 'member',
  email: 'user-x@example.com',
}
const sandboxRoot = resolveUserSandboxRoot(identity.tenantId, identity.userId)

const allowQuota: TenantQuotaCheck = () =>
  Promise.resolve({ allowed: true, reason: 'ok', remainingTokens: 1_000_000 })

/** ensureSession/resolveAgent fakes that never touch persistence. */
function harnessAgents(): ApiSessionAgentController {
  return {
    ensureSession: (sessionId: SessionId) =>
      Promise.resolve({ id: sessionId, session: { id: sessionId } } as unknown as Agent),
    composeAgent: () => Promise.resolve({ setup: () => {} }),
    presetForSession: () => undefined,
    presetForObservation: () => undefined,
  } as unknown as ApiSessionAgentController
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

/** Snapshot stat returns for a stored session at the given cwd. */
function statSnapshot(cwd: string | undefined) {
  return { header: { id: SessionId('s1'), ...cwd !== undefined ? { cwd } : {} }, revision: 'r1' as never }
}

beforeEach(() => { vi.clearAllMocks() })

describe('SessionCommandController.delete', () => {
  it('deletes a stored session whose cwd is inside the sandbox', async () => {
    const ctx = await baseContext()
    const stat = vi.fn(async () => statSnapshot(`${sandboxRoot}/projects/p`))
    const remove = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { stat, delete: remove } as never)
    const controller = new SessionCommandController(ctx, harnessAgents(), 'enforce', allowQuota)

    const value = await controller.delete({ sessionId: SessionId('s1') }, sandboxRoot)

    expect(value.deleted).toBe(true)
    expect(remove).toHaveBeenCalledWith(SessionId('s1'))
    await ctx.fiber.dispose()
  })

  it('rejects a stored session whose cwd is outside the sandbox', async () => {
    const ctx = await baseContext()
    const stat = vi.fn(async () => statSnapshot('/etc'))
    const remove = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { stat, delete: remove } as never)
    const controller = new SessionCommandController(ctx, harnessAgents(), 'enforce', allowQuota)

    await expectFailure(
      controller.delete({ sessionId: SessionId('s1') }, sandboxRoot),
      'session/unauthorized',
    )
    expect(remove).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('maps a writer-held persistence failure to session/writer-held', async () => {
    const ctx = await baseContext()
    const stat = vi.fn(async () => statSnapshot(`${sandboxRoot}/projects/p`))
    const remove = vi.fn(async () => { throw new SessionAlreadyOwnedError(SessionId('s1')) })
    ctx.provide('sessionPersistence', { stat, delete: remove } as never)
    const controller = new SessionCommandController(ctx, harnessAgents(), 'enforce', allowQuota)

    await expectFailure(
      controller.delete({ sessionId: SessionId('s1') }, sandboxRoot),
      'session/writer-held',
    )
    await ctx.fiber.dispose()
  })

  it('is idempotent for an absent session', async () => {
    const ctx = await baseContext()
    const stat = vi.fn(async () => undefined)
    const remove = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { stat, delete: remove } as never)
    const controller = new SessionCommandController(ctx, harnessAgents(), 'enforce', allowQuota)

    const value = await controller.delete({ sessionId: SessionId('missing') }, sandboxRoot)

    expect(value.deleted).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
