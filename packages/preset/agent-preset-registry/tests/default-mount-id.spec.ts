/**
 * Default preset repair: an unnamed request may fall back to the deployment
 * default, while an explicitly requested preset is always reported as-is.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { contribution, declare, harness, liveRegistries } from './harness.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(): Promise<Context> {
  const ctx = await harness({ live: true })
  contexts.push(ctx)
  return ctx
}

describe('defaultMountId', () => {
  it('falls back to the deployment default with a warning when the selected default is unusable', async () => {
    const ctx = await setup()
    await declare(ctx, contribution('standard'))
    await declare(ctx, { id: 'broken-selection', plugins: [{ name: 'missing-preset-plugin-for-test' }] })
    await liveRegistries.get(ctx)!.update({ selectedDefault: 'broken-selection' })
    const warn = vi.spyOn(ctx.logger, 'warn')
    expect(await ctx.agentPresets.defaultMountId()).toBe('standard')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('broken-selection'))
  })

  it('never repairs an explicitly requested preset', async () => {
    const ctx = await setup()
    await declare(ctx, contribution('standard'))
    await declare(ctx, { id: 'broken-explicit', plugins: [{ name: 'missing-preset-plugin-for-test' }] })
    await expect(ctx.agentPresets.resolve('broken-explicit')).resolves.toMatchObject({
      id: 'broken-explicit',
      broken: expect.any(String) as string,
    })
    expect((await ctx.agentPresets.resolve('broken-explicit')).id).toBe('broken-explicit')
  })

  it('keeps an unusable deployment default when no repair is possible', async () => {
    const ctx = await setup()
    await declare(ctx, { id: 'standard', plugins: [{ name: 'missing-preset-plugin-for-test' }] })
    expect(await ctx.agentPresets.defaultMountId()).toBe('standard')
  })
})
