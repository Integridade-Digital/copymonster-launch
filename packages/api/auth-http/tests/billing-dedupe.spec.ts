/**
 * M-18: a retried Stripe delivery of an already-applied event must not apply
 * its tenant update twice. The first delivery claims the event id; a second
 * delivery of the same id is acknowledged as a duplicate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  schema: vi.fn(),
}))

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: mockSupabase,
  hasSupabaseAdminClient: () => true,
}))

import { handleWebhook } from '../src/billing.ts'

const WEBHOOK_SECRET = 'whsec_plan_event_dedupe_secret'

function request(body: string, signature: string): IncomingMessage {
  const stream = new Readable({
    read() {
      this.push(Buffer.from(body))
      this.push(null)
    },
  })
  ;(stream as unknown as { method: string }).method = 'POST'
  ;(stream as unknown as { headers: Record<string, string> }).headers = { 'stripe-signature': signature }
  return stream as unknown as IncomingMessage
}

function response(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    setHeader() {},
    writeHead(code: number) {
      res.statusCode = code
      return res
    },
    write(chunk: string) {
      res.body += chunk
      return true
    },
    end(chunk?: string) {
      if (chunk !== undefined) res.body += chunk
    },
  }
  return res as unknown as ServerResponse & { statusCode: number; body: string }
}

function sign(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${expected}`
}

const payload = JSON.stringify({
  id: 'evt_plan_once',
  type: 'invoice.payment_succeeded',
  data: { object: { id: 'in_1', customer: 'cus_1', billing_reason: 'subscription_cycle' } },
})

describe('M-18 stripe event deduplication', () => {
  let claimed: Set<string>
  let tenantUpdates: number

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    claimed = new Set()
    tenantUpdates = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'processed_stripe_events') {
        return {
          insert: vi.fn().mockImplementation((row: { event_id: string }) => {
            if (claimed.has(row.event_id)) {
              return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })
            }
            claimed.add(row.event_id)
            return Promise.resolve({ error: null })
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_col: string, id: string) => {
              claimed.delete(id)
              return Promise.resolve({ error: null })
            }),
          }),
        }
      }
      if (table === 'tenants') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => {
              tenantUpdates += 1
              return Promise.resolve({ error: null })
            }),
          }),
        }
      }
      return {}
    })
  })

  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    mockSupabase.from.mockReset()
  })

  it('applies a first delivery and acknowledges a redelivery without re-applying', async () => {
    const ctx = {} as Context
    const signature = sign(payload)

    const first = response()
    await handleWebhook(ctx, request(payload, signature), first)
    expect(first.statusCode).toBe(200)
    const appliedAfterFirst = tenantUpdates

    const second = response()
    await handleWebhook(ctx, request(payload, signature), second)
    expect(second.statusCode).toBe(200)
    expect(JSON.parse(second.body)).toEqual({ received: true, duplicate: true })
    expect(tenantUpdates).toBe(appliedAfterFirst)
  })
})
