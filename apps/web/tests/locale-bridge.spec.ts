// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock window.localStorage and events
const mockLocalStorage = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { Reflect.deleteProperty(store, key) }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  }
})()

Object.defineProperty(global, 'localStorage', { value: mockLocalStorage, writable: true })
Object.defineProperty(global, 'navigator', { value: { languages: ['en-US'], language: 'en-US' }, writable: true })

describe('shell-bridge', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
    vi.clearAllMocks()
    // Clear global bridge
    Reflect.deleteProperty(globalThis, '__DSH_LOCALE__')
  })

  it('reads stored locale from localStorage', async () => {
    const { readStoredLocale } = await import('../src/locales/shell-bridge.ts')
    mockLocalStorage.getItem.mockImplementation((key) => {
      if (key === 'dsh_locale') return 'zh'
      if (key === 'locale') return null
      return null
    })
    const stored = readStoredLocale()
    expect(stored).toBe('zh')
  })

  it('prefers dsh_locale over locale', async () => {
    const { readStoredLocale } = await import('../src/locales/shell-bridge.ts')
    mockLocalStorage.getItem.mockImplementation((key) => {
      if (key === 'dsh_locale') return 'pt'
      if (key === 'locale') return 'zh'
      return null
    })
    const stored = readStoredLocale()
    expect(stored).toBe('pt')
  })

  it('returns null when no locale stored', async () => {
    const { readStoredLocale } = await import('../src/locales/shell-bridge.ts')
    mockLocalStorage.getItem.mockReturnValue(null)
    const stored = readStoredLocale()
    expect(stored).toBeNull()
  })

  it('writes to both localStorage keys and dispatches events', async () => {
    const { writeStoredLocale } = await import('../src/locales/shell-bridge.ts')
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent')
    writeStoredLocale('ja')
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('dsh_locale', 'ja')
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('locale', 'ja')
    expect(dispatchEvent).toHaveBeenCalledTimes(2)
    // Check custom event
    const customEvent = dispatchEvent.mock.calls.find(c => c[0] instanceof CustomEvent)
    expect(customEvent).toBeTruthy()
    if (customEvent) {
      expect((customEvent[0] as CustomEvent).type).toBe('copymonster:locale')
      expect((customEvent[0] as CustomEvent).detail).toBe('ja')
    }
  })

  it('installs bridge on globalThis', async () => {
    const { installShellLocaleBridge } = await import('../src/locales/shell-bridge.ts')
    installShellLocaleBridge()
    const g = globalThis as { __DSH_LOCALE__?: { read: () => Promise<unknown>; onChange: (v: string) => void } }
    expect(g.__DSH_LOCALE__).toBeDefined()
    expect(typeof g.__DSH_LOCALE__!.read).toBe('function')
    expect(typeof g.__DSH_LOCALE__!.onChange).toBe('function')
  })

  it('does not reinstall if already present', async () => {
    const { installShellLocaleBridge } = await import('../src/locales/shell-bridge.ts')
    installShellLocaleBridge()
    const first = (globalThis as { __DSH_LOCALE__?: unknown }).__DSH_LOCALE__
    installShellLocaleBridge()
    const second = (globalThis as { __DSH_LOCALE__?: unknown }).__DSH_LOCALE__
    expect(second).toBe(first)
  })
})
