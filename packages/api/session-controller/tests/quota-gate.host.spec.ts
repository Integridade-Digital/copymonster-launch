import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionCommandController } from '../src/commands.ts'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

const identity = { tenantId: 'tenant-123', userId: 'user-1' } as never

function activeSubscription(): void {
  const single = vi.fn().mockResolvedValue({ data: { subscription_status: 'active' }, error: null })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  ;(supabaseAdminClient.from as unknown as Mock).mockReturnValue({ select })
}

function quotaResponse(value: unknown, error: unknown = null): void {
  ;(supabaseAdminClient.rpc as unknown as Mock).mockResolvedValue({ data: value, error })
}

function agentsDouble(): Record<string, Mock> {
  return {
    ensureSession: vi.fn().mockResolvedValue({ agentPreset: 'preset-default', session: 'sess-1' }),
    presetForSession: vi.fn().mockReturnValue('preset-default'),
  }
}

describe('SessionCommandController quota gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeSubscription()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('blocks session creation when check_tenant_quota refuses (enforce)', async () => {
    quotaResponse([{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await expect(controller.create({} as never, identity)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
    })
    try {
      await controller.create({} as never, identity)
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteError)
      expect((error as RemoteError).message).toContain('Limite de tokens do plano atingido')
    }
  })

  it('treats a trial_expired reason as a quota refusal', async () => {
    quotaResponse([{ allowed: false, reason: 'trial_expired', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await expect(controller.create({} as never, identity)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
    })
  })

  it('allows session creation when the quota check permits', async () => {
    quotaResponse([{ allowed: true, reason: 'ok', remaining_tokens: 159_698 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    const result = await controller.create({} as never, identity)
    expect(result.sessionId).toBeDefined()
  })

  it('fails closed when the quota RPC is unavailable (enforce)', async () => {
    ;(supabaseAdminClient.rpc as unknown as Mock).mockRejectedValue(new Error('network down'))
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await expect(controller.create({} as never, identity)).rejects.toMatchObject({
      code: 'session/quota-check-failed',
    })
  })

  it('only logs and proceeds in observe mode', async () => {
    quotaResponse([{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }])
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const controller = new SessionCommandController(ctx, agentsDouble() as never, 'observe')
    const result = await controller.create({} as never, identity)
    expect(result.sessionId).toBeDefined()
    expect(warn).toHaveBeenCalled()
  })

  it('reads observe mode from QUOTA_GATE_MODE when no config is set', async () => {
    vi.stubEnv('QUOTA_GATE_MODE', 'observe')
    quotaResponse([{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    const result = await controller.create({} as never, identity)
    expect(result.sessionId).toBeDefined()
  })

  it('blocks a prompt when the quota check refuses', async () => {
    quotaResponse([{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }])
    const agent = {
      id: 'sess-1',
      session: { header: {}, snapshotEvents: () => [] },
      inbox: { nextTurn: [], nextStep: [] },
    } as unknown as Agent
    const agents = { resolveAgent: () => Promise.resolve({ agent }) }
    const controller = new SessionCommandController(new Context(), agents as never)
    await expect(controller.prompt({
      sessionId: 'sess-1',
      requestId: 'req-1',
      mode: 'followup',
      content: [{ type: 'text', text: 'hello' }],
    } as never, undefined, identity)).rejects.toMatchObject({ code: 'session/quota-exceeded' })
  })
})
