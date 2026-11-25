/**
 * M-3: the main-app session cookie carries a revocable `jti`. A cookie with a
 * deleted session row stops authenticating before its 30-day expiry, and a
 * cookie minted before revocation support (no `jti`) still verifies.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createAppSession,
  isAppSessionActive,
  revokeAppSession,
  signSessionCookie,
  verifySessionCookie,
  clearDatabaseForTesting,
} from '../src/session-token.ts'

const SECRET = 'test-session-secret-at-least-32-chars'

describe('M-3 app session revocation', () => {
  beforeEach(() => {
    process.env.LOCAL_USER_DB_PATH = ':memory:'
    clearDatabaseForTesting()
  })

  afterEach(() => {
    clearDatabaseForTesting()
    delete process.env.LOCAL_USER_DB_PATH
  })

  it('signs and verifies a cookie that carries a jti', () => {
    const now = Math.floor(Date.now() / 1000)
    const value = signSessionCookie(
      { userId: 7, supabaseSub: 'sub-7', username: 'acme', issuedAt: now, jti: 'session-7' },
      SECRET,
    )
    const claims = verifySessionCookie(value, SECRET, now)
    expect(claims?.jti).toBe('session-7')
    expect(claims?.userId).toBe(7)
  })

  it('stops authenticating a session once its row is revoked', async () => {
    const now = Math.floor(Date.now() / 1000)
    await createAppSession('session-a', 7, now)
    expect(await isAppSessionActive('session-a')).toBe(true)

    await revokeAppSession('session-a')
    expect(await isAppSessionActive('session-a')).toBe(false)
  })

  it('revokes every session of a user on sign-out', async () => {
    const now = Math.floor(Date.now() / 1000)
    await createAppSession('session-one', 7, now)
    await createAppSession('session-two', 7, now)
    await createAppSession('other-user', 8, now)

    await revokeAppSession(undefined, 7)

    expect(await isAppSessionActive('session-one')).toBe(false)
    expect(await isAppSessionActive('session-two')).toBe(false)
    expect(await isAppSessionActive('other-user')).toBe(true)
  })

  it('keeps a pre-revocation cookie valid and rejects a tampered jti', () => {
    const now = Math.floor(Date.now() / 1000)
    const legacy = signSessionCookie(
      { userId: 7, supabaseSub: 'sub-7', username: 'acme', issuedAt: now },
      SECRET,
    )
    expect(verifySessionCookie(legacy, SECRET, now)?.jti).toBeUndefined()

    const signed = signSessionCookie(
      { userId: 7, supabaseSub: 'sub-7', username: 'acme', issuedAt: now, jti: 'abc' },
      SECRET,
    )
    expect(verifySessionCookie(`${signed}x`, SECRET, now)).toBeNull()
  })
})
