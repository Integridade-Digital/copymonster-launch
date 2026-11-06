/**
 * dsh-experimental-zernio-mcp — Zernio MCP connection plugin.
 *
 * Mounts the Zernio MCP tools under `mcp__zernio__*`, the OAuth routes the
 * settings panel drives, and the model-facing announcement. The plugin is
 * inert until the user authorizes it from the Web Settings page.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Config } from './config.ts'
import { createSupervisor, type ZernioSupervisor } from './mcp.ts'
import { OAuthFlow } from './oauth.ts'
import { makeRoutes, ZERNIO_MCP_API } from './routes.ts'
import { ZernioMcpStore } from './store.ts'

export { Config }
export { MCP_URL, ZernioMcpStore } from './store.ts'
export { OAuthFlow, ZernioOAuthProvider } from './oauth.ts'
export { createSupervisor, extractText, publicToolName } from './mcp.ts'
export { makeRoutes, resolveCallbackUrl, ZERNIO_MCP_API } from './routes.ts'

/** Stable cordis plugin name. */
export const name = 'zernio-mcp'

/** Services required before the surfaces can mount. */
export const inject = ['tools', 'systemPrompt', 'webServer']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 162

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const ZERNIO_MCP_GUIDANCE = 'dsh-experimental-zernio-mcp is installed (Zernio MCP connection): after OAuth authorization, the Zernio MCP server tools are available as mcp__zernio__*, covering social publishing, accounts, analytics, ads, messaging, automations, commerce, calendar, files, campaigns, and money operations. Authorization flow: zernio_mcp_oauth_start returns the authorization link → the user signs in to Zernio and authorizes → the callback completes automatically (you can also pass the callback code to zernio_mcp_oauth_finish). zernio_mcp_status shows connection state (never the token); zernio_mcp_test tests the connection and lists tools. The token is stored at ~/.dsh/dsh-zernio-mcp.json (mode 0600). You can also authorize and test in the Web Settings page Zernio MCP panel. When the user mentions Zernio / posts / social scheduling / ads / inbox, they mean this plugin; collaborate accordingly.'

/** Shared runtime context for the tools and routes. */
interface PluginContext {
  store: ZernioMcpStore
  flow: OAuthFlow
  supervisor: ZernioSupervisor
  callbackUrl: () => string
}

/**
 * Mount the Zernio MCP tools, helper tools, routes, and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt/webServer.
 * @param config - validated plugin config from the composition row.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new ZernioMcpStore(config.tenant)
  const flow = new OAuthFlow(store)
  const callbackUrl = (): string => `http://127.0.0.1:${ctx.webServer.port ?? 0}${ZERNIO_MCP_API.oauthCallback}`
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
    }, 'dsh-experimental-zernio-mcp: tools')
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
    }, 'dsh-experimental-zernio-mcp: routes')
    if (config.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-experimental-zernio-mcp',
        order: SECTION_ORDER,
        text: ZERNIO_MCP_GUIDANCE,
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
  ctx.effect(() => () => supervisor.dispose(), 'dsh-experimental-zernio-mcp: connection')
}

/** One text content block. */
function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** Build every agent-facing zernio_mcp_* tool. */
function buildTools(context: PluginContext) {
  return [
    zernioMcpStatusTool(context),
    zernioMcpOAuthStartTool(context),
    zernioMcpOAuthFinishTool(context),
    zernioMcpTestTool(context),
    zernioMcpClearTool(context),
  ]
}

/** Status tool: connection state, token age, tool count. */
function zernioMcpStatusTool(context: PluginContext) {
  return defineTool({
    name: 'zernio_mcp_status',
    description: 'Shows the dsh-experimental-zernio-mcp plugin status: whether OAuth is authorized, the token update time, whether MCP is connected, and the number of registered Zernio tools. Never reveals any secret.',
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
        message: 'dsh-experimental-zernio-mcp: ' + [
          view.authorized ? 'Authorized (token updated ' + view.tokenUpdatedAt + ')' : 'Not authorized',
          'MCP ' + (context.supervisor.isConnected() ? 'connected' : 'disconnected'),
          `Registered tools ${context.supervisor.toolCount()}`,
          'Endpoint ' + view.mcpUrl,
          'Config path ' + view.configPath,
        ].join('; ') + '. ' + (view.authorized ? 'You can use the mcp__zernio__* tools directly.' : 'Use zernio_mcp_oauth_start to begin authorization.'),
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
function zernioMcpOAuthStartTool(context: PluginContext) {
  return defineTool({
    name: 'zernio_mcp_oauth_start',
    description: 'Starts the Zernio MCP OAuth authorization flow: returns the authorization link (authorizeUrl) for the user to open in a browser and sign in to Zernio. The callback completes automatically on this machine.',
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
          message: 'Open the following link in your browser to authorize Zernio (then sign in and click Allow): ' + authorizeUrl,
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
function zernioMcpOAuthFinishTool(context: PluginContext) {
  return defineTool({
    name: 'zernio_mcp_oauth_finish',
    description: 'Completes Zernio MCP authorization manually: pass the code parameter (or the full callback URL) from the browser address bar to finish the token exchange. Use when the browser cannot complete the automatic callback.',
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

/** Test tool: connect and list the Zernio MCP tools. */
function zernioMcpTestTool(context: PluginContext) {
  return defineTool({
    name: 'zernio_mcp_test',
    description: 'Tests the Zernio MCP connection: confirms the authorization is valid and lists all tools the server currently provides (for example the mcp__zernio__* tool names).',
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
        return { ok: false, message: 'Not authorized: use zernio_mcp_oauth_start to begin authorization.' }
      }
      try {
        if (!context.supervisor.isConnected()) await context.supervisor.start()
        const tools = await context.supervisor.listTools()
        return {
          ok: true,
          message: `Connection successful: Zernio MCP provides ${tools.length} tools.`
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
function zernioMcpClearTool(context: PluginContext) {
  return defineTool({
    name: 'zernio_mcp_clear',
    description: 'Clears all Zernio MCP credentials (OAuth token and client registration) and disconnects, unregistering the MCP tools. Requires user confirmation.',
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
      return { ok: true, message: 'Cleared all Zernio MCP credentials; the MCP tools are unregistered.' }
    },
  })
}
