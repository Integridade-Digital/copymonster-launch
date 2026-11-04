import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  upsertSessionIndex,
  incrementSessionTokens,
  markSessionStatus,
} from '../src/session-db-sync.ts'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createUserClient: vi.fn() }))

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  createUserClient: mocks.createUserClient,
}))

describe('session-db-sync helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createUserClient.mockReturnValue({ rpc: mocks.rpc })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('upsertSessionIndex writes through the caller-scoped RPC', async () => {
    upsertSessionIndex({
      sessionId: 'sess-001',
      title: 'Minha Sessão Nova',
      model: 'deepseek-chat',
      status: 'active',
      token: 'token-1',
    })

    await new Promise(r => setTimeout(r, 20))

    expect(mocks.createUserClient).toHaveBeenCalledWith('token-1')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('runtime_upsert_my_session_index', {
      p_session_id: 'sess-001',
      p_title: 'Minha Sessão Nova',
      p_model: 'deepseek-chat',
      p_status: 'active',
    })
  })

  it('sends the fallback title when the caller supplies none', async () => {
    upsertSessionIndex({ sessionId: 'sess-004', status: 'active', token: 'token-1' })

    await new Promise(r => setTimeout(r, 20))

    expect(mocks.rpc).toHaveBeenCalledWith('runtime_upsert_my_session_index', {
      p_session_id: 'sess-004',
      p_title: 'Nova sessão',
      p_model: null,
      p_status: 'active',
    })
  })

  it('replaces an empty title with the fallback', async () => {
    upsertSessionIndex({ sessionId: 'sess-006', title: '', status: 'active', token: 'token-1' })

    await new Promise(r => setTimeout(r, 20))

    expect(mocks.rpc).toHaveBeenCalledWith('runtime_upsert_my_session_index', {
      p_session_id: 'sess-006',
      p_title: 'Nova sessão',
      p_model: null,
      p_status: 'active',
    })
  })

  it('skips the write and warns once when no caller token is available', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    upsertSessionIndex({ sessionId: 'sess-005', model: 'deepseek-chat' })
    upsertSessionIndex({ sessionId: 'sess-006', model: 'deepseek-chat' })
    await new Promise(r => setTimeout(r, 20))

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[sessions_index] upsert skipped: no caller token available for the tenant DSH',
    )
    warnSpy.mockRestore()
  })

  it('incrementSessionTokens rounds positive tokens and uses the caller RPC', async () => {
    incrementSessionTokens('sess-002', 1234.6, 'token-1')
    await new Promise(r => setTimeout(r, 20))

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('runtime_increment_my_session_tokens', {
      p_session_id: 'sess-002',
      p_tokens: 1235,
    })
  })

  it('incrementSessionTokens ignores negative or zero tokens', async () => {
    incrementSessionTokens('sess-002', 0, 'token-1')
    incrementSessionTokens('sess-002', -50, 'token-1')
    await new Promise(r => setTimeout(r, 20))

    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('markSessionStatus uses the caller RPC with the requested status', async () => {
    markSessionStatus('sess-003', 'completed', 'token-1')
    await new Promise(r => setTimeout(r, 20))

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('runtime_mark_my_session_status', {
      p_session_id: 'sess-003',
      p_status: 'completed',
    })
  })

  it('logs a warning when the RPC returns an error or rejects without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db error' } })
    expect(() => upsertSessionIndex({ sessionId: 'sess-err', token: 'token-1' })).not.toThrow()
    await new Promise(r => setTimeout(r, 20))
    expect(warnSpy).toHaveBeenCalledWith(
      '[sessions_index] failed to upsert session index',
      { message: 'db error' },
    )

    mocks.rpc.mockRejectedValue(new Error('network error'))
    expect(() => incrementSessionTokens('sess-err', 100, 'token-1')).not.toThrow()
    expect(() => markSessionStatus('sess-err', 'error', 'token-1')).not.toThrow()
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

  it('never touches Supabase when the session id is empty', async () => {
    upsertSessionIndex({ sessionId: '', token: 'token-1' })
    incrementSessionTokens('', 10, 'token-1')
    markSessionStatus('', 'completed', 'token-1')
    await new Promise(r => setTimeout(r, 20))

    expect(mocks.createUserClient).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
