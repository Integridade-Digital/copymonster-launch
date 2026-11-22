/**
 * Gateway client for the CopyMonster Loopback LLM Gateway.
 *
 * Dispatches chat completion calls from tenant sessions to the internal loopback
 * gateway (127.0.0.1:4010) over HTTP/SSE with bearer internal session token.
 *
 * @module @deepseek-ai/dsh-host-model-mask/gateway-client
 */

import {
  ToolCallId,
  type ContentBlock,
  type FinishReason,
  type GenerateOptions,
  type RequestMessage,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { LlmRoutingPolicy } from './index.ts'

export interface GatewayClientConfig {
  gatewayUrl: string
  token?: string
  model?: string
}

/** Check if the central LLM loopback gateway is configured. */
export function isGatewayConfigured(policy?: LlmRoutingPolicy): boolean {
  const url = policy?.gatewayUrl ?? process.env.COPYMONSTER_LLM_GATEWAY_URL
  return typeof url === 'string' && url.trim().length > 0
}

/** Resolve gateway config from policy or environment. */
export function resolveGatewayConfig(policy?: LlmRoutingPolicy): GatewayClientConfig | undefined {
  const gatewayUrl = (policy?.gatewayUrl ?? process.env.COPYMONSTER_LLM_GATEWAY_URL)?.trim()
  if (!gatewayUrl) return undefined

  const token = (policy?.internalSessionToken ?? process.env.COPYMONSTER_INTERNAL_SESSION_TOKEN)?.trim()
  const model = policy?.primaryModel || policy?.virtualModel || 'copy-monster-default'

  return { gatewayUrl, model, ...(token ? { token } : {}) }
}

/**
 * Rota relativa ao endpoint de inferência do loopback. A base da URL (COPYMONSTER_LLM_GATEWAY_URL)
 * já carrega o prefixo /internal/v1/llm conforme definido pelo orquestrador, então o cliente
 * deve anexar apenas o segmento de rota — nunca o prefixo de novo.
 */
const CHAT_COMPLETIONS_PATH = '/chat/completions'

/** Erro tipado para falhas de configuração do gateway de LLM (ex.: URL inválida ou não-loopback). */
export class GatewayConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GatewayConfigError'
  }
}

/**
 * Constrói o endpoint absoluto de chat/completions a partir da URL base do gateway.
 *
 * O contrato é: COPYMONSTER_LLM_GATEWAY_URL é a base da API interna (ex:
 * http://127.0.0.1:4010/internal/v1/llm). Esta função anexa apenas /chat/completions.
 * Qualquer outra forma é considerada configuração inválida e falha alto.
 *
 * @param gatewayUrl - valor emitido pelo orquestrador, já incluindo /internal/v1/llm.
 * @returns endpoint absoluto de inferência do loopback.
 * @throws {GatewayConfigError} quando a URL não é válida ou aponta fora do loopback.
 */
export function gatewayChatEndpoint(gatewayUrl: string): string {
  const base = gatewayUrl.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new GatewayConfigError(
      `COPYMONSTER_LLM_GATEWAY_URL is not a valid URL: ${gatewayUrl}`,
    )
  }

  // O tenant só pode falar com o gateway loopback; qualquer outro destino é
  // configuração inválida, não um fallback silencioso (defesa em profundidade contra SSRF).
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname) || url.search || url.hash) {
    throw new GatewayConfigError(
      `COPYMONSTER_LLM_GATEWAY_URL must be a loopback http origin: ${gatewayUrl}`,
    )
  }

  return `${base}${CHAT_COMPLETIONS_PATH}`
}

/** Retorna true apenas para hostnames do loopback IPv4/IPv6. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true
  // IPv4 loopback range 127.0.0.0/8
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  return false
}

/** Flatten content blocks of a message to plain string. */
function extractMessageContent(message: RequestMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  const texts: string[] = []
  for (const block of message.content as readonly unknown[]) {
    if (typeof block === 'object' && block !== null) {
      const rec = block as Record<string, unknown>
      if (rec.type === 'text' && typeof rec.text === 'string') {
        texts.push(rec.text)
      }
    }
  }
  return texts.join('')
}

/** Format GenerateOptions messages and tools into OpenAI-compatible payload. */
export function formatGatewayPayload(options: GenerateOptions, requestedModel?: string): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = []

  // Prepend system prompt if present and not already first message
  if (options.system && typeof options.system === 'string' && options.system.trim().length > 0) {
    const hasLeadingSystem = options.messages[0]?.role === 'system'
    if (!hasLeadingSystem) {
      messages.push({ role: 'system', content: options.system })
    }
  }

  for (const message of options.messages) {
    let role: string = message.role
    if (role === 'developer') role = 'system'

    const content = extractMessageContent(message)
    const formatted: Record<string, unknown> = { role, content }

    if (role === 'assistant' && Array.isArray(message.content)) {
      const toolCalls: Array<Record<string, unknown>> = []
      for (const block of message.content as readonly unknown[]) {
        if (typeof block === 'object' && block !== null) {
          const rec = block as Record<string, unknown>
          if (rec.type === 'tool-call') {
            toolCalls.push({
              id: typeof rec.id === 'string' ? rec.id : '',
              type: 'function',
              function: {
                name: typeof rec.name === 'string' ? rec.name : '',
                arguments: typeof rec.arguments === 'string' ? rec.arguments : JSON.stringify(rec.arguments ?? {}),
              },
            })
          }
        }
      }
      if (toolCalls.length > 0) {
        formatted.tool_calls = toolCalls
      }
    }

    if (role === 'tool') {
      const toolMsg = message as { toolCallId?: string; id?: string }
      formatted.tool_call_id = toolMsg.toolCallId ?? toolMsg.id ?? ''
    }

    messages.push(formatted)
  }

  const payload: Record<string, unknown> = {
    model: requestedModel || options.model || 'copy-monster-default',
    messages,
    stream: true,
  }

  if (options.tools && options.tools.length > 0) {
    payload.tools = options.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }

  if (typeof options.temperature === 'number') payload.temperature = options.temperature
  if (typeof options.maxTokens === 'number') payload.max_tokens = options.maxTokens
  if (options.stop !== undefined) payload.stop = options.stop

  return payload
}

/** Parse an incoming stream into lines. */
async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        yield line
      }
    }
    if (buffer.length > 0) {
      yield buffer
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Stream completions from the Loopback Gateway and yield provider-neutral StreamChunks.
 */
export async function* streamGateway(
  options: GenerateOptions,
  config: GatewayClientConfig,
): AsyncIterable<StreamChunk> {
  const endpoint = gatewayChatEndpoint(config.gatewayUrl)
  const payload = formatGatewayPayload(options, config.model)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream, application/json',
  }

  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`
  }

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to connect to LLM gateway at ${endpoint}: ${message}`)
  }

  if (!res.ok) {
    let errBody: unknown
    try {
      errBody = await res.json()
    } catch {
      try {
        errBody = { message: await res.text() }
      } catch {
        errBody = { message: `Gateway error HTTP ${res.status}` }
      }
    }

    const obj = errBody as { error?: { message?: string; code?: string; type?: string }; message?: string } | undefined
    const errMsg = obj?.error?.message ?? obj?.message ?? `Gateway returned HTTP ${res.status}`
    const error = new Error(errMsg)
    Object.assign(error, {
      status: res.status,
      code: obj?.error?.code ?? obj?.error?.type ?? `HTTP_${res.status}`,
    })
    throw error
  }

  // Handle non-streaming response if gateway returned application/json
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const text = json.choices?.[0]?.message?.content ?? ''
    if (text.length > 0) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    }
    if (json.usage) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: json.usage.prompt_tokens ?? 0,
          outputTokens: json.usage.completion_tokens ?? 0,
          ...(json.usage.total_tokens === undefined ? {} : { totalTokens: json.usage.total_tokens }),
        },
      }
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
    return
  }

  if (!res.body) {
    throw new Error('Gateway returned empty response body')
  }

  // Handle SSE text/event-stream
  let activeBlockType: 'text' | 'reasoning' | 'tool-call' | null = null
  let activeBlockIndex = 0
  let accumulatedText = ''
  let accumulatedReasoning = ''
  let finishReason: FinishReason = { kind: 'stop' }
  let emittedUsage: TokenUsage | undefined

  for await (const rawLine of readLines(res.body)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue

    const dataStr = line.slice(5).trim()
    if (dataStr === '[DONE]') break

    let chunkPayload: {
      choices?: Array<{
        index?: number
        delta?: {
          content?: string
          reasoning_content?: string
          tool_calls?: Array<{
            index?: number
            id?: string
            type?: string
            function?: { name?: string; arguments?: string }
          }>
        }
        finish_reason?: string | null
      }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      error?: { message?: string }
    }

    try {
      chunkPayload = JSON.parse(dataStr) as typeof chunkPayload
    } catch {
      continue
    }

    if (chunkPayload.error) {
      throw new Error(chunkPayload.error.message ?? 'Unknown error from upstream stream')
    }

    const choice = chunkPayload.choices?.[0]
    if (choice?.delta) {
      const delta = choice.delta

      // Reasoning delta (DeepSeek R1 / thinking models)
      if (delta.reasoning_content) {
        if (activeBlockType !== 'reasoning') {
          if (activeBlockType !== null) {
            yield createBlockEnd(activeBlockType, activeBlockIndex, accumulatedText, accumulatedReasoning)
            activeBlockIndex++
          }
          activeBlockType = 'reasoning'
          accumulatedReasoning = ''
          yield { type: 'block-start', index: activeBlockIndex, blockType: 'reasoning' }
        }
        accumulatedReasoning += delta.reasoning_content
        yield { type: 'reasoning-delta', index: activeBlockIndex, text: delta.reasoning_content }
      }

      // Text delta
      if (delta.content) {
        if (activeBlockType !== 'text') {
          if (activeBlockType !== null) {
            yield createBlockEnd(activeBlockType, activeBlockIndex, accumulatedText, accumulatedReasoning)
            activeBlockIndex++
          }
          activeBlockType = 'text'
          accumulatedText = ''
          yield { type: 'block-start', index: activeBlockIndex, blockType: 'text' }
        }
        accumulatedText += delta.content
        yield { type: 'text-delta', index: activeBlockIndex, text: delta.content }
      }

      // Tool calls
      if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const tcIndex = activeBlockIndex + (tc.index ?? 0)
          yield { type: 'block-start', index: tcIndex, blockType: 'tool-call' }
          yield {
            type: 'tool-call-delta',
            index: tcIndex,
            id: ToolCallId(tc.id ?? `call-${tcIndex}`),
            ...(tc.function?.name === undefined ? {} : { name: tc.function.name }),
            argumentsDelta: tc.function?.arguments ?? '',
          }
        }
      }

      // Finish reason mapping
      if (choice.finish_reason) {
        if (choice.finish_reason === 'tool_calls') {
          finishReason = { kind: 'tool-calls' }
        } else if (choice.finish_reason === 'length') {
          finishReason = { kind: 'max-tokens' }
        } else {
          finishReason = { kind: 'stop' }
        }
      }
    }

    if (chunkPayload.usage) {
      emittedUsage = {
        inputTokens: chunkPayload.usage.prompt_tokens ?? 0,
        outputTokens: chunkPayload.usage.completion_tokens ?? 0,
        ...(chunkPayload.usage.total_tokens === undefined
          ? {}
          : { totalTokens: chunkPayload.usage.total_tokens }),
      }
    }
  }

  // Close trailing active block if any
  if (activeBlockType !== null) {
    yield createBlockEnd(activeBlockType, activeBlockIndex, accumulatedText, accumulatedReasoning)
  }

  // Emit usage if recorded
  if (emittedUsage) {
    yield { type: 'usage', usage: emittedUsage }
  }

  // Emit finish
  yield { type: 'finish', reason: finishReason }
}

function createBlockEnd(
  type: 'text' | 'reasoning' | 'tool-call',
  index: number,
  text: string,
  reasoning: string,
): StreamChunk {
  const block: ContentBlock =
    type === 'reasoning'
      ? { type: 'reasoning', text: reasoning }
      : { type: 'text', text }

  return { type: 'block-end', index, block }
}
