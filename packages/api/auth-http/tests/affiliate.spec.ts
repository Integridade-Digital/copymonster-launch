import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context/types'
import {
  processAffiliateCommissionFromInvoice,
  processAffiliateRefundFromCharge,
  extractAffiliateIdFromInvoice,
  getTable,
} from '../src/affiliate-processor.ts'
import {
  handleCheckout,
  handleWebhook,
} from '../src/billing.ts'

// Mock Supabase admin client
const mockSupabase = vi.hoisted(() => {
  return {
    from: vi.fn(),
    schema: vi.fn(),
  }
})

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: mockSupabase,
  hasSupabaseAdminClient: () => true,
}))

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

function identity(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    userId: 'user-affiliate-1',
    tenantId: 'tenant-affiliate-1',
    role: 'owner',
    email: 'affiliate@copymonster.ai',
    ...overrides,
  }
}

function generateStripeSignature(payload: string | Buffer, secret: string, timestamp?: number): string {
  const t = timestamp ?? Math.floor(Date.now() / 1000)
  const body = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${sig}`
}

describe('Affiliate Processor & Billing Integration', () => {
  const testAffiliateId = '550e8400-e29b-41d4-a716-446655440000'
  const testInvoiceId = 'in_test_invoice_12345'
  const testEventId = 'evt_test_event_98765'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractAffiliateIdFromInvoice', () => {
    it('returns undefined if no metadata is present', () => {
      expect(extractAffiliateIdFromInvoice({})).toBeUndefined()
      expect(extractAffiliateIdFromInvoice({ metadata: {} })).toBeUndefined()
    })

    it('extracts affiliate_id from root metadata', () => {
      const invoice = {
        metadata: {
          affiliate_id: testAffiliateId,
        },
      }
      expect(extractAffiliateIdFromInvoice(invoice)).toBe(testAffiliateId)
    })

    it('extracts affiliateId from line items metadata', () => {
      const invoice = {
        lines: {
          data: [
            {
              metadata: {
                affiliate_id: testAffiliateId,
              },
            },
          ],
        },
      }
      expect(extractAffiliateIdFromInvoice(invoice)).toBe(testAffiliateId)
    })

    it('rejects invalid non-UUID strings', () => {
      const invoice = {
        metadata: {
          affiliate_id: 'not-a-valid-uuid',
        },
      }
      expect(extractAffiliateIdFromInvoice(invoice)).toBeUndefined()
    })
  })

  describe('processAffiliateCommissionFromInvoice', () => {
    it('ignores invoices without affiliate metadata', async () => {
      const result = await processAffiliateCommissionFromInvoice({}, 'evt_none', mockSupabase)
      expect(result).toEqual({ status: 'ignored_no_affiliate' })
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('returns already_processed_event when stripe_event_id is duplicate', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'comm_existing_1' },
              error: null,
            }),
          }
        }
        return {}
      })

      const invoice = {
        id: testInvoiceId,
        metadata: { affiliate_id: testAffiliateId },
      }

      const result = await processAffiliateCommissionFromInvoice(invoice, testEventId, mockSupabase)
      expect(result).toEqual({ status: 'already_processed_event', commissionId: 'comm_existing_1' })
    })

    it('returns already_processed_invoice when stripe_invoice_id is duplicate', async () => {
      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((field: string) => {
              callCount++
              return {
                maybeSingle: vi.fn().mockResolvedValue({
                  data: field === 'stripe_invoice_id' ? { id: 'comm_existing_inv' } : null,
                  error: null,
                }),
              }
            }),
          }
        }
        return {}
      })

      const invoice = {
        id: testInvoiceId,
        metadata: { affiliate_id: testAffiliateId },
      }

      const result = await processAffiliateCommissionFromInvoice(invoice, testEventId, mockSupabase)
      expect(result).toEqual({ status: 'already_processed_invoice', commissionId: 'comm_existing_inv' })
    })

    it('rejects unauthorized affiliate if profile is missing or not KYC approved and records audit log', async () => {
      const auditInsertMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }
        }
        if (table === 'affiliate.profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              // Partner exists but KYC is PENDING
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: testAffiliateId, active: true, kyc_status: 'PENDING' },
                error: null,
              }),
            }),
          }
        }
        if (table === 'affiliate.audit_logs') {
          return { insert: auditInsertMock }
        }
        return {}
      })

      const invoice = {
        id: testInvoiceId,
        amount_paid: 10000,
        metadata: { affiliate_id: testAffiliateId },
      }

      const result = await processAffiliateCommissionFromInvoice(invoice, testEventId, mockSupabase)
      expect(result).toEqual({ status: 'rejected_unauthorized' })
      expect(auditInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMMISSION_REJECTED_UNAUTHORIZED',
          target_type: 'affiliate_profile',
          target_id: testAffiliateId,
          reason: 'KYC status: PENDING',
        }),
      )
    })

    it('calculates commission correctly (30%) and inserts into HOLDING with 35 days retention', async () => {
      const commissionInsertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'comm_new_123' }, error: null }),
        }),
      })
      const notificationInsertMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
            insert: commissionInsertMock,
          }
        }
        if (table === 'affiliate.profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: testAffiliateId, active: true, kyc_status: 'APPROVED' },
                error: null,
              }),
            }),
          }
        }
        if (table === 'affiliate.commission_rules') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { percentage: 30.0, retention_days: 35 },
              error: null,
            }),
          }
        }
        if (table === 'affiliate.notifications') {
          return { insert: notificationInsertMock }
        }
        return {}
      })

      const beforeTime = Date.now()
      const invoice = {
        id: testInvoiceId,
        amount_paid: 10000, // $100.00 USD
        metadata: { affiliate_id: testAffiliateId },
      }

      const result = await processAffiliateCommissionFromInvoice(invoice, testEventId, mockSupabase)
      expect(result).toEqual({ status: 'commission_created', commissionId: 'comm_new_123' })

      // Verify commission insertion
      expect(commissionInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          affiliate_id: testAffiliateId,
          stripe_event_id: testEventId,
          stripe_invoice_id: testInvoiceId,
          amount_gross: 100.0,
          commission_amount: 30.0,
          status: 'HOLDING',
        }),
      )

      const insertedArgs = commissionInsertMock.mock.calls[0]?.[0] as Record<string, unknown>
      const eligibleAtMs = new Date(insertedArgs['eligible_at'] as string).getTime()
      const expectedDaysMs = 35 * 24 * 60 * 60 * 1000
      expect(eligibleAtMs).toBeGreaterThanOrEqual(beforeTime + expectedDaysMs - 1000)
      expect(eligibleAtMs).toBeLessThanOrEqual(beforeTime + expectedDaysMs + 5000)

      // Verify notification
      expect(notificationInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          affiliate_id: testAffiliateId,
          type: 'COMMISSION_EARNED',
          title: 'New commission registered!',
          message: expect.stringContaining('$30.00 USD'),
        }),
      )
    })
  })

  describe('processAffiliateRefundFromCharge', () => {
    it('ignores charge if invoice ID is missing', async () => {
      const result = await processAffiliateRefundFromCharge({}, mockSupabase)
      expect(result).toEqual({ status: 'ignored_no_invoice' })
    })

    it('returns commission_not_found if no commission is linked to invoice', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }
        }
        return {}
      })

      const charge = { invoice: testInvoiceId }
      const result = await processAffiliateRefundFromCharge(charge, mockSupabase)
      expect(result).toEqual({ status: 'commission_not_found' })
    })

    it('returns already_refunded if commission status is already REFUNDED', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'comm_ref_1', status: 'REFUNDED', commission_amount: 30.0 },
                error: null,
              }),
            }),
          }
        }
        return {}
      })

      const charge = { invoice: testInvoiceId }
      const result = await processAffiliateRefundFromCharge(charge, mockSupabase)
      expect(result).toEqual({ status: 'already_refunded', commissionId: 'comm_ref_1' })
    })

    it('refunds HOLDING commission without inserting ledger entry', async () => {
      const commissionUpdateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      const ledgerInsertMock = vi.fn()
      const notificationInsertMock = vi.fn().mockResolvedValue({ error: null })
      const auditInsertMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'comm_holding_1', affiliate_id: testAffiliateId, status: 'HOLDING', commission_amount: 30.0 },
                error: null,
              }),
            }),
            update: commissionUpdateMock,
          }
        }
        if (table === 'finance.ledger_entries') {
          return { insert: ledgerInsertMock }
        }
        if (table === 'affiliate.notifications') {
          return { insert: notificationInsertMock }
        }
        if (table === 'affiliate.audit_logs') {
          return { insert: auditInsertMock }
        }
        return {}
      })

      const charge = { id: 'ch_test_1', invoice: testInvoiceId }
      const result = await processAffiliateRefundFromCharge(charge, mockSupabase)

      expect(result).toEqual({ status: 'commission_refunded', commissionId: 'comm_holding_1' })
      expect(commissionUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'REFUNDED' }),
      )
      // Since it was in HOLDING, ledger entries must NOT be touched
      expect(ledgerInsertMock).not.toHaveBeenCalled()
      // Notification and audit log must be registered
      expect(notificationInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'COMMISSION_REFUNDED',
          affiliate_id: testAffiliateId,
        }),
      )
      expect(auditInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMMISSION_REFUNDED',
          target_id: 'comm_holding_1',
        }),
      )
    })

    it('refunds ELIGIBLE commission and creates compensatory DEBIT entry in finance.ledger_entries', async () => {
      const commissionUpdateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      const ledgerInsertMock = vi.fn().mockResolvedValue({ error: null })
      const notificationInsertMock = vi.fn().mockResolvedValue({ error: null })
      const auditInsertMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'comm_eligible_1', affiliate_id: testAffiliateId, status: 'ELIGIBLE', commission_amount: 45.0 },
                error: null,
              }),
            }),
            update: commissionUpdateMock,
          }
        }
        if (table === 'finance.ledger_entries') {
          return { insert: ledgerInsertMock }
        }
        if (table === 'affiliate.notifications') {
          return { insert: notificationInsertMock }
        }
        if (table === 'affiliate.audit_logs') {
          return { insert: auditInsertMock }
        }
        return {}
      })

      const charge = { id: 'ch_test_2', invoice: testInvoiceId }
      const result = await processAffiliateRefundFromCharge(charge, mockSupabase)

      expect(result).toEqual({ status: 'commission_refunded', commissionId: 'comm_eligible_1' })
      // Since it was ELIGIBLE, compensatory DEBIT must be inserted
      expect(ledgerInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          affiliate_id: testAffiliateId,
          amount: 45.0,
          entry_type: 'DEBIT',
          reference_type: 'REFUND',
          reference_id: 'comm_eligible_1',
          active: true,
        }),
      )
      expect(commissionUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'REFUNDED' }),
      )
    })
  })

  describe('Integration: Checkout with affiliateId & Webhook', () => {
    const webhookSecret = 'whsec_affiliate_integration_secret'
    let mockContext: Context

    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_secret_key'
      process.env.STRIPE_WEBHOOK_SECRET = webhookSecret
      const resolveIdentity = vi.fn().mockResolvedValue(identity())
      mockContext = { auth: { resolveIdentity } } as unknown as Context
    })

    it('injects metadata[affiliate_id] and subscription_data[metadata][affiliate_id] into Stripe checkout session', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'tenant-affiliate-1', stripe_customer_id: 'cus_affiliate_123', plan_id: 'plan_pro' },
              error: null,
            }),
          }
        }
        if (table === 'plans') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { stripe_price_id: 'price_pro_monthly' },
              error: null,
            }),
          }
        }
        return {}
      })

      const fetchCalls: Array<{ url: string; body: string }> = []
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
        fetchCalls.push({ url, body: init?.body ?? '' })
        if (url.endsWith('/checkout/sessions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'cs_affiliate_session_123',
              url: 'https://checkout.stripe.com/pay/cs_affiliate_session_123',
            }),
          } as Response
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response
      })

      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify({
          affiliateId: testAffiliateId,
        }),
      })
      const res = createMockRes()

      await handleCheckout(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()?.sessionId).toBe('cs_affiliate_session_123')

      const sessionCall = fetchCalls.find(c => c.url.includes('/checkout/sessions'))
      expect(sessionCall).toBeDefined()
      expect(sessionCall?.body).toContain(`metadata%5Baffiliate_id%5D=${encodeURIComponent(testAffiliateId)}`)
      expect(sessionCall?.body).toContain(`subscription_data%5Bmetadata%5D%5Baffiliate_id%5D=${encodeURIComponent(testAffiliateId)}`)
    })

    it('rejects invalid affiliateId in handleCheckout with 400', async () => {
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid_token' },
        body: JSON.stringify({
          affiliateId: 'not-a-uuid-string',
        }),
      })
      const res = createMockRes()

      await handleCheckout(mockContext, req, res)

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({
        error: 'invalid_affiliate_id',
        message: 'affiliateId must be a valid UUID',
      })
    })

    it('processes invoice.paid webhook event and creates HOLDING commission for approved affiliate', async () => {
      const commissionInsertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'comm_from_webhook' }, error: null }),
        }),
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
            insert: commissionInsertMock,
          }
        }
        if (table === 'affiliate.profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: testAffiliateId, active: true, kyc_status: 'APPROVED' },
                error: null,
              }),
            }),
          }
        }
        if (table === 'affiliate.commission_rules') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { percentage: 30.0, retention_days: 35 },
              error: null,
            }),
          }
        }
        if (table === 'affiliate.notifications') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        return {}
      })

      const payload = JSON.stringify({
        id: testEventId,
        type: 'invoice.paid',
        data: {
          object: {
            id: testInvoiceId,
            customer: 'cus_tenant_affiliate',
            amount_paid: 20000, // $200.00 USD
            metadata: {
              affiliate_id: testAffiliateId,
            },
          },
        },
      })

      const sig = generateStripeSignature(payload, webhookSecret)
      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': sig },
        body: payload,
      })
      const res = createMockRes()

      await handleWebhook(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })

      expect(commissionInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          affiliate_id: testAffiliateId,
          stripe_event_id: testEventId,
          stripe_invoice_id: testInvoiceId,
          amount_gross: 200.0,
          commission_amount: 60.0,
          status: 'HOLDING',
        }),
      )
    })

    it('processes charge.refunded webhook event and cancels commission', async () => {
      const commissionUpdateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'affiliate.commissions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'comm_to_refund', affiliate_id: testAffiliateId, status: 'HOLDING', commission_amount: 60.0 },
                error: null,
              }),
            }),
            update: commissionUpdateMock,
          }
        }
        if (table === 'affiliate.notifications' || table === 'affiliate.audit_logs') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        return {}
      })

      const payload = JSON.stringify({
        id: 'evt_refund_123',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_refund_123',
            invoice: testInvoiceId,
          },
        },
      })

      const sig = generateStripeSignature(payload, webhookSecret)
      const req = createMockReq({
        method: 'POST',
        headers: { 'stripe-signature': sig },
        body: payload,
      })
      const res = createMockRes()

      await handleWebhook(mockContext, req, res)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })
      expect(commissionUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'REFUNDED' }),
      )
    })
  })
})
