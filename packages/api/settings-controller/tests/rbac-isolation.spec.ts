import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import SettingsController from '../src/index.ts'

describe('Settings & Credentials RBAC isolation', () => {
  it('permite que administradores alterem configurações e credenciais', async () => {
    const ctx = new Context()
    await ctx.plugin(SettingsController)

    ctx.provide('authIdentity', {
      userId: 'usr_admin',
      tenantId: 'ten_main',
      role: 'admin',
      isAdmin: true,
    })

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(true)

    // Sem namespaces registrados, update de LLM não encontra entrada configurável
    await expect(ctx.settingsController.update('llm-deepseek', { apiKey: 'test' }, undefined))
      .rejects.toThrow(RemoteError)
  })

  it('bloqueia membros comuns de alterar credenciais', async () => {
    const ctx = new Context()
    await ctx.plugin(SettingsController)

    ctx.provide('authIdentity', {
      userId: 'usr_member',
      tenantId: 'ten_main',
      role: 'member',
      isAdmin: false,
    })

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(false)
    // Sem namespaces registrados: nada restrito exposto a membros
    expect(described.namespaces).toEqual([])

    // Tentativa de alterar credenciais deve ser rejeitada com credential/forbidden
    await expect(ctx.credentialsController.set('OPENAI_API_KEY', 'sk-xxx'))
      .rejects.toMatchObject({ code: 'credential/forbidden' })
    await expect(ctx.credentialsController.unset('OPENAI_API_KEY'))
      .rejects.toMatchObject({ code: 'credential/forbidden' })

    const credInfo = await ctx.credentialsController.describe(['OPENAI_API_KEY'])
    expect(credInfo.OPENAI_API_KEY?.writable).toBe(false)
  })

  it('permite acesso pleno quando não há autenticação (modo desktop local padrão)', async () => {
    const ctx = new Context()
    await ctx.plugin(SettingsController)

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(true)
  })

  it('bloqueia owner de tenant que não é admin da plataforma de alterar credenciais', async () => {
    const ctx = new Context()
    await ctx.plugin(SettingsController)

    ctx.provide('authIdentity', {
      userId: 'usr_tenant_owner',
      tenantId: 'ten_other',
      role: 'owner',
      isAdmin: false,
    })

    // Tentativa de alterar credenciais deve ser rejeitada com credential/forbidden
    await expect(ctx.credentialsController.set('OPENAI_API_KEY', 'sk-xxx'))
      .rejects.toMatchObject({ code: 'credential/forbidden' })
    await expect(ctx.credentialsController.unset('OPENAI_API_KEY'))
      .rejects.toMatchObject({ code: 'credential/forbidden' })

    const credInfo = await ctx.credentialsController.describe(['OPENAI_API_KEY'])
    expect(credInfo.OPENAI_API_KEY?.writable).toBe(false)
  })
})
