import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/client/index.ts'

const page = globalThis as { __DSH_AUTH__?: { accessToken?: string } }

async function composed(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin({ inject, apply })
  return ctx
}

describe('auth Client Context adapter', () => {
  beforeEach(() => {
    delete page.__DSH_AUTH__
  })

  afterEach(() => {
    delete page.__DSH_AUTH__
  })

  it('declares the browser plugin name and its service dependency', () => {
    expect(name).toBe('auth-client')
    expect(inject).toEqual(['typert'])
  })

  it('registers a Client adapter for the auth Context kind', async () => {
    const ctx = await composed()

    expect(ctx.typert.contexts.getClient('auth')).toBeDefined()
  })

  it('sends the access token the page publishes as the wire identity', async () => {
    page.__DSH_AUTH__ = { accessToken: 'dsh.access.token' }
    const ctx = await composed()

    const adapter = ctx.typert.contexts.getClient('auth')
    expect(adapter?.identity(ctx)).toBe('dsh.access.token')
  })

  it('sends the token for a Context the plugin did not create', async () => {
    page.__DSH_AUTH__ = { accessToken: 'dsh.access.token' }
    const ctx = await composed()

    const adapter = ctx.typert.contexts.getClient('auth')
    expect(adapter?.identity(ctx.extend({}))).toBe('dsh.access.token')
  })

  it('withholds the identity while the page publishes no session', async () => {
    const ctx = await composed()
    const adapter = ctx.typert.contexts.getClient('auth')

    expect(adapter?.identity(ctx)).toBeUndefined()

    page.__DSH_AUTH__ = {}
    expect(adapter?.identity(ctx)).toBeUndefined()

    page.__DSH_AUTH__ = { accessToken: '' }
    expect(adapter?.identity(ctx)).toBeUndefined()
  })

  it('withholds the identity from a Context outside this application', async () => {
    page.__DSH_AUTH__ = { accessToken: 'dsh.access.token' }
    const ctx = await composed()
    const other = new Context()
    const adapter = ctx.typert.contexts.getClient('auth')

    expect(adapter?.identity(ctx)).toBe('dsh.access.token')
    expect(adapter?.identity(other)).toBeUndefined()
  })

  it('reads a refreshed token on the next call', async () => {
    const ctx = await composed()
    const adapter = ctx.typert.contexts.getClient('auth')

    page.__DSH_AUTH__ = { accessToken: 'first' }
    expect(adapter?.identity(ctx)).toBe('first')

    page.__DSH_AUTH__ = { accessToken: 'second' }
    expect(adapter?.identity(ctx)).toBe('second')

    delete page.__DSH_AUTH__
    expect(adapter?.identity(ctx)).toBeUndefined()
  })

  it('resolves the published token to a Context carrying it', async () => {
    page.__DSH_AUTH__ = { accessToken: 'dsh.access.token' }
    const ctx = await composed()
    const adapter = ctx.typert.contexts.getClient('auth')

    const resolved = adapter?.resolve('dsh.access.token')

    expect(resolved).toBeDefined()
    expect((resolved as Context).authToken).toBe('dsh.access.token')
  })

  it('resolves no Context for a token the page no longer publishes', async () => {
    page.__DSH_AUTH__ = { accessToken: 'dsh.access.token' }
    const ctx = await composed()
    const adapter = ctx.typert.contexts.getClient('auth')

    expect(adapter?.resolve('dsh.stale.token')).toBeUndefined()

    delete page.__DSH_AUTH__
    expect(adapter?.resolve('dsh.access.token')).toBeUndefined()
  })

  it('withdraws the registration with the plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    const fiber = ctx.plugin({ inject, apply })
    await fiber
    expect(ctx.typert.contexts.getClient('auth')).toBeDefined()

    await fiber.dispose()

    expect(ctx.typert.contexts.getClient('auth')).toBeUndefined()
  })
})
