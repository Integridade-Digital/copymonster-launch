/** Browser entry for the Kiwify MCP settings card. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { KiwifyMcpSettingsPanel } from './KiwifyPanel.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type KiwifyMcpLocaleKey } from './locales/index.ts'

export type { KiwifyMcpSettingsPanelProps } from './KiwifyPanel.tsx'
export type { KiwifyMcpLocaleKey } from './locales/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Kiwify MCP settings card copy. */
    'settings.kiwifyMcp': KiwifyMcpLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.kiwifyMcp'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale'] as const

/**
 * Register the Kiwify MCP settings page directly below the SendPulse MCP page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(
    () => ctx.locale.register(NS, { en, pt, zh, es, fr, de, ru, ja }),
    'dsh-experimental-kiwify-mcp: dictionaries',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'kiwify-mcp',
    order: 323,
    label: () => t('title'),
    locale: NS,
  }, KiwifyMcpSettingsPanel))
}
