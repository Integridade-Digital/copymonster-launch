/**
 * Composition test for the experimental MCP bundles' browser halves: a Loader
 * that mounted them must publish every one of their client modules in
 * `__DSH_BOOT__`, and a Loader that did not must publish none.
 *
 * The bundle list here mirrors the profile roster the CopyMonster deployment
 * hands tenants; a bundle missing from that roster drops out of the boot graph
 * even though its `lib/client.js` exists, which is the failure this pins.
 */

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { WebServer, WebResourceRoute } from '@deepseek-ai/dsh-host-webserver'
import { ClientModuleRegistry } from '../src/index.ts'

const MCP_BUNDLES = [
  '@deepseek-ai/dsh-experimental-zernio-mcp',
  '@deepseek-ai/dsh-experimental-sendpulse-mcp',
  '@deepseek-ai/dsh-experimental-leadlovers-mcp',
  '@deepseek-ai/dsh-experimental-kiwify-mcp',
] as const

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
})

/**
 * Mount the modules node half over a Loader whose entries are `names`, resolved
 * against the repository tree the same way a profile resolves its bundles.
 * @param names - package names the Loader reports as active rows.
 * @returns the composed boot graph.
 */
async function mountGraph(names: readonly string[]): Promise<ReturnType<ClientModuleRegistry['graph']>> {
  const ctx = new Context()
  contexts.push(ctx)
  const repoRoot = pathToFileURL(`${import.meta.dirname}/../../../..`).href
  ctx.baseUrl = `${repoRoot}/packages/client/modules/`
  ctx.provide('loader', {
    *entries() {
      for (const name of names) {
        yield {
          options: { name },
          fiber: {},
          disabled: false,
          parent: { tree: { ctx: { baseUrl: repoRoot } } },
        }
      }
    },
  })
  const route = Promise.withResolvers<WebResourceRoute>()
  const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = {
    port: 0,
    register: (candidate) => {
      if (candidate.path === '/plugins' && 'resource' in candidate) route.resolve(candidate)
      return () => {}
    },
    tapIndex: () => () => {},
  }
  ctx.provide('webServer', webServer as WebServer)
  const service = new ClientModuleRegistry(ctx)
  await route.promise
  return service.graph()
}

describe('experimental MCP client modules', () => {
  it('publishes every mounted MCP bundle in the boot graph', async () => {
    const missing = MCP_BUNDLES.filter(name => !existsSync(
      `${import.meta.dirname}/../../../experimental/${name.replace('@deepseek-ai/dsh-experimental-', '')}/lib/client.js`,
    ))
    expect(missing, 'these bundles need a build:artifacts run').toEqual([])

    const graph = await mountGraph(MCP_BUNDLES)
    const ids = graph.entries.map(row => row.id)
    for (const name of MCP_BUNDLES) expect(ids).toContain(name)

    const boot = JSON.stringify(graph)
    for (const name of MCP_BUNDLES) expect(boot).toContain(`${name}/client.js`)
  })

  it('publishes no MCP module for a Loader that did not mount them', async () => {
    const graph = await mountGraph([])
    expect(graph.entries).toEqual([])
  })

  it('publishes only the MCP bundles the Loader mounted', async () => {
    const graph = await mountGraph([MCP_BUNDLES[0]])
    const ids = graph.entries.map(row => row.id)
    expect(ids).toEqual([MCP_BUNDLES[0]])
    for (const name of MCP_BUNDLES.slice(1)) expect(ids).not.toContain(name)
  })
})
