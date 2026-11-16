/** The settings card mounts on the Plugins page, under the package's own row. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it } from 'vitest'
import { apply, NS } from '../src/client/index.ts'

/** The row key the profile patch declares for this package. */
const KEY = '@deepseek-ai/dsh-experimental-kiwify-mcp#kiwify-mcp'

/**
 * Mount the browser half with the slot the Plugins page declares.
 * @returns the context and the mounted plugin's fiber.
 */
async function fixture() {
  const ctx = new Context()
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'plugins.row.config': { kind: 'keyed', scope: 'root' },
  } } as never, undefined as never)
  const fiber = ctx.plugin({ inject: ['slots', 'locale'], apply })
  return { ctx, fiber }
}

describe('Kiwify MCP settings card', () => {
  it('registers into the Plugins page row slot under the package row key', async () => {
    const { ctx, fiber } = await fixture()
    try {
      const entries = ctx.slots.entries('plugins.row.config')
      expect(entries.map(entry => entry.options.key)).toEqual([KEY])
      expect(entries[0]?.locale).toBe(NS)
    } finally {
      await fiber.dispose()
    }
  })

  it('releases the row entry when the plugin disposes', async () => {
    const { ctx, fiber } = await fixture()
    expect(ctx.slots.entries('plugins.row.config')).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.slots.entries('plugins.row.config')).toHaveLength(0)
  })
})
