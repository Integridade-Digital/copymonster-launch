import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { guardAutomationModel } from '../src/automation-model-guard.ts'

function ctxFor(identity: { isAdmin?: boolean } | undefined): Context {
  return {
    auth: { resolveIdentity: async () => identity },
  } as unknown as Context
}

function request(token?: string): Request {
  return new Request('http://localhost/dsh-automation/create', {
    method: 'POST',
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })
}

const payload = {
  sessionId: 'settings',
  input: {
    name: 'Daily check',
    prompt: 'Check the build',
    provider: 'agentrouter',
    model: 'claude-opus-5',
    modelKey: 'agentrouter::claude-opus-5',
    reasoningEffort: 'high',
    permission: 'read-only',
  },
}

describe('automation model guard', () => {
  it('passes admin create/update payloads through unchanged', async () => {
    const result = await guardAutomationModel(ctxFor({ isAdmin: true }), request('admin-token'), 'create', payload)
    expect(result).toEqual({ payload })
  })

  it('forces the global model for non-admin explicit selections', async () => {
    const result = await guardAutomationModel(ctxFor({ isAdmin: false }), request('member-token'), 'update', payload)
    expect(result).toEqual({
      payload: {
        sessionId: 'settings',
        input: {
          name: 'Daily check',
          prompt: 'Check the build',
          permission: 'read-only',
          provider: null,
          model: null,
          reasoningEffort: null,
        },
      },
    })
  })

  it('fails closed when the request has no bearer token', async () => {
    const result = await guardAutomationModel(ctxFor({ isAdmin: true }), request(), 'create', payload)
    expect((result as { payload: typeof payload }).payload.input).toMatchObject({
      provider: null,
      model: null,
      reasoningEffort: null,
    })
  })

  it('leaves read endpoints and model-free payloads untouched', async () => {
    const snapshot = await guardAutomationModel(ctxFor({ isAdmin: false }), request('member-token'), 'snapshot', payload)
    expect(snapshot).toEqual({ payload })
    const noModel = {
      sessionId: 'settings',
      input: { name: 'No model', prompt: 'No explicit model', permission: 'read-only' },
    }
    const result = await guardAutomationModel(ctxFor(undefined), request('invalid'), 'create', noModel)
    expect(result).toEqual({ payload: noModel })
  })
})
