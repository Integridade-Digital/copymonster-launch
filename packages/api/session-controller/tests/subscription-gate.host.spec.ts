import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { resolveUserSandboxRoot } from '@deepseek-ai/dsh-workspace'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import { SessionCommandController } from '../src/commands.ts'
import type { ApiSessionAgentController } from '../src/agent.ts'
import type { SessionCreateRequest } from '../src/types.ts'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

const identity = { tenantId: 'tenant-123', userId: 'user-1' } as unknown as UserIdentity

/** Stub `tenants.subscription_status` lookup and permit the quota check. */
function activeSubscription(status: string): void {
  const single = vi.fn().mockResolvedValue({ data: { subscription_status: status }, error: null })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  ;(supabaseAdminClient.from as unknown as Mock).mockReturnValue({ select })
}

describe('SessionCommandController subscription gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(supabaseAdminClient.rpc as unknown as Mock).mockResolvedValue({
      data: [{ allowed: true, reason: 'ok', remaining_tokens: 1000 }],
      error: null,
    })
  })

  it('blocks session creation when tenant status is trial_expired', async () => {
    activeSubscription('trial_expired')
    const controller = new SessionCommandController(new Context(), {} as unknown as ApiSessionAgentController)
    await expect(controller.create({} as SessionCreateRequest, identity)).rejects.toThrow(RemoteError)
    try {
      await controller.create({} as SessionCreateRequest, identity)
    } catch (error) {
      const remote = error as RemoteError
      expect(remote.code).toBe('session/subscription-inactive')
      expect((remote.details as { subscriptionStatus?: string } | undefined)?.subscriptionStatus)
        .toBe('trial_expired')
    }
  })

  it('blocks session creation when tenant status is canceled', async () => {
    activeSubscription('canceled')
    const controller = new SessionCommandController(new Context(), {} as unknown as ApiSessionAgentController)
    await expect(controller.create({} as SessionCreateRequest, identity)).rejects.toThrow(RemoteError)
  })

  it('allows session creation when tenant status is active', async () => {
    activeSubscription('active')
    const ctx = new Context()
    const mockAgents = {
      ensureSession: vi.fn().mockResolvedValue({
        agentPreset: 'preset-default',
        session: 'sess-1',
      }),
      presetForSession: vi.fn().mockReturnValue('preset-default'),
    } as unknown as ApiSessionAgentController
    const controller = new SessionCommandController(ctx, mockAgents)

    const root = resolveUserSandboxRoot(identity.tenantId, identity.userId)
    const result = await controller.create({ cwd: root } as SessionCreateRequest, identity)
    expect(result).toBeDefined()
    expect(result.sessionId).toBeDefined()
  })
})
