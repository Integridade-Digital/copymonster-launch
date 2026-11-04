import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { resolveUserSandboxRoot } from '@deepseek-ai/dsh-workspace'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import { SessionCommandController } from '../src/commands.ts'
import type { ApiSessionAgentController } from '../src/agent.ts'
import type { SessionCreateRequest } from '../src/types.ts'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createUserClient: vi.fn() }))

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  createUserClient: mocks.createUserClient,
}))

const TOKEN = 'caller-token'
const identity = { tenantId: 'tenant-123', userId: 'user-1' } as unknown as UserIdentity
const adminIdentity = { ...identity, isAdmin: true } as unknown as UserIdentity

/** Answer the caller-scoped quota RPC with one refusal reason, or allow. */
function quota(reason: string): void {
  mocks.rpc.mockResolvedValue({
    data: [{ allowed: reason === 'ok', reason, remaining_tokens: reason === 'ok' ? 1000 : 0 }],
    error: null,
  })
}

function agentsDouble(): ApiSessionAgentController {
  return {
    createSession: vi.fn().mockResolvedValue({
      agent: { id: 'sess-1' },
      agentPreset: 'preset-default',
    }),
    ensureSession: vi.fn().mockResolvedValue({ agentPreset: 'preset-default', session: 'sess-1' }),
    presetForSession: vi.fn().mockReturnValue('preset-default'),
  } as unknown as ApiSessionAgentController
}

describe('SessionCommandController subscription gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createUserClient.mockReturnValue({ rpc: mocks.rpc })
  })

  it('blocks session creation when the trial expired', async () => {
    quota('trial_expired')
    const controller = new SessionCommandController(new Context(), agentsDouble())
    await expect(controller.create({} as SessionCreateRequest, identity, TOKEN))
      .rejects.toMatchObject({ code: 'session/quota-exceeded' })
  })

  it('blocks session creation when the subscription is canceled', async () => {
    quota('subscription_inactive:canceled')
    const controller = new SessionCommandController(new Context(), agentsDouble())
    await expect(controller.create({} as SessionCreateRequest, identity, TOKEN))
      .rejects.toMatchObject({ code: 'session/quota-exceeded' })
  })

  it('lets platform admins create sessions despite an inactive subscription', async () => {
    quota('trial_expired')
    const controller = new SessionCommandController(new Context(), agentsDouble())
    const root = resolveUserSandboxRoot(identity.tenantId, identity.userId)
    const result = await controller.create({ cwd: root } as SessionCreateRequest, adminIdentity, TOKEN)
    expect(result.sessionId).toBeDefined()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('allows session creation when the subscription is active', async () => {
    quota('ok')
    const controller = new SessionCommandController(new Context(), agentsDouble())
    const root = resolveUserSandboxRoot(identity.tenantId, identity.userId)
    const result = await controller.create({ cwd: root } as SessionCreateRequest, identity, TOKEN)
    expect(result.sessionId).toBeDefined()
  })

  it('reports the refusal as a RemoteError', async () => {
    quota('quota_exceeded')
    const controller = new SessionCommandController(new Context(), agentsDouble())
    try {
      await controller.create({} as SessionCreateRequest, identity, TOKEN)
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteError)
      expect((error as RemoteError).code).toBe('session/quota-exceeded')
    }
  })
})
