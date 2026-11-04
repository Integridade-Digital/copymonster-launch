import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '../src/types.ts'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionCommandController } from '../src/commands.ts'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createUserClient: vi.fn() }))

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  createUserClient: mocks.createUserClient,
}))

const TOKEN = 'caller-token'
const identity = { tenantId: 'tenant-123', userId: 'user-1' } as never
const adminIdentity = { tenantId: 'tenant-123', userId: 'user-1', isAdmin: true } as never

const USER_SOURCE: MessageSource = { kind: 'user', rpcId: 'req-1' as SessionRequestId }

function quotaResponse(value: unknown, error: unknown = null): void {
  mocks.rpc.mockResolvedValue({ data: value, error })
}

function agentsDouble(): Record<string, unknown> {
  return {
    createSession: vi.fn().mockResolvedValue({
      agent: { id: 'sess-1' },
      agentPreset: 'preset-default',
    }),
    ensureSession: vi.fn().mockResolvedValue({ agentPreset: 'preset-default', session: 'sess-1' }),
    presetForSession: vi.fn().mockReturnValue('preset-default'),
  }
}

describe('SessionCommandController quota gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createUserClient.mockReturnValue({ rpc: mocks.rpc })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('blocks session creation when check_my_tenant_quota refuses (enforce)', async () => {
    quotaResponse([{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await expect(controller.create({} as never, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
    })
    try {
      await controller.create({} as never, identity, TOKEN)
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteError)
      expect((error as RemoteError).message).toContain('Limite de tokens do plano atingido')
    }
  })

  it('reads the quota through the caller-scoped RPC', async () => {
    quotaResponse([{ allowed: true, reason: 'ok', remaining_tokens: 10 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await controller.create({} as never, identity, TOKEN)

    expect(mocks.createUserClient).toHaveBeenCalledWith(TOKEN)
    expect(mocks.rpc).toHaveBeenCalledWith('check_my_tenant_quota')
  })

  it('treats a trial_expired reason as a quota refusal', async () => {
    quotaResponse([{ allowed: false, reason: 'trial_expired', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await expect(controller.create({} as never, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
    })
  })

  it('allows session creation when the quota check permits', async () => {
    quotaResponse([{ allowed: true, reason: 'ok', remaining_tokens: 159_698 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    const result = await controller.create({} as never, identity, TOKEN)
    expect(result.sessionId).toBeDefined()
  })

  it('lets platform admins create sessions without consulting the quota RPC', async () => {
    quotaResponse([{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    const result = await controller.create({} as never, adminIdentity, TOKEN)
    expect(result.sessionId).toBeDefined()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('fails closed when the quota RPC is unavailable (enforce)', async () => {
    mocks.rpc.mockRejectedValue(new Error('network down'))
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await expect(controller.create({} as never, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-check-failed',
    })
  })

  it('fails closed when the caller token is missing (enforce)', async () => {
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await expect(controller.create({} as never, identity)).rejects.toMatchObject({
      code: 'session/quota-check-failed',
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('only logs and proceeds in observe mode', async () => {
    quotaResponse([{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }])
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const controller = new SessionCommandController(ctx, agentsDouble() as never, 'observe')
    const result = await controller.create({} as never, identity, TOKEN)
    expect(result.sessionId).toBeDefined()
    expect(warn).toHaveBeenCalled()
  })

  it('reads observe mode from QUOTA_GATE_MODE when no config is set', async () => {
    vi.stubEnv('QUOTA_GATE_MODE', 'observe')
    quotaResponse([{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    const result = await controller.create({} as never, identity, TOKEN)
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
    } as never, USER_SOURCE, undefined, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
    })
  })
})
