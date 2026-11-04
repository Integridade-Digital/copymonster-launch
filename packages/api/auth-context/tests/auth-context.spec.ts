import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserIdentity } from '../src/types.ts'
import AuthService, { name } from '../src/index.ts'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createUserClient: vi.fn() }))

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  createUserClient: mocks.createUserClient,
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'

/** Profile document `get_my_profile()` returns, before per-test overrides. */
function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user: {
      id: USER_ID,
      email: 'owner@integridade-digital.com',
      full_name: 'Ada Owner',
      whatsapp: '+5511999999999',
      avatar_url: 'https://cdn.example/ada.png',
    },
    tenant: { id: TENANT_ID, name: 'Workspace', slug: 'workspace', status: 'active' },
    role: 'owner',
    is_admin: false,
    ...overrides,
  }
}

/** Compact JWS with the given payload; the signature is never verified here. */
function jwt(payload: unknown): string {
  const segment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `dsh-header.${segment}.dsh-signature`
}

/** Answer `get_my_profile()` with one outcome. */
function answers(data: unknown, error: { message: string } | null = null): void {
  mocks.rpc.mockResolvedValue({ data, error })
}

async function service(): Promise<AuthService> {
  return (await composed()).auth
}

/** Boot the Typert registry and the auth service into one fresh Context. */
async function composed(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(AuthService)
  return ctx
}

describe('auth service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createUserClient.mockReturnValue({ rpc: mocks.rpc })
  })

  it('declares the auth plugin name', () => {
    expect(name).toBe('auth')
  })

  it('registers the auth Host Context adapter over the authId wire field', async () => {
    const ctx = await composed()
    const adapter = ctx.typert.contexts.getHost('auth')
    expect(adapter?.wire).toBe('authId')
    expect(adapter?.wireTypeSymbol).toBe('@deepseek-ai/dsh-api-auth-context/types#AuthToken')
  })

  it('resolves a valid token to an identity from the caller profile', async () => {
    answers(profile())

    const identity = await (await service()).resolveIdentity(jwt({ sub: USER_ID }))

    expect(identity).toEqual({
      userId: USER_ID,
      tenantId: TENANT_ID,
      role: 'owner',
      email: 'owner@integridade-digital.com',
      fullName: 'Ada Owner',
      whatsapp: '+5511999999999',
      avatarUrl: 'https://cdn.example/ada.png',
    } satisfies UserIdentity)
  })

  it('reads the profile with the caller token, never the service role', async () => {
    answers(profile())
    const token = jwt({ sub: USER_ID })

    await (await service()).resolveIdentity(token)

    expect(mocks.createUserClient).toHaveBeenCalledWith(token)
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_profile')
  })

  it.each(['admin', 'member'] as const)('issues a %s identity', async (role) => {
    answers(profile({ role }))

    const identity = await (await service()).resolveIdentity(jwt({ sub: USER_ID }))

    expect(identity?.role).toBe(role)
  })

  it.each([
    ['anonymous', 'anonymous'],
    ['outside the vocabulary', 'superuser'],
    ['absent', null],
  ])('refuses a profile whose role is %s', async (_case, role) => {
    answers(profile({ role }))

    expect(await (await service()).resolveIdentity(jwt({ sub: USER_ID }))).toBeUndefined()
  })

  it('omits absent optional profile fields', async () => {
    answers(profile({
      user: { id: USER_ID, email: 'owner@integridade-digital.com', full_name: null, whatsapp: '', avatar_url: '' },
    }))

    const identity = await (await service()).resolveIdentity(jwt({ sub: USER_ID }))

    expect(identity).toEqual({
      userId: USER_ID,
      tenantId: TENANT_ID,
      role: 'owner',
      email: 'owner@integridade-digital.com',
    })
  })

  it('resolves an empty e-mail when the profile carries none', async () => {
    answers(profile({ user: { id: USER_ID, email: null, full_name: null, whatsapp: null, avatar_url: null } }))

    const identity = await (await service()).resolveIdentity(jwt({ sub: USER_ID }))

    expect(identity?.email).toBe('')
  })

  it('refuses an empty token without contacting Supabase', async () => {
    expect(await (await service()).resolveIdentity('')).toBeUndefined()
    expect(mocks.createUserClient).not.toHaveBeenCalled()
  })

  it('refuses a token the profile RPC rejects', async () => {
    answers(null, { message: 'invalid JWT' })

    expect(await (await service()).resolveIdentity(jwt({ sub: USER_ID }))).toBeUndefined()
  })

  it('refuses a profile that resolves to no row', async () => {
    answers(null)

    expect(await (await service()).resolveIdentity(jwt({ sub: USER_ID }))).toBeUndefined()
  })

  it('refuses a profile with no tenant', async () => {
    answers(profile({ tenant: null }))

    expect(await (await service()).resolveIdentity(jwt({ sub: USER_ID }))).toBeUndefined()
  })

  it('refuses a profile whose tenant is no longer active', async () => {
    answers(profile({ tenant: { id: TENANT_ID, name: 'Workspace', slug: 'workspace', status: 'suspended' } }))

    expect(await (await service()).resolveIdentity(jwt({ sub: USER_ID }))).toBeUndefined()
  })

  it('resolves a token through the registered Host adapter onto an identity-carrying Context', async () => {
    answers(profile())
    const token = jwt({ sub: USER_ID })

    const ctx = await composed()
    const adapter = ctx.typert.contexts.getHost('auth')
    const child = await adapter?.resolve(token)

    expect(child).toBeDefined()
    expect(child).not.toBe(ctx)
    expect((child as Context).authIdentity).toEqual({
      userId: USER_ID,
      tenantId: TENANT_ID,
      role: 'owner',
      email: 'owner@integridade-digital.com',
      fullName: 'Ada Owner',
      whatsapp: '+5511999999999',
      avatarUrl: 'https://cdn.example/ada.png',
    })
    expect((child as Context).authToken).toBe(token)
  })

  it('resolves no child Context for an unusable token', async () => {
    answers(null)

    const ctx = await composed()

    expect(await ctx.auth.resolveContext(jwt({ sub: USER_ID }))).toBeUndefined()
  })

  it('serves repeated lookups for the same token from the in-memory cache', async () => {
    answers(profile())

    const svc = await service()
    const token = jwt({ sub: USER_ID })

    const first = await svc.resolveIdentity(token)
    expect(first).toBeDefined()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)

    const second = await svc.resolveIdentity(token)
    expect(second).toEqual(first)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('clears cached identities when clearCache() is invoked', async () => {
    answers(profile())

    const svc = await service()
    const token = jwt({ sub: USER_ID })

    await svc.resolveIdentity(token)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)

    svc.clearCache()

    await svc.resolveIdentity(token)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('populates isAdmin: true when the profile reports is_admin', async () => {
    answers(profile({ is_admin: true }))

    const identity = await (await service()).resolveIdentity(jwt({ sub: USER_ID }))

    expect(identity?.isAdmin).toBe(true)
  })

  it('omits isAdmin when the profile reports is_admin false (fail-closed)', async () => {
    answers(profile({ is_admin: false }))

    const identity = await (await service()).resolveIdentity(jwt({ sub: USER_ID }))

    expect(identity?.isAdmin).toBeUndefined()
  })
})
