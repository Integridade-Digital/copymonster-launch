/**
 * C-06: `session.follow` is a bearer-token verb. It refuses a call without a
 * token and refuses a Session whose cwd is outside the caller's sandbox, so a
 * member cannot read another user's transcript through the live stream.
 */

import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { resolveUserSandboxRoot } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it } from 'vitest'
import SessionController from '../src/index.ts'
import { TEST_IDENTITY, installSessionReadTestServices, testSandboxCwd, testSessionPersistence } from './test-remote.ts'

function header(sessionId: string, cwd: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: sessionId as SessionId, createdAt: 1, cwd, isSeeded: false }
}

/** Boot the controller as a class plugin so `[Service.init]` builds its history face. */
async function boot(headerValue: SessionHeader): Promise<{ ctx: Context; controller: SessionController }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve([headerValue]),
    inspect: () => Promise.resolve({
      meta: headerValue,
      inheritedEventCount: 0,
      events: [],
    }),
  }) as never)
  ctx.provide('auth', {
    resolveIdentity: (token: string) =>
      token === 'test-token' ? Promise.resolve(TEST_IDENTITY) : Promise.resolve(undefined),
  } as never)
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
    resources: { register: () => () => {} },
  } as never)
  ctx.provide('remoteAccess', { allows: () => true, registerPolicy: () => () => {} } as never)
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 5 * 1024 * 1024, maxImagesPerMessage: 20, maxMessageImageBytes: 100 * 1024 * 1024,
      maxImagePixels: 40_000_000, maxImageDimension: 2000, mediaTypes: ['image/png'],
    },
    admitPromptContent: async (content: readonly unknown[]) => [...content] as never,
  } as never)
  ctx.provide('fileUploads', {
    registerAgentResolver: () => () => {},
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
    retirePrompt: () => {},
  } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: async () => {},
  } as never)
  installSessionReadTestServices(ctx)
  ctx.provide('fs', {
    readFile: () => Promise.resolve(new Uint8Array()),
    realpath: (path: string) => Promise.resolve(path),
  } as never)
  ctx.provide('workspaceRegistry', {
    archivedSessionIds: [],
    list: () => [],
    get: () => undefined,
  } as never)
  await ctx.plugin(SessionController, { nativeOpen: false })
  return { ctx, controller: ctx.sessionController }
}

describe('session.follow identity requirement', () => {
  it('rejects a follow without an auth token', async () => {
    const { ctx, controller } = await boot(header('follow-no-token', testSandboxCwd()))
    const iterator = controller.follow({
      address: { kind: 'session', sessionId: 'follow-no-token' as SessionId },
    }, new AbortController().signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'session/unauthorized',
    })
    await ctx.fiber.dispose()
  })

  it('rejects a follow of a session outside the caller sandbox', async () => {
    const otherSandbox = `${resolveUserSandboxRoot('other-tenant', 'other-user')}/project`
    const { ctx, controller } = await boot(header('follow-foreign-sandbox', otherSandbox))
    const iterator = controller.follow({
      address: { kind: 'session', sessionId: 'follow-foreign-sandbox' as SessionId },
      authToken: 'test-token',
    }, new AbortController().signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'session/unauthorized',
    })
    await ctx.fiber.dispose()
  })

  it('opens a session inside the caller sandbox with a valid token', async () => {
    const { ctx, controller } = await boot(header('follow-own-sandbox', testSandboxCwd()))
    const abort = new AbortController()
    const iterator = controller.follow({
      address: { kind: 'session', sessionId: 'follow-own-sandbox' as SessionId },
      authToken: 'test-token',
    }, abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'snapshot' },
    })
    abort.abort()
    await iterator.return?.()
    await ctx.fiber.dispose()
  })
})
