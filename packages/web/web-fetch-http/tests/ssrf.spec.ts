import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import type { HttpFetchLimits } from '@deepseek-ai/dsh-web-fetch-http'
import {
  assertPublicDestination,
  isPublicAddress,
  isPublicIpv4,
  isPublicIpv6,
  literalIpAddress,
  pinnedAddress,
} from '../src/policy.ts'

const limits: HttpFetchLimits = {
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 5_000,
  maxRedirects: 5,
  userAgent: 'test-agent/1.0',
}

function provider(): HttpFetchProvider {
  return new HttpFetchProvider(limits)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('public address classification', () => {
  it('refuses loopback, private, link-local, metadata, multicast, and reserved IPv4', () => {
    for (const address of [
      '127.0.0.1',
      '127.255.255.254',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.169.254',
      '169.254.1.1',
      '0.0.0.0',
      '100.64.0.1',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isPublicIpv4(address), address).toBe(false)
    }
  })

  it('accepts globally routable IPv4', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1']) {
      expect(isPublicIpv4(address), address).toBe(true)
    }
  })

  it('rejects malformed IPv4 rather than defaulting to public', () => {
    expect(isPublicIpv4('999.1.1.1')).toBe(false)
    expect(isPublicIpv4('8.8.8')).toBe(false)
    expect(isPublicIpv4('')).toBe(false)
  })

  it('refuses loopback, unique-local, link-local, multicast, and mapped private IPv6', () => {
    for (const address of [
      '::1',
      '::',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:169.254.169.254',
      'fe80::1',
      'febf::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      'fec0::1',
    ]) {
      expect(isPublicIpv6(address), address).toBe(false)
    }
  })

  it('accepts a public IPv6 and a public IPv4-mapped address', () => {
    expect(isPublicIpv6('2606:4700:4700::1111')).toBe(true)
    expect(isPublicIpv6('2001:4860:4860::8888')).toBe(true)
    expect(isPublicIpv6('::ffff:8.8.8.8')).toBe(true)
  })

  it('routes each address to the right family', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('127.0.0.1')).toBe(false)
  })

  it('recognises literal addresses only', () => {
    expect(literalIpAddress('127.0.0.1')).toBe('127.0.0.1')
    expect(literalIpAddress('[::1]')).toBe('::1')
    expect(literalIpAddress('example.com')).toBeUndefined()
  })
})

describe('checkout-blocked destinations', () => {
  it('refuses a literal private address before any connection', () => {
    for (const url of [
      'http://127.0.0.1:3080',
      'http://[::1]',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1',
      'http://192.168.0.1',
      'http://172.16.0.1',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      expect(() => assertPublicDestination(new URL(url)), url)
        .toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    }
  })

  it('accepts a literal public address and a DNS name', () => {
    expect(assertPublicDestination(new URL('http://8.8.8.8/')).hostname).toBe('8.8.8.8')
    expect(assertPublicDestination(new URL('https://example.com/x')).hostname).toBe('example.com')
  })

  it('refuses a hostname that resolves to any private address', () => {
    expect(() => pinnedAddress(['93.184.216.34', '10.0.0.7'])).toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(() => pinnedAddress(['::1'])).toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })

  it('pins the first verified address', () => {
    expect(pinnedAddress(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'])).toBe('93.184.216.34')
  })

  it('fails when a hostname resolves to nothing', () => {
    expect(() => pinnedAddress([])).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('HttpFetchProvider SSRF policy', () => {
  it('refuses loopback without opening a socket', async () => {
    await expect(provider().fetch({ url: 'http://127.0.0.1:3080/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })

  it('refuses the metadata endpoint', async () => {
    await expect(provider().fetch({ url: 'http://169.254.169.254/latest/meta-data/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })

  it('refuses a public hostname that resolves to a private address', async () => {
    const { lookup } = await import('node:dns/promises')
    vi.spyOn({ lookup }, 'lookup', 'get')
    vi.doMock('node:dns/promises', () => ({
      lookup: vi.fn().mockResolvedValue([{ address: '10.1.2.3', family: 4 }]),
    }))
    vi.resetModules()
    const { HttpFetchProvider: FreshProvider } = await import('../src/provider.ts')
    const fresh = new FreshProvider(limits)
    await expect(fresh.fetch({ url: 'https://rebind.example.com/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    vi.doUnmock('node:dns/promises')
    vi.resetModules()
    expect(typeof lookup).toBe('function')
  })

  it('connects to the pinned address instead of re-resolving the name', async () => {
    const seen: Array<string> = []
    vi.doMock('undici', async () => {
      const actual = await vi.importActual<typeof import('undici')>('undici')
      return {
        ...actual,
        fetch: vi.fn(async (_url: URL, init: { dispatcher?: unknown }) => {
          seen.push(JSON.stringify(init.dispatcher !== undefined))
          return new Response('pinned', { headers: { 'content-type': 'text/plain' } })
        }),
        getGlobalDispatcher: vi.fn(),
      }
    })
    vi.doMock('node:dns/promises', () => ({
      lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    }))
    vi.resetModules()

    const { HttpFetchProvider: FreshProvider } = await import('../src/provider.ts')
    const fresh = new FreshProvider(limits)
    const result = await fresh.fetch({ url: 'https://example.com/page' })
    expect(result.body.content).toBe('pinned')
    expect(seen).toEqual(['true'])

    vi.doUnmock('undici')
    vi.doUnmock('node:dns/promises')
    vi.resetModules()
  })

  it('keeps the opt-in for local fixtures explicit', async () => {
    const fixture = new HttpFetchProvider({ ...limits, allowPrivateAddresses: true })
    // Loopback is reachable only through the explicit opt-in; the port is closed,
    // so the failure is a transport error rather than a policy block.
    await expect(fixture.fetch({ url: 'http://127.0.0.1:1/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})
