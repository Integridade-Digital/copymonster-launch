/** Browser entry for the WhatsApp MCP settings card. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { WhatsAppMcpSettingsPanel } from './WhatsAppPanel.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type WhatsAppMcpLocaleKey } from './locales/index.ts'

export type { WhatsAppMcpSettingsPanelProps } from './WhatsAppPanel.tsx'
export type { WhatsAppMcpLocaleKey } from './locales/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** WhatsApp MCP settings card copy. */
    'settings.whatsappMcp': WhatsAppMcpLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.whatsappMcp'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale'] as const

/**
 * Register the WhatsApp MCP settings page directly below the SendPulse MCP page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(
    () => ctx.locale.register(NS, { en, pt, zh, es, fr, de, ru, ja }),
    'dsh-experimental-whatsapp-mcp: dictionaries',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'whatsapp-mcp',
    order: 323,
    label: () => t('title'),
    locale: NS,
  }, WhatsAppMcpSettingsPanel))
}
