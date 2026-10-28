// @vitest-environment jsdom
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/src/client/config-form-types.ts'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { WelcomeNotice } from '../src/client/WelcomeNotice.tsx'
import type { WelcomeNoticeProps } from '../src/client/WelcomeNotice.tsx'
import { WelcomeNoticeStore } from '../src/client/welcome-store.ts'
import type { WelcomeSection } from '../src/client/welcome-store.ts'
import { en, zh } from '../src/client/locales.ts'
import {
  WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
} from '../src/onboarding-copy.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as never
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

const WELCOME_NOTICE_COPY = {
  en: { title: en.welcomeTitle, body: en.welcomeBody, continueLabel: en.welcomeContinue },
  zh: { title: zh.welcomeTitle, body: zh.welcomeBody, continueLabel: zh.welcomeContinue },
}

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

type AttentionSnapshot = Parameters<Parameters<WelcomeNoticeProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: WelcomeNoticeProps['useSessionStatus'] = selector => selector(noAttention)

function mount(
  _version?: string,
  setImpl: (field: string, value: unknown) => Promise<unknown> = async () => true,
) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  const set = vi.fn(setImpl)
  const configForm: ConfigForm<WelcomeSection> = {
    getSnapshot: () => ({ status: 'ready' as const, value: {}, base: {}, user: {}, revision: 0, writable: true }),
    subscribe: () => () => {},
    mutate: async () => true,
    set,
  } as unknown as ConfigForm<WelcomeSection>
  const controller = new WelcomeNoticeStore(configForm)
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: WelcomeNoticeProps = {
    stepId: 'welcome-notice',
    complete,
    openSection: vi.fn(),
    useSessions: unusedHook,
    useSessionStatus,
    useRemoteAccess: unusedHook,
    useSessionAccess: unusedHook,
    usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    useWorkspaces: unusedHook,
    controller,
    useWelcome: bindSnapshotSelector(controller.store),
    t: key => zh[key],
  }
  return { ...render(<WelcomeNotice {...props} />), complete, controller, set, mutate: set, appRoot }
}

describe('WelcomeNotice', () => {
  it('uses the exact owner copy in both GUI locales', () => {
    expect(WELCOME_NOTICE_COPY.en).toEqual({
      title: 'Internal Testing Notice',
      body: 'CopyMonster 0.1 remains in testing. Many areas still need improvement, and we welcome feedback from everyone using the platform. Core features and APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of great copywriting with you, building on open, reusable, and composable infrastructure. Thank you for joining the CopyMonster early testers.',
      continueLabel: 'Continue',
    })
    expect(en.welcomeBody).toBe(WELCOME_NOTICE_COPY.en.body)
    expect(zh.welcomeBody).toBe(WELCOME_NOTICE_COPY.zh.body)
  })

  it('renders one blocking modal action and focuses the title', async () => {
    const h = mount()
    const dialog = await screen.findByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    for (const paragraph of WELCOME_NOTICE_COPY.zh.body.split('\n\n')) {
      expect(screen.getByText(paragraph, { exact: true })).toBeTruthy()
    }
    expect(dialog.querySelectorAll('p')).toHaveLength(2)
    expect(dialog.querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: WELCOME_NOTICE_COPY.zh.title }))
    expect(h.appRoot.inert).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('[class*="mask"]')!)
    expect(h.complete).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('completes only after the acknowledgement write commits', async () => {
    const h = mount()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }))
    await act(async () => { await Promise.resolve() })
    expect(h.mutate).toHaveBeenCalledOnce()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('skips itself when this exact version was already acknowledged', async () => {
    const h = mount(WELCOME_NOTICE_VERSION)
    await act(async () => {
      await h.controller.load()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('keeps the sole action disabled while saving and reports a refused write', async () => {
    let resolveWrite!: (value: unknown) => void
    const write = new Promise<unknown>((resolve) => { resolveWrite = resolve })
    const h = mount(undefined, () => write)
    await screen.findByRole('dialog')
    const action = screen.getByRole<HTMLButtonElement>('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel })
    fireEvent.click(action)
    expect(action.disabled).toBe(true)
    resolveWrite({
      ok: false,
      error: new RemoteError('settings/rejected', 'read only', { ns: WELCOME_NOTICE_SETTINGS_NAMESPACE }),
    })
    expect((await screen.findByRole('alert')).textContent).toBe(zh.welcomeError)
    expect(h.complete).not.toHaveBeenCalled()
  })
})
