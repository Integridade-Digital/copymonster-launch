/** Provider-failure redaction at the Session wire boundary. */

import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Stable code the Client maps to its locale-owned unavailable-model copy. */
export const MODEL_UNAVAILABLE_CODE = 'MODEL_UNAVAILABLE'

/** Locale-independent fallback shown by Clients that do not know {@link MODEL_UNAVAILABLE_CODE}. */
export const MODEL_UNAVAILABLE_MESSAGE = 'The selected model is unavailable right now. Please try again or contact support.'

const PROVIDER_FAILURE_CODES: ReadonlySet<string> = new Set([
  'AUTH',
  'CONTEXT_WINDOW_EXCEEDED',
  'EMPTY_RESPONSE',
  'IMAGE_OFFLOAD_REQUIRED',
  'INVALID_CREDENTIAL',
  'INVALID_REQUEST',
  'LLM_STREAM_IDLE_TIMEOUT',
  'MISSING_CREDENTIAL',
  'NO_ADAPTER',
  'PI_AI_ERROR',
  'QUOTA',
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
])

const PROVIDER_FAILURE_TEXT = new RegExp([
  String.raw`campaign[\s_-]?ended`,
  String.raw`insufficient[\s_-]+(?:quota|balance|credits?)`,
  String.raw`(?:quota|balance|credits?)[\s_-]+(?:exceeded|exhausted|depleted|reached)`,
  String.raw`out[\s_-]+of[\s_-]+(?:credits?|budget)`,
  String.raw`(?:free\s+)?offer\b.{0,120}\b(?:ended|expired)`,
  String.raw`paid\s+model`,
  String.raw`model\b.{0,120}\b(?:unavailable|not found)`,
].join('|'), 'i')

const PROVIDER_WIRE_ERROR = /^\s*(?:[45]\d\d\s*:\s*)?\{[\s\S]*"(?:message|error|type|code)"\s*:/i

const PROVIDER_HTTP_STATUS = /(?:^|\D)[45]\d\d(?:\D|$)/

function isProviderFailureMessage(message: string): boolean {
  return PROVIDER_FAILURE_TEXT.test(message)
    || PROVIDER_WIRE_ERROR.test(message)
    || PROVIDER_HTTP_STATUS.test(message)
}

function isLlmFailure(value: unknown): value is LlmFailure {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { code?: unknown; message?: unknown }
  return typeof record.code === 'string' && typeof record.message === 'string'
}

function isProviderFailure(failure: LlmFailure): boolean {
  if (failure.status !== undefined && failure.status >= 400 && failure.status <= 599) return true
  if (PROVIDER_FAILURE_CODES.has(failure.code)) return true
  return isProviderFailureMessage(failure.message)
}

/**
 * Redact provider diagnostics carried as plain text, such as a live agent error chain.
 * @param message - developer-facing failure text.
 * @returns the original text when it carries no provider detail, otherwise generic Client copy.
 */
export function sanitizeProviderFailureMessage(message: string): string {
  return isProviderFailureMessage(message) ? MODEL_UNAVAILABLE_MESSAGE : message
}

/**
 * Replace provider diagnostics with a stable Client-facing failure.
 * The durable Session event keeps the original failure for internal diagnosis.
 * @param failure - structured failure recorded on a Session event.
 * @returns the original failure when it carries no provider detail, otherwise a redacted replacement.
 */
export function sanitizeProviderFailure(failure: LlmFailure): LlmFailure {
  if (!isProviderFailure(failure)) return failure
  if (failure.code === 'AUTH') return { code: 'AUTH', message: '' }
  return { code: MODEL_UNAVAILABLE_CODE, message: MODEL_UNAVAILABLE_MESSAGE }
}

/**
 * Redact provider failures on one logical Session event before it crosses the wire.
 * @param event - durable Session event read from the log.
 * @returns the same event when it carries no provider failure, otherwise a redacted copy.
 */
export function sanitizeProviderFailureEvent(event: SessionEvent): SessionEvent {
  if (event.type === 'turn/end') {
    const { reason } = event.data
    if (reason.kind !== 'error') return event
    const error = sanitizeProviderFailure(reason.error)
    if (error === reason.error) return event
    return { ...event, data: { ...event.data, reason: { kind: 'error', error } } }
  }
  if ((event.type as string) === 'llm/retry') {
    const data = event.data as { readonly failure?: unknown }
    if (!isLlmFailure(data.failure)) return event
    const failure = sanitizeProviderFailure(data.failure)
    if (failure === data.failure) return event
    return { ...event, data: { ...event.data, failure } } as unknown as SessionEvent
  }
  return event
}
