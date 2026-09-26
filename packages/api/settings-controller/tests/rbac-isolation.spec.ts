import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import SettingsController from '../src/index.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

const PreferencesSchema = z.object({
  theme: z.union(['light', 'dark']).default('light'),
})

const DeepSeekSchema = z.object({
  apiKey: z.string().role('secret'),
})

describe('Settings & Credentials RBAC isolation', () => {
  it('permite que administradores listem e alterem configurações de LLM e credenciais', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(MemoryCredentials)
    ctx.settings.register('user-preferences', PreferencesSchema, { base: { theme: 'light' } })
    ctx.settings.register('llm-deepseek', DeepSeekSchema, { base: { apiKey: 'sk-init' } })

    ctx.provide('authIdentity', {
      userId: 'usr_admin',
      tenantId: 'ten_main',
      role: 'admin',
    })

    await ctx.plugin(SettingsController)

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(true)
    expect(described.namespaces.some(n => n.ns === 'llm-deepseek')).toBe(true)

    await expect(ctx.settingsController.update('llm-deepseek', { apiKey: 'test' }, undefined))
      .resolves.toBeDefined()

    await expect(ctx.credentialsController.set('OPENAI_API_KEY', 'sk-xxx'))
      .resolves.toBeUndefined()
  })

  it('bloqueia membros comuns de alterar configurações de LLM e credenciais', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(MemoryCredentials)
    ctx.settings.register('user-preferences', PreferencesSchema, { base: { theme: 'light' } })
    ctx.settings.register('llm-deepseek', DeepSeekSchema, { base: { apiKey: 'sk-init' } })

    ctx.provide('authIdentity', {
      userId: 'usr_member',
      tenantId: 'ten_main',
      role: 'member',
    })

    await ctx.plugin(SettingsController)

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(false)
    expect(described.hasDocument).toBe(false)
    // Membro comum não vê namespaces restritos de LLM
    expect(described.namespaces.some(n => n.ns === 'llm-deepseek')).toBe(false)
    expect(described.namespaces.some(n => n.ns === 'user-preferences')).toBe(true)

    // Tentativa de update de LLM deve ser rejeitada com settings/forbidden
    await expect(ctx.settingsController.update('llm-deepseek', { apiKey: 'hacked' }, undefined))
      .rejects.toThrowError(RemoteError)
    await expect(ctx.settingsController.update('llm-deepseek', { apiKey: 'hacked' }, undefined))
      .rejects.toMatchObject({ code: 'settings/forbidden' })

    // Tentativa de replace de LLM deve ser rejeitada com settings/forbidden
    await expect(ctx.settingsController.replace('llm-deepseek', { apiKey: 'hacked' }, undefined))
      .rejects.toMatchObject({ code: 'settings/forbidden' })

    // Tentativa de mutação de LLM deve ser rejeitada com settings/forbidden
    await expect(ctx.settingsController.mutate('llm-deepseek', [], undefined))
      .rejects.toMatchObject({ code: 'settings/forbidden' })

    // Tentativa de alterar credenciais deve ser rejeitada com credential/forbidden
    await expect(ctx.credentialsController.set('OPENAI_API_KEY', 'sk-xxx'))
      .rejects.toMatchObject({ code: 'credential/forbidden' })
    await expect(ctx.credentialsController.unset('OPENAI_API_KEY'))
      .rejects.toMatchObject({ code: 'credential/forbidden' })

    // Describe credentials deve marcar writable: false
    const credInfo = await ctx.credentialsController.describe(['OPENAI_API_KEY'])
    expect(credInfo.OPENAI_API_KEY.writable).toBe(false)
  })

  it('permite acesso pleno quando não há autenticação (modo desktop local padrão)', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(MemoryCredentials)
    ctx.settings.register('user-preferences', PreferencesSchema, { base: { theme: 'light' } })
    ctx.settings.register('llm-deepseek', DeepSeekSchema, { base: { apiKey: 'sk-init' } })

    await ctx.plugin(SettingsController)

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(true)
    expect(described.namespaces.some(n => n.ns === 'llm-deepseek')).toBe(true)

    await expect(ctx.settingsController.update('llm-deepseek', { apiKey: 'test' }, undefined))
      .resolves.toBeDefined()
  })
})
