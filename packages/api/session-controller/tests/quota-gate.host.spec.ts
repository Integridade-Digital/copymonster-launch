import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { quotaRefusalReason } from '../src/types.ts'
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

/** Route each caller-scoped RPC to its own answer, keyed by name. */
function rpcAnswers(answers: Record<string, { data: unknown; error?: unknown }>): void {
  mocks.rpc.mockImplementation((name: string) => Promise.resolve({
    data: answers[name]?.data ?? null,
    error: answers[name]?.error ?? null,
  }))
}

/** `get_my_tenant_metrics` payload for one local subscription state. */
function metrics(status: string, trialEndsAt: string | null = null): { data: unknown } {
  return { data: { tenant: { subscription_status: status, trial_ends_at: trialEndsAt } } }
}

/** A Host context whose deployment profile installs the tenant virtual alias. */
function tenantProfileContext(): Context {
  const ctx = new Context()
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'copymonster', model: 'copy-monster-default' }),
  } as never)
  return ctx
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

  it('names the exhausted allowance in the refusal instead of provider text', async () => {
    quotaResponse([{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    try {
      await controller.create({} as never, identity, TOKEN)
      throw new Error('expected a refusal')
    } catch (error) {
      const failure = error as RemoteError
      expect(failure.code).toBe('session/quota-exceeded')
      expect(failure.message).toContain('Limite de tokens do plano atingido.')
      expect(failure.message).not.toMatch(/openrouter|deepseek|nvidia/i)
      expect(failure.details).toMatchObject({ reason: 'quota_exceeded', remainingTokens: 0 })
    }
  })

  it('reports a trial that consumed its allowance as trial_tokens_exhausted', async () => {
    quotaResponse([{ allowed: false, reason: 'subscription_inactive:trial_expired', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await expect(controller.create({} as never, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
      details: { reason: 'trial_tokens_exhausted' },
    })
  })

  it('reports an ended trial as trial_expired', async () => {
    quotaResponse([{ allowed: false, reason: 'trial_expired', remaining_tokens: 0 }])
    const controller = new SessionCommandController(new Context(), agentsDouble() as never)
    await expect(controller.create({} as never, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
      details: { reason: 'trial_expired' },
    })
  })
})

describe('quotaRefusalReason', () => {
  it('classifies every refusal the RPC can answer', () => {
    expect(quotaRefusalReason('quota_exceeded')).toBe('quota_exceeded')
    expect(quotaRefusalReason('trial_expired')).toBe('trial_expired')
    expect(quotaRefusalReason('subscription_inactive:canceled')).toBe('trial_tokens_exhausted')
    expect(quotaRefusalReason('subscription_inactive:trial_expired')).toBe('trial_tokens_exhausted')
  })

  it('leaves every non-refusal reason unclassified', () => {
    for (const reason of ['ok', 'not_authenticated', 'tenant_not_found', 'no_plan', 'unknown']) {
      expect(quotaRefusalReason(reason)).toBeUndefined()
    }
  })
})

describe('deployment-profile administrator bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createUserClient.mockReturnValue({ rpc: mocks.rpc })
  })

  it('lets the caller the tenant profile serves through a stale trial refusal', async () => {
    rpcAnswers({
      get_my_tenant_metrics: metrics('active'),
      check_my_tenant_quota: { data: [{ allowed: false, reason: 'trial_expired', remaining_tokens: 0 }] },
    })
    const controller = new SessionCommandController(tenantProfileContext(), agentsDouble() as never)
    const result = await controller.create({} as never, identity, TOKEN)
    expect(result.sessionId).toBeDefined()
    expect(mocks.rpc).not.toHaveBeenCalledWith('check_my_tenant_quota')
  })

  it('keeps the gate when the local row already reached its inactive state', async () => {
    rpcAnswers({
      get_my_tenant_metrics: metrics('trial_expired'),
      check_my_tenant_quota: { data: [{ allowed: false, reason: 'trial_expired', remaining_tokens: 0 }] },
    })
    const controller = new SessionCommandController(tenantProfileContext(), agentsDouble() as never)
    await expect(controller.create({} as never, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
    })
  })

  it('keeps the gate when the local trial date already passed', async () => {
    const expired = new Date(Date.now() - 86_400_000).toISOString()
    rpcAnswers({
      get_my_tenant_metrics: metrics('trialing', expired),
      check_my_tenant_quota: { data: [{ allowed: false, reason: 'trial_expired', remaining_tokens: 0 }] },
    })
    const controller = new SessionCommandController(tenantProfileContext(), agentsDouble() as never)
    await expect(controller.create({} as never, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
    })
  })

  it('keeps the gate when the local row cannot be read', async () => {
    rpcAnswers({
      get_my_tenant_metrics: { data: null, error: { message: 'unavailable' } },
      check_my_tenant_quota: { data: [{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }] },
    })
    const controller = new SessionCommandController(tenantProfileContext(), agentsDouble() as never)
    await expect(controller.create({} as never, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
    })
  })

  it('does not treat a deployment without the tenant alias as served', async () => {
    rpcAnswers({
      get_my_tenant_metrics: metrics('active'),
      check_my_tenant_quota: { data: [{ allowed: false, reason: 'quota_exceeded', remaining_tokens: 0 }] },
    })
    const ctx = new Context()
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-chat' }),
    } as never)
    const controller = new SessionCommandController(ctx, agentsDouble() as never)
    await expect(controller.create({} as never, identity, TOKEN)).rejects.toMatchObject({
      code: 'session/quota-exceeded',
    })
  })
})
