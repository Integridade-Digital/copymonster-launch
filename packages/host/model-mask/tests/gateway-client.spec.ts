import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import {
  formatGatewayPayload,
  gatewayChatEndpoint,
  gatewayImageEndpoint,
  generateImageGateway,
  GatewayConfigError,
  isGatewayConfigured,
  resolveGatewayConfig,
  streamGateway,
} from '../src/gateway-client.ts'
import {
  buildVirtualAdapter,
  VIRTUAL_MODEL,
  VIRTUAL_MODEL_NAME,
  VIRTUAL_PROVIDER,
} from '../src/index.ts'
import type { GenerateOptions, RequestMessage, StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm'

async function drainStream(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return chunks
}

/** Start a test server on an ephemeral loopback port. */
function listenOnLoopback(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err?: Error) => {
      if (err !== undefined) {
        reject(err)
        return
      }
      resolve()
    })
  })
}

/** Concatenate the text blocks of an OpenAI-compatible `messages` array. */
function joinedMessageText(payload: unknown): string {
  const messages =
    typeof payload === 'object' && payload !== null
      ? (payload as { messages?: unknown }).messages
      : undefined
  if (!Array.isArray(messages)) return ''
  return messages
    .map((message: unknown) => {
      if (typeof message !== 'object' || message === null) return ''
      const content = (message as { content?: unknown }).content
      return typeof content === 'string' ? content : ''
    })
    .join('')
}

describe('gateway-client configuration resolution', () => {
  it('detects gateway configured via policy', () => {
    expect(isGatewayConfigured({ gatewayUrl: 'http://127.0.0.1:4010/internal/v1/llm' })).toBe(true)
    expect(isGatewayConfigured({ gatewayUrl: '' })).toBe(false)
    expect(isGatewayConfigured({})).toBe(false)
  })

  it('detects gateway configured via process.env', () => {
    const oldEnv = process.env.COPYMONSTER_LLM_GATEWAY_URL
    try {
      process.env.COPYMONSTER_LLM_GATEWAY_URL = 'http://127.0.0.1:4010'
      expect(isGatewayConfigured()).toBe(true)
      delete process.env.COPYMONSTER_LLM_GATEWAY_URL
      expect(isGatewayConfigured()).toBe(false)
    } finally {
      process.env.COPYMONSTER_LLM_GATEWAY_URL = oldEnv
    }
  })

  it('resolves gateway URL, token, and model from policy and environment', () => {
    const oldEnvUrl = process.env.COPYMONSTER_LLM_GATEWAY_URL
    const oldEnvToken = process.env.COPYMONSTER_INTERNAL_SESSION_TOKEN
    try {
      process.env.COPYMONSTER_LLM_GATEWAY_URL = 'http://127.0.0.1:4010/internal/v1/llm'
      process.env.COPYMONSTER_INTERNAL_SESSION_TOKEN = 'env-token-xyz'

      const cfg = resolveGatewayConfig({
        primaryModel: 'custom-model',
      })
      expect(cfg).toEqual({
        gatewayUrl: 'http://127.0.0.1:4010/internal/v1/llm',
        token: 'env-token-xyz',
        model: 'custom-model',
      })
    } finally {
      process.env.COPYMONSTER_LLM_GATEWAY_URL = oldEnvUrl
      process.env.COPYMONSTER_INTERNAL_SESSION_TOKEN = oldEnvToken
    }
  })

  it('contract: gatewayChatEndpoint appends only /chat/completions to the producer URL', () => {
    // Valor emitido por LocalSpawner.baseEnv no repositório do orquestrador
    // (test/orchestrator-gateway-env.test.mjs). Contrato único: a env já traz
    // /internal/v1/llm; o cliente não pode colá-lo de novo.
    const PRODUCER_GATEWAY_URL = 'http://127.0.0.1:4010/internal/v1/llm'
    expect(gatewayChatEndpoint(PRODUCER_GATEWAY_URL)).toBe(
      'http://127.0.0.1:4010/internal/v1/llm/chat/completions',
    )
  })

  it('rejects non-loopback gateway URLs', () => {
    expect(() => gatewayChatEndpoint('https://api.deepseek.com/chat/completions')).toThrow(
      GatewayConfigError,
    )
    expect(() => gatewayChatEndpoint('ftp://127.0.0.1/internal/v1/llm')).toThrow(GatewayConfigError)
    expect(() => gatewayChatEndpoint('not-a-url')).toThrow(GatewayConfigError)
    expect(() => gatewayChatEndpoint('http://127.0.0.1:4010/internal/v1/llm?x=1')).toThrow(
      GatewayConfigError,
    )
  })

  it('accepts loopback variants with trailing slash', () => {
    expect(gatewayChatEndpoint('http://127.0.0.1:4010/internal/v1/llm/')).toBe(
      'http://127.0.0.1:4010/internal/v1/llm/chat/completions',
    )
    expect(gatewayChatEndpoint('http://[::1]:4010/internal/v1/llm')).toBe(
      'http://[::1]:4010/internal/v1/llm/chat/completions',
    )
  })
})

describe('gateway-client payload formatting', () => {
  it('formats system prompt, user messages, and parameters', () => {
    const options: GenerateOptions = {
      provider: VIRTUAL_PROVIDER,
      model: VIRTUAL_MODEL,
      system: 'You are CopyMonster Assistant.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello!' }] },
      ],
      temperature: 0.7,
      maxTokens: 1024,
      stop: ['\n\n'],
    }

    const payload = formatGatewayPayload(options, 'deepseek-chat')
    expect(payload).toEqual({
      model: 'deepseek-chat',
      stream: true,
      messages: [
        { role: 'system', content: 'You are CopyMonster Assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      temperature: 0.7,
      max_tokens: 1024,
      stop: ['\n\n'],
    })
  })

  it('formats tools and assistant tool calls', () => {
    const toolDeclaration: ToolSchema = {
      name: 'get_weather',
      description: 'Get weather for city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    }

    const messages: RequestMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Check weather' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            id: 'call_1' as unknown as RequestMessage extends { id: infer T } ? T : never,
            name: 'get_weather',
            arguments: '{"city":"Lisbon"}',
          } as unknown as RequestMessage['content'][number],
        ],
      },
      {
        role: 'tool',
        toolCallId: 'call_1' as unknown as RequestMessage extends { id: infer T } ? T : never,
        content: [{ type: 'text', text: 'Sunny 22C' }],
      } as unknown as RequestMessage,
    ]

    const options: GenerateOptions = {
      provider: VIRTUAL_PROVIDER,
      model: VIRTUAL_MODEL,
      messages,
      tools: [toolDeclaration],
    }

    const payload = formatGatewayPayload(options)
    expect(payload.model).toBe(VIRTUAL_MODEL)
    expect(payload.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather for city',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      },
    ])
    const msgs = payload.messages as Array<Record<string, unknown>>
    expect(msgs[1]?.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"Lisbon"}',
        },
      },
    ])
    expect(msgs[2]?.tool_call_id).toBe('call_1')
  })
})

describe('gateway-client streaming execution', () => {
  it('parses SSE stream with reasoning, text, usage, and finish reason', async () => {
    const sseChunks = [
      'data: {"id":"1","choices":[{"index":0,"delta":{"reasoning_content":"Thinking..."},"finish_reason":null}]}\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":"world!"},"finish_reason":null}]}\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\n',
      'data: [DONE]\n\n',
    ]

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })

    const oldFetch = globalThis.fetch
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      expect(urlStr).toBe('http://127.0.0.1:4010/internal/v1/llm/chat/completions')
      const headers = init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer test-token-123')

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    try {
      const chunks: StreamChunk[] = []
      for await (const chunk of streamGateway(
        {
          provider: VIRTUAL_PROVIDER,
          model: VIRTUAL_MODEL,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        },
        {
          gatewayUrl: 'http://127.0.0.1:4010/internal/v1/llm',
          token: 'test-token-123',
        },
      )) {
        chunks.push(chunk)
      }

      // 1. Reasoning start & delta
      expect(chunks).toContainEqual({ type: 'block-start', index: 0, blockType: 'reasoning' })
      expect(chunks).toContainEqual({ type: 'reasoning-delta', index: 0, text: 'Thinking...' })
      expect(chunks).toContainEqual({ type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Thinking...' } })

      // 2. Text start & deltas
      expect(chunks).toContainEqual({ type: 'block-start', index: 1, blockType: 'text' })
      expect(chunks).toContainEqual({ type: 'text-delta', index: 1, text: 'Hello ' })
      expect(chunks).toContainEqual({ type: 'text-delta', index: 1, text: 'world!' })
      expect(chunks).toContainEqual({ type: 'block-end', index: 1, block: { type: 'text', text: 'Hello world!' } })

      // 3. Usage & finish
      expect(chunks).toContainEqual({
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      })
      expect(chunks).toContainEqual({
        type: 'finish',
        reason: { kind: 'stop' },
      })
    } finally {
      globalThis.fetch = oldFetch
    }
  })

  it('handles non-streaming JSON response gracefully', async () => {
    const oldFetch = globalThis.fetch
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-json',
          choices: [{ message: { role: 'assistant', content: 'Direct JSON response' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    try {
      const chunks: StreamChunk[] = []
      for await (const chunk of streamGateway(
        {
          provider: VIRTUAL_PROVIDER,
          model: VIRTUAL_MODEL,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        },
        { gatewayUrl: 'http://127.0.0.1:4010/internal/v1/llm' },
      )) {
        chunks.push(chunk)
      }

      expect(chunks).toContainEqual({ type: 'block-start', index: 0, blockType: 'text' })
      expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'Direct JSON response' })
      expect(chunks).toContainEqual({ type: 'block-end', index: 0, block: { type: 'text', text: 'Direct JSON response' } })
      expect(chunks).toContainEqual({
        type: 'usage',
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      })
      expect(chunks).toContainEqual({ type: 'finish', reason: { kind: 'stop' } })
    } finally {
      globalThis.fetch = oldFetch
    }
  })

  it('throws error with status and code on non-200 responses', async () => {
    const oldFetch = globalThis.fetch
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Unauthorized internal token',
            code: 'invalid_token',
          },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    try {
      const stream = streamGateway(
        { provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL, messages: [] },
        { gatewayUrl: 'http://127.0.0.1:4010/internal/v1/llm' },
      )
      await expect(drainStream(stream)).rejects.toMatchObject({
        message: 'Unauthorized internal token',
        status: 401,
        code: 'invalid_token',
      })
    } finally {
      globalThis.fetch = oldFetch
    }
  })

  it('wraps network connection error with target URL diagnostic', async () => {
    const oldFetch = globalThis.fetch
    globalThis.fetch = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:4010')
    }

    try {
      const executeNetworkError = async () => {
        for await (const _ of streamGateway(
          {
            provider: VIRTUAL_PROVIDER,
            model: VIRTUAL_MODEL,
            messages: [],
          },
          { gatewayUrl: 'http://127.0.0.1:4010/internal/v1/llm' },
        )) {}
      }

      await expect(executeNetworkError()).rejects.toThrow(
        /Failed to connect to LLM gateway at http:\/\/127\.0\.0\.1:4010\/internal\/v1\/llm\/chat\/completions/,
      )
    } finally {
      globalThis.fetch = oldFetch
    }
  })
})

describe('buildVirtualAdapter gateway integration', () => {
  it('dispatches to gateway when gatewayUrl is configured', async () => {
    let calledGateway = false
    const oldFetch = globalThis.fetch
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.includes('/internal/v1/llm/chat/completions')) {
        calledGateway = true
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'From loopback gateway' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    }

    try {
      const ctx = {
        llm: {
          listProviders: () => [],
          listModels: async () => [],
          stream: async function* () {},
        },
        agentDefaultModel: { currentSelection: () => ({ provider: 'none', model: 'none' }) },
        logger: { debug: () => {}, warn: () => {}, error: () => {} },
      } as unknown as Parameters<typeof buildVirtualAdapter>[0]['ctx']

      const adapter = buildVirtualAdapter({
        ctx,
        getPolicy: () => ({
          virtualProvider: VIRTUAL_PROVIDER,
          virtualModel: VIRTUAL_MODEL,
          virtualModelName: VIRTUAL_MODEL_NAME,
          gatewayUrl: 'http://127.0.0.1:4010/internal/v1/llm',
          internalSessionToken: 'session-token-abc',
        }),
      })

      const chunks: StreamChunk[] = []
      for await (const chunk of adapter.stream({
        provider: VIRTUAL_PROVIDER,
        model: VIRTUAL_MODEL,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      })) {
        chunks.push(chunk)
      }

      expect(calledGateway).toBe(true)
      expect(chunks).toContainEqual({
        type: 'text-delta',
        index: 0,
        text: 'From loopback gateway',
      })
    } finally {
      globalThis.fetch = oldFetch
    }
  })
})

describe('gateway-client real-server integration', () => {
  it('streams from a real HTTP server using the producer gateway URL', async () => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/internal/v1/llm/chat/completions') {
        let body = ''
        req.on('data', (chunk: Buffer | string) => {
          body += String(chunk)
        })
        req.on('end', () => {
          const payload: unknown = JSON.parse(body)
          const text = joinedMessageText(payload)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'chatcmpl-real',
              choices: [{ message: { role: 'assistant', content: `echo:${text}` } }],
              usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
            }),
          )
        })
      } else {
        res.writeHead(404)
        res.end('not found')
      }
    })

    await listenOnLoopback(server)
    const addr = server.address() as { port: number }
    const gatewayUrl = `http://127.0.0.1:${addr.port}/internal/v1/llm`

    try {
      const chunks: StreamChunk[] = []
      for await (const chunk of streamGateway(
        {
          provider: VIRTUAL_PROVIDER,
          model: VIRTUAL_MODEL,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello real' }] }],
        },
        { gatewayUrl },
      )) {
        chunks.push(chunk)
      }

      expect(chunks).toContainEqual({
        type: 'text-delta',
        index: 0,
        text: 'echo:Hello real',
      })
      expect(chunks).toContainEqual({
        type: 'usage',
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      })
      expect(chunks).toContainEqual({ type: 'finish', reason: { kind: 'stop' } })
    } finally {
      server.close()
    }
  })
})

describe('gatewayImageEndpoint and generateImageGateway', () => {
  it('constructs canonical image generation endpoint', () => {
    expect(gatewayImageEndpoint('http://127.0.0.1:4010/internal/v1/llm')).toBe(
      'http://127.0.0.1:4010/internal/v1/llm/images/generations',
    )
    expect(gatewayImageEndpoint('http://127.0.0.1:4010')).toBe(
      'http://127.0.0.1:4010/images/generations',
    )
  })

  it('successfully generates image via loopback gateway with session token', async () => {
    let capturedAuth = ''
    let capturedBody: Record<string, unknown> | null = null

    const server = createServer((req, res) => {
      capturedAuth = req.headers['authorization'] ?? ''
      let raw = ''
      req.on('data', (chunk: Buffer | string) => {
        raw += String(chunk)
      })
      req.on('end', () => {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new TypeError('image gateway payload is not an object')
        }
        capturedBody = parsed as Record<string, unknown>
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          created: 1710000000,
          data: [
            {
              b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              mime_type: 'image/png',
            },
          ],
        }))
      })
    })

    await listenOnLoopback(server)
    const addr = server.address() as { port: number }
    const gatewayUrl = `http://127.0.0.1:${addr.port}/internal/v1/llm`

    try {
      const result = await generateImageGateway(
        {
          prompt: 'A friendly monster mascot illustrating high conversion copy',
          model: '@cf/black-forest-labs/flux-1-schnell',
          numSteps: 4,
          width: 512,
          height: 512,
        },
        {
          gatewayUrl,
          token: 'session-jwt-token-xyz',
        },
      )

      expect(capturedAuth).toBe('Bearer session-jwt-token-xyz')
      expect(capturedBody?.prompt).toBe('A friendly monster mascot illustrating high conversion copy')
      expect(capturedBody?.model).toBe('@cf/black-forest-labs/flux-1-schnell')
      expect(capturedBody?.num_steps).toBe(4)
      expect(capturedBody?.width).toBe(512)
      expect(capturedBody?.height).toBe(512)

      expect(result.created).toBe(1710000000)
      expect(result.data.length).toBe(1)
      expect(result.data[0].mimeType).toBe('image/png')
      expect(result.data[0].b64Json).toContain('iVBORw0KGgo')
    } finally {
      server.close()
    }
  })

  it('handles upstream gateway error with descriptive message and status', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: {
          message: 'Upstream image generation failed: Cloudflare Workers AI rate limited',
          type: 'upstream_error',
        },
      }))
    })

    await listenOnLoopback(server)
    const addr = server.address() as { port: number }
    const gatewayUrl = `http://127.0.0.1:${addr.port}/internal/v1/llm`

    try {
      await expect(
        generateImageGateway(
          { prompt: 'A simple test prompt' },
          { gatewayUrl, token: 'session-jwt-token-xyz' },
        ),
      ).rejects.toThrow(/Cloudflare Workers AI rate limited/)
    } finally {
      server.close()
    }
  })
})
