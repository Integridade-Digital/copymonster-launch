import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context/types'
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
  // The main app owns the service-role key, so its billing runs locally
  // instead of forwarding to itself.
  hasSupabaseAdminClient: () => true,
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
  headers: Record<string, string>
  body: string
  json: () => Record<string, unknown> | null
}

function createMockRes(): MockResponse {
  const headers: Record<string, string> = {}
  let body = ''

  const res = {
    statusCode: 200,
    headers,
    body: '',
    writeHead: vi.fn((status: number, hdrs?: Record<string, string>) => {
      res.statusCode = status
      if (hdrs) Object.assign(headers, hdrs)
    }),
    end: vi.fn((chunk?: unknown) => {
      if (chunk) {
        body += chunk.toString()
        res.body = body
      }
    }),
    json: (): Record<string, unknown> | null => (body ? JSON.parse(body) : null),
  }

  return res as unknown as MockResponse
}

/** Build a complete identity, overriding only the fields a case cares about. */
function identity(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'owner',
    email: 'user@copymonster.ai',
    ...overrides,
  }
}

function generateStripeSignature(payload: string | Buffer, secret: string, timestamp?: number): string {
  const t = timestamp ?? Math.floor(Date.now() / 1000)
  const body = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${sig}`
}

describe('Stripe Billing & Webhooks Integration Tests', () => {
  const originalEnv = process.env
  const resolveIdentity = vi.fn<[token: string], Promise<UserIdentity | undefined>>()
  let mockContext: Context
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    process.env = { ...originalEnv }
    resolveIdentity.mockReset()
    mockContext = { auth: { resolveIdentity } } as unknown as Context
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
      resolveIdentity.mockResolvedValue(undefined)
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
      resolveIdentity.mockResolvedValue(identity())
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(500)
      expect(res.json()).toEqual({ error: 'stripe_secret_key_not_configured' })
    })

    it.each([
      ['an unknown plan slug', { plan: 'enterprise', interval: 'monthly' }],
      ['an unknown interval', { plan: 'pro', interval: 'weekly' }],
      ['a price id instead of a plan', { priceId: 'price_arbitrary', interval: 'monthly' }],
      ['a missing interval', { plan: 'pro' }],
    ])('rejects %s with 400 before any database read', async (_label, body) => {
      resolveIdentity.mockResolvedValue(identity())
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify(body),
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({
        error: 'invalid_plan_request',
        message: 'Choose a billing plan and interval to continue.',
      })
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('rejects an unparsable body with 400', async () => {
      resolveIdentity.mockResolvedValue(identity())
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: 'not json',
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({
        error: 'invalid_plan_request',
        message: 'Choose a billing plan and interval to continue.',
      })
    })

    it('rejects a plan without a Stripe price with 400 and a readable message', async () => {
      resolveIdentity.mockResolvedValue(identity())
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'tenant-1', stripe_customer_id: null, name: 'Tenant' },
            error: null,
          }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'plan-pro', stripe_price_id_monthly: null }, error: null }),
        })
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify({ plan: 'pro', interval: 'monthly' }),
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({
        error: 'plan_not_billable',
        message: 'This plan is not available for checkout yet. Please contact support.',
      })
    })

    it('answers 413 for a body above the cap', async () => {
      resolveIdentity.mockResolvedValue(identity())
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: Buffer.alloc(1024 * 1024 + 1, 0x61),
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(413)
      expect(res.json()).toEqual({ error: 'payload_too_large', limit: 1024 * 1024 })
    })

    it('should return 404 if tenant is not found in Supabase', async () => {
      resolveIdentity.mockResolvedValue(identity({ tenantId: 'tenant-nonexistent' }))

      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      }
      mockSupabase.from.mockReturnValue(mockQueryBuilder)

      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify({ plan: 'pro', interval: 'monthly' }),
      })
      const res = createMockRes()
      await handleCheckout(mockContext, req, res)
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'tenant_not_found' })
    })

    it('should create Stripe customer if not present and create checkout session', async () => {
      resolveIdentity.mockResolvedValue(identity({
        tenantId: 'tenant-123',
        userId: 'user-123',
        fullName: 'Adriano Vieira',
      }))

      // Supabase mock: tenant has no stripe_customer_id initially
      const mockTenantSelect = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'tenant-123', stripe_customer_id: null, name: 'Monster Tenant', plan_id: 'plan-row-1' },
          error: null,
        }),
      }
      const mockTenantUpdate = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      const mockPlanSelect = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'plan-row-1', stripe_price_id_monthly: 'price_plan_pro' }, error: null }),
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
        if (table === 'plans') return mockPlanSelect
        return {}
      })

      // Mock Stripe API calls
      const fetchCalls: Array<{ url: string; body: string }> = []
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
        fetchCalls.push({ url, body: init?.body ?? '' })
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
        body: JSON.stringify({ plan: 'pro', interval: 'monthly' }),
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
      // The plan row owns the price; the request names only a plan and interval.
      expect(fetchCalls[1]?.body).toContain('line_items%5B0%5D%5Bprice%5D=price_plan_pro')
      expect(fetchCalls[1]?.body).toContain('subscription_data%5Bmetadata%5D%5Bplan%5D=pro')
      expect(fetchCalls[1]?.body).toContain('subscription_data%5Bmetadata%5D%5Binterval%5D=monthly')
      // Redirects always name the platform origin, never the request Host.
      expect(fetchCalls[1]?.body).toContain('success_url=https%3A%2F%2Fapp.copymonster.co%2Fbilling%2Fsuccess')
      expect(fetchCalls[1]?.body).toContain('cancel_url=https%3A%2F%2Fapp.copymonster.co%2Fbilling%2Fcancel')
    })

    it('should reuse existing stripe_customer_id if already saved on tenant', async () => {
      resolveIdentity.mockResolvedValue(identity({ tenantId: 'tenant-123', userId: 'user-123' }))

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'plans') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'plan-row-1', stripe_price_id_annual: 'price_pro_annual' }, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'tenant-123', stripe_customer_id: 'cus_existing_999' },
            error: null,
          }),
        }
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
        body: JSON.stringify({ plan: 'pro', interval: 'annual' }),
      })
      const res = createMockRes()

      await handleCheckout(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()?.sessionId).toBe('cs_existing_customer_session')
      // An annual request reads the annual price column, not the monthly one;
      // customer creation was skipped because the tenant already had one.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    it('resolves the price from the plan row and ignores a client-supplied price id', async () => {
      resolveIdentity.mockResolvedValue(identity({ tenantId: 'tenant-123', userId: 'user-123' }))

      const plansEq = vi.fn().mockReturnThis()
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'plans') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: plansEq,
            single: vi.fn().mockResolvedValue({
              data: { id: 'plan-legend', stripe_price_id_annual: 'price_legend_annual_server' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'tenant-123', stripe_customer_id: 'cus_existing_999' },
            error: null,
          }),
          update: vi.fn().mockReturnThis(),
        }
      })

      const checkoutBodies: string[] = []
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
        if (url.endsWith('/checkout/sessions')) {
          checkoutBodies.push(init?.body ?? '')
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'cs_legend', url: 'https://checkout.stripe.com/pay/cs_legend' }),
          } as Response
        }
        return { ok: false, status: 500, json: async () => ({}) } as Response
      })

      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify({
          plan: 'legend',
          interval: 'annual',
          priceId: 'price_attacker_supplied',
          price_id: 'price_attacker_supplied',
        }),
      })
      const res = createMockRes()

      await handleCheckout(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      // The plan slug and the annual column select the price; the client value never reaches Stripe.
      expect(plansEq).toHaveBeenCalledWith('slug', 'legend')
      expect(checkoutBodies[0]).toContain('line_items%5B0%5D%5Bprice%5D=price_legend_annual_server')
      expect(checkoutBodies[0]).not.toContain('price_attacker_supplied')
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
      resolveIdentity.mockResolvedValue(identity({ tenantId: 'tenant-no-billing' }))

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
      resolveIdentity.mockResolvedValue(identity({ tenantId: 'tenant-billing' }))

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
        expect(init?.body).toContain('customer=cus_registered_777')
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
    it('should reject webhook with 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET
      const payload = JSON.stringify({ type: 'checkout.session.completed' })
      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': 't=12345,v1=any' },
        body: payload,
      })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)
      expect(res.statusCode).toBe(500)
      expect(res.json()).toEqual({ error: 'stripe_webhook_secret_not_configured' })
    })

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
            current_period_end: 1735689600,
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
          current_period_end: '2025-01-01T00:00:00.000Z',
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
            current_period_end: 1735689600,
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

      const plansEq = vi.fn()
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'plans') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: plansEq.mockImplementation((column: string) => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: column === 'stripe_price_id_monthly' ? { id: 'plan_pro' } : null,
                error: null,
              }),
            })),
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
          current_period_end: '2025-01-01T00:00:00.000Z',
        }),
      )
      expect(tenantEqMock).toHaveBeenCalledWith('stripe_customer_id', 'cus_tenant_abc')
      // The price id is a literal equality operand, never an interpolated filter.
      expect(plansEq).toHaveBeenCalledWith('stripe_price_id_monthly', priceId)
    })

    /** Stub the plans and tenants lookups a subscription event makes. */
    const stubSubscriptionTables = (plan: { id: string } | null): {
      tenantUpdate: ReturnType<typeof vi.fn>
      tenantEq: ReturnType<typeof vi.fn>
      plansEq: ReturnType<typeof vi.fn>
    } => {
      const tenantUpdate = vi.fn().mockReturnThis()
      const tenantEq = vi.fn().mockResolvedValue({ error: null })
      const plansEq = vi.fn()
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'plans') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: plansEq.mockImplementation((column: string) => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: column === 'stripe_price_id_monthly' ? plan : null,
                error: null,
              }),
            })),
          }
        }
        if (table === 'tenants') return { update: tenantUpdate, eq: tenantEq }
        return {}
      })
      return { tenantUpdate, tenantEq, plansEq }
    }

    /** Deliver one signed webhook payload and return the mock response. */
    const deliver = async (event: Record<string, unknown>): Promise<MockResponse> => {
      const payload = JSON.stringify(event)
      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': generateStripeSignature(payload, webhookSecret) },
        body: payload,
      })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)
      return res
    }

    it('should activate the tenant on customer.subscription.created and record the subscription id', async () => {
      const { tenantUpdate, tenantEq, plansEq } = stubSubscriptionTables({ id: 'plan_pro' })
      const res = await deliver({
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_active_123',
            customer: 'cus_tenant_abc',
            status: 'active',
            cancel_at_period_end: false,
            items: {
              data: [{ quantity: 1, price: { id: 'price_pro_month', recurring: { interval: 'month' } } }],
            },
          },
        },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })
      expect(tenantUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_status: 'active',
          stripe_subscription_id: 'sub_active_123',
          subscription_interval: 'month',
          plan_id: 'plan_pro',
        }),
      )
      expect(tenantEq).toHaveBeenCalledWith('stripe_customer_id', 'cus_tenant_abc')
      expect(plansEq).toHaveBeenCalledWith('stripe_price_id_monthly', 'price_pro_month')
    })

    it('should read the current period end from the subscription item', async () => {
      const { tenantUpdate } = stubSubscriptionTables({ id: 'plan_pro' })
      await deliver({
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_active_123',
            customer: 'cus_tenant_abc',
            status: 'active',
            items: {
              data: [{
                quantity: 1,
                current_period_end: 1735689600,
                price: { id: 'price_pro_month', recurring: { interval: 'month' } },
              }],
            },
          },
        },
      })

      expect(tenantUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ current_period_end: '2025-01-01T00:00:00.000Z' }),
      )
    })

    it('should fall back to the subscription-level period end on an older payload', async () => {
      const { tenantUpdate } = stubSubscriptionTables({ id: 'plan_pro' })
      await deliver({
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_active_123',
            customer: 'cus_tenant_abc',
            status: 'active',
            current_period_end: 1735689600,
            items: {
              data: [{ quantity: 1, price: { id: 'price_pro_month', recurring: { interval: 'month' } } }],
            },
          },
        },
      })

      expect(tenantUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ current_period_end: '2025-01-01T00:00:00.000Z' }),
      )
    })

    it('should take the period end from the latest billed item, not an unbilled one', async () => {
      const { tenantUpdate } = stubSubscriptionTables({ id: 'plan_pro' })
      await deliver({
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_active_123',
            customer: 'cus_tenant_abc',
            status: 'active',
            items: {
              data: [
                {
                  quantity: 0,
                  current_period_end: 1796932834,
                  price: { id: 'price_pro_year', recurring: { interval: 'year' } },
                },
                {
                  quantity: 1,
                  current_period_end: 1735689600,
                  price: { id: 'price_pro_month', recurring: { interval: 'month' } },
                },
              ],
            },
          },
        },
      })

      expect(tenantUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ current_period_end: '2025-01-01T00:00:00.000Z' }),
      )
    })

    it('should map the plan from a subscription carrying an unbilled first item', async () => {
      const { tenantUpdate, plansEq } = stubSubscriptionTables({ id: 'plan_pro' })
      await deliver({
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_active_123',
            customer: 'cus_tenant_abc',
            status: 'active',
            items: {
              data: [
                { quantity: 0, price: { id: 'price_pro_year', recurring: { interval: 'year' } } },
                { quantity: 1, price: { id: 'price_pro_month', recurring: { interval: 'month' } } },
              ],
            },
          },
        },
      })

      expect(plansEq).toHaveBeenCalledWith('stripe_price_id_monthly', 'price_pro_month')
      expect(plansEq).not.toHaveBeenCalledWith('stripe_price_id_monthly', 'price_pro_year')
      expect(tenantUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ plan_id: 'plan_pro', subscription_interval: 'month' }),
      )
    })

    it('should leave the stored period end untouched when the payload carries none', async () => {
      const { tenantUpdate } = stubSubscriptionTables({ id: 'plan_pro' })
      await deliver({
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_active_123',
            customer: 'cus_tenant_abc',
            status: 'active',
            items: {
              data: [{ quantity: 1, price: { id: 'price_pro_month', recurring: { interval: 'month' } } }],
            },
          },
        },
      })

      const updated = tenantUpdate.mock.calls[0]?.[0] as Record<string, unknown>
      expect(updated).not.toHaveProperty('current_period_end')
      expect(updated).toMatchObject({ subscription_status: 'active' })
    })

    it('should treat a price id with filter syntax as a literal and match no plan', async () => {
      const priceId = 'price_x,stripe_price_id_annual.not.is.null)'
      const payload = JSON.stringify({
        type: 'customer.subscription.updated',
        data: {
          object: {
            customer: 'cus_tenant_inject',
            status: 'active',
            items: { data: [{ price: { id: priceId, recurring: { interval: 'month' } } }] },
          },
        },
      })

      const sig = generateStripeSignature(payload, webhookSecret)
      const tenantUpdateMock = vi.fn().mockReturnThis()
      const plansEq = vi.fn()

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'plans') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: plansEq.mockImplementation(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          }
        }
        if (table === 'tenants') {
          return { update: tenantUpdateMock, eq: vi.fn().mockResolvedValue({ error: null }) }
        }
        return {}
      })

      const req = createMockReq({ method: 'POST', headers: { 'stripe-signature': sig }, body: payload })
      const res = createMockRes()
      await handleWebhook(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      // Both lookups pass the raw text as a value; neither can widen the filter.
      expect(plansEq).toHaveBeenCalledWith('stripe_price_id_monthly', priceId)
      expect(plansEq).toHaveBeenCalledWith('stripe_price_id_annual', priceId)
      const updated = tenantUpdateMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(updated).not.toHaveProperty('plan_id')
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
