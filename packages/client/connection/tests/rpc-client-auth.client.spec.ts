import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebConnectionRpc } from '../src/client/rpc.ts'

type AuthGlobal = { __DSH_AUTH__?: { accessToken?: string } }

afterEach(() => {
  delete (globalThis as AuthGlobal).__DSH_AUTH__
})

describe('createWebConnectionRpc authorization', () => {
  it('sends the published Supabase bearer token', async () => {
    ;(globalThis as AuthGlobal).__DSH_AUTH__ = { accessToken: 'supabase-token' }
    const send = vi.fn(async (_input: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { rpcId: string }
      return Response.json({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: null },
      })
    })
    const rpc = createWebConnectionRpc(send)
    await rpc.call('/dsh-automation' as never, 'snapshot', {}, undefined)
    const init = send.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer supabase-token',
    })
  })

  it('omits authorization when no session token is published', async () => {
    const send = vi.fn(async (_input: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { rpcId: string }
      return Response.json({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: null },
      })
    })
    const rpc = createWebConnectionRpc(send)
    await rpc.call('/dsh-automation' as never, 'snapshot', {}, undefined)
    const init = send.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).not.toHaveProperty('authorization')
  })
})
