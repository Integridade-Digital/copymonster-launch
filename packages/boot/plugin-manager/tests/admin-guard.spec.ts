/** Bundle changes require a platform operator when the caller is a Remote Peer. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { assertPlatformAdmin } from '../src/index.ts'

function withPrincipal(principal: unknown): Context {
  return new Context().extend({ invocation: { peer: { principal } } as never })
}

describe('assertPlatformAdmin', () => {
  it('allows an in-process call, the local owner, a tenant admin, and a platform operator', () => {
    expect(() => assertPlatformAdmin(new Context())).not.toThrow()
    expect(() => assertPlatformAdmin(withPrincipal({ kind: 'owner' }))).not.toThrow()
    expect(() => assertPlatformAdmin(withPrincipal({ kind: 'user', userId: 'u', tenantId: 't', role: 'admin', isAdmin: false }))).not.toThrow()
    expect(() => assertPlatformAdmin(withPrincipal({ kind: 'user', userId: 'u', tenantId: 't', role: 'member', isAdmin: true }))).not.toThrow()
  })

  it('refuses a member Remote caller', () => {
    expect(() => assertPlatformAdmin(withPrincipal({ kind: 'user', userId: 'u', tenantId: 't', role: 'member', isAdmin: false })))
      .toThrowError(/administradores da plataforma/)
  })
})
