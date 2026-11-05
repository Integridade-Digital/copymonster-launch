import { describe, expect, it } from 'vitest'
import { errorText } from '../src/lib/error-text'

describe('errorText', () => {
  it('reads the message of a real Error', () => {
    expect(errorText(new Error('network down'))).toBe('network down')
  })

  it('reads PostgREST objects with code and hint', () => {
    expect(errorText({
      message: 'The schema must be one of the following',
      code: 'PGRST106',
      hint: 'Expose affiliate and finance in the API settings',
    })).toBe('The schema must be one of the following (PGRST106) – Expose affiliate and finance in the API settings')
  })

  it('serializes objects without a message and falls back for circular values', () => {
    expect(errorText({ status: 406 })).toBe('{"status":406}')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(errorText(circular)).toBe('[object Object]')
  })

  it('keeps strings and unknown primitives readable', () => {
    expect(errorText('plain failure')).toBe('plain failure')
    expect(errorText(406)).toBe('406')
  })
})
