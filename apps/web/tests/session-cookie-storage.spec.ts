/** Behavior of the Supabase session store shared across `*.copymonster.co`. */
import { describe, expect, it } from 'vitest'
import {
  createSessionCookieStorage,
  sharedCookieDomain,
  type CookieDocument,
} from '../src/lib/auth/session-cookie-storage'

/** Cookie stand-in that records every assignment and honors `Max-Age`. */
class FakeCookieDocument implements CookieDocument {
  private readonly cookies = new Map<string, string>()
  readonly writes: string[] = []

  get cookie(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  set cookie(input: string) {
    this.writes.push(input)
    const [rawPair = '', ...rawAttributes] = input.split(';')
    const pair = rawPair.trim()
    const attributes = rawAttributes.map(part => part.trim())
    const separator = pair.indexOf('=')
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    const maxAge = attributes.find(attribute => attribute.toLowerCase().startsWith('max-age='))
    if (maxAge !== undefined && Number(maxAge.slice('max-age='.length)) <= 0) {
      this.cookies.delete(name)
    } else {
      this.cookies.set(name, value)
    }
  }

  names(): string[] {
    return [...this.cookies.keys()]
  }
}

describe('sharedCookieDomain', () => {
  it('shares the parent domain for the main app and tenant subdomains', () => {
    expect(sharedCookieDomain('app.copymonster.co')).toBe('.copymonster.co')
    expect(sharedCookieDomain('adrianos.copymonster.co')).toBe('.copymonster.co')
    expect(sharedCookieDomain('copymonster.co')).toBe('.copymonster.co')
  })

  it('keeps localhost and unrelated hosts host-only', () => {
    expect(sharedCookieDomain('localhost')).toBeUndefined()
    expect(sharedCookieDomain('example.test')).toBeUndefined()
  })
})

describe('createSessionCookieStorage', () => {
  it('round-trips a session and scopes it to the shared HTTPS domain', async () => {
    const document = new FakeCookieDocument()
    const storage = createSessionCookieStorage({
      document,
      hostname: 'app.copymonster.co',
      secure: true,
    })
    const value = JSON.stringify({ access_token: 'token', refresh_token: 'refresh' })

    await storage.setItem('sb-test-auth-token', value)

    expect(await storage.getItem('sb-test-auth-token')).toBe(value)
    expect(document.writes).toContainEqual(expect.stringContaining('Domain=.copymonster.co'))
    expect(document.writes).toContainEqual(expect.stringContaining('Secure'))
    expect(document.writes).toContainEqual(expect.stringContaining('SameSite=Lax'))
    expect(document.writes).toContainEqual(expect.stringContaining('Path=/'))
  })

  it('splits values that exceed one cookie budget and removes every chunk', async () => {
    const document = new FakeCookieDocument()
    const storage = createSessionCookieStorage({
      document,
      hostname: 'adrianos.copymonster.co',
      secure: true,
    })
    const value = 'x'.repeat(4000)

    await storage.setItem('sb-test-auth-token', value)

    expect(document.names().length).toBeGreaterThan(1)
    expect(await storage.getItem('sb-test-auth-token')).toBe(value)

    await storage.removeItem('sb-test-auth-token')

    expect(document.names()).toEqual([])
  })

  it('reads an unchunked cookie written by an earlier version', async () => {
    const document = new FakeCookieDocument()
    const storage = createSessionCookieStorage({
      document,
      hostname: 'app.copymonster.co',
      secure: true,
    })
    const value = 'legacy-session'
    document.cookie = `sb-test-auth-token=${Buffer.from(value).toString('base64url')}`

    expect(await storage.getItem('sb-test-auth-token')).toBe(value)
  })

  it('returns null for unknown and malformed values', async () => {
    const document = new FakeCookieDocument()
    const storage = createSessionCookieStorage({
      document,
      hostname: 'app.copymonster.co',
      secure: true,
    })

    expect(await storage.getItem('sb-missing-auth-token')).toBeNull()

    document.cookie = 'sb-broken-auth-token=not!base64'
    expect(await storage.getItem('sb-broken-auth-token')).toBeNull()
  })

  it('keeps local development cookies host-only and non-secure', async () => {
    const document = new FakeCookieDocument()
    const storage = createSessionCookieStorage({
      document,
      hostname: 'localhost',
      secure: false,
    })

    await storage.setItem('sb-test-auth-token', 'value')

    expect(document.writes.join(' ')).not.toContain('Domain=')
    expect(document.writes.join(' ')).not.toContain('Secure')
  })
})
