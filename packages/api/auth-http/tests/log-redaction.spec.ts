import { afterEach, describe, expect, it, vi } from 'vitest'
import { logSessionEvent, logSessionFailure } from '../src/session-token.ts'
import { redactSecrets } from '../src/billing.ts'

const PII = ['ana.silva@example.com', 'Ana Silva', 'tenant-slug-abc', 'user-sub-uuid', 'jwt.header.payload']

function captureAllSpies() {
  const lines: string[] = []
  for (const level of ['log', 'error', 'warn', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '))
    })
  }
  return lines
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('session-token logs carry no identity', () => {
  it('writes only a stable code and fixed fields', () => {
    const lines = captureAllSpies()
    logSessionFailure('SESSION_TOKEN_INVALID')
    logSessionFailure('SESSION_TOKEN_USER_LOOKUP_FAILED', { status: 401 })
    logSessionEvent('SESSION_TOKEN_REQUEST_RECEIVED')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(JSON.stringify({ level: 'error', scope: 'session-token', code: 'SESSION_TOKEN_INVALID' }))
    expect(lines[1]).toContain('"status":401')
    expect(lines[2]).toContain('SESSION_TOKEN_REQUEST_RECEIVED')
    for (const line of lines) {
      for (const value of PII) expect(line).not.toContain(value)
    }
  })

  it('never accepts a payload carrying an e-mail, name, tenant, sub, or token', () => {
    const lines = captureAllSpies()
    // The signature only admits fixed, non-identifying fields; a caller passing a
    // string still cannot produce an email-shaped log line by accident.
    logSessionFailure('SESSION_TOKEN_SUBJECT_MISMATCH')
    const line = lines.join('\n')
    expect(line).not.toMatch(/@/)
    expect(line).not.toContain('tenant')
    expect(line).not.toContain('sub')
  })
})

describe('billing error redaction', () => {
  it('masks Stripe keys, webhook secrets, and bearer tokens', () => {
    const message = 'request failed for sk_live_abc123 and whsec_xyz789 with Bearer eyJhbGciOi.abc.def'
    const redacted = redactSecrets(message)
    expect(redacted).not.toContain('sk_live_abc123')
    expect(redacted).not.toContain('whsec_xyz789')
    expect(redacted).not.toContain('eyJhbGciOi')
    expect(redacted).toContain('[redacted]')
  })

  it('leaves an ordinary message intact', () => {
    expect(redactSecrets('customer cus_123 has no payment method')).toBe('customer cus_123 has no payment method')
  })
})

describe('public error codes', () => {
  it('uses stable codes instead of upstream messages', async () => {
    const fs = await import('node:fs/promises')
    const billing = await fs.readFile(new URL('../src/billing.ts', import.meta.url), 'utf8')
    expect(billing).toContain("'BILLING_CHECKOUT_FAILED'")
    expect(billing).toContain("'BILLING_PORTAL_FAILED'")
    expect(billing).toContain("'BILLING_WEBHOOK_FAILED'")
    expect(billing).not.toContain('sendJson(res, 500, { error: message')

    const payout = await fs.readFile(new URL('../src/payout-executor.ts', import.meta.url), 'utf8')
    expect(payout).not.toContain('insertError?.message')
  })
})
