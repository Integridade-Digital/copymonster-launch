/** Encaminhamento do host principal para o subdomínio do tenant. */

import { describe, expect, it } from 'vitest'
import { isPlatformOnlyPath, resolveTenantRedirect } from '../src/lib/auth/subdomain-guard'

describe('resolveTenantRedirect', () => {
  it('sends a tenant account from the platform host to its subdomain', () => {
    expect(resolveTenantRedirect({
      host: 'app.copymonster.co',
      pathname: '/',
      tenantSlug: 'acme',
    })).toBe('https://acme.copymonster.co/')
  })

  it('keeps public, admin, billing, and tenant-only pages on the platform host', () => {
    for (const pathname of ['/login', '/admin', '/admin/audit', '/plans', '/billing/success']) {
      expect(resolveTenantRedirect({
        host: 'app.copymonster.co',
        pathname,
        tenantSlug: 'acme',
      })).toBeNull()
    }
  })

  it('does not redirect outside the platform host or without a valid slug', () => {
    expect(resolveTenantRedirect({ host: 'acme.copymonster.co', pathname: '/', tenantSlug: 'acme' }))
      .toBeNull()
    expect(resolveTenantRedirect({ host: 'app.copymonster.co', pathname: '/' })).toBeNull()
    expect(resolveTenantRedirect({ host: 'app.copymonster.co', pathname: '/', tenantSlug: 'Acme!' }))
      .toBeNull()
  })
})

describe('isPlatformOnlyPath', () => {
  it('matches prefixes on path boundaries only', () => {
    expect(isPlatformOnlyPath('/login')).toBe(true)
    expect(isPlatformOnlyPath('/login/help')).toBe(true)
    expect(isPlatformOnlyPath('/login-help')).toBe(false)
  })
})
