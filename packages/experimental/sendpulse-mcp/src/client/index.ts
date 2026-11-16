/** Browser entry for the SendPulse MCP settings card. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SendPulseMcpSettingsPanel } from './SendPulsePanel.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type SendPulseMcpLocaleKey } from './locales/index.ts'

export type { SendPulseMcpSettingsPanelProps } from './SendPulsePanel.tsx'
export type { SendPulseMcpLocaleKey } from './locales/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** SendPulse MCP settings card copy. */
    'settings.sendpulseMcp': SendPulseMcpLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.sendpulseMcp'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale'] as const

/**
 * Register the SendPulse MCP settings page directly below the Zernio MCP page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(
    () => ctx.locale.register(NS, { en, pt, zh, es, fr, de, ru, ja }),
    'dsh-experimental-sendpulse-mcp: dictionaries',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sendpulse-mcp',
    order: 322,
    label: () => t('title'),
    locale: NS,
  }, SendPulseMcpSettingsPanel))
}
