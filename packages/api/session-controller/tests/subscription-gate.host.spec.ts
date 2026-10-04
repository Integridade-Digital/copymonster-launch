import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { resolveUserSandboxRoot } from '@deepseek-ai/dsh-workspace'
import { SessionCommandController } from '../src/commands.ts'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: {
    from: vi.fn(),
  },
}))

describe('SessionCommandController subscription gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks session creation when tenant status is trial_expired', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: { subscription_status: 'trial_expired' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    vi.mocked(supabaseAdminClient.from).mockReturnValue({ select: selectMock } as any)

    const ctx = new Context()
    const controller = new SessionCommandController(ctx, {} as any)
    const identity = { tenantId: 'tenant-123', userId: 'user-1' } as any

    await expect(
      controller.create({} as any, identity)
    ).rejects.toThrowError(RemoteError)

    try {
      await controller.create({} as any, identity)
    } catch (err: any) {
      expect(err.code).toBe('session/subscription-inactive')
      expect(err.details?.subscriptionStatus).toBe('trial_expired')
    }
  })

  it('blocks session creation when tenant status is canceled', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: { subscription_status: 'canceled' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    vi.mocked(supabaseAdminClient.from).mockReturnValue({ select: selectMock } as any)

    const ctx = new Context()
    const controller = new SessionCommandController(ctx, {} as any)
    const identity = { tenantId: 'tenant-123', userId: 'user-1' } as any

    await expect(
      controller.create({} as any, identity)
    ).rejects.toThrowError(RemoteError)
  })

  it('allows session creation when tenant status is active', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: { subscription_status: 'active' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    vi.mocked(supabaseAdminClient.from).mockReturnValue({ select: selectMock } as any)

    const ctx = new Context()
    const mockAgents = {
      ensureSession: vi.fn().mockResolvedValue({
        agentPreset: 'preset-default',
        session: 'sess-1',
      }),
      presetForSession: vi.fn().mockReturnValue('preset-default'),
    }
    const controller = new SessionCommandController(ctx, mockAgents as any)
    const identity = { tenantId: 'tenant-123', userId: 'user-1' } as any

    const root = resolveUserSandboxRoot(identity.tenantId, identity.userId)
    const res = await controller.create({ cwd: root } as any, identity)
    expect(res).toBeDefined()
    expect(res.sessionId).toBeDefined()
  })
})
