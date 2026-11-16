/**
 * dsh-experimental-whatsapp-mcp — WhatsApp MCP connection plugin.
 *
 * Mounts the WhatsApp MCP tools under `mcp__whatsapp__*`, the OAuth routes the
 * settings panel drives, and the model-facing announcement. The plugin is
 * inert until the user authorizes it from the Web Settings page.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingHttpHeaders } from 'node:http'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Config } from './config.ts'
import { createSupervisor, type WhatsAppSupervisor } from './mcp.ts'
import { OAuthFlow } from './oauth.ts'
import { makeRoutes, WHATSAPP_MCP_API, resolveCallbackUrl } from './routes.ts'
import { WhatsAppMcpStore } from './store.ts'

export { Config }
export { MCP_URL, WhatsAppMcpStore } from './store.ts'
export { OAuthFlow, WhatsAppOAuthProvider } from './oauth.ts'
export { createSupervisor, extractText, publicToolName } from './mcp.ts'
export { makeRoutes, resolveCallbackUrl, WHATSAPP_MCP_API } from './routes.ts'

/** Stable cordis plugin name. */
export const name = 'whatsapp-mcp'

/** Services required before the surfaces can mount. */
export const inject = ['tools', 'systemPrompt', 'webServer']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 165

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const WHATSAPP_MCP_GUIDANCE = 'dsh-experimental-whatsapp-mcp is installed (WhatsApp Business MCP connection): after OAuth authorization, the WhatsApp Business MCP server tools are available as mcp__whatsapp__*, covering business accounts, phone numbers, message templates, webhooks and sending messages. Authorization flow: whatsapp_mcp_oauth_start returns the authorization link → the user signs in to Meta and approves the app → the callback completes automatically (you can also pass the callback code to whatsapp_mcp_oauth_finish). whatsapp_mcp_status shows connection state (never the token); whatsapp_mcp_test tests the connection and lists tools. The token is stored at ~/.dsh/dsh-whatsapp-mcp.json (mode 0600). You can also authorize and test in the Web Settings page WhatsApp Business MCP panel. When the user mentions WhatsApp Business / WABA / message templates / Cloud API / phone numbers, they mean this plugin; collaborate accordingly.'

/** Shared runtime context for the tools and routes. */
interface PluginContext {
  store: WhatsAppMcpStore
  flow: OAuthFlow
  supervisor: WhatsAppSupervisor
  callbackUrl: (requestHeaders?: IncomingHttpHeaders) => string
}

/**
 * Mount the WhatsApp MCP tools, helper tools, routes, and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt/webServer.
 * @param config - validated plugin config from the composition row.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new WhatsAppMcpStore(config.tenant)
  const flow = new OAuthFlow(store, config.metaAppId)
  const callbackUrl = (requestHeaders?: IncomingHttpHeaders): string => {
    if (requestHeaders !== undefined) {
      return resolveCallbackUrl({ headers: requestHeaders }, ctx.webServer.port ?? 0, config.publicOrigin)
    }
    // Fallback for tools without request context: use configured publicOrigin or loopback
    if (config.publicOrigin !== undefined) {
      return `${config.publicOrigin}${WHATSAPP_MCP_API.oauthCallback}`
    }
    return `http://127.0.0.1:${ctx.webServer.port ?? 0}${WHATSAPP_MCP_API.oauthCallback}`
  }
  const supervisor = createSupervisor(ctx, store, flow, callbackUrl)
  const context: PluginContext = { store, flow, supervisor, callbackUrl }
  let disposeTools: (() => void | Promise<void>) | undefined
  let disposeRoutes: (() => void | Promise<void>) | undefined
  let disposeSection: (() => void | Promise<void>) | undefined
  const sync = (): void => {
    void disposeTools?.()
    disposeTools = undefined
    void disposeRoutes?.()
    disposeRoutes = undefined
    void disposeSection?.()
    disposeSection = undefined
    if (!config.enabled) return
    disposeTools = ctx.effect(() => {
      const disposers = buildTools(context).map(tool => ctx.tools.register(tool))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-experimental-whatsapp-mcp: tools')
    disposeRoutes = ctx.effect(() => {
      const disposers = makeRoutes({
        store,
        flow,
        supervisor,
        callbackUrl,
        publicOrigin: config.publicOrigin,
        getPort: () => ctx.webServer.port ?? 0,
      }).map(route => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-experimental-whatsapp-mcp: routes')
    if (config.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-experimental-whatsapp-mcp',
        order: SECTION_ORDER,
        text: WHATSAPP_MCP_GUIDANCE,
      })
    }
  }
  sync()
  void (async () => {
    if (!config.enabled) return
    if ((await store.view(callbackUrl())).authorized) {
      supervisor.start().catch(() => {})
    }
  })()
  ctx.effect(() => () => supervisor.dispose(), 'dsh-experimental-whatsapp-mcp: connection')
}

/** One text content block. */
function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** Build every agent-facing whatsapp_mcp_* tool. */
function buildTools(context: PluginContext) {
  return [
    whatsappMcpStatusTool(context),
    whatsappMcpOAuthStartTool(context),
    whatsappMcpOAuthFinishTool(context),
    whatsappMcpTestTool(context),
    whatsappMcpClearTool(context),
  ]
}

/** Status tool: connection state, token age, tool count. */
function whatsappMcpStatusTool(context: PluginContext) {
  return defineTool({
    name: 'whatsapp_mcp_status',
    description: 'Shows the dsh-experimental-whatsapp-mcp plugin status: whether OAuth is authorized, the token update time, whether MCP is connected, and the number of registered WhatsApp tools. Never reveals any secret.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          authorized: { type: 'boolean' },
          connected: { type: 'boolean' },
          toolCount: { type: 'number' },
          tokenUpdatedAt: { type: 'string' },
          mcpUrl: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { message?: string }) => text(value.message ?? ''),
    },
    async execute() {
      const view = await context.store.view(context.callbackUrl())
      return {
        ok: true,
        message: 'dsh-experimental-whatsapp-mcp: ' + [
          view.authorized ? 'Authorized (token updated ' + view.tokenUpdatedAt + ')' : 'Not authorized',
          'MCP ' + (context.supervisor.isConnected() ? 'connected' : 'disconnected'),
          `Registered tools ${context.supervisor.toolCount()}`,
          'Endpoint ' + view.mcpUrl,
          'Config path ' + view.configPath,
        ].join('; ') + '. ' + (view.authorized ? 'You can use the mcp__whatsapp__* tools directly.' : 'Use whatsapp_mcp_oauth_start to begin authorization.'),
        authorized: view.authorized,
        connected: context.supervisor.isConnected(),
        toolCount: context.supervisor.toolCount(),
        tokenUpdatedAt: view.tokenUpdatedAt,
        mcpUrl: view.mcpUrl,
        configPath: view.configPath,
      }
    },
  })
}

/** OAuth start tool: begin the flow, return the browser URL. */
function whatsappMcpOAuthStartTool(context: PluginContext) {
  return defineTool({
    name: 'whatsapp_mcp_oauth_start',
    description: 'Starts the WhatsApp MCP OAuth authorization flow: returns the authorization link (authorizeUrl) for the user to open in a browser and sign in to WhatsApp. The callback completes automatically on this machine.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          authorizeUrl: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { message?: string }) => text(value.message ?? ''),
    },
    async execute() {
      try {
        const { authorizeUrl } = await context.flow.begin(context.callbackUrl())
        return {
          ok: true,
          message: 'Open the following link in your browser to authorize WhatsApp (then sign in and click Allow): ' + authorizeUrl,
          authorizeUrl,
        }
      } catch (error) {
        return {
          ok: false,
          message: 'Could not start authorization: ' + (error instanceof Error ? error.message : String(error)),
        }
      }
    },
  })
}

/** OAuth finish tool: manual code paste fallback. */
function whatsappMcpOAuthFinishTool(context: PluginContext) {
  return defineTool({
    name: 'whatsapp_mcp_oauth_finish',
    description: 'Completes WhatsApp MCP authorization manually: pass the code parameter (or the full callback URL) from the browser address bar to finish the token exchange. Use when the browser cannot complete the automatic callback.',
    parameters: {
      code: {
        type: 'string',
        description: 'The code parameter value from the authorization callback URL',
      },
      redirectUrl: {
        type: 'string',
        description: 'The full authorization callback URL (extracts the code automatically)',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: { message?: string }) => text(value.message ?? ''),
    },
    async execute(args: { code?: string; redirectUrl?: string }) {
      let code = typeof args.code === 'string' ? args.code.trim() : ''
      if (code === '' && typeof args.redirectUrl === 'string' && args.redirectUrl !== '') {
        try {
          code = new URL(args.redirectUrl).searchParams.get('code') ?? ''
        } catch {
          code = ''
        }
      }
      if (code === '') {
        return { ok: false, message: 'Missing code (or could not extract the code from redirectUrl).' }
      }
      const result = await context.flow.complete(code, '')
      if (result.ok) void context.supervisor.start().catch(() => {})
      return result
    },
  })
}

/** Test tool: connect and list the WhatsApp MCP tools. */
function whatsappMcpTestTool(context: PluginContext) {
  return defineTool({
    name: 'whatsapp_mcp_test',
    description: 'Tests the WhatsApp MCP connection: confirms the authorization is valid and lists all tools the server currently provides (for example the mcp__whatsapp__* tool names).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          tools: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args: unknown, value: { message?: string }) => text(value.message ?? ''),
    },
    async execute() {
      if (!(await context.store.view(context.callbackUrl())).authorized) {
        return { ok: false, message: 'Not authorized: use whatsapp_mcp_oauth_start to begin authorization.' }
      }
      try {
        if (!context.supervisor.isConnected()) await context.supervisor.start()
        const tools = await context.supervisor.listTools()
        return {
          ok: true,
          message: `Connection successful: WhatsApp MCP provides ${tools.length} tools.`
            + (tools.length > 0 ? ' Examples: ' + tools.slice(0, 8).join(', ') : ''),
          tools,
        }
      } catch (error) {
        return {
          ok: false,
          message: 'Test failed: ' + (error instanceof Error ? error.message : String(error)),
        }
      }
    },
  })
}

/** Clear tool: wipe credentials and disconnect. */
function whatsappMcpClearTool(context: PluginContext) {
  return defineTool({
    name: 'whatsapp_mcp_clear',
    description: 'Clears all WhatsApp MCP credentials (OAuth token and client registration) and disconnects, unregistering the MCP tools. Requires user confirmation.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: { message?: string }) => text(value.message ?? ''),
    },
    async execute() {
      context.flow.abort()
      await context.supervisor.dispose()
      await context.store.clearAll()
      return { ok: true, message: 'Cleared all WhatsApp MCP credentials; the MCP tools are unregistered.' }
    },
  })
}
