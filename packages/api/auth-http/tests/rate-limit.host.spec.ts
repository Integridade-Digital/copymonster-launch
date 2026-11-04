import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientKey, createRateLimiter } from '../src/rate-limit.ts'

/** Minimal request carrying the headers the limiter reads. */
function request(headers: Record<string, string>, remoteAddress = '10.0.0.1'): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage
}

describe('rate limiter', () => {
  it('allows the configured budget and refuses the next request', () => {
    const limiter = createRateLimiter({ windowMs: 1_000, max: 2 })

    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(true)
    const refused = limiter.check('a')
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('keeps one budget per key', () => {
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1 })

    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('b').allowed).toBe(true)
  })

  it('reopens the window once it elapses', async () => {
    const limiter = createRateLimiter({ windowMs: 20, max: 1 })

    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(limiter.check('a').allowed).toBe(true)
  })
})

describe('clientKey', () => {
  it('prefers the Cloudflare client address from a trusted proxy', () => {
    expect(clientKey(request({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }), ['10.0.0.1']))
      .toBe('203.0.113.9')
  })

  it('falls back to the first forwarded address from a trusted proxy', () => {
    expect(clientKey(request({ 'x-forwarded-for': '198.51.100.1, 10.0.0.2' }), ['10.0.0.1'])).toBe('198.51.100.1')
  })

  it('ignores a forwarding header from an untrusted socket', () => {
    expect(clientKey(request({ 'cf-connecting-ip': '203.0.113.9' }, '198.51.100.7'), ['10.0.0.1']))
      .toBe('198.51.100.7')
  })

  it('normalizes an IPv4-mapped IPv6 socket address', () => {
    expect(clientKey(request({ 'x-forwarded-for': '203.0.113.9' }, '::ffff:10.0.0.1'), ['10.0.0.1']))
      .toBe('203.0.113.9')
  })

  it('falls back to the socket address', () => {
    expect(clientKey(request({}, '127.0.0.1'))).toBe('127.0.0.1')
  })

  it('reports unknown when no address is available', () => {
    const bare = { headers: {}, socket: {} } as unknown as IncomingMessage
    expect(clientKey(bare)).toBe('unknown')
  })
})
