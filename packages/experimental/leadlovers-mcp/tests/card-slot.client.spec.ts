/** The settings card mounts in the global Settings dialog. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it } from 'vitest'
import { apply, NS } from '../src/client/index.ts'

/** The settings section id this plugin claims, and its order below the Kiwify MCP page. */
const ID = 'leadlovers-mcp'
const ORDER = 324

/**
 * Mount the browser half with the slot the Settings dialog declares.
 * @returns the context and the mounted plugin's fiber.
 */
async function fixture() {
  const ctx = new Context()
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' },
  } } as never, undefined as never)
  const fiber = ctx.plugin({ inject: ['slots', 'locale'], apply })
  return { ctx, fiber }
}

describe('LeadLovers MCP settings card', () => {
  it('registers a Settings section with its id, order, and dictionary', async () => {
    const { ctx, fiber } = await fixture()
    try {
      const entries = ctx.slots.entries('settings.section')
      expect(entries.map(entry => entry.options.id)).toEqual([ID])
      expect(entries[0]?.options.order).toBe(ORDER)
      expect(resolveSlotLabel(entries[0]?.options.label)).toBe('LeadLovers MCP')
      expect(entries[0]?.locale).toBe(NS)
    } finally {
      await fiber.dispose()
    }
  })

  it('releases the section entry when the plugin disposes', async () => {
    const { ctx, fiber } = await fixture()
    expect(ctx.slots.entries('settings.section')).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
  })
})
