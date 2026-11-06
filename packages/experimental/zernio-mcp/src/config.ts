/** Deployment-tunable settings for the Zernio MCP connection plugin. */

import { z } from 'zod'

/** Validated plugin configuration from the composition row. */
export const Config = z.object({
  /** Mount the agent tools, HTTP routes, and settings panel. */
  enabled: z.boolean().default(true),
  /** Announce the plugin and its `mcp__zernio__*` namespace to the model. */
  announceToAgent: z.boolean().default(true),
  /**
   * Optional tenant key namespacing the credential file. Deployments that run
   * one profile per tenant set it so each tenant owns a separate token file.
   */
  tenant: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  /**
   * Public origin the reverse proxy presents to the plugin routes, for example
   * `https://app.copymonster.co`. When set, OAuth starts from that origin
   * register a public callback URL instead of the loopback one.
   */
  publicOrigin: z.url().refine(value => new URL(value).pathname === '/', {
    message: 'publicOrigin must be an origin without a path',
  }).optional(),
}).prefault({})

/** Validated plugin configuration after schema defaults. */
export type Config = z.infer<typeof Config>
