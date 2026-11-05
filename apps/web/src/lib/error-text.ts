/**
 * Render a caught value as readable text.
 * PostgREST failures arrive as plain objects carrying message, code, details,
 * and hint, so `String(error)` would lose the real cause as `[object Object]`.
 * @param error - value caught from a promise or thrown by a request.
 * @returns the most specific message available for the user.
 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string') {
      const code = typeof record.code === 'string' ? ` (${record.code})` : ''
      const hint = typeof record.hint === 'string' ? ` – ${record.hint}` : ''
      return `${record.message}${code}${hint}`
    }
    const serialized = safeJson(error)
    if (serialized !== undefined) return serialized
  }
  return String(error)
}

/**
 * Serialize a value without letting a circular reference hide the failure.
 * @param value - caught value that is not an Error and has no message field.
 * @returns the JSON text, or undefined when the value cannot be serialized.
 */
function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}
