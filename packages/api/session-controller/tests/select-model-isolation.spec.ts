import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionCommandController } from '../src/commands.ts'
import type { AgentModelSelection, SessionId } from '../src/types.ts'

describe('session-controller selectModel isolation', () => {
  it('selectModel scopes selection to the session and does NOT call agentDefaultModel.saveSelection', async () => {
    const saveSelectionSpy = vi.fn().mockResolvedValue(undefined)
    const selectSpy = vi.fn()

    const mockAgent = {
      model: {
        select: selectSpy,
      },
    }

    const ctx = new Context()
    ctx.provide('llm')
    ctx.provide('agentDefaultModel')
    ctx.provide('agents')

    // Mock services
    ctx.agents = {
      serializeImageAdmission: (_agent: any, fn: any) => fn(),
    } as any

    ctx.agentDefaultModel = {
      saveSelection: saveSelectionSpy,
    } as any

    ctx.llm = {
      resolveCallConfig: vi.fn().mockResolvedValue({ provider: 'copymonster', model: 'copy-monster-default' }),
      listProviders: () => [],
    } as any

    const mockAgents = {
      serializeImageAdmission: (_agent: any, fn: any) => fn(),
    }
    const controller = new SessionCommandController(ctx, mockAgents as any)

    // Stub resolveAgent and requireModel
    vi.spyOn(controller as any, 'resolveAgent').mockResolvedValue(mockAgent)
    vi.spyOn(controller as any, 'requireModel').mockResolvedValue(undefined)
    vi.spyOn(controller as any, 'requireWritableSession').mockResolvedValue(undefined)

    const result = await controller.selectModel({
      sessionId: 'test-session-1' as SessionId,
      provider: 'copymonster',
      model: 'copy-monster-default',
    })

    expect(result.selected).toEqual({
      provider: 'copymonster',
      model: 'copy-monster-default',
    })

    // agent.model.select was called for this session's agent
    expect(selectSpy).toHaveBeenCalledTimes(1)
    expect(selectSpy).toHaveBeenCalledWith({
      provider: 'copymonster',
      model: 'copy-monster-default',
    })

    // agentDefaultModel.saveSelection was NOT called (strictly isolated)
    expect(saveSelectionSpy).not.toHaveBeenCalled()
  })
})
