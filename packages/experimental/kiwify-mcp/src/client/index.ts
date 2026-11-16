/** Browser entry for the Kiwify MCP settings card. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.row.config' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
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
 * Register the Kiwify MCP card on the Plugins page, under the row of the
 * package's own entry in the profile patch.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(NS, { en, pt, zh, es, fr, de, ru, ja }),
    'dsh-experimental-kiwify-mcp: dictionaries',
  )
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: '@deepseek-ai/dsh-experimental-kiwify-mcp#kiwify-mcp',
    locale: NS,
  }, KiwifyMcpSettingsPanel))
}
