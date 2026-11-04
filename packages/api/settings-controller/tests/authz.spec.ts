/** Settings and credential authorization: scoped identity, Peer principal, in-process call. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { callerIsAdmin, getAuthIdentity } from '../src/authz.ts'

function withPrincipal(principal: unknown): Context {
  return new Context().extend({ invocation: { peer: { principal } } as never })
}

describe('settings authorization', () => {
  it('allows an in-process call and a local owner Peer', () => {
    expect(callerIsAdmin(new Context())).toBe(true)
    expect(callerIsAdmin(withPrincipal({ kind: 'owner' }))).toBe(true)
  })

  it('allows a tenant admin and a platform operator Peer', () => {
    expect(callerIsAdmin(withPrincipal({ kind: 'user', userId: 'u', tenantId: 't', role: 'admin', isAdmin: false }))).toBe(true)
    expect(callerIsAdmin(withPrincipal({ kind: 'user', userId: 'u', tenantId: 't', role: 'member', isAdmin: true }))).toBe(true)
  })

  it('refuses a member Peer', () => {
    expect(callerIsAdmin(withPrincipal({ kind: 'user', userId: 'u', tenantId: 't', role: 'member', isAdmin: false }))).toBe(false)
  })

  it('reads a scoped auth identity before the Peer principal', () => {
    const ctx = new Context()
    ctx.provide('authIdentity', {
      userId: 'u',
      tenantId: 't',
      role: 'member',
      isAdmin: false,
      email: 'member@example.test',
    })
    expect(getAuthIdentity(ctx)).toMatchObject({ role: 'member' })
    expect(callerIsAdmin(ctx)).toBe(false)
  })
})
