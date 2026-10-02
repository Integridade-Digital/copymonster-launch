/**
 * Decisão de boot do host do workspace autenticado: quando o documento injetado
 * está disponível, quando a troca do token de lançamento é necessária e quando o
 * host não atende a rota de entrada.
 */

import { describe, expect, it } from 'vitest'
import { DSH_ENTER_PATH, resolveHostBoot } from '../src/lib/auth/host-boot'

describe('resolveHostBoot', () => {
  it('boots the workspace when the host injected the bootstrap facade', () => {
    expect(resolveHostBoot({ facadePresent: true, desktopBoot: false, pathname: '/' })).toBe('boot')
  })

  it('boots the desktop carrier, which installs the facade through its own exchange', () => {
    expect(resolveHostBoot({ facadePresent: false, desktopBoot: true, pathname: '/' })).toBe('boot')
  })

  it('keeps booting a desktop carrier that already carries the facade', () => {
    expect(resolveHostBoot({ facadePresent: true, desktopBoot: true, pathname: '/' })).toBe('boot')
  })

  it('exchanges the launch token when the document is the public shell', () => {
    expect(resolveHostBoot({ facadePresent: false, desktopBoot: false, pathname: '/' })).toBe('exchange')
  })

  it('exchanges from a deep client route as well', () => {
    expect(resolveHostBoot({ facadePresent: false, desktopBoot: false, pathname: '/plans' })).toBe('exchange')
  })

  it('reports the enter route as unavailable instead of reloading it forever', () => {
    expect(resolveHostBoot({
      facadePresent: false,
      desktopBoot: false,
      pathname: DSH_ENTER_PATH,
    })).toBe('unavailable')
  })

  it('still boots an injected document served at the enter route', () => {
    expect(resolveHostBoot({
      facadePresent: true,
      desktopBoot: false,
      pathname: DSH_ENTER_PATH,
    })).toBe('boot')
  })
})
