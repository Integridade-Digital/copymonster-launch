/**
 * Session index writes through the caller's own Supabase client.
 *
 * The `runtime_*_my_*` RPCs derive the tenant and user from `auth.uid()` and
 * validate that the session belongs to the caller, so the tenant DSH never
 * needs the service-role key for its own index. A write with no caller token
 * is skipped with one warning: the durable Session log is the source of truth,
 * and the index is a derived read model.
 * @module @deepseek-ai/dsh-api-session-controller/session-db-sync
 */

import { createUserClient } from '@deepseek-ai/dsh-supabase-client'

/** Fields the session index accepts from a caller-scoped write. */
export interface UpsertSessionIndexParams {
  sessionId: string
  title?: string | undefined
  model?: string | undefined
  status?: string | undefined
  /** Bearer token of the caller the session belongs to. */
  token?: string | undefined
}

/** Fallback title for a host-created index row; the Supabase column is NOT NULL. */
const FALLBACK_SESSION_TITLE = 'Nova sessão'

/** Warn once per process when a write has no caller token to authorize it. */
let warnedMissingToken = false

/**
 * Report a skipped index write without repeating the warning on every turn.
 * @param operation - index operation that could not run.
 */
function warnMissingToken(operation: string): void {
  if (warnedMissingToken) return
  warnedMissingToken = true
  console.warn(`[sessions_index] ${operation} skipped: no caller token available for the tenant DSH`)
}

/**
 * Upsert one row of the caller's session index.
 * @param params - session identity, optional title/model/status, and caller token.
 */
export function upsertSessionIndex(params: UpsertSessionIndexParams): void {
  if (!params.sessionId) return
  const { token } = params
  if (token === undefined || token === '') {
    warnMissingToken('upsert')
    return
  }
  // The Supabase column is NOT NULL, so an insert-capable path must never send
  // a null or empty title. Updates without a title pass null so the RPC's
  // COALESCE preserves a title already set by rename.
  const title = params.title || FALLBACK_SESSION_TITLE
  void (async () => {
    try {
      const { error } = await createUserClient(token).rpc('runtime_upsert_my_session_index', {
        p_session_id: params.sessionId,
        p_title: title,
        p_model: params.model ?? null,
        p_status: params.status ?? 'active',
      })
      if (error) {
        console.warn('[sessions_index] failed to upsert session index', error)
      }
    } catch (err) {
      console.warn('[sessions_index] failed to upsert session index', err)
    }
  })()
}

/**
 * Add one turn's tokens to the caller's session index.
 * @param sessionId - indexed session.
 * @param tokens - non-negative token count for the turn.
 * @param token - bearer token of the caller the session belongs to.
 */
export function incrementSessionTokens(sessionId: string, tokens: number, token?: string): void {
  if (!sessionId || !tokens || tokens <= 0) return
  if (token === undefined || token === '') {
    warnMissingToken('token increment')
    return
  }
  void (async () => {
    try {
      const { error } = await createUserClient(token).rpc('runtime_increment_my_session_tokens', {
        p_session_id: sessionId,
        p_tokens: Math.round(tokens),
      })
      if (error) {
        console.warn('[sessions_index] failed to increment session tokens', error)
      }
    } catch (err) {
      console.warn('[sessions_index] failed to increment session tokens', err)
    }
  })()
}

/**
 * Mark the caller's session index row with a terminal or active status.
 * @param sessionId - indexed session.
 * @param status - one of active, completed, archived, error.
 * @param token - bearer token of the caller the session belongs to.
 */
export function markSessionStatus(
  sessionId: string,
  status: 'active' | 'completed' | 'archived' | 'error',
  token?: string,
): void {
  if (!sessionId) return
  if (token === undefined || token === '') {
    warnMissingToken('status update')
    return
  }
  void (async () => {
    try {
      const { error } = await createUserClient(token).rpc('runtime_mark_my_session_status', {
        p_session_id: sessionId,
        p_status: status,
      })
      if (error) {
        console.warn('[sessions_index] failed to mark session status', error)
      }
    } catch (err) {
      console.warn('[sessions_index] failed to mark session status', err)
    }
  })()
}
