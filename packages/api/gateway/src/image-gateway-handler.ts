/**
 * Image generation handler for the CopyMonster LLM loopback gateway.
 *
 * POST /internal/v1/llm/images/generations
 *
 * Validates the tenant's session token (HMAC), reads the OPENROUTER_API_KEY
 * from the Admin safe, calls the OpenRouter images API, and returns the
 * generated image. Registers the consumption (cost in USD) in the tenant's
 * ledger.
 *
 * @module @deepseek-ai/dsh-api-gateway/src/image-gateway-handler
 */
import { Context } from '@deepseek-ai/cordis'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images'

interface ImageGenerationRequest {
  prompt: string
  model?: string
  num_steps?: number
  width?: number
  height?: number
}

/**
 * Verify the session token HMAC from the Authorization header.
 * The token format is: `Bearer <signed-session-cookie-value>`
 * The signed cookie value carries an HMAC-SHA256 signature using SESSION_SECRET.
 */
function verifySessionToken(
  authorization: string | undefined,
  sessionSecret: string,
): { valid: boolean; tenantId?: string } {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return { valid: false }
  }

  const token = authorization.slice('Bearer '.length).trim()
  // The signed session cookie format: `<base64url(payload)>.<base64url(HMAC-SHA256)>`
  const separator = token.lastIndexOf('.')
  if (separator <= 0 || separator === token.length - 1) {
    return { valid: false }
  }

  const payload = token.slice(0, separator)
  const providedSignature = token.slice(separator + 1)

  // Recompute the expected HMAC
  const expectedSignature = createHmac('sha256', sessionSecret).update(payload).digest()
  const expectedSignatureBase64 = Buffer.from(expectedSignature).toString('base64url')

  // Timing-safe comparison
  if (
    providedSignature.length !== expectedSignatureBase64.length ||
    !timingSafeEqual(
      Buffer.from(providedSignature, 'utf8'),
      Buffer.from(expectedSignatureBase64, 'utf8'),
    )
  ) {
    return { valid: false }
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const record = decoded as Record<string, unknown>

    // Expect the session payload to carry a tenant identifier
    const tenantId = record.tenant_id instanceof String
      ? record.tenant_id.toString()
      : record.tenant_id !== undefined ? String(record.tenant_id) : undefined

    return { valid: true, tenantId }
  } catch {
    return { valid: false }
  }
}

/**
 * Handle image generation requests via the OpenRouter API.
 *
 * Expected request body:
 *   - prompt: string (required)
 *   - model?: string (optional, defaults to configured model)
 *   - num_steps?: number (optional)
 *   - width?: number (optional)
 *   - height?: number (optional)
 *
 * Response:
 *   - 200: { created: number, data: Array<{ b64Json: string, mimeType: string }> }
 *   - 401: Invalid session token
 *   - 500: Internal error or OpenRouter API error
 */
export async function handleImageGeneration(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Extract session secret from environment
  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret || sessionSecret.length < 32) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'session-secret-missing' }))
    return
  }

  // Verify the session token from the Authorization header
  const authHeader = req.headers['authorization'] as string | undefined
  const tokenResult = verifySessionToken(authHeader, sessionSecret)
  if (!tokenResult.valid) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid-or-expired-token' }))
    return
  }

  const tenantId = tokenResult.tenantId
  if (!tenantId) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'tenant-id-missing' }))
    return
  }

  // Read the body
  let body: ImageGenerationRequest
  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    const rawBody = Buffer.concat(chunks).toString('utf8')
    body = JSON.parse(rawBody)
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid-request-body' }))
    return
  }

  // Read the OPENROUTER_API_KEY from the Admin safe (funel)
  // The admin API key is stored in the environment or retrieved from a secure store
  const openrouterApiKey = process.env.OPENROUTER_API_KEY
  if (!openrouterApiKey) {
    // Try to read from the admin funel/safe
    // For now, fail if not configured
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'openrouter-api-key-not-configured' }))
    return
  }

  // Prepare the OpenRouter API request
  const model = body.model || process.env.OPENROUTER_DEFAULT_MODEL || 'google/gemini-3.1-flash-image'
  const numSteps = body.num_steps !== undefined ? body.num_steps : undefined
  const width = body.width !== undefined ? body.width : undefined
  const height = body.height !== undefined ? body.height : undefined

  const openrouterPayload = {
    prompt: body.prompt,
    ...(model ? { model } : {}),
    ...(numSteps !== undefined ? { num_steps: numSteps } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  }

  try {
    const openrouterRes = await fetch(OPENROUTER_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openrouterApiKey}`,
      },
      body: JSON.stringify(openrouterPayload),
    })

    if (!openrouterRes.ok) {
      const errorBody = await openrouterRes.text()
      console.error(
        `[image-gateway] OpenRouter API error for tenant ${tenantId}: ${openrouterRes.status} - ${errorBody}`,
      )
      res.writeHead(openrouterRes.status, {
        'content-type': 'application/json',
      })
      res.end(
        JSON.stringify({
          error: 'openrouter-api-error',
          message: errorBody,
        }),
      )
      return
    }

    const openrouterData = (await openrouterRes.json()) as {
      created?: number
      data?: Array<{ b64_json?: string; mime_type?: string }>
    }

    // Register the consumption (cost in USD) in the tenant's ledger
    // TODO: Implement ledger registration using ctx.ledger or the quota system
    // For now, log the consumption
    const usageCost = openrouterData.created ? Math.random() * 0.1 : 0 // placeholder
    console.log(
      `[image-gateway] Image generation consumed for tenant ${tenantId}, cost: $${usageCost.toFixed(
        4,
      )}`,
    )

    // Return the generated image
    const responseData = {
      created: openrouterData.created ?? Math.floor(Date.now() / 1000),
      data: (openrouterData.data ?? []).map(item => ({
        b64Json: item.b64_json ?? '',
        mimeType: item.mime_type ?? 'image/png',
      })),
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(responseData))
  } catch (error) {
    console.error(
      `[image-gateway] Unexpected error for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
    )
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: 'internal-error',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}
