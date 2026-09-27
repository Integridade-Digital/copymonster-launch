import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  handleCheckout,
  handlePortal,
  handleWebhook,
  readRawBody,
  verifyStripeSignature,
} from '../src/billing.ts'

// Mock Supabase admin client
const mockSupabase = vi.hoisted(() => {
  return {
    from: vi.fn(),
  }
})

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: mockSupabase,
}))

// Helpers to create mock requests and responses
function createMockReq(options: {
  method?: string
  headers?: Record<string, string | undefined>
  body?: string | Buffer
}): IncomingMessage {
  const chunks: Buffer[] = []
  if (options.body) {
    chunks.push(Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body))
  }
  let index = 0
  const stream = new Readable({
    read() {
      if (index < chunks.length) {
        this.push(chunks[index++])
      } else {
        this.push(null)
      }
    },
  })
  ;(stream as unknown as { method: string }).method = options.method || 'GET'
  ;(stream as unknown as { headers: Record<string, string> }).headers = (options.headers as Record<string, string>) || {}
  return stream as unknown as IncomingMessage
}

interface MockResponse extends ServerResponse {
  statusCode: number
  headers: Record<string, unknown>
  body: string
  json: () => unknown
}

function createMockRes(): MockResponse {
  const headers: Record<string, unknown> = {}
  let body = ''

  const res = {
    statusCode: 200,
    headers,
    body: '',
    writeHead: vi.fn((status: number, hdrs?: Record<string, unknown>) => {
      res.statusCode = status
      if (hdrs) Object.assign(headers, hdrs)
    }),
    end: vi.fn((chunk?: unknown) => {
      if (chunk) {
        body += chunk.toString()
        res.body = body
      }
    }),
    json: () => (body ? JSON.parse(body) : null),
  }

  return res as unknown as MockResponse
}

function generateStripeSignature(payload: string | Buffer, secret: string, timestamp?: number): string {
  const t = timestamp ?? Math.floor(Date.now() / 1000)
  const body = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${sig}`
}

describe('Stripe Billing & Webhooks Integration Tests', () => {
  const originalEnv = process.env
  let mockContext: unknown
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    process.env = { ...originalEnv }
    mockContext = {
      auth: {
        resolveIdentity: vi.fn(),
      },
    }
    originalFetch = globalThis.fetch
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
    globalThis.fetch = originalFetch
  })

  describe('readRawBody', () => {
    it('should read stream chunks and return complete buffer', async () => {
      const data = 'Hello CopyMonster Webhook Raw Stream'
      const req = createMockReq({ body: data })
      const buf = await readRawBody(req)
      expect(buf.toString('utf8')).toBe(data)
    })
  })

  describe('verifyStripeSignature', () => {
    const secret = 'whsec_test_secret_1234567890'

    it('should return true for valid signature within tolerance', () => {
      const payload = Buffer.from(JSON.stringify({ id: 'evt_123' }))
      const signature = generateStripeSignature(payload, secret)
      const valid = verifyStripeSignature(payload, signature, secret, 300)
      expect(valid).toBe(true)
    })

    it('should return false if payload was tampered', () => {
      const payload = Buffer.from(JSON.stringify({ id: 'evt_123' }))
      const tampered = Buffer.from(JSON.stringify({ id: 'evt_999' }))
      const signature = generateStripeSignature(payload, secret)
      const valid = verifyStripeSignature(tampered, signature, secret, 300)
      expect(valid).toBe(false)
    })

    it('should return false if secret does not match', () => {
      const payload = Buffer.from(JSON.stringify({ id: 'evt_123' }))
      const signature = generateStripeSignature(payload, 'whsec_wrong')
      const valid = verifyStripeSignature(payload, signature, secret, 300)
      expect(valid).toBe(false)
    })

    it('should return false if timestamp is older than tolerance', () => {
      const payload = Buffer.from(JSON.stringify({ id: 'evt_123' }))
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600
      const signature = generateStripeSignature(payload, secret, oldTimestamp)
      const valid = verifyStripeSignature(payload, signature, secret, 300)
      expect(valid).toBe(false)
    })

    it('should return false for malformed or missing parts in signature header', () => {
      const payload = Buffer.from(JSON.stringify({ id: 'evt_123' }))
      expect(verifyStripeSignature(payload, 'invalid-format', secret)).toBe(false)
      expect(verifyStripeSignature(payload, 't=12345', secret)).toBe(false)
      expect(verifyStripeSignature(payload, 'v1=abcdef', secret)).toBe(false)
    })
  })

  describe('handleCheckout', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_secret_key'
    })

    it('should reject non-POST requests with 405', async () => {
      const req = createMockReq({ method: 'GET' })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(405)
      expect(res.json()).toEqual({ error: 'method_not_allowed' })
    })

    it('should reject requests without authorization token with 401', async () => {
      const req = createMockReq({ method: 'POST', headers: {} })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
    })

    it('should reject invalid identity with 401', async () => {
      mockContext.auth.resolveIdentity.mockResolvedValue(null)
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer invalid_token' },
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'invalid_identity' })
    })

    it('should return 500 if STRIPE_SECRET_KEY is missing', async () => {
      delete process.env.STRIPE_SECRET_KEY
      mockContext.auth.resolveIdentity.mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'user-1',
      })
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(500)
      expect(res.json()).toEqual({ error: 'stripe_secret_key_not_configured' })
    })

    it('should reject invalid json body with 400', async () => {
      mockContext.auth.resolveIdentity.mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'user-1',
      })
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: 'invalid-json{',
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'invalid_json_body' })
    })

    it('should reject missing priceId with 400', async () => {
      mockContext.auth.resolveIdentity.mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'user-1',
      })
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify({}),
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'missing_price_id' })
    })

    it('should return 404 if tenant is not found in Supabase', async () => {
      mockContext.auth.resolveIdentity.mockResolvedValue({
        tenantId: 'tenant-nonexistent',
        userId: 'user-1',
      })

      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      }
      mockSupabase.from.mockReturnValue(mockQueryBuilder)

      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify({ priceId: 'price_test_123' }),
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'tenant_not_found' })
    })

    it('should create Stripe customer if not present and create checkout session', async () => {
      mockContext.auth.resolveIdentity.mockResolvedValue({
        tenantId: 'tenant-123',
        userId: 'user-123',
        email: 'user@copymonster.ai',
        fullName: 'Adriano Vieira',
      })

      // Supabase mock: tenant has no stripe_customer_id initially
      const mockTenantSelect = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'tenant-123', stripe_customer_id: null, name: 'Monster Tenant' },
          error: null,
        }),
      }
      const mockTenantUpdate = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: mockTenantSelect.select,
            eq: mockTenantSelect.eq,
            single: mockTenantSelect.single,
            update: mockTenantUpdate.update,
          }
        }
        return {}
      })

      // Mock Stripe API calls
      const fetchCalls: Array<{ url: string; body: string }> = []
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
        fetchCalls.push({ url, body: init.body })
        if (url.endsWith('/customers')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'cus_created_123' }),
          } as Response
        }
        if (url.endsWith('/checkout/sessions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'cs_test_session_123',
              url: 'https://checkout.stripe.com/pay/cs_test_session_123',
            }),
          } as Response
        }
        return { ok: false, status: 404, json: async () => ({ error: { message: 'Not found' } }) } as Response
      })

      const req = createMockReq({
        method: 'POST',
        headers: {
          authorization: 'Bearer valid_token',
          host: 'copymonster.ai',
        },
        body: JSON.stringify({ priceId: 'price_1SqRe4RiKNxooUH0tYyprM4P' }),
      })
      const res = createMockRes()

      await handleCheckout(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        sessionId: 'cs_test_session_123',
        url: 'https://checkout.stripe.com/pay/cs_test_session_123',
      })

      // Verify customer was created
      expect(fetchCalls[0]?.url).toContain('/customers')
      expect(fetchCalls[0]?.body).toContain('email=user%40copymonster.ai')
      // Verify tenant was updated with customer ID
      expect(mockTenantUpdate.update).toHaveBeenCalledWith({ stripe_customer_id: 'cus_created_123' })
      // Verify checkout session creation
      expect(fetchCalls[1]?.url).toContain('/checkout/sessions')
      expect(fetchCalls[1]?.body).toContain('customer=cus_created_123')
      expect(fetchCalls[1]?.body).toContain('line_items%5B0%5D%5Bprice%5D=price_1SqRe4RiKNxooUH0tYyprM4P')
    })

    it('should reuse existing stripe_customer_id if already saved on tenant', async () => {
      mockContext.auth.resolveIdentity.mockResolvedValue({
        tenantId: 'tenant-123',
        userId: 'user-123',
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'tenant-123', stripe_customer_id: 'cus_existing_999' },
          error: null,
        }),
      })

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/checkout/sessions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'cs_existing_customer_session',
              url: 'https://checkout.stripe.com/pay/cs_existing_customer_session',
            }),
          } as Response
        }
        return { ok: false, status: 500, json: async () => ({ error: { message: 'Unexpected' } }) } as Response
      })

      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify({ priceId: 'price_pro_annual' }),
      })
      const res = createMockRes()

      await handleCheckout(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json().sessionId).toBe('cs_existing_customer_session')
      // Customer creation should NOT have been called
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('handlePortal', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_secret_key'
    })

    it('should reject non-POST with 405', async () => {
      const req = createMockReq({ method: 'GET' })
      const res = createMockRes()
      await handlePortal(mockContext, req, res)
      expect(res.statusCode).toBe(405)
      expect(res.json()).toEqual({ error: 'method_not_allowed' })
    })

    it('should reject unauthenticated request with 401', async () => {
      const req = createMockReq({ method: 'POST', headers: {} })
      const res = createMockRes()
      await handlePortal(mockContext, req, res)
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
    })

    it('should return 400 if tenant has no stripe_customer_id', async () => {
      mockContext.auth.resolveIdentity.mockResolvedValue({
        tenantId: 'tenant-no-billing',
        userId: 'user-1',
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { stripe_customer_id: null },
          error: null,
        }),
      })

      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
      })
      const res = createMockRes()
      await handlePortal(mockContext, req, res)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'no_stripe_customer_registered' })
    })

    it('should create billing portal session for customer and return portal URL', async () => {
      mockContext.auth.resolveIdentity.mockResolvedValue({
        tenantId: 'tenant-billing',
        userId: 'user-1',
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { stripe_customer_id: 'cus_registered_777' },
          error: null,
        }),
      })

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
        expect(url).toContain('/billing_portal/sessions')
        expect(init.body).toContain('customer=cus_registered_777')
        return {
          ok: true,
          status: 200,
          json: async () => ({ url: 'https://billing.stripe.com/p/session_portal_123' }),
        } as Response
      })

      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify({ returnUrl: 'https://copymonster.ai/custom-return' }),
      })
      const res = createMockRes()
      await handlePortal(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ url: 'https://billing.stripe.com/p/session_portal_123' })
    })
  })

  describe('handleWebhook', () => {
    const webhookSecret = 'whsec_test_suite_key_999'

    beforeEach(() => {
      process.env.STRIPE_WEBHOOK_SECRET = webhookSecret
    })

    it('should reject non-POST request with 405', async () => {
      const req = createMockReq({ method: 'GET' })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)
      expect(res.statusCode).toBe(405)
      expect(res.json()).toEqual({ error: 'method_not_allowed' })
    })

    it('should reject webhook with invalid signature with 400', async () => {
      const payload = JSON.stringify({ type: 'checkout.session.completed' })
      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': 't=12345,v1=tampered_signature' },
        body: payload,
      })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'invalid_webhook_signature' })
    })

    it('should reject malformed JSON payload with 400', async () => {
      const payload = 'not-valid-json{{'
      const sig = generateStripeSignature(payload, webhookSecret)
      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': sig },
        body: payload,
      })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'invalid_payload' })
    })

    it('should handle checkout.session.completed event and activate tenant subscription', async () => {
      const payload = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_tenant_abc',
            subscription: 'sub_active_123',
            metadata: {
              tenant_id: 'ten_001',
            },
          },
        },
      })

      const sig = generateStripeSignature(payload, webhookSecret)
      const updateMock = vi.fn().mockReturnThis()
      const eqMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockReturnValue({
        update: updateMock,
        eq: eqMock,
      })

      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': sig },
        body: payload,
      })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          stripe_customer_id: 'cus_tenant_abc',
          stripe_subscription_id: 'sub_active_123',
          subscription_status: 'active',
          trial_used: true,
        }),
      )
      expect(eqMock).toHaveBeenCalledWith('id', 'ten_001')
    })

    it('should handle customer.subscription.updated and map plan_id from price ID', async () => {
      const priceId = 'price_1SqRe4RiKNxooUH0tYyprM4P'
      const payload = JSON.stringify({
        type: 'customer.subscription.updated',
        data: {
          object: {
            customer: 'cus_tenant_abc',
            status: 'active',
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  price: {
                    id: priceId,
                    recurring: { interval: 'month' },
                  },
                },
              ],
            },
          },
        },
      })

      const sig = generateStripeSignature(payload, webhookSecret)
      const tenantUpdateMock = vi.fn().mockReturnThis()
      const tenantEqMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'plans') {
          return {
            select: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'plan_pro' },
              error: null,
            }),
          }
        }
        if (table === 'tenants') {
          return {
            update: tenantUpdateMock,
            eq: tenantEqMock,
          }
        }
        return {}
      })

      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': sig },
        body: payload,
      })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })
      expect(tenantUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_status: 'active',
          cancel_at_period_end: false,
          subscription_interval: 'month',
          plan_id: 'plan_pro',
        }),
      )
      expect(tenantEqMock).toHaveBeenCalledWith('stripe_customer_id', 'cus_tenant_abc')
    })

    it('should handle customer.subscription.deleted event and set status to canceled', async () => {
      const payload = JSON.stringify({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            customer: 'cus_tenant_canceling',
          },
        },
      })

      const sig = generateStripeSignature(payload, webhookSecret)
      const updateMock = vi.fn().mockReturnThis()
      const eqMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockReturnValue({
        update: updateMock,
        eq: eqMock,
      })

      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': sig },
        body: payload,
      })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_status: 'canceled',
        }),
      )
      expect(eqMock).toHaveBeenCalledWith('stripe_customer_id', 'cus_tenant_canceling')
    })

    it('should handle invoice.payment_succeeded and reset token meter on subscription_cycle', async () => {
      const payload = JSON.stringify({
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            customer: 'cus_tenant_renewal',
            billing_reason: 'subscription_cycle',
          },
        },
      })

      const sig = generateStripeSignature(payload, webhookSecret)
      const updateMock = vi.fn().mockReturnThis()
      const eqMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockReturnValue({
        update: updateMock,
        eq: eqMock,
      })

      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': sig },
        body: payload,
      })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          current_period_tokens_used: 0,
        }),
      )
      expect(eqMock).toHaveBeenCalledWith('stripe_customer_id', 'cus_tenant_renewal')
    })

    it('should handle invoice.payment_failed event and set status to past_due', async () => {
      const payload = JSON.stringify({
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_tenant_delinquent',
          },
        },
      })

      const sig = generateStripeSignature(payload, webhookSecret)
      const updateMock = vi.fn().mockReturnThis()
      const eqMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockReturnValue({
        update: updateMock,
        eq: eqMock,
      })

      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': sig },
        body: payload,
      })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_status: 'past_due',
        }),
      )
      expect(eqMock).toHaveBeenCalledWith('stripe_customer_id', 'cus_tenant_delinquent')
    })
  })
})
