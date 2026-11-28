/**
 * Gateway loopback server for the CopyMonster LLM loopback.
 *
 * Listens on 127.0.0.1:4010 and handles LLM and image generation requests.
 * Validates session tokens and forwards to the appropriate handlers.
 *
 * @module @deepseek-ai/dsh-api-gateway/src/gateway-server
 */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { verifySessionCookie } from './src/auth-http/session-token.ts'
import { handleImageGeneration } from './src/image-gateway-handler.ts'
import { type Context } from '@deepseek-ai/cordis'

const GATEWAY_HOST = '127.0.0.1'
const GATEWAY_PORT = 4010

/**
 * Create the gateway HTTP server.
 * @param ctx - the Cordis context containing services and configuration.
 * @returns the HTTP server instance.
 */
export function createGatewayServer(ctx: Context): Server {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://' + GATEWAY_HOST)

    // Only accept requests to the loopback gateway
    if (url.hostname !== GATEWAY_HOST || url.port !== String(GATEWAY_PORT)) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    try {
      // Handle different routes
      if (req.method === 'POST' && url.pathname === '/internal/v1/llm/chat/completions') {
        await handleChatCompletion(req, res, ctx)
      } else if (
        req.method === 'POST' &&
        url.pathname === '/internal/v1/llm/images/generations'
      ) {
        await handleImageGeneration(ctx, req, res)
      } else if (req.method === 'GET' && url.pathname === '/internal/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    } catch (error) {
      console.error('[gateway-server] Unexpected error:', error)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal-server-error' }))
    }
  })

  return server
}

/**
 * Handle chat completion requests via the OpenAI-compatible API.
 */
async function handleChatCompletion(
  req: IncomingMessage,
  res: ServerResponse,
  _ctx: Context,
): Promise<void> {
  // Extract session token from Authorization header
  const authHeader = req.headers['authorization'] as string | undefined

  // Read session secret from environment
  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret || sessionSecret.length < 32) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'session-secret-missing' }))
    return
  }

  // Verify the session token
  let decoded: { tenant_id?: string } | null = null
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim()
    const result = verifySessionCookie(token, sessionSecret)
    if (result) {
      decoded = { tenant_id: result.tenant_id }
    }
  }

  if (!decoded?.tenant_id) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid-or-expired-token' }))
    return
  }

  // Read the body
  let _body: unknown
  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    _body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid-request-body' }))
    return
  }

  // Forward to the OpenAI-compatible relay (dsh-image-gen plugin mode)
  // The dsh-image-gen plugin sends requests to the gateway which then
  // forwards to the OpenRouter API using the admin's OPENROUTER_API_KEY
  // This is a simplified forward - in production, the plugin handles
  // the actual OpenRouter API call

  res.writeHead(501, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not-implemented', message: 'Chat completion forwarding not yet implemented' }))
}

/**
 * Start the gateway server.
 * @param ctx - the Cordis context
 * @param port - the port to listen on (default: 4010)
 */
export async function startGatewayServer(ctx: Context, port?: number): Promise<void> {
  const serverPort = port ?? GATEWAY_PORT
  const server = createGatewayServer(ctx)

  await new Promise<void>((resolve, reject) => {
    server.listen(serverPort, GATEWAY_HOST, () => {
      console.log(`[gateway-server] Listening on http://${GATEWAY_HOST}:${serverPort}`)
      resolve()
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(err)
    })
  })

  return new Promise<void>((resolve) => {
    // The server is already listening, just resolve
    resolve()
  })
}
