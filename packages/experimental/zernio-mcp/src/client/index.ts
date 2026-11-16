/** Browser entry for the Zernio MCP settings card. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.row.config' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
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
 * Register the Zernio MCP card on the Plugins page, under the row of the
 * package's own entry in the profile patch.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(NS, { en, pt, zh, es, fr, de, ru, ja }),
    'dsh-experimental-zernio-mcp: dictionaries',
  )
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: '@deepseek-ai/dsh-experimental-zernio-mcp#zernio-mcp',
    locale: NS,
  }, ZernioMcpSettingsPanel))
}
