import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'

export interface UpsertSessionIndexParams {
  sessionId: string
  tenantId?: string | undefined
  userId?: string | undefined
  title?: string | undefined
  model?: string | undefined
  status?: string | undefined
}

export function upsertSessionIndex(params: UpsertSessionIndexParams): void {
  if (!params.sessionId) return
  void (async () => {
    try {
      const { error } = await (supabaseAdminClient as unknown as {
        rpc: (name: string, params: Record<string, unknown>) => Promise<{ error: unknown }>
      }).rpc('runtime_upsert_session_index', {
        p_session_id: params.sessionId,
        p_tenant_id: params.tenantId ?? null,
        p_user_id: params.userId ?? null,
        p_title: params.title ?? null,
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

export function incrementSessionTokens(sessionId: string, tokens: number): void {
  if (!sessionId || !tokens || tokens <= 0) return
  void (async () => {
    try {
      const { error } = await (supabaseAdminClient as unknown as {
        rpc: (name: string, params: Record<string, unknown>) => Promise<{ error: unknown }>
      }).rpc('runtime_increment_session_tokens', {
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

export function markSessionStatus(
  sessionId: string,
  status: 'active' | 'completed' | 'archived' | 'error',
): void {
  if (!sessionId) return
  void (async () => {
    try {
      const { error } = await (supabaseAdminClient as unknown as {
        rpc: (name: string, params: Record<string, unknown>) => Promise<{ error: unknown }>
      }).rpc('runtime_mark_session_status', {
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
