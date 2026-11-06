/** Browser entry for the Zernio MCP settings card. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ZernioMcpSettingsPanel } from './ZernioPanel.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type ZernioMcpLocaleKey } from './locales/index.ts'

export type { ZernioMcpSettingsPanelProps } from './ZernioPanel.tsx'
export type { ZernioMcpLocaleKey } from './locales/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Zernio MCP settings card copy. */
    'settings.zernioMcp': ZernioMcpLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.zernioMcp'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale'] as const

/**
 * Register the Zernio MCP settings page directly below the Vercel MCP page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(
    () => ctx.locale.register(NS, { en, pt, zh, es, fr, de, ru, ja }),
    'dsh-experimental-zernio-mcp: dictionaries',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zernio-mcp',
    order: 321,
    label: () => t('title'),
    locale: NS,
  }, ZernioMcpSettingsPanel))
}
