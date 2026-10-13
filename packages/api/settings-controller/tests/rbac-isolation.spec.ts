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
  it('permite que administradores da plataforma listem e alterem configurações de LLM e credenciais', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(MemoryCredentials)
    ctx.settings.register('user-preferences', PreferencesSchema, { base: { theme: 'light' } })
    ctx.settings.register('llm-deepseek', DeepSeekSchema, { base: { apiKey: 'sk-init' } })

    ctx.provide('authIdentity', {
      userId: 'usr_admin',
      tenantId: '00000000-0000-0000-0000-000000000001',
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

  it('permite administrador via metadata.is_admin mesmo fora do tenant da plataforma', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(MemoryCredentials)
    ctx.settings.register('llm-deepseek', DeepSeekSchema, { base: { apiKey: 'sk-init' } })

    ctx.provide('authIdentity', {
      userId: 'usr_flagged',
      tenantId: 'ten_other',
      role: 'owner',
      isAdmin: true,
    })

    await ctx.plugin(SettingsController)

    await expect(ctx.settingsController.update('llm-deepseek', { apiKey: 'test' }, undefined))
      .resolves.toBeDefined()
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
      .rejects.toThrow(RemoteError)
    await expect(ctx.settingsController.update('llm-deepseek', { apiKey: 'hacked' }, undefined))
      .rejects.toMatchObject({ code: 'settings/forbidden' })

    // Tentativa de replace de LLM deve ser rejeitada com settings/forbidden
    await expect(ctx.settingsController.replace('llm-deepseek', { apiKey: 'hacked' }, undefined))
      .rejects.toMatchObject({ code: 'settings/forbidden' })

    // Tentativa de mutação de LLM deve ser rejeitada com settings/forbidden
    await expect(ctx.settingsController.mutate('llm-deepseek', [], undefined))
      .rejects.toMatchObject({ code: 'settings/forbidden' })

    // Membro comum ainda altera namespaces não protegidos (preferências próprias)
    await expect(ctx.settingsController.update('user-preferences', { theme: 'dark' }, undefined))
      .resolves.toBeDefined()

    // Tentativa de alterar credenciais deve ser rejeitada com credential/forbidden
    await expect(ctx.credentialsController.set('OPENAI_API_KEY', 'sk-xxx'))
      .rejects.toMatchObject({ code: 'credential/forbidden' })
    await expect(ctx.credentialsController.unset('OPENAI_API_KEY'))
      .rejects.toMatchObject({ code: 'credential/forbidden' })

    // Describe credentials deve marcar writable: false
    const credInfo = await ctx.credentialsController.describe(['OPENAI_API_KEY'])
    expect(credInfo.OPENAI_API_KEY?.writable).toBe(false)
    // ...mas nunca expõe o valor armazenado
    expect(JSON.stringify(credInfo)).not.toContain('sk-xxx')
  })

  it('recusa owner de tenant pessoal (não-plataforma) em namespaces protegidos', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(MemoryCredentials)
    ctx.settings.register('llm-deepseek', DeepSeekSchema, { base: { apiKey: 'sk-init' } })

    ctx.provide('authIdentity', {
      userId: 'usr_creator',
      tenantId: 'ten_personal',
      role: 'owner',
    })

    await ctx.plugin(SettingsController)

    await expect(ctx.settingsController.update('llm-deepseek', { apiKey: 'hacked' }, undefined))
      .rejects.toMatchObject({ code: 'settings/forbidden' })
    await expect(ctx.credentialsController.set('OPENAI_API_KEY', 'sk-xxx'))
      .rejects.toMatchObject({ code: 'credential/forbidden' })
  })

  it('recusa todas as configurações e credenciais quando não há autenticação (fail-closed)', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(MemoryCredentials)
    ctx.settings.register('user-preferences', PreferencesSchema, { base: { theme: 'light' } })
    ctx.settings.register('llm-deepseek', DeepSeekSchema, { base: { apiKey: 'sk-init' } })

    await ctx.plugin(SettingsController)

    expect(() => ctx.settingsController.describe())
      .toThrow(RemoteError)
    await expect(ctx.settingsController.update('user-preferences', { theme: 'dark' }, undefined))
      .rejects.toMatchObject({ code: 'settings/unauthorized' })
    await expect(ctx.settingsController.mutate('user-preferences', [], undefined))
      .rejects.toMatchObject({ code: 'settings/unauthorized' })
    await expect(ctx.settingsController.replace('user-preferences', {}, undefined))
      .rejects.toMatchObject({ code: 'settings/unauthorized' })
    await expect(ctx.credentialsController.set('OPENAI_API_KEY', 'sk-xxx'))
      .rejects.toMatchObject({ code: 'settings/unauthorized' })
    await expect(ctx.credentialsController.unset('OPENAI_API_KEY'))
      .rejects.toMatchObject({ code: 'settings/unauthorized' })
    await expect(ctx.credentialsController.describe(['OPENAI_API_KEY']))
      .rejects.toMatchObject({ code: 'settings/unauthorized' })
  })
})
