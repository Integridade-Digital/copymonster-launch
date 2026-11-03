/** Platform-operator gate published by the CopyMonster shell. */

/** Window event the shell dispatches after it (re)publishes `__DSH_AUTH__`. */
const AUTH_EVENT = 'copymonster:auth'

/** Page global carrying the session facts the shell publishes. */
interface ClientAuthGlobal {
  __DSH_AUTH__?: { isAdmin?: boolean }
}

/**
 * Read the platform-operator flag the shell resolved from
 * `public.users.metadata.is_admin`. The JWT does not carry that flag, so it is
 * absent until the shell finishes the profile read; absent means not an
 * operator.
 * @returns true only when the shell resolved `is_admin` as true.
 */
export function isPlatformAdmin(): boolean {
  return (globalThis as ClientAuthGlobal).__DSH_AUTH__?.isAdmin === true
}

/**
 * Keep a contribution registered only while the signed-in user is a platform
 * operator. `register` runs immediately when the flag is already published,
 * and again each time `copymonster:auth` announces a resolution that turns it
 * on; turning it off disposes the contribution.
 * @param register - contributes the surface and returns its disposer.
 * @returns disposer that unsubscribes and releases an active contribution.
 */
export function whenPlatformAdmin(register: () => () => void): () => void {
  let dispose: (() => void) | undefined
  const sync = (): void => {
    if (isPlatformAdmin()) {
      if (dispose === undefined) dispose = register()
      return
    }
    const active = dispose
    dispose = undefined
    active?.()
  }
  sync()
  const target = typeof globalThis.addEventListener === 'function' ? globalThis : undefined
  target?.addEventListener(AUTH_EVENT, sync)
  return () => {
    target?.removeEventListener(AUTH_EVENT, sync)
    const active = dispose
    dispose = undefined
    active?.()
  }
}
