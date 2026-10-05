import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import { sessionTenantMap } from '../src/commands.ts'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'
import { createSessionTestController } from './test-remote.ts'

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  supabaseAdminClient: {
    rpc: vi.fn(),
  },
}))

const defaults = {
  defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

function createMockSession(id: string, events: unknown[] = []) {
  return {
    id,
    header: {
      version: 1,
      id,
      createdAt: 1,
      cwd: '/tmp',
      isSeeded: false,
    },
    inheritedEventCount: SessionLogOffset(0),
    snapshotEvents: () => events,
  } as unknown as Session
}

describe('Token Metering (turn/end and sessionTenantMap)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls increment_tenant_token_usage RPC with correct tokens on turn/end with usage', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMock as unknown as typeof supabaseAdminClient.rpc)

    const ctx = new Context()
    createSessionTestController(ctx, defaults)

    const fakeSession = createMockSession('session-123', [
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 0,
          usage: {
            inputTokens: 150,
            outputTokens: 50,
          },
        },
      },
      {
        type: 'assistant/attempt',
        data: {
          turn: 1,
          step: 1,
          usage: {
            inputTokens: 200,
            outputTokens: 100,
          },
        },
      },
      {
        type: 'assistant/message',
        data: {
          turn: 2, // different turn
          step: 0,
          usage: {
            inputTokens: 1000,
            outputTokens: 500,
          },
        },
      },
    ])

    sessionTenantMap.set(fakeSession, {
      tenantId: 'tenant-abc-123',
      userId: 'user-xyz',
    })

    ctx.emit('session/event', fakeSession, {
      type: 'turn/end',
      seq: SessionSeq(0),
      time: 1,
      data: { turn: 1, reason: 'complete' },
    } as never)

    await new Promise(r => setTimeout(r, 20))

    expect(rpcMock).toHaveBeenCalledWith('increment_tenant_token_usage', {
      p_tenant_id: 'tenant-abc-123',
      p_tokens: 500, // (150+50) + (200+100)
    })
    expect(rpcMock).toHaveBeenCalledWith('runtime_increment_session_tokens', {
      p_session_id: 'session-123',
      p_tokens: 500,
    })
  })

  it('does not call RPC when turn has no tokens / usage', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMock as unknown as typeof supabaseAdminClient.rpc)

    const ctx = new Context()
    createSessionTestController(ctx, defaults)

    const fakeSession = createMockSession('session-456', [
      {
        type: 'user/message',
        data: { turn: 1, source: { kind: 'user' } },
      },
    ])

    sessionTenantMap.set(fakeSession, {
      tenantId: 'tenant-abc-123',
      userId: 'user-xyz',
    })

    ctx.emit('session/event', fakeSession, {
      type: 'turn/end',
      seq: SessionSeq(0),
      time: 1,
      data: { turn: 1, reason: 'complete' },
    } as never)

    await new Promise(r => setTimeout(r, 20))

    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('cleans up sessionTenantMap on session/end and session/disposed', async () => {
    const ctx = new Context()
    createSessionTestController(ctx, defaults)

    const sessionA = createMockSession('sess-a')
    const sessionB = createMockSession('sess-b')

    sessionTenantMap.set(sessionA, { tenantId: 'tenant-1', userId: 'user-1' })
    sessionTenantMap.set(sessionB, { tenantId: 'tenant-2', userId: 'user-2' })

    expect(sessionTenantMap.get(sessionA)).toBeDefined()
    expect(sessionTenantMap.get(sessionB)).toBeDefined()

    ctx.emit('session/event', sessionA, {
      type: 'session/end',
      seq: SessionSeq(0),
      time: 1,
      data: {},
    } as never)

    expect(sessionTenantMap.get(sessionA)).toBeUndefined()
    expect(sessionTenantMap.get(sessionB)).toBeDefined()

    ctx.emit('session/disposed', sessionB)
    expect(sessionTenantMap.get(sessionB)).toBeUndefined()
  })

  it('logs warning when RPC fails without breaking execution', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rpcMock = vi.fn().mockRejectedValue(new Error('Postgres connection timeout'))
    vi.mocked(supabaseAdminClient.rpc).mockImplementation(rpcMock as unknown as typeof supabaseAdminClient.rpc)

    const ctx = new Context()
    createSessionTestController(ctx, defaults)

    const fakeSession = createMockSession('session-789', [
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 0,
          usage: {
            inputTokens: 100,
            outputTokens: 50,
          },
        },
      },
    ])

    sessionTenantMap.set(fakeSession, {
      tenantId: 'tenant-warn',
      userId: 'user-warn',
    })

    expect(() => {
      ctx.emit('session/event', fakeSession, {
        type: 'turn/end',
        seq: SessionSeq(0),
        time: 1,
        data: { turn: 1, reason: 'complete' },
      } as never)
    }).not.toThrow()

    await new Promise(r => setTimeout(r, 20))

    expect(rpcMock).toHaveBeenCalledWith('increment_tenant_token_usage', expect.anything())
    expect(rpcMock).toHaveBeenCalledWith('runtime_increment_session_tokens', expect.anything())
    expect(warnSpy).toHaveBeenCalledWith(
      '[metering] failed to increment token usage',
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })
})
