import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { resolveUserSandboxRoot } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it } from 'vitest'
import { SessionCommandController } from '../src/commands.ts'
import { ApiSessionList } from '../src/list.ts'
import { SessionHistoryController } from '../src/history.ts'
import { installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

const identityA: UserIdentity = {
  userId: 'user-a',
  tenantId: 'tenant-a',
  role: 'member',
  email: 'user-a@example.com',
}
const identityB: UserIdentity = {
  userId: 'user-b',
  tenantId: 'tenant-b',
  role: 'member',
  email: 'user-b@example.com',
}
const sandboxA = resolveUserSandboxRoot(identityA.tenantId, identityA.userId)
const sandboxB = resolveUserSandboxRoot(identityB.tenantId, identityB.userId)

function sessionHeader(sessionId: string, cwd: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: sessionId as SessionId,
    createdAt: 1,
    cwd,
    isSeeded: false,
  }
}

async function listContext(sessions: readonly SessionHeader[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve(sessions),
    inspect: () => Promise.resolve(undefined),
  }) as never)
  installSessionReadTestServices(ctx)
  return ctx
}

describe('Session multi-tenant isolation', () => {
  it('user B does not see user A sessions in list', async () => {
    const ctx = await listContext([
      sessionHeader('session-a', `${sandboxA}/project-a`),
      sessionHeader('session-b', `${sandboxB}/project-b`),
    ])
    const list = new ApiSessionList(ctx)

    const itemsB = await list.list(undefined, sandboxB)
    const idsB = itemsB.map(item => item.sessionId)
    expect(idsB).toContain('session-b')
    expect(idsB).not.toContain('session-a')

    const itemsA = await list.list(undefined, sandboxA)
    const idsA = itemsA.map(item => item.sessionId)
    expect(idsA).toContain('session-a')
    expect(idsA).not.toContain('session-b')
  })

  it('excludes sessions without a cwd from the filtered list', async () => {
    const noCwdHeader: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: 'session-nocwd' as SessionId,
      createdAt: 1,
      isSeeded: false,
    }
    const ctx = await listContext([noCwdHeader, sessionHeader('session-b', `${sandboxB}/project-b`)])
    const list = new ApiSessionList(ctx)

    const itemsB = await list.list(undefined, sandboxB)
    const idsB = itemsB.map(item => item.sessionId)
    expect(idsB).toContain('session-b')
    expect(idsB).not.toContain('session-nocwd')
  })

  it('user B cannot page user A session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([sessionHeader('session-a', `${sandboxA}/project-a`)]),
      inspect: () => Promise.resolve({
        meta: sessionHeader('session-a', `${sandboxA}/project-a`),
        inheritedEventCount: 0,
        events: [],
      }),
    }) as never)
    installSessionReadTestServices(ctx)

    const history = new SessionHistoryController(ctx, () => {})
    await expect(history.page({
      address: { kind: 'session', sessionId: 'session-a' as SessionId },
      throughSeq: -1,
    }, new AbortController().signal, sandboxB)).rejects.toMatchObject({
      code: 'session/unauthorized',
    })
  })

  it('user B cannot prompt user A session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create('session-a' as SessionId, {
      meta: sessionHeader('session-a', `${sandboxA}/project-a`),
    })
    const agent = {
      id: 'session-a' as SessionId,
      session,
      status: 'idle',
      ctx,
      inbox: { nextTurn: [], nextStep: [] },
      steer: () => {},
      followup: () => {},
      cancel: () => {},
    } as unknown as Agent
    await ctx.agents.register(agent)
    ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 5242880,
        maxImagesPerMessage: 20,
        maxMessageImageBytes: 104857600,
        maxImagePixels: 40000000,
        maxImageDimension: 2000,
        mediaTypes: ['image/png'],
      },
      admitPromptContent: async (content: readonly unknown[]) => [...content] as never,
    } as never)
    ctx.provide('fileUploads', {
      registerAgentResolver: () => () => {},
      resolve: () => undefined,
      bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
      retirePrompt: () => {},
    } as never)

    const agents = {
      ensureSession: () => Promise.resolve(),
      composeAgent: () => Promise.resolve({ setup: () => {} }),
      presetForSession: () => undefined,
      presetForObservation: () => undefined,
      resolveAgent: () => Promise.resolve({ agent }),
      serializeImageAdmission: (_agent: unknown, op: () => Promise<unknown>) => op(),
      selectionFor: () => ({ current: { provider: 'fixture', model: 'fixture-model' } }),
    } as never

    const commands = new SessionCommandController(ctx, agents)
    await expect(commands.prompt({
      requestId: 'req-1' as never,
      sessionId: 'session-a' as SessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    }, sandboxB)).rejects.toMatchObject({
      code: 'session/unauthorized',
    })
  })

  it('user B cannot rename user A session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create('session-a' as SessionId, {
      meta: sessionHeader('session-a', `${sandboxA}/project-a`),
    })
    const agent = {
      id: 'session-a' as SessionId,
      session,
      status: 'idle',
      ctx,
    } as unknown as Agent
    await ctx.agents.register(agent)

    const agents = {
      ensureSession: () => Promise.resolve(),
      composeAgent: () => Promise.resolve({ setup: () => {} }),
      presetForSession: () => undefined,
      presetForObservation: () => undefined,
      resolveAgent: () => Promise.resolve({ agent }),
      serializeImageAdmission: (_agent: unknown, op: () => Promise<unknown>) => op(),
      selectionFor: () => ({ current: { provider: 'fixture', model: 'fixture-model' } }),
    } as never

    const commands = new SessionCommandController(ctx, agents)
    await expect(commands.rename({
      sessionId: 'session-a' as SessionId,
      title: 'new title',
    }, sandboxB)).rejects.toMatchObject({
      code: 'session/unauthorized',
    })
  })

  it('user B cannot fork user A session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([sessionHeader('session-a', `${sandboxA}/project-a`)]),
      inspect: () => Promise.resolve({
        meta: sessionHeader('session-a', `${sandboxA}/project-a`),
        inheritedEventCount: 0,
        events: [{ type: 'turn/end', seq: 0, time: 1, data: {} } as never],
      }),
    }) as never)
    installSessionReadTestServices(ctx)

    const agents = {
      ensureSession: () => Promise.resolve(),
      composeAgent: () => Promise.resolve({ setup: () => {} }),
      presetForSession: () => undefined,
      presetForObservation: () => undefined,
      resolveAgent: () => Promise.resolve({ error: { code: 'session/not-found' } }),
      serializeImageAdmission: (_agent: unknown, op: () => Promise<unknown>) => op(),
      selectionFor: () => ({ current: { provider: 'fixture', model: 'fixture-model' } }),
    } as never

    const commands = new SessionCommandController(ctx, agents)
    await expect(commands.fork({
      sessionId: 'session-a' as SessionId,
    }, sandboxB)).rejects.toMatchObject({
      code: 'session/unauthorized',
    })
  })
})
