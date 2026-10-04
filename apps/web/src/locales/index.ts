import { en } from './en'
import { zh } from './zh'

export type LocaleId = 'en' | 'zh'
export type TranslationKey = keyof typeof en

export function getActiveLocale(): LocaleId {
  if (typeof window === 'undefined') return 'en'
  const stored = localStorage.getItem('dsh_locale') || localStorage.getItem('locale')
  if (stored && (stored === 'zh' || stored.startsWith('zh'))) return 'zh'
  if (navigator.language && navigator.language.startsWith('zh')) return 'zh'
  return 'en'
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const lang = getActiveLocale()
  const dict = lang === 'zh' ? zh : en
  let text: string = (dict as Record<string, string>)[key] || (en as Record<string, string>)[key] || key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return text
}


export function setActiveLocale(locale: LocaleId): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('dsh_locale', locale)
    localStorage.setItem('locale', locale)
    window.dispatchEvent(new Event('storage'))
  }
}

export { en, zh }
export * from './LocaleContext'

