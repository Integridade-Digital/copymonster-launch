/** Models section registration: slot declaration injection, the locale-following label thunk, and HMR recovery. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import Schema from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { remoteDefaultResponses } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/remote-default-responses.ts'
import { ok, RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, refreshIfLoaded } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import {
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE, WELCOME_NOTICE_VERSION,
} from '../src/onboarding-copy.ts'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { DeepSeekOnboardingDialog } from '../src/client/DeepSeekOnboardingDialog.tsx'
import { WelcomeNotice } from '../src/client/WelcomeNotice.tsx'
import type { IndexInjection, WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as hostPlugin from '../src/index.ts'
import { ONBOARDING_CONFIG_GLOBAL } from '../src/onboarding-config.ts'

/** The Peer an index render speaks for; this listener reads no field of it. */
const PAGE_PEER = { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1]

afterEach(() => { vi.unstubAllGlobals() })

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

async function bench(mock = RemoteMock.create().load(remoteDefaultResponses), services: object = {}, isAdmin = true) {
  onTestFinished(() => { mock.assertNoUnmatched() })
  // Provider surfaces register only for a platform operator; the shell publishes
  // `users.metadata.is_admin` into `__DSH_AUTH__`.
  vi.stubGlobal('__DSH_AUTH__', { isAdmin })
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const remote = new TestRemote(ctx, {
    credentials: {
      describe: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
      set: vi.fn(),
      unset: vi.fn(),
    },
    llm: {
      listProviders: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
      listConfigurableProviders: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
      discoverModels: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
      ...services,
    },
    settings: mock.remote.settings,
    session: { initializeDefaultModel: vi.fn(async () => ({ ok: true, value: undefined })) },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, remote }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

/**
 * Capture the shell's auth-resolution listeners. This lane has no `window`, so
 * the gate subscribes on `globalThis` when a test installs these stubs.
 * @returns a `fire` helper that announces a republished session.
 */
function stubAuthEvent(): { fire: () => void } {
  const listeners = new Set<() => void>()
  vi.stubGlobal('addEventListener', (name: string, fn: () => void) => {
    if (name === 'copymonster:auth') listeners.add(fn)
  })
  vi.stubGlobal('removeEventListener', (name: string, fn: () => void) => {
    if (name === 'copymonster:auth') listeners.delete(fn)
  })
  return { fire: () => { for (const fn of listeners) fn() } }
}

describe('ui-settings-models apply', () => {
  it('keeps manual credential onboarding available when the native shell owns automatic onboarding', async () => {
    const { ctx, slots } = await bench()
    declare(slots)
    try {
      const host = ctx.plugin(hostPlugin, { credentialOnboarding: false })
      await host.await()
      const rows: IndexInjection[] = []
      ctx.emit('webserver/index-inject', rows, PAGE_PEER)
      expect(rows).toEqual([{ kind: 'global', name: ONBOARDING_CONFIG_GLOBAL, value: { credentialOnboarding: false } }])
      for (const row of rows) if (row.kind === 'global') vi.stubGlobal(row.name, row.value)
      const plugin = ctx.plugin({ inject: [...inject], apply })
      await plugin.await()
      expect(slots.entries('settings.onboarding').map(entry => entry.options.id)).toEqual(['welcome-notice', 'deepseek-official'])
      const onboarding = slots.entries('settings.onboarding').find(entry => entry.options.id === 'deepseek-official')!
      expect((onboarding.inject as () => { automatic: boolean })().automatic).toBe(false)
      expect(slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['usage', 'models'])
      await plugin.dispose()
      expect(slots.entries('settings.onboarding')).toEqual([])
      await host.dispose()
      const after: IndexInjection[] = []
      ctx.emit('webserver/index-inject', after, PAGE_PEER)
      expect(after).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('defaults to browser onboarding and rejects malformed bootstrap options', async () => {
    expect(hostPlugin.Config({})).toEqual({ credentialOnboarding: true })
    expect(hostPlugin.Config['~standard'].validate({ credentialOnboarding: 'false' })).toHaveProperty('issues')
    const { ctx } = await bench()
    try {
      vi.stubGlobal(ONBOARDING_CONFIG_GLOBAL, { credentialOnboarding: 'false' })
      expect(() => { apply(ctx) }).toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings', 'remote.session',
      'configForms', 'settingsSchema',
    ])
  })

  it('loads tenant metrics with the request argument the gateway requires', async () => {
    const mock = RemoteMock.create().load(remoteDefaultResponses)
      .unary('settings/getTenantMetrics', ok({}))
    const { ctx, slots } = await bench(mock)
    declare(slots)
    const plugin = ctx.plugin({ inject: [...inject], apply })
    await plugin.await()
    try {
      const usage = slots.entries('settings.section').find(entry => entry.options.id === 'usage')!
      const injected = usage.inject?.() ?? {}
      const load = injected.load
      if (typeof load !== 'function') throw new Error('usage inject must expose load')
      await expect((load as () => Promise<unknown>)()).resolves.toEqual({})
      expect(mock.remote.settings.getTenantMetrics).toHaveBeenCalledWith({})
    } finally {
      await plugin.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('registers the models nav entry for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(ModelsSection)
    expect(entry.options).toMatchObject({ id: 'models', order: 10 })
    // The section claims its two extension seats in the same registration.
    expect(before.slots.spec('settings.models.provider-card')).toMatchObject({ kind: 'keyed', scope: 'root' })
    expect(before.slots.spec('settings.models.footer')).toMatchObject({ kind: 'list', scope: 'root' })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('模型')
    const injected = (entry.inject as unknown as () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected)()
    expect(injected.canManage).toBe(true)
    expect(injected.t('nav')).toBe('模型')
    expect(injected.t('deleteTitle')).toBe('删除 {provider}？')
    expect(typeof injected.controller.load).toBe('function')
    expect(injected.hooks.snapshot).toBe(injected.controller.store)
    expect(typeof injected.operations.writeSettings).toBe('function')
    const onboarding = before.slots.entries('settings.onboarding')
    expect(onboarding).toHaveLength(2)
    expect(onboarding.find(entry => entry.options.id === 'welcome-notice')).toMatchObject({
      component: WelcomeNotice,
      options: { id: 'welcome-notice', order: -100 },
    })
    const deepSeek = onboarding.find(entry => entry.options.id === 'deepseek-official')!
    expect(deepSeek.component).toBe(DeepSeekOnboardingDialog)
    const analytics = (deepSeek.inject!() as object) as import('../src/client/DeepSeekOnboardingDialog.tsx').DeepSeekOnboardingInjected
    analytics.track?.('api_key_save_click', {})
    const track = vi.fn()
    before.ctx.provide('productAnalytics', { track } as never)
    analytics.track?.('api_key_save_click', {})
    expect(track).toHaveBeenCalledWith('api_key_save_click', {})
    expect(deepSeek.options).toMatchObject({ id: 'deepseek-official', order: 0 })
    const deepSeekInjected = (
      deepSeek.inject as unknown as () => import('../src/client/DeepSeekOnboardingDialog.tsx').DeepSeekOnboardingInjected
    )()
    expect(deepSeekInjected.hooks.models).toBe(injected.controller.store)
    expect(typeof deepSeekInjected.operations.storeCredential).toBe('function')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['usage'])
    expect(after.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section').map(entry => entry.component)).toEqual([UsageSection, ModelsSection])
    expect(after.slots.entries('settings.onboarding')).toHaveLength(2)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('settings.section')).toHaveLength(2)
  })

  it('keeps provider surfaces unregistered for a creator and follows a later admin grant', async () => {
    const auth = stubAuthEvent()
    const b = await bench(undefined, {}, false)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The testing notice is product copy for everyone; provider setup is not.
    expect(b.slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['usage'])
    expect(b.slots.entries('settings.onboarding').map(entry => entry.options.id)).toEqual(['welcome-notice'])

    vi.stubGlobal('__DSH_AUTH__', { isAdmin: true })
    auth.fire()
    expect(b.slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['usage', 'models'])
    expect(b.slots.entries('settings.onboarding').map(entry => entry.options.id))
      .toEqual(['welcome-notice', 'deepseek-official'])

    vi.stubGlobal('__DSH_AUTH__', { isAdmin: false })
    auth.fire()
    expect(b.slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['usage'])
    expect(b.slots.entries('settings.onboarding').map(entry => entry.options.id)).toEqual(['welcome-notice'])
  })

  it('the label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    const modelsEntry = b.slots.entries('settings.section').find(entry => entry.options.id === 'models')!
    expect(resolveSlotLabel(modelsEntry.options.label)).toBe('Models')
    const injected = modelsEntry.inject as unknown as () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected
    expect(injected().t('deleteTitle')).toBe('Delete {provider}?')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(modelsEntry.options.label)).toBe('模型')
    expect(injected().t('deleteTitle')).toBe('删除 {provider}？')
  })

  it('locale change while the slot is undeclared stays a no-op', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    b.locale.setLocale('zh')
  })

  it('re-registers after an HMR collapse re-declares the slot (stale disposer must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(2)
    // Declarer unload: the cascade removes our entry while our local
    // disposer variable goes stale.
    redeclare()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section').map(entry => entry.component)).toEqual([UsageSection, ModelsSection])
    expect(b.slots.entries('settings.onboarding')).toHaveLength(2)
    // The locale path also recovers through the same ledger re-check.
    b.locale.setLocale('en')
    const modelsEntry = b.slots.entries('settings.section').find(entry => entry.options.id === 'models')!
    expect(resolveSlotLabel(modelsEntry.options.label)).toBe('Models')
    b.locale.setLocale('zh')
  })

  it('accepts extension entries under the declared seats and cascades them with the declarer', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    // A keyed card extension and a footer entry register through the ordinary
    // ledger once the section's registration declared the seats.
    const disposeCard = b.slots.register(
      { name: 'settings.models.provider-card', key: 'llm-pi-ai' } as never,
      () => null,
    )
    b.slots.register({ name: 'settings.models.footer', id: 'extra', order: 0 } as never, () => null)
    expect(b.slots.entries('settings.models.provider-card')).toHaveLength(1)
    expect(b.slots.entries('settings.models.footer')).toHaveLength(1)
    // Extension-side HMR safety: its own disposer removes the entry.
    disposeCard()
    expect(b.slots.entries('settings.models.provider-card')).toHaveLength(0)
    // Declarer unload cascades whatever extension entries remain.
    await fiber.dispose()
    expect(b.slots.entries('settings.models.footer')).toHaveLength(0)
  })

  it('registers the zh/en nav dictionaries and disposes everything with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings.models')('nav')).toBe('模型')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    // The (ns, locale) seats are free again — the dictionary disposers ran.
    expect(() => b.locale.register('settings.models', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings.models', 'en', {})).not.toThrow()
  })
})

describe('pushed invalidations', () => {
  it('ignores invalidations before the page ever loaded', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The fake wire face has no methods: a fetch attempt would throw.
    b.remote.emit('settings/document-updated', ['llm-pi-ai', 1])
    b.remote.emit('credentials/reference-updated', ['OPENAI_API_KEY'])
    b.remote.emit('llm/adapters-updated', [])
    b.ctx.emit('connection/reset')
  })

  it('refreshes a loaded page and skips an idle one', () => {
    const loads: number[] = []
    const controller = {
      store: { getSnapshot: () => ({ status: 'ready' }) },
      load: () => { loads.push(1); return Promise.resolve() },
    }
    refreshIfLoaded(controller as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
    const idle = {
      store: { getSnapshot: () => ({ status: 'idle' }) },
      load: () => { loads.push(2); return Promise.resolve() },
    }
    refreshIfLoaded(idle as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
  })

  it('routes pushed credential invalidation into the shared onboarding join', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'deepseek-official')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/DeepSeekOnboardingDialog.tsx').DeepSeekOnboardingInjected
    )()
    injected.controller.store.update((state) => { state.status = 'ready' })
    const load = vi.spyOn(injected.controller, 'load').mockResolvedValue()
    b.remote.emit('credentials/reference-updated', ['DEEPSEEK_API_KEY'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('welcome state follows the shared mirror across document commits', async () => {
    // The welcome notice derives from its settings scope: a document commit
    // reaches it through the mirror's one refresh, with no routing here.
    const mock = RemoteMock.create().load(remoteDefaultResponses)
    const namespace = {
      ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
      schema: JSON.parse(JSON.stringify(Schema.object({ [WELCOME_NOTICE_ACK_FIELD]: Schema.string() }).toJSON())) as JsonValue,
      value: {},
      autoGenerate: true, applies: 'live' as const,
      secrets: [],
      revision: 0,
    }
    const document = { writable: true, hasDocument: false, namespaces: [namespace] }
    mock.remote.settings.describe.mockResolvedValue(ok(document))
    const b = await bench(mock)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'welcome-notice')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/WelcomeNotice.tsx').WelcomeNoticeInjected
    )()
    await injected.controller.load()
    await vi.waitFor(() => {
      expect(injected.hooks.welcome.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: false })
    })
    mock.remote.settings.describe.mockResolvedValue(ok({
      ...document,
      namespaces: [{ ...namespace, value: { [WELCOME_NOTICE_ACK_FIELD]: WELCOME_NOTICE_VERSION }, revision: 1 }],
    }))
    b.remote.emit('settings/document-updated', ['ui-settings-general', 1])
    await vi.waitFor(() => {
      expect(injected.hooks.welcome.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: true })
    })
  })

  it('joins the refreshed mirror view on a settings invalidation', async () => {
    const mock = RemoteMock.create().load(remoteDefaultResponses)
    const namespace = { ns: 'llm-test', schema: {}, value: {}, autoGenerate: true, applies: 'live' as const, secrets: [], revision: 1 }
    const document = { writable: true, hasDocument: false, namespaces: [namespace] }
    const describe = mock.remote.settings.describe
    describe.mockResolvedValue(ok(document))
    const listProviders = vi.fn(() => Promise.resolve({ ok: true as const, value: [] }))
    const b = await bench(mock, { listProviders })
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')
      .find(candidate => candidate.options.id === 'models')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected
    )()
    await injected.controller.load()
    expect(injected.hooks.snapshot.getSnapshot().namespaces.get('llm-test')?.revision).toBe(1)

    describe.mockResolvedValue(ok({ ...document, namespaces: [{ ...namespace, revision: 2 }] }))
    b.remote.emit('settings/document-updated', ['llm-test', 2])

    await vi.waitFor(() => {
      expect(injected.hooks.snapshot.getSnapshot().namespaces.get('llm-test')?.revision).toBe(2)
    })
    expect(describe).toHaveBeenCalledTimes(2)
  })
})
