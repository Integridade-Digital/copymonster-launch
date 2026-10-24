/** Provider failure redaction at the Session wire boundary. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  MODEL_UNAVAILABLE_CODE,
  MODEL_UNAVAILABLE_MESSAGE,
  sanitizeProviderFailure,
  sanitizeProviderFailureEvent,
  sanitizeProviderFailureMessage,
} from '../src/provider-error.ts'

describe('provider failure sanitization', () => {
  it('replaces a provider campaign failure with generic copy', () => {
    const failure = {
      code: 'UNKNOWN',
      status: 404,
      message: '404: {"message":"The free offer `Claude Haiku5.5 — Limited Time` has ended. Use the paid model `claude-haiku-5.5` to keep going.","type":"campaign_ended","code":"campaign_ended"}',
    }

    expect(sanitizeProviderFailure(failure)).toEqual({
      code: MODEL_UNAVAILABLE_CODE,
      message: MODEL_UNAVAILABLE_MESSAGE,
    })
  })

  it('redacts provider codes even when the message is innocuous', () => {
    expect(sanitizeProviderFailure({ code: 'RATE_LIMIT', message: 'slow down' })).toEqual({
      code: MODEL_UNAVAILABLE_CODE,
      message: MODEL_UNAVAILABLE_MESSAGE,
    })
  })

  it('redacts an upstream HTTP error without a known code', () => {
    expect(sanitizeProviderFailure({ code: 'UNKNOWN', status: 503, message: 'busy' })).toEqual({
      code: MODEL_UNAVAILABLE_CODE,
      message: MODEL_UNAVAILABLE_MESSAGE,
    })
  })

  it('keeps the AUTH code but drops the provider diagnostic', () => {
    expect(sanitizeProviderFailure({ code: 'AUTH', status: 401, message: 'key sk-secret rejected' })).toEqual({
      code: 'AUTH',
      message: '',
    })
  })

  it('preserves a non-provider failure', () => {
    const failure = { code: 'UNKNOWN', message: 'tool output could not be parsed' }
    expect(sanitizeProviderFailure(failure)).toBe(failure)
  })

  it('redacts provider text carried outside a structured failure', () => {
    expect(sanitizeProviderFailureMessage('campaign_ended: paid model required'))
      .toBe(MODEL_UNAVAILABLE_MESSAGE)
    expect(sanitizeProviderFailureMessage('404: {"type":"campaign_ended"}'))
      .toBe(MODEL_UNAVAILABLE_MESSAGE)
    expect(sanitizeProviderFailureMessage('tool output could not be parsed'))
      .toBe('tool output could not be parsed')
  })

  it('redacts a turn/end failure without mutating the durable event', () => {
    const event = {
      type: 'turn/end',
      seq: 3,
      time: 10,
      data: {
        turn: 1,
        reason: {
          kind: 'error',
          error: {
            code: 'UNKNOWN',
            message: '404: {"message":"offer ended","type":"campaign_ended","code":"campaign_ended"}',
          },
        },
      },
    } as SessionEvent

    const sanitized = sanitizeProviderFailureEvent(event)

    expect(sanitized).toMatchObject({
      type: 'turn/end',
      seq: 3,
      data: {
        turn: 1,
        reason: {
          kind: 'error',
          error: { code: MODEL_UNAVAILABLE_CODE, message: MODEL_UNAVAILABLE_MESSAGE },
        },
      },
    })
    expect(event).toMatchObject({
      data: { reason: { kind: 'error', error: { code: 'UNKNOWN' } } },
    })
  })

  it('redacts a retry failure carried by an extension event', () => {
    const event = {
      type: 'llm/retry',
      seq: 4,
      time: 11,
      data: {
        turn: 1,
        step: 1,
        failure: { code: 'PI_AI_ERROR', message: 'campaign_ended: paid model required' },
      },
    } as unknown as SessionEvent

    expect(sanitizeProviderFailureEvent(event)).toMatchObject({
      data: { failure: { code: MODEL_UNAVAILABLE_CODE, message: MODEL_UNAVAILABLE_MESSAGE } },
    })
  })
})
