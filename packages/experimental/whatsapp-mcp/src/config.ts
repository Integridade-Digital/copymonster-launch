/** Deployment-tunable settings for the WhatsApp MCP connection plugin. */

import { z } from 'zod'

/** Validated plugin configuration from the composition row. */
export const Config = z.object({
  /** Mount the agent tools, HTTP routes, and settings panel. */
  enabled: z.boolean().default(true),
  /** Announce the plugin and its `mcp__whatsapp__*` namespace to the model. */
  announceToAgent: z.boolean().default(true),
  /**
   * Optional tenant key namespacing the credential file. Deployments that run
   * one profile per tenant set it so each tenant owns a separate token file.
   */
  tenant: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  /**
   * Public origin the reverse proxy presents to the plugin routes, for example
   * `https://app.copymonster.co`. When set, OAuth starts from that origin and
   * registers a public callback URL instead of the loopback one.
   */
  publicOrigin: z.url().refine(value => new URL(value).pathname === '/', {
    message: 'publicOrigin must be an origin without a path',
  }).optional(),
  /**
   * Meta app ID the authorization dialog runs under. Meta's dynamic
   * registration endpoint (`https://mcp.facebook.com/.well-known/register/
   * whatsapp_business_tools`) rejects every client whose name is not on Meta's
   * own allowlist, so the plugin cannot create its own app. Set this to an app
   * registered at https://developers.facebook.com with the WhatsApp Business
   * products enabled and the callback URL listed under *Valid OAuth Redirect
   * URIs*. When unset, Authorize reports the missing configuration instead of
   * opening a dialog that Meta refuses.
   */
  metaAppId: z.string().regex(/^[1-9][0-9]{5,24}$/).optional(),
}).prefault({})

/** Validated plugin configuration after schema defaults. */
export type Config = z.infer<typeof Config>
