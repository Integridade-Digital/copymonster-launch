/** Browser API client for the WhatsApp MCP settings card. */

import { z } from 'zod'

/** Status view returned by `/api/dsh-whatsapp-mcp/status`. */
const statusViewSchema = z.object({
  configured: z.boolean(),
  authorized: z.boolean(),
  tokenUpdatedAt: z.string(),
  clientIdMasked: z.string(),
  callbackUrl: z.string(),
  mcpUrl: z.string(),
  configPath: z.string(),
  connected: z.boolean(),
  toolCount: z.number(),
})

/** Status view returned by `/api/dsh-whatsapp-mcp/status`. */
export type WhatsAppStatusView = z.infer<typeof statusViewSchema>

/** Result of an OAuth start request. */
const oauthStartSchema = z.object({
  ok: z.boolean(),
  authorizeUrl: z.string().optional(),
  callbackUrl: z.string().optional(),
  error: z.string().optional(),
})

/** Result of an OAuth start request. */
export type WhatsAppOAuthStart = z.infer<typeof oauthStartSchema>

/** Result of an OAuth finish or refresh request. */
const actionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  view: statusViewSchema,
})

/** Result of an OAuth finish or refresh request. */
export type WhatsAppActionResult = z.infer<typeof actionResultSchema>

/** Result of a connection test. */
const testResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
  tools: z.array(z.string()).optional(),
  view: statusViewSchema,
})

/** Result of a connection test. */
export type WhatsAppTestResult = z.infer<typeof testResultSchema>

/** Result of clearing credentials. */
const clearResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  view: statusViewSchema,
})

/** Result of clearing credentials. */
export type WhatsAppClearResult = z.infer<typeof clearResultSchema>

/** Error carrying the route's JSON error message. */
export class WhatsAppMcpApiError extends Error {
  /** @param message - route error text. */
  constructor(message: string) {
    super(message)
    this.name = 'WhatsAppMcpApiError'
  }
}

/** Plain fetch helper with an error wrapper and response validation. */
async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    throw new WhatsAppMcpApiError('Network request failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new WhatsAppMcpApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null && typeof Reflect.get(body, 'error') === 'string'
      ? String(Reflect.get(body, 'error'))
      : `HTTP ${response.status}`
    throw new WhatsAppMcpApiError(detail)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new WhatsAppMcpApiError(`HTTP ${response.status}: unexpected response`)
  return parsed.data
}

/** The WhatsApp MCP card API. */
export class WhatsAppMcpApi {
  /**
   * Read the current connection status.
   * @returns the current status view.
   */
  async status(): Promise<WhatsAppStatusView> {
    return await request('/api/dsh-whatsapp-mcp/status', statusViewSchema)
  }

  /**
   * Start an OAuth authorization flow.
   * @returns the authorization URL and its callback URL.
   */
  async oauthStart(): Promise<WhatsAppOAuthStart> {
    return await request('/api/dsh-whatsapp-mcp/oauth/start', oauthStartSchema, { method: 'POST' })
  }

  /**
   * Finish an OAuth flow with a pasted code or callback URL.
   * @param code - authorization code.
   * @param redirectUrl - optional full callback URL.
   * @returns the completion outcome and refreshed view.
   */
  async oauthFinish(code: string, redirectUrl: string): Promise<WhatsAppActionResult> {
    return await request('/api/dsh-whatsapp-mcp/oauth/finish', actionResultSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUrl }),
    })
  }

  /**
   * Refresh the stored token.
   * @returns the refresh outcome and refreshed view.
   */
  async oauthRefresh(): Promise<WhatsAppActionResult> {
    return await request('/api/dsh-whatsapp-mcp/oauth/refresh', actionResultSchema, { method: 'POST' })
  }

  /**
   * Test the MCP connection and list tools.
   * @returns the test outcome and discovered tools.
   */
  async test(): Promise<WhatsAppTestResult> {
    return await request('/api/dsh-whatsapp-mcp/test', testResultSchema, { method: 'POST' })
  }

  /**
   * Clear every credential.
   * @returns the clear outcome and refreshed view.
   */
  async clear(): Promise<WhatsAppClearResult> {
    return await request('/api/dsh-whatsapp-mcp/clear', clearResultSchema, { method: 'POST' })
  }
}
