import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserIdentity } from '../src/types.ts'
import AuthService, { name } from '../src/index.ts'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn() }))

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: { auth: { getUser: mocks.getUser }, from: mocks.from },
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'

interface QueryOutcome {
  data: unknown
  error: { message: string } | null
}

/** One recorded `.eq(column, value)` filter. */
interface EqCall {
  column: string
  value: unknown
}

/** A query builder answering one table, plus the filters the test asserted on. */
interface TableStub {
  readonly builder: Record<string, unknown>
  readonly eqCalls: EqCall[]
}

function table(outcome: QueryOutcome): TableStub {
  const eqCalls: EqCall[] = []
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      eqCalls.push({ column, value })
      return builder
    },
    single: async () => outcome,
    maybeSingle: async () => outcome,
  }
  return { builder, eqCalls }
}

/** Answer `.from(table)` with the outcome the test registered for that table. */
function tables(outcomes: Record<string, QueryOutcome>): Map<string, EqCall[]> {
  const filters = new Map<string, EqCall[]>()
  mocks.from.mockImplementation((name: string) => {
    const outcome = outcomes[name]
    if (outcome === undefined) throw new Error(`fixture received an unexpected table ${name}`)
    const stub = table(outcome)
    filters.set(name, stub.eqCalls)
    return stub.builder
  })
  return filters
}

/** Compact JWS with the given payload; the signature is never verified here. */
function jwt(payload: unknown): string {
  const segment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `dsh-header.${segment}.dsh-signature`
}

const validClaims = { tenant_id: TENANT_ID, user_role: 'owner' }

const activeTenant: QueryOutcome = { data: { id: TENANT_ID }, error: null }
const fullProfile: QueryOutcome = {
  data: {
    id: USER_ID,
    email: 'owner@integridade-digital.com',
    full_name: 'Ada Owner',
    whatsapp: '+5511999999999',
    avatar_url: 'https://cdn.example/ada.png',
  },
  error: null,
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

function signedIn(email: string | null = 'fallback@integridade-digital.com'): void {
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID, email } }, error: null })
}

describe('auth service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (globalThis as { __DSH_AUTH__?: unknown }).__DSH_AUTH__
  })

  it('declares the auth plugin name', () => {
    expect(name).toBe('auth')
  })

  it('registers the auth Host Context adapter over the authToken wire field', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(AuthService)

    const adapter = ctx.typert.contexts.getHost('auth')
    expect(adapter?.wire).toBe('authToken')
    expect(adapter?.wireTypeSymbol).toBe('@copymonster/auth#AuthToken')
  })

  it('resolves a valid token to an identity from the JWT claims and profile', async () => {
    signedIn()
    tables({ tenants: activeTenant, users: fullProfile })

    const identity = await (await service()).resolveIdentity(jwt(validClaims))

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

  it('scopes the tenant lookup to the claimed tenant and the active status', async () => {
    signedIn()
    const filters = tables({ tenants: activeTenant, users: fullProfile })

    await (await service()).resolveIdentity(jwt(validClaims))

    expect(filters.get('tenants')).toEqual([
      { column: 'id', value: TENANT_ID },
      { column: 'status', value: 'active' },
    ])
  })

  it.each(['admin', 'member'] as const)('issues a %s identity', async (role) => {
    signedIn()
    tables({ tenants: activeTenant, users: fullProfile })

    const identity = await (await service()).resolveIdentity(jwt({ ...validClaims, user_role: role }))

    expect(identity?.role).toBe(role)
  })

  it('omits absent optional profile fields', async () => {
    signedIn()
    tables({
      tenants: activeTenant,
      users: {
        data: { id: USER_ID, email: 'owner@integridade-digital.com', full_name: null, whatsapp: '', avatar_url: '' },
        error: null,
      },
    })

    const identity = await (await service()).resolveIdentity(jwt(validClaims))

    expect(identity).toEqual({
      userId: USER_ID,
      tenantId: TENANT_ID,
      role: 'owner',
      email: 'owner@integridade-digital.com',
    })
  })

  it('falls back to the auth e-mail when the profile carries none', async () => {
    signedIn('auth@integridade-digital.com')
    tables({
      tenants: activeTenant,
      users: { data: { id: USER_ID, email: null, full_name: 'Ada', whatsapp: null, avatar_url: null }, error: null },
    })

    const identity = await (await service()).resolveIdentity(jwt(validClaims))

    expect(identity?.email).toBe('auth@integridade-digital.com')
  })

  it('resolves an empty e-mail when neither source carries one', async () => {
    signedIn(null)
    tables({
      tenants: activeTenant,
      users: { data: { id: USER_ID, email: null, full_name: null, whatsapp: null, avatar_url: null }, error: null },
    })

    const identity = await (await service()).resolveIdentity(jwt(validClaims))

    expect(identity?.email).toBe('')
  })

  it('refuses an empty token without contacting Supabase', async () => {
    expect(await (await service()).resolveIdentity('')).toBeUndefined()
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it('refuses a token Supabase rejects', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } })
    expect(await (await service()).resolveIdentity(jwt(validClaims))).toBeUndefined()
  })

  it('refuses a token Supabase resolves to no user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect(await (await service()).resolveIdentity(jwt(validClaims))).toBeUndefined()
  })

  it.each([
    ['no payload segment', 'not-a-jwt'],
    ['a payload that is not JSON', 'dsh-header.%%%.dsh-signature'],
    ['a null payload', jwt(null)],
    ['an array payload', jwt([1, 2, 3])],
    ['a primitive payload', jwt('owner')],
  ])('refuses a token with %s', async (_case, token) => {
    signedIn()
    expect(await (await service()).resolveIdentity(token)).toBeUndefined()
  })

  it.each([
    ['absent', { user_role: 'owner' }],
    ['blank', { tenant_id: '', user_role: 'owner' }],
    ['not a string', { tenant_id: 42, user_role: 'owner' }],
  ])('refuses a token whose tenant_id claim is %s', async (_case, claims) => {
    signedIn()
    tables({ tenants: activeTenant, users: fullProfile })

    expect(await (await service()).resolveIdentity(jwt(claims))).toBeUndefined()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each([
    ['absent', { tenant_id: TENANT_ID }],
    ['blank', { tenant_id: TENANT_ID, user_role: '' }],
    ['not a string', { tenant_id: TENANT_ID, user_role: 7 }],
    ['anonymous', { ...validClaims, user_role: 'anonymous' }],
    ['outside the vocabulary', { ...validClaims, user_role: 'superuser' }],
  ])('refuses a token whose user_role claim is %s', async (_case, claims) => {
    signedIn()
    tables({ tenants: activeTenant, users: fullProfile })

    expect(await (await service()).resolveIdentity(jwt(claims))).toBeUndefined()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('refuses a token whose tenant is no longer active', async () => {
    signedIn()
    tables({ tenants: { data: null, error: null }, users: fullProfile })

    expect(await (await service()).resolveIdentity(jwt(validClaims))).toBeUndefined()
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })

  it('refuses a token whose tenant lookup fails', async () => {
    signedIn()
    tables({ tenants: { data: null, error: { message: 'tenant unreadable' } }, users: fullProfile })

    expect(await (await service()).resolveIdentity(jwt(validClaims))).toBeUndefined()
  })

  it('refuses a token whose profile lookup fails', async () => {
    signedIn()
    tables({ tenants: activeTenant, users: { data: null, error: { message: 'no profile row' } } })

    expect(await (await service()).resolveIdentity(jwt(validClaims))).toBeUndefined()
  })

  it('refuses a token whose profile row is missing', async () => {
    signedIn()
    tables({ tenants: activeTenant, users: { data: null, error: null } })

    expect(await (await service()).resolveIdentity(jwt(validClaims))).toBeUndefined()
  })

  it('resolves a token through the registered Host adapter onto an identity-carrying Context', async () => {
    signedIn()
    tables({ tenants: activeTenant, users: fullProfile })

    const ctx = await composed()
    const adapter = ctx.typert.contexts.getHost('auth')
    const child = await adapter?.resolve(jwt(validClaims))

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
  })

  it('resolves no child Context for an unusable token', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })

    const ctx = await composed()

    expect(await ctx.auth.resolveContext(jwt(validClaims))).toBeUndefined()
  })
  it("serves repeated lookups for the same token from the in-memory cache without hitting Supabase", async () => {
    signedIn()
    tables({ tenants: activeTenant, users: fullProfile })

    const svc = await service()
    const token = jwt(validClaims)

    const first = await svc.resolveIdentity(token)
    expect(first).toBeDefined()
    expect(mocks.getUser).toHaveBeenCalledTimes(1)
    expect(mocks.from).toHaveBeenCalledTimes(2)

    // Second call within 60s should use cache
    const second = await svc.resolveIdentity(token)
    expect(second).toEqual(first)
    expect(mocks.getUser).toHaveBeenCalledTimes(1)
    expect(mocks.from).toHaveBeenCalledTimes(2)
  })

  it("clears cached identities when clearCache() is invoked", async () => {
    signedIn()
    tables({ tenants: activeTenant, users: fullProfile })

    const svc = await service()
    const token = jwt(validClaims)

    await svc.resolveIdentity(token)
    expect(mocks.getUser).toHaveBeenCalledTimes(1)

    svc.clearCache()

    await svc.resolveIdentity(token)
    expect(mocks.getUser).toHaveBeenCalledTimes(2)
  })
})
