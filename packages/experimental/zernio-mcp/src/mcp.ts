/**
 * dsh-experimental-zernio-mcp — MCP connection supervisor.
 *
 * Connects to `https://mcp.zernio.com/mcp` with the OAuth provider (the
 * transport attaches the bearer token and refreshes it on 401), discovers the
 * server's tools, and registers them on `ctx.tools` under deterministic
 * server-qualified public names (`mcp__zernio__<rawName>`).
 *
 * Lifecycle: only starts when tokens exist (an unauthenticated connect would
 * otherwise spin the OAuth redirect loop). On connection loss it retries with
 * bounded exponential backoff; when the user clears credentials mid-run the
 * supervisor stops.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import type { OAuthFlow } from './oauth.ts'
import { MCP_URL, type ZernioMcpStore } from './store.ts'

/** DeepSeek function-name contract: at most 64 characters. */
const MAX_PUBLIC_NAME_LENGTH = 64

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12

/** Default per-tool-call timeout (ms). */
const TOOL_CALL_TIMEOUT_MS = 60_000

/** Close-signal wait before giving up on a generation (ms). */
const GENERATION_CLOSE_TIMEOUT_MS = 5_000

/** Reconnect backoff bounds. */
const RECONNECT = {
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxAttempts: 10,
} as const

/**
 * Derive the model-facing public name (`mcp__zernio__<rawName>`).
 * @param rawName - the MCP server's own tool name.
 * @returns the normalized, namespace-qualified public name.
 */
export function publicToolName(rawName: string): string {
  const joined = `mcp__zernio__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`zernio\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/**
 * Extract readable text from an MCP content array.
 * @param mcpContent - the tool result's content blocks.
 * @param toolName - raw tool name used in diagnostics.
 * @returns joined text with discarded media labeled.
 */
export function extractText(mcpContent: unknown, toolName: string): string {
  if (!Array.isArray(mcpContent)) return `(${toolName} returned non-content output)`
  const parts: string[] = []
  for (const value of mcpContent) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      parts.push('[unsupported content type: unknown]')
      continue
    }
    const block = value as Record<string, unknown>
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string') parts.push(block.text)
        break
      case 'image':
        parts.push(`[image: ${typeof block.mimeType === 'string' ? block.mimeType : 'unknown'}, content discarded]`)
        break
      case 'audio':
        parts.push(`[audio: ${typeof block.mimeType === 'string' ? block.mimeType : 'unknown'}, content discarded]`)
        break
      case 'resource':
      case 'resource_link':
        parts.push('[resource: content discarded]')
        break
      default:
        parts.push(`[unsupported content type: ${String(block.type)}]`)
    }
  }
  return parts.join('\n') || `(${toolName} returned no text content)`
}

/** Handle returned by {@link createSupervisor}. */
export interface ZernioSupervisor {
  /** Connect and register tools; rejects when the first attempt fails. */
  start(): Promise<void>
  /** Whether a client generation is live. */
  isConnected(): boolean
  /** Number of tools currently registered by this supervisor. */
  toolCount(): number
  /** List the server's current raw tool names. */
  listTools(): Promise<string[]>
  /** Stop reconnecting, close the client, and unregister every tool. */
  dispose(): Promise<void>
}

/**
 * Create the supervised connection for the Zernio MCP server.
 * @param ctx - cordis context carrying the tools registry and logger.
 * @param store - credential store (tokens gate the connection).
 * @param flow - OAuth flow providing the transport's auth provider.
 * @param getCallbackUrl - resolves the loopback OAuth callback URL at connect time.
 * @returns the supervisor handle.
 */
export function createSupervisor(
  ctx: Context,
  store: ZernioMcpStore,
  flow: OAuthFlow,
  getCallbackUrl: () => string,
): ZernioSupervisor {
  const label = 'zernio-mcp'
  let client: Client | null = null
  let clientClosed: Promise<void> | null = null
  let disposers = new Map<string, () => void>()
  let reconnectTimer: NodeJS.Timeout | null = null
  let failedAttempts = 0
  let disposed = false
  let firstAttemptError: unknown = null

  /** Serializes every tool sync (initial and notification re-syncs). */
  let syncChain: Promise<void> = Promise.resolve()

  const isCurrent = (generation: Client): boolean => !disposed && client === generation

  function enqueueSync(generation: Client): Promise<void> {
    const run = syncChain.then(async () => {
      if (!isCurrent(generation)) return
      disposers = await syncTools(generation)
    })
    syncChain = run.catch(() => {})
    return run
  }

  async function syncTools(generation: Client): Promise<Map<string, () => void>> {
    const response = await generation.listTools(undefined, { cacheMode: 'refresh' })
    const definitions = response.tools.map(tool => ({
      name: publicToolName(tool.name),
      description: tool.description ?? '',
      parameters: tool.inputSchema,
      output: {
        schema: {
          type: 'object' as const,
          properties: {
            content: { type: 'array' as const, items: {} },
            structuredContent: {},
          },
          required: ['content'],
          additionalProperties: false,
        },
        render: (_args: unknown, value: unknown) => [{
          type: 'text' as const,
          text: extractText(
            typeof value === 'object' && value !== null ? Reflect.get(value, 'content') : undefined,
            tool.name,
          ),
        }],
      },
      execute: async (args: unknown, exec: { signal: AbortSignal }) => {
        const cleanArgs: Record<string, unknown> = typeof args === 'object' && args !== null && !Array.isArray(args)
          ? Object.fromEntries(Object.entries(args))
          : {}
        const result = await generation.callTool(
          { name: tool.name, arguments: cleanArgs },
          { signal: exec.signal, timeout: TOOL_CALL_TIMEOUT_MS },
        )
        if (result.isError === true) throw new Error(extractText(result.content, tool.name))
        return { content: result.content }
      },
    }))
    for (const dispose of disposers.values()) dispose()
    const next = new Map<string, () => void>()
    for (const definition of definitions) next.set(definition.name, ctx.tools.register(definition))
    return next
  }

  async function listToolsAll(generation: Client): Promise<string[]> {
    const response = await generation.listTools(undefined, { cacheMode: 'refresh' })
    return response.tools.map(tool => tool.name)
  }

  function generationDown(generation: Client): void {
    if (!isCurrent(generation)) return
    client = null
    clientClosed = null
    scheduleReconnect()
  }

  function waitForClose(closed: Promise<void>): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { resolve(false) }, GENERATION_CLOSE_TIMEOUT_MS)
      timeout.unref()
      void closed.then(() => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
  }

  function scheduleReconnect(): void {
    if (disposed) return
    if (failedAttempts >= RECONNECT.maxAttempts) {
      syncChain = syncChain.then(() => {
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
      })
      ctx.logger.error(
        `${label}: giving up after ${RECONNECT.maxAttempts} reconnect attempts — tools unregistered; re-authorize or restart to reconnect`,
      )
      return
    }
    const delayMs = Math.min(RECONNECT.maxDelayMs, RECONNECT.initialDelayMs * 2 ** failedAttempts)
    failedAttempts += 1
    ctx.logger.warn(`${label}: connection lost; retrying in ${delayMs}ms (attempt ${failedAttempts}/${RECONNECT.maxAttempts})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connectGeneration(false)
    }, delayMs)
    reconnectTimer.unref()
  }

  async function connectGeneration(startup: boolean): Promise<void> {
    if (disposed) return
    const cfg = await store.load()
    if (cfg.tokens === null || cfg.tokens.access_token === '') {
      ctx.logger.info(`${label}: no OAuth tokens — connection deferred until authorization completes`)
      return
    }
    function onToolListChanged(): void {
      if (!isCurrent(generation)) return
      ctx.logger.info(`${label}: tool list changed, re-syncing`)
      void enqueueSync(generation).catch((error: unknown) => {
        if (!disposed) ctx.logger.error(`${label}: tool re-sync failed: ${String(error)}`)
      })
    }
    const generation = new Client(
      { name: 'dsh-zernio-mcp', version: '0.1.0' },
      {
        capabilities: {},
        listChanged: {
          tools: {
            autoRefresh: false,
            debounceMs: 0,
            onChanged: onToolListChanged,
          },
        },
      },
    )
    let resolveClosed: () => void = () => {}
    const closed: Promise<void> = new Promise((resolve) => {
      resolveClosed = resolve
    })
    let attemptSettled = false
    let closeObserved = false
    const hasClosed = (): boolean => closeObserved
    client = generation
    clientClosed = closed
    generation.onclose = () => {
      closeObserved = true
      resolveClosed()
      if (attemptSettled) generationDown(generation)
    }
    try {
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
        authProvider: flow.getProvider(getCallbackUrl()),
      })
      await generation.connect(transport)
      if (hasClosed()) {
        attemptSettled = true
        generationDown(generation)
        return
      }
      await enqueueSync(generation)
    } catch (error) {
      if (firstAttemptError === null && startup) firstAttemptError = error
      if (isCurrent(generation)) ctx.logger.warn(`${label}: connection attempt failed: ${String(error)}`)
      try {
        await generation.close()
      } catch {
        // The transport is already gone; the close barrier below still decides retry ownership.
      }
      const quiesced = hasClosed() || await waitForClose(closed)
      attemptSettled = true
      if (!isCurrent(generation)) return
      if (!quiesced) {
        client = null
        clientClosed = null
        ctx.logger.error(
          `${label}: failed generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms — reconnect stopped; restart the Host to retry`,
        )
        return
      }
      generationDown(generation)
      return
    }
    attemptSettled = true
    if (hasClosed()) {
      generationDown(generation)
      return
    }
    if (!isCurrent(generation)) return
    if (failedAttempts > 0) {
      ctx.logger.info(`${label}: reconnected and re-synced tools (attempt ${failedAttempts}/${RECONNECT.maxAttempts})`)
    }
  }

  return {
    async start(): Promise<void> {
      failedAttempts = 0
      await connectGeneration(true)
      if (firstAttemptError !== null && client === null) {
        const error = firstAttemptError
        firstAttemptError = null
        throw error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : JSON.stringify(error))
      }
    },
    isConnected(): boolean {
      return client !== null
    },
    toolCount(): number {
      return disposers.size
    },
    async listTools(): Promise<string[]> {
      if (client === null) throw new Error('Zernio MCP is not connected.')
      return await listToolsAll(client)
    },
    async dispose(): Promise<void> {
      disposed = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      const current = client
      const currentClosed = clientClosed
      client = null
      clientClosed = null
      if (current !== null) {
        try {
          await current.close()
        } catch {
          // The generation is already closed; the barrier below reports a stuck transport.
        }
        if (currentClosed !== null && !await waitForClose(currentClosed)) {
          ctx.logger.error(`${label}: generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms during disposal`)
        }
      }
      await syncChain
      for (const dispose of disposers.values()) dispose()
      disposers = new Map()
    },
  }
}
