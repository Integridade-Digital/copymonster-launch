import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { IDENTITY_SECTION, apply, inject, name } from '../src/index.ts'

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin({ name, inject, apply })
  return ctx
}

async function mintScope(ctx: Context, scopeName: string): Promise<Scope> {
  let scope!: Scope
  // The scoped context resolves services through the minting plugin's
  // dependency chain, so the minter injects what scope holders reach.
  await ctx.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, { name: scopeName }) },
    { inject: ['systemPrompt'] },
  ))
  return scope
}

describe('copymonster identity watermark', () => {
  it('prepends the identity section to the global assembly', async () => {
    const ctx = await mount()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections[0]?.name).toBe(IDENTITY_SECTION)
    expect(renderPrompt(assembly)).toContain('You ARE CopyMonster.')
  })

  it('survives a scoped preset persona and stays above it', async () => {
    const ctx = await mount()
    const scope = await mintScope(ctx, 'preset')
    scope.ctx.systemPrompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: 0,
      text: 'You are a coding agent powered by the underlying model.',
    })

    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(assembly.sections[0]?.name).toBe(IDENTITY_SECTION)
    const rendered = renderPrompt(assembly)
    expect(rendered).toContain('You ARE CopyMonster.')
    expect(rendered).toContain('You are a coding agent powered by the underlying model.')
  })

  it('is dropped by a complete:true persona (minimal) — documented limitation', async () => {
    const ctx = await mount()
    const scope = await mintScope(ctx, 'minimal')
    scope.ctx.systemPrompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: 0,
      text: 'You are a helpful software engineer assistant.',
      complete: true,
    })

    const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(assembly.sections.map(section => section.name)).not.toContain(IDENTITY_SECTION)
  })
})
