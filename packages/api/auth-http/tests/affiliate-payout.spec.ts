import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context/types'

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

import {
  isPaypalMock,
  getPaypalBaseUrl,
  getPaypalAccessToken,
  createPaypalPayout,
  getPaypalPayoutStatus,
} from '../src/paypal-payout.ts'

import {
  getAffiliateBalance,
  requestAffiliatePayout,
  executePayout,
  handleRequestAffiliatePayout,
  handleAdminExecutePayout,
} from '../src/payout-executor.ts'

function createMockReq(options: {
  method?: string
  headers?: Record<string, string | undefined>
  body?: string | Buffer | Record<string, unknown>
}): IncomingMessage {
  const chunks: Buffer[] = []
  if (options.body) {
    const raw = typeof options.body === 'string'
      ? options.body
      : Buffer.isBuffer(options.body)
        ? options.body
        : JSON.stringify(options.body)
    chunks.push(Buffer.from(raw))
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

describe('PayPal Payouts Module (paypal-payout.ts)', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('detects PAYPAL_MOCK environment variable', () => {
    process.env.PAYPAL_MOCK = 'true'
    expect(isPaypalMock()).toBe(true)

    process.env.PAYPAL_MOCK = 'false'
    expect(isPaypalMock()).toBe(false)

    delete process.env.PAYPAL_MOCK
    expect(isPaypalMock()).toBe(false)
  })

  it('resolves sandbox vs live PayPal base URL', () => {
    process.env.PAYPAL_MODE = 'sandbox'
    expect(getPaypalBaseUrl()).toBe('https://api-m.sandbox.paypal.com')

    process.env.PAYPAL_MODE = 'live'
    expect(getPaypalBaseUrl()).toBe('https://api-m.paypal.com')
  })

  it('returns MOCK_TOKEN in mock mode without network calls', async () => {
    process.env.PAYPAL_MOCK = 'true'
    const token = await getPaypalAccessToken()
    expect(token).toBe('MOCK_TOKEN')
  })

  it('throws in non-mock mode if PayPal credentials are missing', async () => {
    process.env.PAYPAL_MOCK = 'false'
    delete process.env.PAYPAL_CLIENT_ID
    delete process.env.PAYPAL_CLIENT_SECRET
    await expect(getPaypalAccessToken()).rejects.toThrow('PayPal credentials missing')
  })

  it('creates simulated payout with MOCK_<timestamp>_<uuid> in mock mode', async () => {
    process.env.PAYPAL_MOCK = 'true'
    const res = await createPaypalPayout({
      payoutId: 'payout-12345',
      amount: 150.00,
      paypalEmail: 'affiliate@example.com',
    })

    expect(res.success).toBe(true)
    expect(res.status).toBe('PENDING')
    expect(res.batchId).toMatch(/^MOCK_\d+_[a-z0-9]+$/i)
  })

  it('returns SUCCESS status for any batch in mock mode', async () => {
    process.env.PAYPAL_MOCK = 'true'
    const res = await getPaypalPayoutStatus('MOCK_1700000000_abcdef')
    expect(res.success).toBe(true)
    expect(res.status).toBe('SUCCESS')
  })
})

describe('Payout Executor & Affiliate Payout Lifecycle', () => {
  const originalEnv = { ...process.env }
  const testAffiliateId = 'aff-uuid-1111-2222-3333'
  const testUserId = 'user-uuid-9999'
  const testPayoutId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, PAYPAL_MOCK: 'true' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getAffiliateBalance', () => {
    it('calculates credit, debit, and available balance correctly', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation(function (this: any, col: string, val: unknown) {
          return this
        }),
      }

      const mockEntries = [
        { amount: '100.00', entry_type: 'CREDIT' },
        { amount: '50.50', entry_type: 'CREDIT' },
        { amount: '30.00', entry_type: 'DEBIT' },
      ]

      const fakeClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: mockEntries, error: null }),
              }),
            }),
          }),
        }),
      }

      const balance = await getAffiliateBalance(testAffiliateId, fakeClient)
      expect(balance.credit).toBe(150.50)
      expect(balance.debit).toBe(30.00)
      expect(balance.available).toBe(120.50)
    })
  })

  describe('requestAffiliatePayout', () => {
    it('refuses payout if KYC is not approved', async () => {
      const fakeClient = {
        schema: vi.fn().mockImplementation((schemaName: string) => ({
          from: vi.fn().mockImplementation((tableName: string) => {
            if (schemaName === 'affiliate' && tableName === 'profiles') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: testAffiliateId,
                          user_id: testUserId,
                          kyc_status: 'PENDING',
                          paypal_email: 'partner@example.com',
                        },
                      }),
                    }),
                  }),
                }),
              }
            }
            return {}
          }),
        })),
      }

      const res = await requestAffiliatePayout({
        userId: testUserId,
        amount: 100,
        client: fakeClient,
      })

      expect(res.success).toBe(false)
      expect(res.error).toBe('kyc_not_approved')
    })

    it('refuses payout if amount is below minimum ($50)', async () => {
      const fakeClient = {
        schema: vi.fn().mockImplementation((schemaName: string) => ({
          from: vi.fn().mockImplementation((tableName: string) => {
            if (schemaName === 'affiliate' && tableName === 'profiles') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: testAffiliateId,
                          user_id: testUserId,
                          kyc_status: 'APPROVED',
                          paypal_email: 'partner@example.com',
                        },
                      }),
                    }),
                  }),
                }),
              }
            }
            if (schemaName === 'affiliate' && tableName === 'commission_rules') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { min_payout_amount: 50.0 },
                      }),
                    }),
                  }),
                }),
              }
            }
            return {}
          }),
        })),
      }

      const res = await requestAffiliatePayout({
        userId: testUserId,
        amount: 25.0, // Below $50
        client: fakeClient,
      })

      expect(res.success).toBe(false)
      expect(res.error).toBe('amount_below_minimum')
      expect(res.minAmount).toBe(50.0)
    })

    it('refuses payout if another payout request is already in progress', async () => {
      const fakeClient = {
        schema: vi.fn().mockImplementation((schemaName: string) => ({
          from: vi.fn().mockImplementation((tableName: string) => {
            if (schemaName === 'affiliate' && tableName === 'profiles') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: testAffiliateId,
                          user_id: testUserId,
                          kyc_status: 'APPROVED',
                          paypal_email: 'partner@example.com',
                        },
                      }),
                    }),
                  }),
                }),
              }
            }
            if (schemaName === 'affiliate' && tableName === 'commission_rules') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { min_payout_amount: 50.0 },
                      }),
                    }),
                  }),
                }),
              }
            }
            if (schemaName === 'finance' && tableName === 'payout_requests') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      in: vi.fn().mockResolvedValue({
                        data: [{ id: 'existing-payout-id', status: 'REQUESTED' }],
                      }),
                    }),
                  }),
                }),
              }
            }
            return {}
          }),
        })),
      }

      const res = await requestAffiliatePayout({
        userId: testUserId,
        amount: 60.0,
        client: fakeClient,
      })

      expect(res.success).toBe(false)
      expect(res.error).toBe('payout_already_in_progress')
      expect(res.existingPayoutId).toBe('existing-payout-id')
    })

    it('refuses payout if requested amount exceeds available balance', async () => {
      const fakeClient = {
        schema: vi.fn().mockImplementation((schemaName: string) => ({
          from: vi.fn().mockImplementation((tableName: string) => {
            if (schemaName === 'affiliate' && tableName === 'profiles') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: testAffiliateId,
                          user_id: testUserId,
                          kyc_status: 'APPROVED',
                          paypal_email: 'partner@example.com',
                        },
                      }),
                    }),
                  }),
                }),
              }
            }
            if (schemaName === 'affiliate' && tableName === 'commission_rules') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { min_payout_amount: 50.0 },
                      }),
                    }),
                  }),
                }),
              }
            }
            if (schemaName === 'finance' && tableName === 'payout_requests') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      in: vi.fn().mockResolvedValue({ data: [] }),
                    }),
                  }),
                }),
              }
            }
            if (schemaName === 'finance' && tableName === 'ledger_entries') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({
                      data: [
                        { amount: '40.00', entry_type: 'CREDIT' }, // Only $40 available
                      ],
                    }),
                  }),
                }),
              }
            }
            return {}
          }),
        })),
      }

      const res = await requestAffiliatePayout({
        userId: testUserId,
        amount: 80.0,
        client: fakeClient,
      })

      expect(res.success).toBe(false)
      expect(res.error).toBe('insufficient_balance')
      expect(res.available).toBe(40.0)
    })

    it('successfully creates payout request in REQUESTED status and notifies affiliate', async () => {
      const insertPayoutMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: testPayoutId,
              affiliate_id: testAffiliateId,
              amount: 100.00,
              paypal_email_snapshot: 'partner@example.com',
              status: 'REQUESTED',
            },
            error: null,
          }),
        }),
      })

      const insertNotificationMock = vi.fn().mockResolvedValue({ data: {}, error: null })

      const fakeClient = {
        schema: vi.fn().mockImplementation((schemaName: string) => ({
          from: vi.fn().mockImplementation((tableName: string) => {
            if (schemaName === 'affiliate' && tableName === 'profiles') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: testAffiliateId,
                          user_id: testUserId,
                          kyc_status: 'APPROVED',
                          paypal_email: 'partner@example.com',
                        },
                      }),
                    }),
                  }),
                }),
              }
            }
            if (schemaName === 'affiliate' && tableName === 'commission_rules') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { min_payout_amount: 50.0 },
                      }),
                    }),
                  }),
                }),
              }
            }
            if (schemaName === 'finance' && tableName === 'payout_requests') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      in: vi.fn().mockResolvedValue({ data: [] }),
                    }),
                  }),
                }),
                insert: insertPayoutMock,
              }
            }
            if (schemaName === 'finance' && tableName === 'ledger_entries') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({
                      data: [{ amount: '200.00', entry_type: 'CREDIT' }],
                    }),
                  }),
                }),
              }
            }
            if (schemaName === 'affiliate' && tableName === 'notifications') {
              return {
                insert: insertNotificationMock,
              }
            }
            return {}
          }),
        })),
      }

      const res = await requestAffiliatePayout({
        userId: testUserId,
        amount: 100.0,
        client: fakeClient,
      })

      expect(res.success).toBe(true)
      expect(res.payout?.id).toBe(testPayoutId)
      expect(res.payout?.status).toBe('REQUESTED')
      expect(insertNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          affiliate_id: testAffiliateId,
          type: 'PAYOUT_REQUESTED',
        }),
      )
    })
  })

  describe('executePayout', () => {
    it('executes payout with PAYPAL_MOCK=true, updates status to EXECUTED and registers DEBIT ledger entry', async () => {
      const updateLockMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: testPayoutId,
                  affiliate_id: testAffiliateId,
                  amount: 120.00,
                  paypal_email_snapshot: 'partner@example.com',
                  status: 'PROCESSING',
                },
                error: null,
              }),
            }),
          }),
        }),
      })

      const updateFinalMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
      })

      const insertLedgerMock = vi.fn().mockResolvedValue({ data: {}, error: null })
      const insertNotificationMock = vi.fn().mockResolvedValue({ data: {}, error: null })
      const insertAuditMock = vi.fn().mockResolvedValue({ data: {}, error: null })

      let updateCalls = 0
      const fakeClient = {
        schema: vi.fn().mockImplementation((schemaName: string) => ({
          from: vi.fn().mockImplementation((tableName: string) => {
            if (schemaName === 'finance' && tableName === 'payout_requests') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: testPayoutId,
                          affiliate_id: testAffiliateId,
                          amount: 120.00,
                          paypal_email_snapshot: 'partner@example.com',
                          status: 'REQUESTED',
                          active: true,
                        },
                      }),
                    }),
                  }),
                }),
                update: vi.fn().mockImplementation((payload) => {
                  updateCalls++
                  if (updateCalls === 1) {
                    return updateLockMock()
                  }
                  return updateFinalMock()
                }),
              }
            }
            if (schemaName === 'finance' && tableName === 'ledger_entries') {
              return {
                insert: insertLedgerMock,
              }
            }
            if (schemaName === 'affiliate' && tableName === 'notifications') {
              return {
                insert: insertNotificationMock,
              }
            }
            if (schemaName === 'affiliate' && tableName === 'audit_logs') {
              return {
                insert: insertAuditMock,
              }
            }
            return {}
          }),
        })),
      }

      const res = await executePayout(testPayoutId, {
        adminUserId: 'admin-user-007',
        client: fakeClient,
      })

      expect(res.success).toBe(true)
      expect(res.status).toBe('EXECUTED')
      expect(res.batchId).toMatch(/^MOCK_\d+_[a-z0-9]+$/i)

      // Ledger DEBIT must be inserted with reference_type = 'PAYOUT'
      expect(insertLedgerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          affiliate_id: testAffiliateId,
          amount: 120.00,
          entry_type: 'DEBIT',
          reference_type: 'PAYOUT',
          reference_id: testPayoutId,
        }),
      )

      // Audit log must record PAYOUT_EXECUTED
      expect(insertAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PAYOUT_EXECUTED',
          target_type: 'payout_request',
          target_id: testPayoutId,
          admin_user_id: 'admin-user-007',
        }),
      )
    })

    it('enforces idempotency: cannot execute a payout that is already EXECUTED', async () => {
      const fakeClient = {
        schema: vi.fn().mockImplementation((schemaName: string) => ({
          from: vi.fn().mockImplementation((tableName: string) => {
            if (schemaName === 'finance' && tableName === 'payout_requests') {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: testPayoutId,
                          affiliate_id: testAffiliateId,
                          amount: 100.00,
                          status: 'EXECUTED', // Already executed
                          active: true,
                        },
                      }),
                    }),
                  }),
                }),
              }
            }
            return {}
          }),
        })),
      }

      const res = await executePayout(testPayoutId, { client: fakeClient })
      expect(res.success).toBe(false)
      expect(res.error).toBe('payout_not_eligible_status_executed')
    })
  })

  describe('HTTP Handlers', () => {
    it('handleRequestAffiliatePayout rejects unauthenticated request (401)', async () => {
      const req = createMockReq({ method: 'POST', body: { amount: 100 } })
      const res = createMockRes()
      const ctx = {
        auth: {
          resolveIdentity: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as Context

      await handleRequestAffiliatePayout(ctx, req, res)
      expect(res.statusCode).toBe(401)
    })

    it('handleAdminExecutePayout rejects non-admin users (403)', async () => {
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-user-token' },
        body: { payoutId: testPayoutId },
      })
      const res = createMockRes()
      const ctx = {
        auth: {
          resolveIdentity: vi.fn().mockResolvedValue(
            identity({ role: 'member', isAdmin: false }),
          ),
        },
      } as unknown as Context

      await handleAdminExecutePayout(ctx, req, res)
      expect(res.statusCode).toBe(403)
      expect(res.json()?.error).toBe('forbidden')
    })

    it('handleAdminExecutePayout allows operator (owner/admin) to trigger executePayout', async () => {
      const req = createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer admin-token' },
        body: { payoutId: testPayoutId },
      })
      const res = createMockRes()
      const ctx = {
        auth: {
          resolveIdentity: vi.fn().mockResolvedValue(
            identity({ role: 'admin', isAdmin: true }),
          ),
        },
      } as unknown as Context

      // Setup mock Supabase for executePayout
      let updateCount = 0
      mockSupabase.schema.mockImplementation((schemaName: string) => ({
        from: vi.fn().mockImplementation((tableName: string) => {
          if (schemaName === 'finance' && tableName === 'payout_requests') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: testPayoutId,
                        affiliate_id: testAffiliateId,
                        amount: 150.00,
                        paypal_email_snapshot: 'partner@example.com',
                        status: 'APPROVED',
                        active: true,
                      },
                    }),
                  }),
                }),
              }),
              update: vi.fn().mockImplementation(() => {
                updateCount++
                if (updateCount === 1) {
                  return {
                    eq: vi.fn().mockReturnValue({
                      in: vi.fn().mockReturnValue({
                        select: vi.fn().mockReturnValue({
                          maybeSingle: vi.fn().mockResolvedValue({
                            data: {
                              id: testPayoutId,
                              affiliate_id: testAffiliateId,
                              amount: 150.00,
                              status: 'PROCESSING',
                            },
                          }),
                        }),
                      }),
                    }),
                  }
                }
                return {
                  eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
                }
              }),
            }
          }
          if (schemaName === 'finance' && tableName === 'ledger_entries') {
            return {
              insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
            }
          }
          if (schemaName === 'affiliate' && tableName === 'notifications') {
            return {
              insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
            }
          }
          if (schemaName === 'affiliate' && tableName === 'audit_logs') {
            return {
              insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
            }
          }
          return {}
        }),
      }))

      await handleAdminExecutePayout(ctx, req, res)
      expect(res.statusCode).toBe(200)
      const data = res.json()
      expect(data?.success).toBe(true)
      expect(data?.status).toBe('EXECUTED')
      expect(data?.batchId).toMatch(/^MOCK_/)
    })
  })
})
