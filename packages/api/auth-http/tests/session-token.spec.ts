/**
 * Security tests for the SSO session token endpoint.
 *
 * Covers the mandatory locks:
 * 1. Missing SUPABASE_JWT_SECRET fails closed with 500.
 * 2. Invalid or expired HS256 JWT returns 401.
 * 3. A token cannot resolve another identity's profile or tenant.
 * 4. The destination username always comes from `get_my_profile().tenant.slug`,
 *    never from the request body.
 * 5. Asymmetric tokens are accepted only because `/auth/v1/user` validates them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import {
  handleSessionToken,
  clearDatabaseForTesting,
  signSessionCookie,
  verifySessionCookie,
  SESSION_MAX_AGE_SECONDS,
} from '../src/session-token.ts'
import { SESSION_COOKIE_NAME } from '@deepseek-ai/dsh-constants'
import { SignJWT, generateKeyPair } from 'jose'

const SUPABASE_URL = 'https://test.supabase.co'
const SUPABASE_ANON_KEY = 'test-anon-key'
const SUPABASE_JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long'
const SESSION_SECRET = 'test-session-secret-at-least-32-chars'

interface MockUser {
  id: string
  email: string
  user_metadata?: Record<string, unknown>
}

interface MockProfile {
  user?: { id?: string }
  tenant?: { slug?: string | null } | null
}

function createMockReq(method: string, headers: Record<string, string>, body = ''): IncomingMessage {
  const req = {
    method,
    headers,
    on: (event: string, callback: (data: unknown) => void) => {
      if (event === 'data') callback(Buffer.from(body))
      if (event === 'end') callback(null)
    },
  } as unknown as IncomingMessage
  return req
}

function createMockRes(): ServerResponse & { _headers: Record<string, string>; _status: number; _body: string } {
  const headers: Record<string, string> = {}
  const res = {
    _headers: headers,
    _status: 200,
    _body: '',
    writeHead: vi.fn((status: number, responseHeaders?: Record<string, string | string[]>) => {
      res._status = status
      if (responseHeaders) {
        for (const [key, value] of Object.entries(responseHeaders)) {
          headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
        }
      }
    }),
    end: vi.fn((body?: string) => {
      res._body = body ?? ''
    }),
    setHeader: vi.fn((key: string, value: string) => {
      headers[key.toLowerCase()] = value
    }),
    getHeader: vi.fn((key: string) => headers[key.toLowerCase()]),
  } as unknown as ServerResponse & { _headers: Record<string, string>; _status: number; _body: string }
  return res
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

/** Queue `/auth/v1/user` then `/rest/v1/rpc/get_my_profile` responses. */
function mockSupabase(user: MockUser, profile: MockProfile): void {
  vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce(jsonResponse({ user }))
    .mockResolvedValueOnce(jsonResponse(profile))
}

async function createValidJWT(user: MockUser): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    user_metadata: user.user_metadata ?? {},
    app_metadata: {},
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SUPABASE_JWT_SECRET))
}

async function createExpiredJWT(user: MockUser): Promise<string> {
  return new SignJWT({ sub: user.id, email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(new TextEncoder().encode(SUPABASE_JWT_SECRET))
}

describe('POST /api/auth/session-token security tests', () => {
  let ctx: Context

  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', SUPABASE_URL)
    vi.stubEnv('SUPABASE_ANON_KEY', SUPABASE_ANON_KEY)
    vi.stubEnv('SUPABASE_JWT_SECRET', SUPABASE_JWT_SECRET)
    vi.stubEnv('SESSION_SECRET', SESSION_SECRET)
    vi.stubEnv('SESSION_COOKIE_DOMAIN', '.app.copymonster.co')
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false')
    vi.stubEnv('LOCAL_USER_DB_PATH', ':memory:')
    clearDatabaseForTesting()

    ctx = new Context()
  })

  afterEach(() => {
    clearDatabaseForTesting()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns 500 when SESSION_SECRET is not configured', async () => {
    vi.stubEnv('SESSION_SECRET', '')
    const fetchSpy = vi.spyOn(global, 'fetch')

    const req = createMockReq('POST', { authorization: 'Bearer any-token' })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(500)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('server-misconfigured')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns 500 when SESSION_SECRET is too short', async () => {
    vi.stubEnv('SESSION_SECRET', 'short')
    const req = createMockReq('POST', { authorization: 'Bearer any-token' })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(500)
    const body = JSON.parse(res._body)
    expect(body.error).toBe('server-misconfigured')
  })

  it('accepts HS256 via Supabase when SUPABASE_JWT_SECRET is not configured', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', '')
    const user: MockUser = { id: 'supabase-user-id-optional', email: 'optional@example.com' }
    const jwt = await createValidJWT(user)
    mockSupabase(user, { user: { id: user.id }, tenant: { slug: 'optional' } })

    const res = createMockRes()
    await handleSessionToken(ctx, createMockReq('POST', { authorization: `Bearer ${jwt}` }), res)

    expect(res._status).toBe(200)
    const body = JSON.parse(res._body)
    expect(body.username).toBe('optional')
  })

  it('returns 401 for a JWT signed with the wrong secret', async () => {
    const invalidJWT = await new SignJWT({ sub: 'user-id', email: 'user@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('wrong-secret'))
    const fetchSpy = vi.spyOn(global, 'fetch')

    const req = createMockReq('POST', { authorization: `Bearer ${invalidJWT}` })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(401)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('invalid-or-expired-token')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns 401 for an expired HS256 JWT', async () => {
    const expiredJWT = await createExpiredJWT({ id: 'user-id', email: 'user@example.com' })

    const req = createMockReq('POST', { authorization: `Bearer ${expiredJWT}` })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(401)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('invalid-or-expired-token')
  })

  it('returns 401 for missing Authorization header', async () => {
    const req = createMockReq('POST', {})
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(401)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('missing-token')
  })

  it('returns 401 when Supabase rejects the token', async () => {
    const user: MockUser = { id: 'supabase-user-id-1', email: 'user1@example.com' }
    const jwt = await createValidJWT(user)
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({ error: { message: 'bad token' } }, false, 401))

    const req = createMockReq('POST', { authorization: `Bearer ${jwt}` })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(401)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('invalid-or-expired-token')
  })

  it('returns 403 when the JWT sub does not match the Supabase user id', async () => {
    const user: MockUser = { id: 'supabase-user-id-1', email: 'user1@example.com' }
    const jwt = await createValidJWT(user)
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({
      user: { id: 'supabase-user-id-2', email: 'user2@example.com' },
    }))

    const req = createMockReq('POST', { authorization: `Bearer ${jwt}` })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(403)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('token-user-mismatch')
  })

  it('returns 403 when get_my_profile resolves another identity', async () => {
    const user: MockUser = { id: 'supabase-user-id-1', email: 'user1@example.com' }
    const jwt = await createValidJWT(user)
    mockSupabase(user, { user: { id: 'supabase-user-id-2' }, tenant: { slug: 'user2' } })

    const req = createMockReq('POST', { authorization: `Bearer ${jwt}` })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(403)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('profile-user-mismatch')
  })

  it('returns 403 when the profile has no tenant', async () => {
    const user: MockUser = { id: 'supabase-user-id-1', email: 'user1@example.com' }
    const jwt = await createValidJWT(user)
    mockSupabase(user, { user: { id: user.id }, tenant: null })

    const req = createMockReq('POST', { authorization: `Bearer ${jwt}` })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(403)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('tenant-not-assigned')
  })

  it('issues the cookie for the canonical tenant slug and ignores a body username', async () => {
    const user: MockUser = { id: 'supabase-user-id-1', email: 'user1@example.com' }
    const jwt = await createValidJWT(user)
    mockSupabase(user, { user: { id: user.id }, tenant: { slug: 'canonical' } })

    const req = createMockReq(
      'POST',
      { authorization: `Bearer ${jwt}` },
      JSON.stringify({ username: 'attacker' }),
    )
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(200)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(true)
    expect(body.supabase_sub).toBe(user.id)
    expect(body.username).toBe('canonical')

    const setCookie = res.getHeader('set-cookie') ?? ''
    expect(setCookie).toBeDefined()
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(setCookie).toContain('Domain=.app.copymonster.co')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`)

    const cookieValue = setCookie.split(';')[0]?.slice(`${SESSION_COOKIE_NAME}=`.length) ?? ''
    expect(cookieValue).toContain('.')
    const verified = verifySessionCookie(cookieValue, SESSION_SECRET)
    expect(verified).not.toBeNull()
    expect(verified?.supabaseSub).toBe(user.id)
    expect(verified?.username).toBe('canonical')
  })

  it('rejects a forged cookie whose payload MAC does not match', async () => {
    const user: MockUser = { id: 'supabase-user-id-1', email: 'user1@example.com' }
    const jwt = await createValidJWT(user)
    mockSupabase(user, { user: { id: user.id }, tenant: { slug: 'canonical' } })
    const res = createMockRes()
    await handleSessionToken(ctx, createMockReq('POST', { authorization: `Bearer ${jwt}` }), res)

    const setCookie = res.getHeader('set-cookie') ?? ''
    const original = setCookie.split(';')[0]?.slice(`${SESSION_COOKIE_NAME}=`.length) ?? ''
    const [payload, mac] = original.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({
      u: 1,
      s: 'supabase-user-id-1',
      n: 'victim',
      iat: Math.floor(Date.now() / 1000),
    })).toString('base64url')

    expect(verifySessionCookie(`${forgedPayload}.${mac}`, SESSION_SECRET)).toBeNull()
    expect(verifySessionCookie(`${payload}.${mac}`, SESSION_SECRET)).not.toBeNull()
  })

  it('rejects a cookie signed with a different secret', async () => {
    const value = signSessionCookie(
      { userId: 1, supabaseSub: 'sub', username: 'user', issuedAt: Math.floor(Date.now() / 1000) },
      'another-secret-at-least-32-characters',
    )

    expect(verifySessionCookie(value, SESSION_SECRET)).toBeNull()
  })

  it('rejects an expired signed cookie', async () => {
    const now = Math.floor(Date.now() / 1000)
    const value = signSessionCookie(
      { userId: 1, supabaseSub: 'sub', username: 'user', issuedAt: now - SESSION_MAX_AGE_SECONDS - 1 },
      SESSION_SECRET,
    )

    expect(verifySessionCookie(value, SESSION_SECRET, now)).toBeNull()
  })

  it('rejects malformed signed cookie values', () => {
    expect(verifySessionCookie('', SESSION_SECRET)).toBeNull()
    expect(verifySessionCookie('no-separator', SESSION_SECRET)).toBeNull()
    expect(verifySessionCookie('payload.', SESSION_SECRET)).toBeNull()
    expect(verifySessionCookie('.mac', SESSION_SECRET)).toBeNull()
    expect(verifySessionCookie('bm90LWpzb24=.AAAA', SESSION_SECRET)).toBeNull()
  })

  it('binds each Supabase sub to its own local user on repeat login', async () => {
    const user: MockUser = { id: 'supabase-user-id-existing', email: 'existing@example.com' }
    const jwt = await createValidJWT(user)

    mockSupabase(user, { user: { id: user.id }, tenant: { slug: 'existing' } })
    const res1 = createMockRes()
    await handleSessionToken(ctx, createMockReq('POST', { authorization: `Bearer ${jwt}` }), res1)
    expect(res1._status).toBe(200)

    mockSupabase(user, { user: { id: user.id }, tenant: { slug: 'existing' } })
    const res2 = createMockRes()
    await handleSessionToken(ctx, createMockReq('POST', { authorization: `Bearer ${jwt}` }), res2)
    expect(res2._status).toBe(200)
  })

  it('returns 403 when another Supabase identity already owns the same tenant slug', async () => {
    const user1: MockUser = { id: 'supabase-user-id-1', email: 'user1@example.com' }
    const user2: MockUser = { id: 'supabase-user-id-2', email: 'user2@example.com' }
    const jwt1 = await createValidJWT(user1)
    const jwt2 = await createValidJWT(user2)

    mockSupabase(user1, { user: { id: user1.id }, tenant: { slug: 'shared' } })
    const res1 = createMockRes()
    await handleSessionToken(ctx, createMockReq('POST', { authorization: `Bearer ${jwt1}` }), res1)
    expect(res1._status).toBe(200)

    mockSupabase(user2, { user: { id: user2.id }, tenant: { slug: 'shared' } })
    const res2 = createMockRes()
    await handleSessionToken(ctx, createMockReq('POST', { authorization: `Bearer ${jwt2}` }), res2)

    expect(res2._status).toBe(403)
    const body = JSON.parse(res2._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('username-taken-by-another-user')
  })

  it('accepts an asymmetric token because Supabase validates it', async () => {
    const { privateKey } = await generateKeyPair('ES256')
    const user: MockUser = { id: 'supabase-user-id-es256', email: 'es256@example.com' }
    const jwt = await new SignJWT({ sub: user.id, email: user.email })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    mockSupabase(user, { user: { id: user.id }, tenant: { slug: 'asymmetric' } })
    const res = createMockRes()

    await handleSessionToken(ctx, createMockReq('POST', { authorization: `Bearer ${jwt}` }), res)

    expect(res._status).toBe(200)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(true)
    expect(body.username).toBe('asymmetric')
  })

  it('returns 401 for an asymmetric token without aud=authenticated', async () => {
    const { privateKey } = await generateKeyPair('ES256')
    const jwt = await new SignJWT({ sub: 'user-id' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('service_role')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    const req = createMockReq('POST', { authorization: `Bearer ${jwt}` })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(401)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('invalid-or-expired-token')
  })

  it('returns 405 for non-POST methods', async () => {
    const req = createMockReq('GET', { authorization: 'Bearer any-token' })
    const res = createMockRes()

    await handleSessionToken(ctx, req, res)

    expect(res._status).toBe(405)
    const body = JSON.parse(res._body)
    expect(body.success).toBe(false)
    expect(body.error).toBe('method-not-allowed')
  })
})
