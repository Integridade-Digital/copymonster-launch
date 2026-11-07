/** The signed identity handshake and the tenant policy it feeds. */
import { generateKeyPairSync, sign } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createTenantPolicy } from '../src/access.ts'
import { createIdentityResolver, IDENTITY_HEADER } from '../src/identity.ts'

const NOW = 1_800_000_000_000

function keypair(): { publicKey: string; sign: (payload: string) => string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    sign: payload => sign(null, Buffer.from(payload), privateKey).toString('base64url'),
  }
}

function header(claims: Record<string, unknown>, keys = keypair()): { value: string; keys: ReturnType<typeof keypair> } {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return { value: `${payload}.${keys.sign(payload)}`, keys }
}

function request(value?: string): { headers: Record<string, string | undefined> } {
  return { headers: value === undefined ? {} : { [IDENTITY_HEADER]: value } }
}

const CLAIMS = {
  sub: 'a371977b-b414-4bd4-b51e-f2c16efc4425',
  tenant: '00000000-0000-0000-0000-000000000001',
  role: 'member',
  isAdmin: false,
  iat: NOW,
  exp: NOW + 60_000,
}

describe('signed identity handshake', () => {
  it('admits the verified caller as a user principal', () => {
    const { value, keys } = header(CLAIMS)
    const resolver = createIdentityResolver(keys.publicKey, () => NOW)
    expect(resolver.resolve(request(value))).toEqual({
      principal: {
        kind: 'user',
        userId: CLAIMS.sub,
        tenantId: CLAIMS.tenant,
        role: 'member',
        isAdmin: false,
      },
    })
  })

  it('refuses a missing, malformed, tampered, expired, or foreign-signed header', () => {
    const { value, keys } = header(CLAIMS)
    const resolver = createIdentityResolver(keys.publicKey, () => NOW)
    const [payload, signature] = value.split('.')
    const tampered = Buffer.from(JSON.stringify({ ...CLAIMS, role: 'owner' })).toString('base64url')
    const foreign = header(CLAIMS)
    const cases = [
      undefined,
      '',
      'not-a-token',
      `${payload}.${signature}x`,
      `${tampered}.${signature}`,
      header({ ...CLAIMS, exp: NOW - 1 }, keys).value,
      header({ ...CLAIMS, iat: NOW + 120_000 }, keys).value,
      foreign.value,
    ]
    for (const candidate of cases) {
      expect(resolver.resolve(request(candidate))).toEqual({ rejection: 401 })
    }
  })

  it('refuses a payload whose claims are not a valid identity', () => {
    const { value, keys } = header({ ...CLAIMS, role: 'superuser' })
    expect(createIdentityResolver(keys.publicKey, () => NOW).resolve(request(value))).toEqual({ rejection: 401 })
  })
})

describe('tenant access policy', () => {
  const descriptors = [
    { namespace: 'session', method: 'list' },
    { namespace: 'pluginManager', method: 'installBundle' },
    { namespace: 'terminal', method: 'create' },
    { namespace: 'settings', method: 'update' },
    { namespace: 'credentials', method: 'set' },
  ]

  function policy() {
    const ctx = new Context()
    ctx.provide('typert', { local: { list: () => descriptors } } as never)
    return createTenantPolicy(ctx)
  }

  const principal = (role: 'owner' | 'admin' | 'member', isAdmin = false) => ({
    kind: 'user' as const,
    userId: 'u',
    tenantId: 't',
    role,
    isAdmin,
  })

  function actionsFor(role: 'owner' | 'admin' | 'member', isAdmin = false): readonly string[] {
    return policy().bindings(principal(role, isAdmin))[0]!.role.actions
  }

  it('gives the owner, tenant admins, and platform operators the full surface', () => {
    for (const actions of [actionsFor('owner'), actionsFor('admin'), actionsFor('member', true)]) {
      expect([...actions].sort()).toEqual([
        'credentials/set',
        'pluginManager/installBundle',
        'session/list',
        'settings/update',
        'terminal/create',
      ])
    }
  })

  it('denies a member the Host, terminal, settings, and credential writes', () => {
    expect(actionsFor('member')).toEqual(['session/list'])
  })
})

describe('tenant access policy: owned Workspaces and Sessions', () => {
  const descriptors = [
    { namespace: 'workspace', method: 'delete' },
    { namespace: 'workspace', method: 'rename' },
    { namespace: 'session', method: 'create' },
    { namespace: 'session', method: 'prompt' },
  ]

  const TENANT = '00000000-0000-0000-0000-000000000001'
  const USER = 'a371977b-b414-4bd4-b51e-f2c16efc4425'

  function policy(options: {
    workspaces?: readonly { id: string; path: string }[]
    sessions?: readonly { id: string; cwd: string }[]
  } = {}) {
    const ctx = new Context()
    ctx.provide('typert', { local: { list: () => descriptors } } as never)
    if (options.workspaces !== undefined) {
      ctx.provide('workspaceRegistry', {
        list: () => options.workspaces!.map(row => ({ id: row.id, path: row.path })),
      } as never)
    }
    if (options.sessions !== undefined) {
      ctx.provide('sessions', {
        list: () => options.sessions!.map(row => ({ id: row.id, header: { cwd: row.cwd } })),
      } as never)
    }
    return createTenantPolicy(ctx)
  }

  const principal = (role: 'owner' | 'admin' | 'member' = 'owner') => ({
    kind: 'user' as const,
    userId: USER,
    tenantId: TENANT,
    role,
    isAdmin: false,
  })

  const ownRoot = `/var/copymonster/data/${TENANT}/${USER}/workspaces`
  const foreignRoot = `/var/copymonster/data/${TENANT}/another-user/workspaces`

  it('binds the Workspace this caller owns and refuses another tenant user\'s', () => {
    const bindings = policy({
      workspaces: [
        { id: 'ws-own', path: `${ownRoot}/default` },
        { id: 'ws-foreign', path: `${foreignRoot}/default` },
      ],
    }).bindings(principal())

    const ids = bindings
      .filter(binding => binding.resource.kind === 'workspace')
      .map(({ resource }) => (resource as { readonly id: string }).id)
    expect(ids).toEqual(['ws-own'])
  })

  it('binds a Session whose working directory is inside the caller sandbox', () => {
    const bindings = policy({
      sessions: [
        { id: 's-own', cwd: `${ownRoot}/default` },
        { id: 's-foreign', cwd: `${foreignRoot}/default` },
      ],
    }).bindings(principal())

    const ids = bindings
      .filter(binding => binding.resource.kind === 'session')
      .map(({ resource }) => (resource as { readonly id: string }).id)
    expect(ids).toEqual(['s-own'])
  })

  it('grants the same endpoint set on an owned resource as on the global surface', () => {
    const bindings = policy({ workspaces: [{ id: 'ws-own', path: `${ownRoot}/default` }] })
      .bindings(principal('member'))
    const global = bindings.find(binding => binding.resource.kind === 'global')!
    const workspace = bindings.find(binding => binding.resource.kind === 'workspace')!
    expect(workspace.role.actions).toEqual(global.role.actions)
    expect(workspace.role.actions).toContain('workspace/delete')
    expect(workspace.role.actions).toContain('session/create')
  })

  it('grants no resource binding when the Host mounts neither store', () => {
    const bindings = policy().bindings(principal())
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.resource).toEqual({ kind: 'global' })
  })
})
