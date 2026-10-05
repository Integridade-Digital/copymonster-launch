import { getActiveLocale } from '../locales'

export function formatCurrency(value: number): string {
  const locale = getActiveLocale() === 'zh' ? 'zh-CN' : 'en-US'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

export function formatDate(iso: string | Date | number): string {
  if (!iso) return ''
  const locale = getActiveLocale() === 'zh' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export function formatDateTime(iso: string | Date | number): string {
  if (!iso) return ''
  const locale = getActiveLocale() === 'zh' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
