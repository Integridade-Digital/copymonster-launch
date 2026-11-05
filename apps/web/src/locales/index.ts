import { en } from './en'
import { zh } from './zh'
import { pt } from './pt'
import { es } from './es'
import { writeStoredLocale } from './shell-bridge'

export type LocaleId = 'en' | 'zh' | 'pt' | 'es'
export type TranslationKey = keyof typeof en

export function getActiveLocale(): LocaleId {
  if (typeof window === 'undefined') return 'en'
  const stored = localStorage.getItem('dsh_locale') || localStorage.getItem('locale')
  if (stored) {
    if (stored === 'zh' || stored.startsWith('zh-')) return 'zh'
    if (stored === 'pt' || stored.startsWith('pt-')) return 'pt'
    if (stored === 'es' || stored.startsWith('es-')) return 'es'
    return 'en'
  }
  if (navigator.language && navigator.language.startsWith('zh')) return 'zh'
  if (navigator.language && navigator.language.startsWith('pt')) return 'pt'
  if (navigator.language && navigator.language.startsWith('es')) return 'es'
  return 'en'
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const lang = getActiveLocale()
  const dict = lang === 'zh' ? zh : lang === 'pt' ? pt : lang === 'es' ? es : en
  let text: string = (dict as Record<string, string>)[key] || (en as Record<string, string>)[key] || key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return text
}


export function setActiveLocale(locale: LocaleId): void {
  writeStoredLocale(locale)
}

export { en, zh, pt, es }
export * from './LocaleContext'

