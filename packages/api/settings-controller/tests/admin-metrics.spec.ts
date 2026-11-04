import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SettingsController from '../src/index.ts'

// Mock Supabase
const mockTenants = [
  {
    id: 'ten_001',
    name: 'Tenant Principal',
    slug: 'tenant-principal',
    status: 'active',
    subscription_status: 'trialing',
    plan_id: 'plan_pro',
    trial_ends_at: new Date(Date.now() + 86400000 * 5).toISOString(),
    trial_used: false,
    trial_tokens_used: 150000,
    current_period_tokens_used: 150000,
    created_at: new Date().toISOString(),
  },
  {
    id: 'ten_002',
    name: 'Tenant Secundário',
    slug: 'tenant-secundario',
    status: 'active',
    subscription_status: 'active',
    plan_id: 'plan_pro',
    trial_ends_at: null,
    trial_used: true,
    trial_tokens_used: 0,
    current_period_tokens_used: 450000,
    created_at: new Date().toISOString(),
  },
]

const mockPlan = {
  id: 'plan_pro',
  name: 'Pro',
  slug: 'pro',
  monthly_price_cents: 29700,
  annual_price_cents: 180000,
  token_limit_input: 7000000,
  token_limit_output: 3000000,
  max_workspaces: 5,
  max_sessions: 20,
  storage_gb: 10,
  ai_tier: 'advanced',
}

const mockAuditLogs = [
  {
    id: 'log_001',
    tenant_id: 'ten_001',
    user_id: 'usr_admin',
    action: 'SETTINGS_UPDATE',
    resource_type: 'SETTINGS',
    resource_id: 'llm-deepseek',
    old_value: null,
    new_value: { model: 'v3' },
    ip_address: '127.0.0.1',
    user_agent: 'Vitest Agent',
    created_at: new Date().toISOString(),
  },
]

let rpcCalls: Array<{ fn: string; params: unknown }> = []

vi.mock('@deepseek-ai/dsh-supabase-client', () => {
  const rpc = (fn: string, params: unknown) => {
    rpcCalls.push({ fn, params })
    if (fn === 'admin_list_tenants') return Promise.resolve({ data: mockTenants, error: null })
    if (fn === 'admin_list_audit_logs') return Promise.resolve({ data: mockAuditLogs, error: null })
    if (fn === 'get_my_tenant_metrics') {
      return Promise.resolve({ data: { tenant: mockTenants[0], plan: mockPlan }, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }
  return {
    createUserClient: () => ({ rpc }),
  }
})

describe('SettingsController - Métricas, Auditoria e Administração (Etapa 3)', () => {
  beforeEach(() => {
    rpcCalls = []
  })

  it('permite que administradores listem tenants e logs de auditoria', async () => {
    const ctx = new Context()

    ctx.provide('authIdentity', {
      userId: 'usr_admin',
      tenantId: 'ten_001',
      role: 'admin',
    })
    ctx.provide('authToken', 'token-admin')

    await ctx.plugin(SettingsController)

    const tenants = await ctx.settingsController.listTenants()
    expect(tenants).toHaveLength(2)
    expect(tenants[0]?.id).toBe('ten_001')
    expect(tenants[0]?.subscription_status).toBe('trialing')

    const auditLogs = await ctx.settingsController.listAuditLogs()
    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0]?.action).toBe('SETTINGS_UPDATE')
  })

  it('bloqueia membros comuns de listar tenants e logs de auditoria', async () => {
    const ctx = new Context()

    ctx.provide('authIdentity', {
      userId: 'usr_member',
      tenantId: 'ten_001',
      role: 'member',
    })
    ctx.provide('authToken', 'token-member')

    await ctx.plugin(SettingsController)

    await expect(ctx.settingsController.listTenants()).rejects.toMatchObject({
      code: 'settings/forbidden',
    })

    await expect(ctx.settingsController.listAuditLogs()).rejects.toMatchObject({
      code: 'settings/forbidden',
    })
  })

  it('permite que membro consulte as métricas de seu próprio tenant', async () => {
    const ctx = new Context()

    ctx.provide('authIdentity', {
      userId: 'usr_member',
      tenantId: 'ten_001',
      role: 'member',
    })
    ctx.provide('authToken', 'token-member')

    await ctx.plugin(SettingsController)

    const metrics = await ctx.settingsController.getTenantMetrics()
    expect(metrics.tenantId).toBe('ten_001')
    expect(metrics.subscriptionStatus).toBe('trialing')
    expect(metrics.trial.trialTokensUsed).toBe(150000)
    expect(metrics.trial.maxTrialTokens).toBe(1000000)
    expect(metrics.trial.daysLeft).toBeGreaterThan(0)
    expect(metrics.plan?.slug).toBe('pro')
  })

  it('bloqueia membro comum de consultar métricas de outro tenant', async () => {
    const ctx = new Context()

    ctx.provide('authIdentity', {
      userId: 'usr_member',
      tenantId: 'ten_001',
      role: 'member',
    })
    ctx.provide('authToken', 'token-member')

    await ctx.plugin(SettingsController)

    await expect(ctx.settingsController.getTenantMetrics({ tenantId: 'ten_002' })).rejects.toMatchObject({
      code: 'settings/forbidden',
    })
  })

  it('permite registrar consumo de tokens via recordTokenUsage chamando a RPC atômica', async () => {
    const ctx = new Context()

    ctx.provide('authIdentity', {
      userId: 'usr_member',
      tenantId: 'ten_001',
      role: 'member',
    })
    ctx.provide('authToken', 'token-member')

    await ctx.plugin(SettingsController)

    const result = await ctx.settingsController.recordTokenUsage({ tokens: 1250 })
    expect(result.recorded).toBe(true)
    expect(result.tenantId).toBe('ten_001')
    expect(result.tokensAdded).toBe(1250)

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toEqual({
      fn: 'increment_my_tenant_token_usage',
      params: {
        p_tokens: 1250,
        p_tenant_id: null,
      },
    })
  })

  it('does not expose a client-driven audit write', async () => {
    const ctx = new Context()
    await ctx.plugin(SettingsController)
    expect('recordAuditLog' in ctx.settingsController).toBe(false)
  })

  it('rejeita chamadas sem autenticação em endpoints administrativos', async () => {
    const ctx = new Context()

    await ctx.plugin(SettingsController)

    await expect(ctx.settingsController.listTenants()).rejects.toMatchObject({
      code: 'settings/unauthorized',
    })

    await expect(ctx.settingsController.listAuditLogs()).rejects.toMatchObject({
      code: 'settings/unauthorized',
    })

    await expect(ctx.settingsController.getTenantMetrics()).rejects.toMatchObject({
      code: 'settings/unauthorized',
    })
  })
})
