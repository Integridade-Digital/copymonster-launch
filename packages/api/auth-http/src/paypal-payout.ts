/**
 * CopyMonster PayPal Payouts integration module.
 *
 * Implements PayPal Payouts REST API v1 with automatic support for PAYPAL_MOCK mode.
 * @module @deepseek-ai/dsh-api-auth-http/paypal-payout
 */

import crypto from 'node:crypto'

export interface PaypalPayoutItem {
  payoutId: string
  amount: number
  paypalEmail: string
  currency?: string
  note?: string
  emailSubject?: string
  emailMessage?: string
}

export interface PaypalPayoutResult {
  success: boolean
  batchId?: string
  status?: string
  error?: string
  raw?: unknown
}

export interface PaypalPayoutStatusResult {
  success: boolean
  status: string
  error?: string
  raw?: unknown
}

/** Check if mock mode is explicitly active */
export function isPaypalMock(): boolean {
  return process.env.PAYPAL_MOCK === 'true'
}

/** Resolve the PayPal API base URL based on mode */
export function getPaypalBaseUrl(): string {
  return process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
}

/**
 * Retrieve a PayPal OAuth2 access token.
 * In mock mode (PAYPAL_MOCK === 'true'), returns a simulated token immediately.
 */
export async function getPaypalAccessToken(): Promise<string> {
  if (isPaypalMock()) {
    return 'MOCK_TOKEN'
  }

  const clientId = process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials missing: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required when PAYPAL_MOCK is false')
  }

  const baseUrl = getPaypalBaseUrl()
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`PayPal OAuth failed (${res.status}): ${errorText}`)
  }

  const data = (await res.json()) as { access_token?: string }
  if (!data?.access_token) {
    throw new Error('PayPal OAuth response did not contain an access_token')
  }

  return data.access_token
}

/**
 * Create a PayPal payout batch.
 * In mock mode (PAYPAL_MOCK === 'true'), generates a mock batchId without network calls.
 */
export async function createPaypalPayout(payout: PaypalPayoutItem): Promise<PaypalPayoutResult> {
  if (isPaypalMock()) {
    const timestamp = Date.now()
    const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    const mockBatchId = `MOCK_${timestamp}_${uuid}`
    return {
      success: true,
      batchId: mockBatchId,
      status: 'PENDING',
      raw: { mock: true, sender_batch_id: payout.payoutId },
    }
  }

  try {
    const token = await getPaypalAccessToken()
    const baseUrl = getPaypalBaseUrl()

    const payload = {
      sender_batch_header: {
        sender_batch_id: payout.payoutId,
        email_subject: payout.emailSubject ?? 'CopyMonster - Saque de Afiliado Processado',
        email_message: payout.emailMessage ?? 'Seu pagamento de comissões do CopyMonster foi enviado com sucesso via PayPal.',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: {
            value: Number(payout.amount).toFixed(2),
            currency: payout.currency ?? 'USD',
          },
          receiver: payout.paypalEmail,
          note: payout.note ?? 'CopyMonster Affiliate Payout',
        },
      ],
    }

    const res = await fetch(`${baseUrl}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const json = (await res.json()) as Record<string, unknown>

    if (!res.ok) {
      const errorMsg = typeof json?.message === 'string'
        ? json.message
        : (typeof json?.name === 'string' ? json.name : `PayPal Payouts error (${res.status})`)
      return {
        success: false,
        error: errorMsg,
        raw: json,
      }
    }

    const batchHeader = (json?.batch_header as Record<string, unknown>) ?? {}
    const batchId = (batchHeader.payout_batch_id as string) ?? (batchHeader.sender_batch_id as string) ?? payout.payoutId
    const status = (batchHeader.batch_status as string) ?? 'PENDING'

    return {
      success: true,
      batchId,
      status,
      raw: json,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: msg,
    }
  }
}

/**
 * Retrieve the status of a PayPal payout batch.
 * In mock mode (PAYPAL_MOCK === 'true'), always returns 'SUCCESS'.
 */
export async function getPaypalPayoutStatus(batchId: string): Promise<PaypalPayoutStatusResult> {
  if (isPaypalMock()) {
    return {
      success: true,
      status: 'SUCCESS',
      raw: { mock: true, batchId },
    }
  }

  try {
    const token = await getPaypalAccessToken()
    const baseUrl = getPaypalBaseUrl()

    const res = await fetch(`${baseUrl}/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    const json = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      const errorMsg = typeof json?.message === 'string' ? json.message : `PayPal status error (${res.status})`
      return {
        success: false,
        status: 'UNKNOWN',
        error: errorMsg,
        raw: json,
      }
    }

    const batchHeader = (json?.batch_header as Record<string, unknown>) ?? {}
    const status = (batchHeader.batch_status as string) ?? 'UNKNOWN'

    return {
      success: true,
      status,
      raw: json,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      status: 'UNKNOWN',
      error: msg,
    }
  }
}
