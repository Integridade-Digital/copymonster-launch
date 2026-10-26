import type { BootSeams } from '@deepseek-ai/dsh-client-web'

/** The client Context type the LazyWebApp onBoot seam hands apps. */
type ClientContext = Parameters<NonNullable<BootSeams['onBoot']>>[0]

/** Public service the IM plugin exposes for its Settings section registration. */
interface DshImClient {
  setSettingsVisible(visible: boolean): void
}

/**
 * Keep IM bots as a sidebar panel without exposing a duplicate Settings tab.
 * The IM plugin owns the section registration through this switch; hiding it
 * leaves the plugin, its sidebar entry, and the panel functional.
 * @param ctx - the client Context from the LazyWebApp onBoot seam.
 */
export function installImSettingsHidden(ctx: ClientContext): void {
  ctx.inject(['dshImClient'], (untyped) => {
    const client = (untyped as unknown as { dshImClient?: DshImClient }).dshImClient
    client?.setSettingsVisible(false)
  })
}
