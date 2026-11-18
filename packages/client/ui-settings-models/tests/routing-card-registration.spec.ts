import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import { PlatformRoutingCard } from '../src/client/PlatformRoutingCard.tsx'

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__DSH_AUTH__
})

async function mountBench(isAdmin: boolean) {
  (globalThis as Record<string, unknown>).__DSH_AUTH__ = { isAdmin }
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)

  new TestRemote(ctx, {
    credentials: {
      describe: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
      set: vi.fn(),
      unset: vi.fn(),
    },
    llm: {
      listProviders: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
      listConfigurableProviders: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
      discoverModels: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve({ ok: true, value: { writable: true, hasDocument: false, namespaces: [] } })),
      mutate: vi.fn(() => Promise.resolve({ ok: true, value: { ns: 'model-mask', revision: 1 } })),
      getTenantMetrics: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
    },
    session: {
      initializeDefaultModel: vi.fn(async () => ({ ok: true, value: undefined })),
      modelCatalog: vi.fn(async () => ({ ok: true, value: { groups: [] } })),
    },
  })

  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )

  const plugin = ctx.plugin({ inject: [...inject], apply })
  await plugin.await()

  return { ctx, slots, plugin }
}

describe('PlatformRoutingCard registration', () => {
  it('registers PlatformRoutingCard in settings.models.footer when user is platform admin', async () => {
    const { ctx, slots, plugin } = await mountBench(true)
    try {
      const footerEntries = slots.entries('settings.models.footer')
      expect(footerEntries).toHaveLength(1)
      expect(footerEntries[0]?.options.id).toBe('platform-routing')
      expect(footerEntries[0]?.component).toBe(PlatformRoutingCard)
    } finally {
      await plugin.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('does NOT register PlatformRoutingCard in footer when user is regular tenant', async () => {
    const { ctx, slots, plugin } = await mountBench(false)
    try {
      const footerEntries = slots.entries('settings.models.footer')
      expect(footerEntries).toHaveLength(0)
    } finally {
      await plugin.dispose()
      await ctx.fiber.dispose()
    }
  })
})
