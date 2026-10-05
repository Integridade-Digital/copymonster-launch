import { describe, expect, it, vi, beforeEach } from 'vitest'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'
import {
  upsertSessionIndex,
  incrementSessionTokens,
  markSessionStatus,
} from '../src/session-db-sync.ts'

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: {
    rpc: vi.fn(),
  },
}))

describe('session-db-sync helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upsertSessionIndex invokes runtime_upsert_session_index with correct parameters', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMock as unknown as typeof supabaseAdminClient.rpc)

    upsertSessionIndex({
      sessionId: 'sess-001',
      tenantId: 'd3b07384-d113-4ec6-a111-222233334444',
      userId: 'e4c18495-e224-4fd7-b222-333344445555',
      title: 'Minha Sessão Nova',
      model: 'deepseek-chat',
      status: 'active',
    })

    await new Promise(r => setTimeout(r, 20))

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('runtime_upsert_session_index', {
      p_session_id: 'sess-001',
      p_tenant_id: 'd3b07384-d113-4ec6-a111-222233334444',
      p_user_id: 'e4c18495-e224-4fd7-b222-333344445555',
      p_title: 'Minha Sessão Nova',
      p_model: 'deepseek-chat',
      p_status: 'active',
    })
  })

  it('upsertSessionIndex allows updating existing session title/model without tenantId/userId', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMock as unknown as typeof supabaseAdminClient.rpc)

    upsertSessionIndex({
      sessionId: 'sess-001',
      title: 'Título Atualizado',
    })

    await new Promise(r => setTimeout(r, 20))

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('runtime_upsert_session_index', {
      p_session_id: 'sess-001',
      p_tenant_id: null,
      p_user_id: null,
      p_title: 'Título Atualizado',
      p_model: null,
      p_status: 'active',
    })
  })

  it('incrementSessionTokens invokes runtime_increment_session_tokens with positive rounded tokens', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMock as unknown as typeof supabaseAdminClient.rpc)

    incrementSessionTokens('sess-002', 1234.6)
    await new Promise(r => setTimeout(r, 20))

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('runtime_increment_session_tokens', {
      p_session_id: 'sess-002',
      p_tokens: 1235,
    })
  })

  it('incrementSessionTokens ignores negative or zero tokens', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMock as unknown as typeof supabaseAdminClient.rpc)

    incrementSessionTokens('sess-002', 0)
    incrementSessionTokens('sess-002', -50)
    await new Promise(r => setTimeout(r, 20))

    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('markSessionStatus invokes runtime_mark_session_status with requested status', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMock as unknown as typeof supabaseAdminClient.rpc)

    markSessionStatus('sess-003', 'completed')
    await new Promise(r => setTimeout(r, 20))

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('runtime_mark_session_status', {
      p_session_id: 'sess-003',
      p_status: 'completed',
    })
  })

  it('logs warning when RPC returns an error or rejects without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Case 1: RPC returns { error }
    const rpcMockError = vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } })
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMockError as unknown as typeof supabaseAdminClient.rpc)

    expect(() => upsertSessionIndex({ sessionId: 'sess-err' })).not.toThrow()
    await new Promise(r => setTimeout(r, 20))
    expect(warnSpy).toHaveBeenCalledWith(
      '[sessions_index] failed to upsert session index',
      { message: 'db error' },
    )

    // Case 2: RPC throws
    const rpcMockThrow = vi.fn().mockRejectedValue(new Error('network error'))
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMockThrow as unknown as typeof supabaseAdminClient.rpc)

    expect(() => incrementSessionTokens('sess-err', 100)).not.toThrow()
    expect(() => markSessionStatus('sess-err', 'error')).not.toThrow()
    await new Promise(r => setTimeout(r, 20))

    expect(warnSpy).toHaveBeenCalledWith(
      '[sessions_index] failed to increment session tokens',
      expect.any(Error),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      '[sessions_index] failed to mark session status',
      expect.any(Error),
    )

    warnSpy.mockRestore()
  })
})
