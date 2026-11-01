/**
 * Bridge between the app's localStorage locale and the shell's __DSH_LOCALE__ contract.
 *
 * The shell (dsh-client-locale) looks for a global `__DSH_LOCALE__` object with:
 *   read(): Promise<{ languages: string[]; preference: string | null }>
 *   onChange(locale: string): void
 *
 * We implement this bridge so the shell reads/writes the same localStorage keys
 * the app uses ('dsh_locale' and 'locale'), keeping them in sync.
 */

export const LOCALE_STORAGE_KEYS = ['dsh_locale', 'locale'] as const

/** Read the stored locale from localStorage, if any. */
export function readStoredLocale(): string | null {
  if (typeof window === 'undefined') return null
  for (const key of LOCALE_STORAGE_KEYS) {
    const value = localStorage.getItem(key)
    if (value) return value
  }
  return null
}

/** Write locale to both localStorage keys and dispatch events for listeners. */
export function writeStoredLocale(locale: string): void {
  if (typeof window === 'undefined') return
  for (const key of LOCALE_STORAGE_KEYS) {
    localStorage.setItem(key, locale)
  }
  // Legacy storage event (for app's LocaleContext)
  window.dispatchEvent(new Event('storage'))
  // New custom event with detail for shell listeners
  window.dispatchEvent(new CustomEvent('copymonster:locale', { detail: locale }))
}

/** Install the shell locale bridge before the shell boots. */
export function installShellLocaleBridge(): void {
  if (typeof window === 'undefined') return
  const g = globalThis as { __DSH_LOCALE__?: LocaleBridge }
  if (g.__DSH_LOCALE__) return

  g.__DSH_LOCALE__ = {
    async read() {
      const preference = readStoredLocale()
      const languages = navigator.languages ?? [navigator.language]
      return { languages, preference }
    },
    onChange(locale: string) {
      writeStoredLocale(locale)
    },
  }
}

interface LocaleBridge {
  read(): Promise<{ languages: readonly string[]; preference: string | null }>
  onChange(locale: string): void
}
