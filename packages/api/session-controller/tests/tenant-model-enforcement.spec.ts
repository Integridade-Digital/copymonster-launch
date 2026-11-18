/**
 * Tenant model enforcement on the prompt path: a non-admin tenant always runs
 * on the virtual CopyMonster alias, even when the Session recorded a real
 * provider from a profile provisioned before the platform route was fixed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import { SessionCommandController, tenantModelSelection } from '../src/commands.ts'
import { VIRTUAL_ALIAS } from '../src/catalog.ts'
import type { SessionRequestId } from '../src/types.ts'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createUserClient: vi.fn() }))

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  createUserClient: mocks.createUserClient,
}))

const TOKEN = 'caller-token'
const identity = { userId: 'user-1', tenantId: 'tenant-123', role: 'member', email: 'u@example.com' } as UserIdentity
const adminIdentity = { ...identity, isAdmin: true } as UserIdentity
const SOURCE: MessageSource = { kind: 'user', rpcId: 'req-1' as SessionRequestId }
const STALE = { provider: 'tokenharbor', model: 'deepseek-v4.1-flash:free' } as const

/** One Agent double whose model selection is observable. */
function agentDouble() {
  const selected: Array<{ provider: string; model: string }> = []
  let current: { provider: string; model: string } | undefined = { ...STALE }
  const agent = {
    id: 'sess-1',
    session: { header: {}, snapshotEvents: () => [] },
    inbox: { nextTurn: [], nextStep: [] },
    model: {
      current: () => current,
      select: (next: { provider: string; model: string }) => {
        current = next
        selected.push(next)
      },
    },
  } as unknown as Agent
  return { agent, selected }
}

function controller(agent: Agent): SessionCommandController {
  mocks.createUserClient.mockReturnValue({ rpc: mocks.rpc })
  const ctx = new Context()
  // No provider route is registered in this unit context; the admin path asks
  // the catalog and is refused before admission runs.
  ctx.provide('llm', { listProviders: () => [] } as never)
  return new SessionCommandController(
    ctx,
    { resolveAgent: () => Promise.resolve({ agent }) } as never,
  )
}

describe('tenant model enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({
      data: [{ allowed: true, reason: 'ok', remaining_tokens: 1000 }],
      error: null,
    })
  })

  it('selects the virtual alias for a tenant whose Session recorded a real provider', async () => {
    const { agent, selected } = agentDouble()
    const prompt = controller(agent).prompt(
      { sessionId: 'sess-1', requestId: 'req-1', mode: 'followup', content: [{ type: 'text', text: 'hello' }] } as never,
      SOURCE,
      undefined,
      identity,
      TOKEN,
    )
    // The prompt cannot finish without the attachment and upload services this
    // unit context omits; the enforcement point runs first and is what matters.
    await expect(prompt).rejects.toMatchObject({ code: 'session/agent-busy' })
    expect(selected).toEqual([{ ...VIRTUAL_ALIAS }])
  })

  it('leaves a platform administrator on the recorded real provider', async () => {
    const { agent, selected } = agentDouble()
    const prompt = controller(agent).prompt(
      { sessionId: 'sess-1', requestId: 'req-1', mode: 'followup', content: [{ type: 'text', text: 'hello' }] } as never,
      SOURCE,
      undefined,
      adminIdentity,
      TOKEN,
    )
    // The admin keeps the recorded route, and this unit context advertises no
    // provider, so the ordinary availability refusal fires instead.
    await expect(prompt).rejects.toMatchObject({ code: 'session/model-unavailable' })
    expect(selected).toEqual([])
  })

  it('leaves a caller without a tenant unenforced', () => {
    expect(tenantModelSelection(undefined)).toBeUndefined()
    expect(tenantModelSelection({ ...identity, tenantId: '' })).toBeUndefined()
  })

  it('resolves the enforcement alias to the tenant virtual model', () => {
    expect(tenantModelSelection(identity)).toEqual({ provider: 'copymonster', model: 'copy-monster-default' })
  })
})
