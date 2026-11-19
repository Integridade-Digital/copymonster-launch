// @vitest-environment jsdom
/** Admin provider manager card: route selects, write payload, and the automatic fallback. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import { PlatformRoutingCard } from '../src/client/PlatformRoutingCard.tsx'
import type { PlatformRoutingCardInjected, PlatformRoutingCardProps, RoutingCatalogProvider } from '../src/client/PlatformRoutingCard.tsx'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: PlatformRoutingCardInjected['t'] = key => en[key]

const CATALOG: readonly RoutingCatalogProvider[] = [
  { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'deepseek-chat' }, { id: 'deepseek-reasoner', name: 'deepseek-reasoner' }] },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    models: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'openrouter/free', name: 'openrouter/free' },
    ],
  },
]

/** The model-mask namespace as the Host describes it. */
function maskNamespace(value: Record<string, JsonValue>, user: Record<string, JsonValue> = value): SettingsNamespaceView {
  return {
    ns: 'model-mask',
    schema: {},
    base: {},
    user,
    value,
    autoGenerate: false,
    applies: 'live',
    secrets: [],
    revision: 2,
  }
}

function scripted(value: Record<string, JsonValue>, overrides: {
  writable?: boolean
  catalog?: () => Promise<readonly RoutingCatalogProvider[]>
  mutate?: ReturnType<typeof vi.fn>
} = {}) {
  const namespace = maskNamespace(value)
  const mutate = overrides.mutate ?? vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { ...namespace, revision: 3 },
  }))
  const face = {
    llm: {
      listProviders: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
      listConfigurableProviders: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
      discoverModels: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve({
        ok: true as const,
        value: { writable: overrides.writable ?? true, hasDocument: false, namespaces: [namespace] },
      })),
      mutate,
    },
    credentials: {
      describe: vi.fn((refs: string[]): Promise<RemoteResult<Record<string, { configured: boolean }>>> =>
        Promise.resolve({ ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: false }])) })),
      set: vi.fn(),
      unset: vi.fn(),
    },
    session: {
      initializeDefaultModel: vi.fn(async () => ({ ok: true as const, value: undefined })),
      modelCatalog: vi.fn(async () => ({ ok: true as const, value: { groups: [] } })),
    },
  }
  return { face, mutate, catalog: overrides.catalog ?? ((): Promise<readonly RoutingCatalogProvider[]> => Promise.resolve(CATALOG)) }
}

async function mount(value: Record<string, JsonValue>, overrides: Parameters<typeof scripted>[1] = {}) {
  const { face, mutate, catalog } = scripted(value, overrides)
  const ctx = Object.assign(new Context(), { remote: face })
  const mirror = new SettingsDescribeMirror(ctx)
  const controller = new ModelsSettingsStore(ctx, settingsSchema, mirror)
  await controller.load()
  const injected = {
    controller,
    hooks: { snapshot: controller.store },
    operations: createModelsOperations(ctx),
    catalog,
    t,
  }
  const props = { ...injected, useSnapshot: bindSnapshotSelector(controller.store) } as unknown as PlatformRoutingCardProps
  render(<PlatformRoutingCard {...props} />)
  return { mutate, controller }
}

describe('PlatformRoutingCard', () => {
  it('offers every catalog provider and the automatic choice', async () => {
    await mount({})
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(3) })
    expect([...provider.options].map(option => option.value)).toEqual(['', 'deepseek-official', 'openrouter'])
    expect(provider.options[0]?.textContent).toBe(en.routingAutomatic)
    expect(screen.getByText(en.routingPrimaryAuto)).toBeTruthy()
    expect(screen.getByText(en.routingFallbackAuto)).toBeTruthy()
    expect(provider.disabled).toBe(false)
    expect(screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryModel).disabled).toBe(true)
    expect(screen.getByRole('button', { name: en.routingSave })).toHaveProperty('disabled', true)
  })

  it('pins openrouter and deepseek-chat from the real catalog', async () => {
    const { mutate } = await mount({})
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(3) })

    fireEvent.change(provider, { target: { value: 'openrouter' } })
    const model = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryModel)
    fireEvent.change(model, { target: { value: 'deepseek/deepseek-chat' } })
    expect(model.value).toBe('deepseek/deepseek-chat')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.routingSave })) })
    expect(mutate).toHaveBeenCalledWith('model-mask', [
      { op: 'set', path: ['primaryProvider'], value: 'openrouter' },
      { op: 'set', path: ['primaryModel'], value: 'deepseek/deepseek-chat' },
      { op: 'set', path: ['fallbackProvider'], value: '' },
      { op: 'set', path: ['fallbackModel'], value: '' },
      { op: 'set', path: ['fallbackPolicy', 'enabled'], value: true },
    ], 2)
  })

  it('writes the chosen provider and model for both routes', async () => {
    const { mutate } = await mount({})
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(3) })

    fireEvent.change(provider, { target: { value: 'deepseek-official' } })
    const model = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryModel)
    expect([...model.options].map(option => option.value))
      .toEqual(['', 'deepseek-chat', 'deepseek-reasoner'])
    fireEvent.change(model, { target: { value: 'deepseek-chat' } })

    fireEvent.change(screen.getByLabelText(en.routingFallbackProvider), { target: { value: 'openrouter' } })
    fireEvent.change(screen.getByLabelText(en.routingFallbackModel), { target: { value: 'openrouter/free' } })

    const save = screen.getByRole('button', { name: en.routingSave })
    expect(save).toHaveProperty('disabled', false)
    await act(async () => { fireEvent.click(save) })

    expect(mutate).toHaveBeenCalledWith('model-mask', [
      { op: 'set', path: ['primaryProvider'], value: 'deepseek-official' },
      { op: 'set', path: ['primaryModel'], value: 'deepseek-chat' },
      { op: 'set', path: ['fallbackProvider'], value: 'openrouter' },
      { op: 'set', path: ['fallbackModel'], value: 'openrouter/free' },
      { op: 'set', path: ['fallbackPolicy', 'enabled'], value: true },
    ], 2)
    await screen.findByText(en.routingSaved)
  })

  it('shows the stored pin and clears it back to automatic', async () => {
    const { mutate } = await mount({
      primaryProvider: 'deepseek-official',
      primaryModel: 'deepseek-chat',
      fallbackPolicy: { enabled: false },
    })
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(3) })
    expect(provider.value).toBe('deepseek-official')
    expect(screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryModel).value).toBe('deepseek-chat')
    expect(screen.getByRole('button', { name: en.routingSave })).toHaveProperty('disabled', true)

    fireEvent.change(provider, { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.routingSave })) })
    expect(mutate).toHaveBeenCalledWith('model-mask', [
      { op: 'set', path: ['primaryProvider'], value: '' },
      { op: 'set', path: ['primaryModel'], value: '' },
      { op: 'set', path: ['fallbackProvider'], value: '' },
      { op: 'set', path: ['fallbackModel'], value: '' },
      { op: 'set', path: ['fallbackPolicy', 'enabled'], value: false },
    ], 2)
  })

  it('keeps a stored provider the catalog no longer lists visible', async () => {
    await mount({ primaryProvider: 'retired', primaryModel: 'retired-model' })
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(4) })
    expect(provider.value).toBe('retired')
    expect(provider.selectedOptions[0]?.textContent).toBe('retired (not available)')
    expect(screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryModel).value).toBe('retired-model')
  })

  it('marks a model the provider no longer serves', async () => {
    await mount({ primaryProvider: 'deepseek-official', primaryModel: 'deepseek-v1' })
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(3) })
    const model = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryModel)
    await waitFor(() => { expect(model.value).toBe('deepseek-v1') })
    expect(model.selectedOptions[0]?.textContent).toBe('deepseek-v1 (not available)')
  })

  it('requires both halves of a route before saving', async () => {
    await mount({ primaryProvider: 'deepseek-official', primaryModel: 'deepseek-chat' })
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(3) })
    fireEvent.change(screen.getByLabelText(en.routingFallbackProvider), { target: { value: 'openrouter' } })
    expect(screen.getByText(en.routingIncomplete)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.routingSave })).toHaveProperty('disabled', true)
  })

  it('discards an unsaved draft', async () => {
    await mount({ primaryProvider: 'deepseek-official', primaryModel: 'deepseek-chat' })
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(3) })
    fireEvent.change(provider, { target: { value: 'openrouter' } })
    expect(provider.value).toBe('openrouter')
    fireEvent.click(screen.getByRole('button', { name: en.routingReset }))
    expect(provider.value).toBe('deepseek-official')
  })

  it('reports a refused write', async () => {
    const mutate = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: new RemoteError('settings/rejected', 'not volatile', { ns: 'model-mask' }),
    }))
    await mount({ primaryProvider: 'deepseek-official', primaryModel: 'deepseek-chat' }, { mutate })
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(3) })
    fireEvent.change(screen.getByLabelText(en.routingPrimaryModel), { target: { value: 'deepseek-reasoner' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.routingSave })) })
    await screen.findByText('not volatile')
  })

  it('reports an unreachable catalog and still saves the stored route', async () => {
    const catalog = (): Promise<readonly RoutingCatalogProvider[]> => Promise.reject(new Error('catalog down'))
    const { mutate } = await mount({ primaryProvider: 'deepseek-official', primaryModel: 'deepseek-chat' }, { catalog })
    await screen.findByText(`${en.routingCatalogError.replace('{message}', '')}catalog down`)
    fireEvent.click(screen.getByRole('checkbox', { name: en.routingPolicyEnabled }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.routingSave })) })
    expect(mutate).toHaveBeenCalledWith('model-mask', [
      { op: 'set', path: ['primaryProvider'], value: 'deepseek-official' },
      { op: 'set', path: ['primaryModel'], value: 'deepseek-chat' },
      { op: 'set', path: ['fallbackProvider'], value: '' },
      { op: 'set', path: ['fallbackModel'], value: '' },
      { op: 'set', path: ['fallbackPolicy', 'enabled'], value: false },
    ], 2)
  })

  it('disables every control when the document is read-only', async () => {
    await mount({}, { writable: false })
    await screen.findByText(en.readOnly)
    const provider = screen.getByLabelText<HTMLSelectElement>(en.routingPrimaryProvider)
    await waitFor(() => { expect(provider.querySelectorAll('option')).toHaveLength(3) })
    expect(provider.disabled).toBe(true)
    expect(screen.getByRole('checkbox', { name: en.routingPolicyEnabled })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.routingSave })).toHaveProperty('disabled', true)
  })
})
