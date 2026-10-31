/**
 * SSO session token exchange: validates a Supabase JWT and issues a session cookie.
 *
 * POST /api/auth/session-token
 * - Authorization: Bearer <supabase-jwt>
 *
 * The Supabase JWT is the only caller-supplied identity input. The destination
 * subdomain is the `tenant.slug` returned by `get_my_profile()` under the
 * caller's own JWT, never a username supplied in the request body.
 *
 * Validation order:
 * 1. `SUPABASE_JWT_SECRET` must be configured; otherwise the route fails closed with 500.
 * 2. HS256 tokens are verified locally (signature, `aud=authenticated`, `exp`).
 *    Asymmetric tokens are verified by Supabase at `/auth/v1/user`, which is the
 *    authoritative check for algorithms that do not use the shared secret.
 * 3. The local `sub` must match the user returned by `/auth/v1/user`.
 * 4. `get_my_profile()` must resolve a tenant slug owned by that same `sub`.
 * 5. The local user row is keyed by `supabase_sub`, so one Supabase identity can
 *    never claim another identity's username or workspace directory.
 * @module @deepseek-ai/dsh-api-auth-http/session-token
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { bearerToken } from './bearer-token.ts'
import { SESSION_COOKIE_NAME } from '@deepseek-ai/dsh-constants'
import { decodeJwt, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose'

export const SESSION_TOKEN_PATH = '/api/auth/session-token'

interface SessionTokenResponse {
  success: boolean
  error?: string
  supabase_sub?: string
  username?: string
}

interface SupabaseUserResponse {
  user: {
    id: string
    email: string
    user_metadata?: Record<string, unknown>
    app_metadata?: Record<string, unknown>
  } | null
  error?: {
    message: string
  }
}

interface SupabaseProfile {
  user?: {
    id?: string
  }
  tenant?: {
    slug?: string | null
  } | null
}

interface LocalUser {
  id: number
  username: string
  supabase_sub: string
  email: string
  created_at: number
  updated_at: number
}

let db: DatabaseSync | undefined

function getConfig() {
  const baseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
  return {
    SUPABASE_URL: baseUrl,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    COOKIE_DOMAIN: process.env.SESSION_COOKIE_DOMAIN ?? '.app.copymonster.co',
    COOKIE_SECURE: process.env.SESSION_COOKIE_SECURE !== 'false',
    DB_PATH: process.env.LOCAL_USER_DB_PATH ?? '/var/lib/copymonster/users.db',
  }
}

function requireJwtSecret(): string {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (secret === undefined || secret === '') {
    throw new Error('SUPABASE_JWT_SECRET is required but not set in environment')
  }
  return secret
}

async function getDatabase(): Promise<DatabaseSync> {
  if (db !== undefined) return db

  const config = getConfig()
  const inMemory = config.DB_PATH === ':memory:'
  const actualPath = inMemory ? ':memory:' : resolve(config.DB_PATH)
  if (!inMemory) {
    await mkdir(dirname(actualPath), { recursive: true, mode: 0o700 })
    await open(actualPath, 'wx', 0o600).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
  }

  db = new DatabaseSync(actualPath)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      supabase_sub TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_supabase_sub ON users(supabase_sub)
  `)

  return db
}

function hasAuthenticatedAudience(payload: JWTPayload): boolean {
  const audience = payload.aud
  return Array.isArray(audience) ? audience.includes('authenticated') : audience === 'authenticated'
}

/**
 * Verify a Supabase token locally when it is HS256 and decode its claims otherwise.
 *
 * HS256 tokens are verified against `SUPABASE_JWT_SECRET` with audience and issuer
 * checks, and `jose` enforces expiration. Asymmetric tokens are not verified here:
 * the Supabase `/auth/v1/user` response is their authoritative validation, so this
 * function only decodes claims to enforce `aud` and require `sub`.
 * @param token - raw bearer token.
 * @param secret - configured `SUPABASE_JWT_SECRET`.
 * @param supabaseUrl - normalized Supabase project URL.
 * @returns the verified payload, or `null` when validation fails.
 */
async function verifyToken(token: string, secret: string, supabaseUrl: string): Promise<JWTPayload | null> {
  let algorithm: string
  try {
    algorithm = decodeProtectedHeader(token).alg ?? ''
  } catch {
    return null
  }

  try {
    if (algorithm === 'HS256') {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ['HS256'],
        audience: 'authenticated',
        issuer: `${supabaseUrl}/auth/v1`,
      })
      return payload.sub ? payload : null
    }

    const payload = decodeJwt(token)
    if (!hasAuthenticatedAudience(payload) || !payload.sub) return null
    return payload
  } catch {
    return null
  }
}

async function fetchSupabaseUser(token: string): Promise<SupabaseUserResponse['user'] | null> {
  const config = getConfig()
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    throw new Error('Supabase configuration missing: SUPABASE_URL and SUPABASE_ANON_KEY required')
  }

  try {
    const response = await fetch(`${config.SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': config.SUPABASE_ANON_KEY,
      },
    })

    if (!response.ok) {
      return null
    }

    const data: SupabaseUserResponse = await response.json()
    if (data.error || !data.user) {
      return null
    }

    return data.user
  } catch {
    return null
  }
}

async function fetchProfile(token: string): Promise<SupabaseProfile | null> {
  const config = getConfig()
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    throw new Error('Supabase configuration missing: SUPABASE_URL and SUPABASE_ANON_KEY required')
  }

  try {
    const response = await fetch(`${config.SUPABASE_URL}/rest/v1/rpc/get_my_profile`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': config.SUPABASE_ANON_KEY,
        'content-type': 'application/json',
      },
      body: '{}',
    })

    if (!response.ok) {
      return null
    }

    return await response.json() as SupabaseProfile
  } catch {
    return null
  }
}

function normalizeUsername(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

async function upsertLocalUser(username: string, supabaseSub: string, email: string): Promise<LocalUser> {
  const database = await getDatabase()
  const now = Date.now()

  const existing = database.prepare('SELECT * FROM users WHERE username = ?').get(username) as LocalUser | undefined
  if (existing) {
    if (existing.supabase_sub !== supabaseSub) {
      throw new Error('username-taken-by-another-user')
    }
    database.prepare('UPDATE users SET email = ?, updated_at = ? WHERE username = ?').run(email, now, username)
    return { ...existing, email, updated_at: now }
  }

  const existingBySub = database.prepare('SELECT * FROM users WHERE supabase_sub = ?').get(supabaseSub) as LocalUser | undefined
  if (existingBySub) {
    database.prepare('UPDATE users SET username = ?, email = ?, updated_at = ? WHERE supabase_sub = ?').run(username, email, now, supabaseSub)
    return { ...existingBySub, username, email, updated_at: now }
  }

  const result = database.prepare('INSERT INTO users (username, supabase_sub, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(username, supabaseSub, email, now, now)
  return {
    id: result.lastInsertRowid as number,
    username,
    supabase_sub: supabaseSub,
    email,
    created_at: now,
    updated_at: now,
  }
}

function setSessionCookie(res: ServerResponse, sessionId: string): void {
  const config = getConfig()
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    'Path=/',
    `Domain=${config.COOKIE_DOMAIN}`,
    'HttpOnly',
    'SameSite=Lax',
    config.COOKIE_SECURE ? 'Secure' : '',
    'Max-Age=2592000',
  ].filter(Boolean).join('; ')

  res.setHeader('Set-Cookie', cookieParts)
}

function sendJson(res: ServerResponse, status: number, body: SessionTokenResponse): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Handle `POST /api/auth/session-token`: exchange a Supabase JWT for a local session cookie.
 *
 * Fails closed when `SUPABASE_JWT_SECRET` is missing, rejects identity mismatches,
 * and resolves the destination username only from `get_my_profile().tenant.slug`.
 * @param _ctx - plugin Context; the route needs no service dependency.
 * @param req - incoming HTTP request carrying the bearer token.
 * @param res - response to write with the session cookie or an error body.
 * @returns a promise that settles after the response ends.
 */
export async function handleSessionToken(_ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { success: false, error: 'method-not-allowed' })
    return
  }

  const token = bearerToken(req.headers.authorization)
  if (!token) {
    sendJson(res, 401, { success: false, error: 'missing-token' })
    return
  }

  let secret: string
  try {
    secret = requireJwtSecret()
  } catch {
    sendJson(res, 500, { success: false, error: 'server-misconfigured' })
    return
  }

  const config = getConfig()
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    sendJson(res, 500, { success: false, error: 'server-misconfigured' })
    return
  }

  const payload = await verifyToken(token, secret, config.SUPABASE_URL)
  if (!payload || !payload.sub) {
    sendJson(res, 401, { success: false, error: 'invalid-or-expired-token' })
    return
  }

  const supabaseUser = await fetchSupabaseUser(token)
  if (!supabaseUser) {
    sendJson(res, 401, { success: false, error: 'invalid-or-expired-token' })
    return
  }

  if (payload.sub !== supabaseUser.id) {
    sendJson(res, 403, { success: false, error: 'token-user-mismatch' })
    return
  }

  const profile = await fetchProfile(token)
  if (!profile || profile.user?.id !== supabaseUser.id) {
    sendJson(res, 403, { success: false, error: 'profile-user-mismatch' })
    return
  }

  const tenantSlug = profile.tenant?.slug
  if (typeof tenantSlug !== 'string' || tenantSlug === '') {
    sendJson(res, 403, { success: false, error: 'tenant-not-assigned' })
    return
  }

  const username = normalizeUsername(tenantSlug)
  if (!username) {
    sendJson(res, 403, { success: false, error: 'invalid-tenant-slug' })
    return
  }

  const email = supabaseUser.email ?? `${supabaseUser.id}@supabase.local`
  let localUser: LocalUser
  try {
    localUser = await upsertLocalUser(username, supabaseUser.id, email)
  } catch (error) {
    if (error instanceof Error && error.message === 'username-taken-by-another-user') {
      sendJson(res, 403, { success: false, error: 'username-taken-by-another-user' })
      return
    }
    throw error
  }

  const sessionId = `${localUser.id}:${supabaseUser.id}:${Date.now()}`
  setSessionCookie(res, sessionId)
  sendJson(res, 200, { success: true, supabase_sub: supabaseUser.id, username })
}

/**
 * Close the cached SQLite handle so a test can open a fresh database.
 */
export function clearDatabaseForTesting(): void {
  if (db !== undefined) {
    db.close()
    db = undefined
  }
}
