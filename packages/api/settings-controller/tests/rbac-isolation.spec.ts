import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '../src/index.ts'
import SettingsController from '../src/index.ts'

describe('Settings & Credentials RBAC isolation', () => {
  it('permite que administradores listem e alterem configurações', async () => {
    const ctx = new Context()
    const mockProvider = {
      writable: true,
      documentPath: '/mock/path',
      describe: () => [
        { ns: 'user-preferences', writable: true, schema: {}, layers: [] },
        { ns: 'llm-pi-ai', writable: true, schema: {}, layers: [] },
      ],
      write: () => Promise.resolve({ ns: 'llm-pi-ai', writable: true, value: {} }),
    }
    ctx.provide<SettingsProvider>('settings', mockProvider)
    await ctx.plugin(SettingsController)

    ctx.provide('authIdentity', {
      userId: 'usr_admin',
      tenantId: 'ten_main',
      role: 'admin',
      isAdmin: true,
    })

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(true)
    expect(described.namespaces.some(n => n.ns === 'llm-pi-ai')).toBe(true)
  })

  it('permite que operador da plataforma (isAdmin: true) com role: member veja e configure IA', async () => {
    const ctx = new Context()
    const mockProvider = {
      writable: true,
      documentPath: '/mock/path',
      describe: () => [
        { ns: 'user-preferences', writable: true, schema: {}, layers: [] },
        { ns: 'llm-pi-ai', writable: true, schema: {}, layers: [] },
      ],
      write: () => Promise.resolve({ ns: 'llm-pi-ai', writable: true, value: {} }),
    }
    ctx.provide<SettingsProvider>('settings', mockProvider)
    await ctx.plugin(SettingsController)

    ctx.provide('authIdentity', {
      userId: 'usr_platform_admin',
      tenantId: 'ten_main',
      role: 'member',
      isAdmin: true,
    })

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(true)
    expect(described.namespaces.some(n => n.ns === 'llm-pi-ai')).toBe(true)
  })

  it('bloqueia membros comuns de ver namespaces protegidos de IA', async () => {
    const ctx = new Context()
    const mockProvider = {
      writable: true,
      documentPath: '/mock/path',
      describe: () => [
        { ns: 'user-preferences', writable: true, schema: {}, layers: [] },
        { ns: 'llm-pi-ai', writable: true, schema: {}, layers: [] },
      ],
    }
    ctx.provide<SettingsProvider>('settings', mockProvider)
    await ctx.plugin(SettingsController)

    ctx.provide('authIdentity', {
      userId: 'usr_member',
      tenantId: 'ten_main',
      role: 'member',
      isAdmin: false,
    })

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(false)
    expect(described.namespaces.some(n => n.ns === 'llm-pi-ai')).toBe(false)
    expect(described.namespaces.some(n => n.ns === 'user-preferences')).toBe(true)

    // Tentativa de update em namespace protegido deve ser rejeitada com settings/forbidden
    await expect(ctx.settingsController.update('llm-pi-ai', { key: 'val' }, undefined))
      .rejects.toMatchObject({ code: 'settings/forbidden' })
  })

  it('permite acesso pleno quando não há autenticação (modo desktop local padrão)', async () => {
    const ctx = new Context()
    const mockProvider = {
      writable: true,
      documentPath: '/mock/path',
      describe: () => [
        { ns: 'user-preferences', writable: true, schema: {}, layers: [] },
        { ns: 'llm-pi-ai', writable: true, schema: {}, layers: [] },
      ],
    }
    ctx.provide<SettingsProvider>('settings', mockProvider)
    await ctx.plugin(SettingsController)

    const described = ctx.settingsController.describe()
    expect(described.writable).toBe(true)
    expect(described.namespaces.some(n => n.ns === 'llm-pi-ai')).toBe(true)
  })
})
