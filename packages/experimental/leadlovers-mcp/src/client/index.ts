/** Browser entry for the LeadLovers MCP settings card. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { LeadLoversMcpSettingsPanel } from './LeadLoversPanel.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type LeadLoversMcpLocaleKey } from './locales/index.ts'

export type { LeadLoversMcpSettingsPanelProps } from './LeadLoversPanel.tsx'
export type { LeadLoversMcpLocaleKey } from './locales/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** LeadLovers MCP settings card copy. */
    'settings.leadloversMcp': LeadLoversMcpLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.leadloversMcp'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale'] as const

/**
 * Register the LeadLovers MCP settings page directly below the WhatsApp Business MCP page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(
    () => ctx.locale.register(NS, { en, pt, zh, es, fr, de, ru, ja }),
    'dsh-experimental-leadlovers-mcp: dictionaries',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'leadlovers-mcp',
    order: 324,
    label: () => t('title'),
    locale: NS,
  }, LeadLoversMcpSettingsPanel))
}
