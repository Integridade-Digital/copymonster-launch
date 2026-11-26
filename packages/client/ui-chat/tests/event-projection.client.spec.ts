/**
 * Context producer projection: the role and producer name a transcript row
 * shows for one logged non-user message, read from the durable source alone.
 */

import { describe, expect, it } from 'vitest'
import {
  contextForm, contextProducer, sessionRecallLabels,
} from '../src/client/conversation-nodes/event-projection.ts'

describe('contextProducer', () => {
  it('names a plugin producer by its logged plugin id', () => {
    expect(contextProducer({ kind: 'dsh-tool-skill' }))
      .toEqual({ role: 'inject', label: 'dsh-tool-skill' })
  })

  it('names an explicitly invoked skill', () => {
    expect(contextProducer({ kind: 'skill-invocation', name: 'review' }))
      .toEqual({ role: 'inject', label: 'review' })
  })

  it('names workspace instructions by the files they reconciled, deduplicated in first-seen order', () => {
    expect(contextProducer({
      kind: 'agent-instructions',
      baseline: true,
      changes: [
        { action: 'set', scope: '.\0AGENTS.md', path: 'AGENTS.md' },
        { action: 'set', scope: 'sub\0AGENTS.md', path: 'sub/AGENTS.md' },
        { action: 'replace', scope: '.\0AGENTS.md', path: 'AGENTS.md' },
      ],
    })).toEqual({ role: 'inject', label: 'AGENTS.md, sub/AGENTS.md' })
  })

  it('marks a cross-session snapshot as recall and names the sessions it read', () => {
    expect(contextProducer({
      kind: 'session-reference',
      version: 1,
      references: [{ sessionId: 's1', label: 'Refactor the loader' }, { sessionId: 's2', label: 'Fix CI' }],
    })).toEqual({ role: 'recall', label: 'Refactor the loader, Fix CI' })
  })

  it('identifies a producer this UI version does not know by its own durable kind', () => {
    expect(contextProducer({ kind: 'subagent-report', senderSessionId: 'child' }))
      .toEqual({ role: 'inject', label: 'subagent-report' })
  })

  it('falls back to the source kind when the expected name field is unusable', () => {
    // Every arm keeps the kind as its last readable name: a missing, empty, or
    // wrongly-typed name field must not blank the row header.
    expect(contextProducer({ kind: 'plugin' }).label).toBe('plugin')
    expect(contextProducer({ kind: 'plugin', plugin: '' }).label).toBe('plugin')
    expect(contextProducer({ kind: 'plugin', plugin: 7 }).label).toBe('plugin')
    expect(contextProducer({ kind: 'agent-instructions', changes: [] }).label)
      .toBe('agent-instructions')
    expect(contextProducer({ kind: 'agent-instructions', changes: 'AGENTS.md' }).label)
      .toBe('agent-instructions')
    expect(contextProducer({ kind: 'agent-instructions', changes: [{ action: 'set' }, null] }).label)
      .toBe('agent-instructions')
    expect(contextProducer({ kind: 'session-reference', references: [] }))
      .toEqual({ role: 'recall', label: 'session-reference' })
  })

  it('degrades to an unnamed injection for a source that carries no readable kind', () => {
    const unnamed = { role: 'inject', label: null }
    expect(contextProducer(null)).toEqual(unnamed)
    expect(contextProducer(undefined)).toEqual(unnamed)
    expect(contextProducer('plugin')).toEqual(unnamed)
    expect(contextProducer([{ kind: 'plugin' }])).toEqual(unnamed)
    expect(contextProducer({ plugin: 'dsh-tool-skill' })).toEqual(unnamed)
    expect(contextProducer({ kind: 42 })).toEqual(unnamed)
  })
})

describe('contextForm', () => {
  it('reads the form a producer declared', () => {
    expect(contextForm({ kind: 'agent-instructions', form: 'instructions', changes: [] }))
      .toBe('instructions')
    expect(contextForm({ kind: 'skill-catalog', form: 'catalog', entries: [] })).toBe('catalog')
    expect(contextForm({ kind: 'plugin', form: 'snapshot', sections: [] })).toBe('snapshot')
    expect(contextForm({ kind: 'plugin', form: 'notice', summary: 'x' })).toBe('notice')
    expect(contextForm({ kind: 'subagent-report', form: 'relay' })).toBe('relay')
    expect(contextForm({ kind: 'session-reference', form: 'recall' })).toBe('recall')
  })

  it('degrades to the opaque presentation for anything this version does not present', () => {
    // The durable vocabulary may already be wider than this UI version, and a
    // source need not declare a form at all; neither may drop the row.
    expect(contextForm({ kind: 'plugin', plugin: 'dsh-tool-skill' })).toBeNull()
    // A durable vocabulary wider than this UI version still renders.
    expect(contextForm({ kind: 'plugin', form: 'a-later-form' })).toBeNull()
    expect(contextForm({ kind: 'plugin', form: '' })).toBeNull()
    expect(contextForm({ kind: 'plugin', form: 7 })).toBeNull()
    expect(contextForm(null)).toBeNull()
    expect(contextForm('instructions')).toBeNull()
  })
})

describe('sessionRecallLabels', () => {
  it('collects distinct labels of a session-reference source and nothing else', () => {
    expect(sessionRecallLabels({
      kind: 'session-reference',
      form: 'recall',
      version: 1,
      references: [{ label: 'A' }, { label: 'B' }, { label: 'A' }, { notLabel: true }],
    })).toEqual(['A', 'B'])
    expect(sessionRecallLabels({ kind: 'session-reference', references: 'corrupt' })).toEqual([])
    expect(sessionRecallLabels({ kind: 'plugin', plugin: 'session-reference' })).toEqual([])
    expect(sessionRecallLabels(null)).toEqual([])
  })
})


import { displayFailure } from '../src/client/conversation-nodes/event-projection.ts'

describe('displayFailure sanitization', () => {
  it('strips openrouter rate-limit URLs and provider names from error messages', () => {
    const raw = 'Error: Provider returned error: Rate limit exceeded: free-models-per-day. Add credits to continue using this model or upgrade to a higher tier: https://openrouter.ai/settings/credits'
    const result = displayFailure({ message: raw, code: 'openrouter/rate-limit' })
    expect(result.message).not.toContain('openrouter')
    expect(result.message).not.toContain('https://')
    expect(result.message).toContain('Limite de requisições excedido')
    // Ensures provider path code is scrubbed
    expect(result.code).toBeUndefined()
  })

  it('sanitizes quota and credit balance error messages from providers', () => {
    const raw = 'insufficient balance on provider account'
    const result = displayFailure({ message: raw })
    expect(result.message).toContain('Cota de utilização do serviço de IA temporariamente indisponível')
  })

  it('does NOT sanitize first-party session quota refusals', () => {
    const raw = 'Seu período de teste terminou. Seu uso de IA atingiu o limite do plano ou o período de teste encerrou. Ajuste seu plano para continuar. (trial_expired)'
    const result = displayFailure({ message: raw, code: 'session/quota-exceeded' })
    expect(result.message).toBe(raw)
    expect(result.code).toBe('session/quota-exceeded')
  })

  it('does NOT sanitize other first-party session/* errors', () => {
    const raw = 'Limite de sessões atingido (5/5). Arquive uma sessão ou faça upgrade do plano.'
    const result = displayFailure({ message: raw, code: 'session/quota-exceeded' })
    expect(result.message).toBe(raw)
  })
})
