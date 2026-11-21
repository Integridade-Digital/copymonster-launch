/**
 * CopyMonster virtual-model mask for the Host with streaming failover.
 *
 * Tenants see exactly one selectable model — `copy-monster-default` / "Model
 * CopyMonster" — in the browser model catalog. The underlying provider and
 * model id never reach the client payload, error messages, the session log,
 * or the wire. The alias is admitted by `modelAvailable()` (owned by the
 * session-controller) and resolved privately at model-request time, so the
 * Agent turn executes on a real provider without exposing it.
 *
 * Platform administrators (`isAdmin === true`) keep the full real provider
 * catalog; that branch is owned by the session-controller's `buildModelCatalog`.
 *
 * The alias is an alias, not a model: it has no provider and no key of its own
 * and never appears in a picker. This plugin registers an adapter for the
 * virtual provider route. When the Agent loop dispatches a request whose
 * provider/model is the virtual alias, this adapter's `stream` resolves the
 * route chain from the administrator's pinned routes and the live `ctx.llm`
 * registry, then reissues the call through `ctx.llm.stream`.
 *
 * Resolution: an administrator may pin a primary pair (`primaryProvider` /
 * `primaryModel`) and a contingency pair (`fallbackProvider` / `fallbackModel`)
 * from the Admin provider manager. A pinned pair takes effect only while the
 * catalog advertises it. Without a pinned primary, the deployment default from
 * `ctx.agentDefaultModel` is primary when it matches a candidate and the first
 * catalog candidate otherwise. After the primary comes the pinned contingency
 * route, then every remaining model advertised by `ctx.llm.listProviders()` /
 * `ctx.llm.listModels()` in registry order. An empty pin therefore leaves the
 * mask on the live catalog, and adding a provider in `Settings > Models`
 * changes the routing on the next request without any administrator write.
 *
 * Failover: a route that fails with an eligible transient error BEFORE any
 * chunk is emitted falls over to the next chain route, up to
 * `fallbackPolicy.maxAttempts`. Once any chunk has been emitted, failover is
 * strictly forbidden to prevent corrupted or mixed generation outputs.
 *
 * No `packages/core/` or `packages/llm/` code is touched; routing happens
 * purely through the public `llm` service API.
 * @module @deepseek-ai/dsh-host-model-mask
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
// Type-only: declares the `loader/volatile-update` event this plugin listens to.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { isGatewayConfigured, resolveGatewayConfig, streamGateway } from './gateway-client.ts'

export * from './gateway-client.ts'

/**
 * The one `agentDefaultModel` member this plugin reads.
 *
 * Declared structurally instead of importing `@deepseek-ai/dsh-agent-default-model`,
 * which would add a core dependency edge for a single read.
 */
interface AgentDefaultModelSelection {
  /** Deployment default selection applied to fresh Agents. */
  currentSelection(): { readonly provider: string; readonly model: string }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Deployment default model selection, provided by its own core plugin. */
    agentDefaultModel: AgentDefaultModelSelection
  }
}

/** Stable Cordis plugin name. */
export const name = 'model-mask'

/** The plugin consumes the live `llm` registry and the deployment default selection. */
export const inject = ['llm', 'agentDefaultModel'] as const

/** The virtual provider route under which the alias is advertised. */
export const VIRTUAL_PROVIDER = 'copymonster'

/** The virtual model id advertised to tenants. */
export const VIRTUAL_MODEL = 'copy-monster-default'

/** The human-readable virtual model name advertised to tenants. */
export const VIRTUAL_MODEL_NAME = 'Model CopyMonster'

/** Description shown alongside the virtual model in the catalog. */
export const VIRTUAL_MODEL_DESCRIPTION =
  'Standard CopyMonster model. The underlying provider and route are managed by the platform.'

/** The CopyMonster model-selection alias, shared with the session-controller. */
export interface VirtualModelAlias {
  readonly provider: typeof VIRTUAL_PROVIDER
  readonly model: typeof VIRTUAL_MODEL
}

/** The virtual alias selection tenants are offered. */
export const VIRTUAL_ALIAS: VirtualModelAlias = { provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL }

/** One provider/model route. */
export interface Route {
  readonly provider: string
  readonly model: string
}

/** Configuration for failover policy. */
export interface FallbackPolicyConfig {
  /** Whether automatic failover across the chain is enabled. @default true */
  readonly enabled?: boolean
  /** Maximum routes one turn may attempt, primary included. @default 3 */
  readonly maxAttempts?: number
  /** Timeout in ms before failing over. @default 30000 */
  readonly timeoutMs?: number
}

/** Mask identity and failover policy, without the routes resolved from the registry. */
export interface LlmRoutingPolicy {
  /** Virtual provider route advertised in the masked catalog. @default 'copymonster' */
  readonly virtualProvider?: string
  /** Virtual model id advertised in the masked catalog. @default 'copy-monster-default' */
  readonly virtualModel?: string
  /** Human-readable virtual model name. @default 'Model CopyMonster' */
  readonly virtualModelName?: string
  /** Administrator-pinned primary route provider; empty or absent follows the live catalog. */
  readonly primaryProvider?: string
  /** Administrator-pinned primary route model; empty or absent follows the live catalog. */
  readonly primaryModel?: string
  /** Administrator-pinned contingency route provider; empty or absent leaves the catalog order. */
  readonly fallbackProvider?: string
  /** Administrator-pinned contingency route model, paired with {@link fallbackProvider}. */
  readonly fallbackModel?: string
  /** Failover policy options. */
  readonly fallbackPolicy?: FallbackPolicyConfig
  /** Whether masking applies only to non-admin callers. @default true */
  readonly applyToTenantsOnly?: boolean
  /** Loopback LLM gateway URL. Fallback: process.env.COPYMONSTER_LLM_GATEWAY_URL. */
  readonly gatewayUrl?: string
  /** Internal session token for gateway authorization. Fallback: process.env.COPYMONSTER_INTERNAL_SESSION_TOKEN. */
  readonly internalSessionToken?: string
}

/** Resolved mask identity, routing chain, and failover policy for one turn. */
export interface ResolvedRoutingPolicy extends LlmRoutingPolicy {
  /** Real route the alias dispatches to first. */
  readonly primaryRoute: Route
  /** Ordered real routes tried after the primary on eligible transient failure. */
  readonly fallbackChain: readonly Route[]
}

/** Plugin configuration: mask identity, optional pinned routes, and failover policy. */
export interface Config {
  /** Virtual provider route advertised in the masked catalog. */
  virtualProvider: Volatile<string>
  /** Virtual model id advertised in the masked catalog. */
  virtualModel: Volatile<string>
  /** Human-readable virtual model name. */
  virtualModelName: Volatile<string>
  /**
   * Administrator-pinned primary route provider. Empty keeps the primary route
   * on the deployment default resolved from the live catalog.
   */
  primaryProvider: Volatile<string>
  /** Administrator-pinned primary route model. Empty keeps the catalog default. */
  primaryModel: Volatile<string>
  /**
   * Administrator-pinned contingency route provider. Empty leaves the whole
   * advertised catalog as the contingency order.
   */
  fallbackProvider: Volatile<string>
  /** Administrator-pinned contingency route model, paired with {@link fallbackProvider}. */
  fallbackModel: Volatile<string>
  /** Failover policy options. */
  fallbackPolicy: Volatile<FallbackPolicyConfig | undefined>
  /** Whether masking applies only to non-admin callers. */
  applyToTenantsOnly: Volatile<boolean>
  /** Loopback LLM gateway URL. */
  gatewayUrl: Volatile<string>
  /** Internal session token for gateway authorization. */
  internalSessionToken: Volatile<string>
}

/** Loader schema for {@link Config}. */
export const Config = z.object({
  virtualProvider: z.string().default(VIRTUAL_PROVIDER).volatile(),
  virtualModel: z.string().default(VIRTUAL_MODEL).volatile(),
  virtualModelName: z.string().default(VIRTUAL_MODEL_NAME).volatile(),
  primaryProvider: z.string().default('').volatile(),
  primaryModel: z.string().default('').volatile(),
  fallbackProvider: z.string().default('').volatile(),
  fallbackModel: z.string().default('').volatile(),
  fallbackPolicy: z.object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().default(3),
    timeoutMs: z.number().default(30000),
  }).default({ enabled: true, maxAttempts: 3, timeoutMs: 30000 }).volatile(),
  applyToTenantsOnly: z.boolean().default(true).volatile(),
  gatewayUrl: z.string().default(process.env.COPYMONSTER_LLM_GATEWAY_URL ?? '').volatile(),
  internalSessionToken: z.string().default(process.env.COPYMONSTER_INTERNAL_SESSION_TOKEN ?? '').volatile(),
})

/** Project a plugin Config to its plain identity values, dropping the live references. */
function plain(config: Config): LlmRoutingPolicy {
  const fallbackPolicy = config.fallbackPolicy.get()
  return {
    virtualProvider: config.virtualProvider.get(),
    virtualModel: config.virtualModel.get(),
    virtualModelName: config.virtualModelName.get(),
    primaryProvider: config.primaryProvider.get(),
    primaryModel: config.primaryModel.get(),
    fallbackProvider: config.fallbackProvider.get(),
    fallbackModel: config.fallbackModel.get(),
    ...fallbackPolicy === undefined ? {} : { fallbackPolicy },
    applyToTenantsOnly: config.applyToTenantsOnly.get(),
    gatewayUrl: config.gatewayUrl.get() || process.env.COPYMONSTER_LLM_GATEWAY_URL,
    internalSessionToken: config.internalSessionToken.get() || process.env.COPYMONSTER_INTERNAL_SESSION_TOKEN,
  }
}

/**
 * Determine whether a model execution failure is an eligible transient error
 * that warrants attempting failover to a contingency route.
 *
 * Eligible:
 * - HTTP status 429 (rate limit), 500, 502, 503, 504 (server error / gateway).
 * - Standard failure codes: RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT.
 * - Network timeouts and connection resets (ECONNRESET, ETIMEDOUT).
 *
 * Also eligible: HTTP 401 and auth/key rejections, so a route with a dead key falls
 * over to the next available route.
 *
 * Ineligible (fail-fast):
 * - HTTP 400 (bad request), 403 (forbidden), codes containing INVALID_REQUEST.
 *
 * @param error - the failure thrown by the primary stream attempt.
 * @returns true if failover should be attempted.
 */
export function isEligibleFailoverError(error: unknown): boolean {
  if (!error) return false

  // Check for HTTP status codes
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined
  if (status !== undefined) {
    // 401: dead key, 402: payment required / insufficient credits.
    if (status === 401 || status === 402) return true
    // 400 and 403 describe the request or its permissions, not the route: fail fast.
    if (status === 400 || status === 403) return false
    // 429, 500, 502, 503, 504 are eligible
    if (status === 429 || (status >= 500 && status <= 504)) return true
  }

  // Check for failure code
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
  if (code) {
    const upperCode = code.toUpperCase()
    if (upperCode.includes('INVALID_REQUEST')) return false
    if (
      upperCode.includes('AUTH') ||
      upperCode.includes('KEY') ||
      upperCode.includes('CREDIT') ||
      upperCode.includes('PAYMENT') ||
      upperCode.includes('BILLING') ||
      upperCode.includes('QUOTA') ||
      upperCode.includes('BALANCE')
    ) return true
    if (
      upperCode === 'RATE_LIMIT' ||
      upperCode === 'SERVER' ||
      upperCode === 'TIMEOUT' ||
      upperCode === 'TRANSPORT' ||
      upperCode.includes('TIMEOUT') ||
      upperCode.includes('OVERLOAD')
    ) {
      return true
    }
  }

  // Check error message for transient and key-rejection indicators
  const msg = String(error instanceof Error ? error.message : error).toLowerCase()
  if (
    msg.includes('api key is invalid') ||
    msg.includes('invalid api key') ||
    msg.includes('unauthorized') ||
    msg.includes('authentication') ||
    msg.includes('payment required') ||
    msg.includes('402') ||
    msg.includes('insufficient_quota') ||
    msg.includes('insufficient quota') ||
    msg.includes('insufficient balance') ||
    msg.includes('insufficient credits') ||
    msg.includes('out of credits') ||
    msg.includes('no credits') ||
    msg.includes('credits exhausted') ||
    msg.includes('billing') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('server error') ||
    msg.includes('bad gateway') ||
    msg.includes('service unavailable')
  ) {
    return true
  }

  return false
}

/**
 * Resolve the ordered route chain from the administrator's pinned routes and
 * the live LLM registry.
 *
 * A pinned primary pair that the catalog actually advertises leads the chain.
 * The chain then continues with the deployment default when it is advertised,
 * the pinned contingency pair when it is advertised, and every other advertised
 * model in registry order. An unpinned mask therefore starts at the deployment
 * default and otherwise at the first advertised model, while a pinned mask
 * starts exactly where the administrator chose.
 * @param ctx - Host context carrying the live `llm` and `agentDefaultModel` services.
 * @param policy - the current mask policy, whose pinned routes are optional.
 * @returns the primary route and the ordered fallback chain.
 */
export async function resolveRouteChain(
  ctx: Context,
  policy: LlmRoutingPolicy = {},
): Promise<{ primaryRoute: Route; fallbackChain: Route[] }> {
  const candidates = await listCatalog(ctx)
  // A deployment with no advertised model cannot serve a tenant turn. The
  // sentinel names that state so the failure reaches the caller instead of
  // silently dispatching to an unrelated route.
  if (candidates.length === 0) {
    return { primaryRoute: { provider: 'none', model: 'none' }, fallbackChain: [] }
  }

  const advertised = (route: Route | undefined): Route | undefined =>
    route === undefined ? undefined : candidates.find(entry => sameRoute(entry, route))
  const pinnedPrimary = advertised(pinOf(policy.primaryProvider, policy.primaryModel))
  const pinnedFallback = advertised(pinOf(policy.fallbackProvider, policy.fallbackModel))

  if (pinnedPrimary !== undefined) {
    return {
      primaryRoute: pinnedPrimary,
      fallbackChain: orderChain(candidates, pinnedPrimary, pinnedFallback),
    }
  }

  const defaultSelection = ctx.agentDefaultModel.currentSelection()
  const primaryIndex = candidates.findIndex(
    route => route.provider === defaultSelection.provider && route.model === defaultSelection.model,
  )
  // `candidates` is non-empty here, so the selected entry always exists.
  const primary = candidates[primaryIndex === -1 ? 0 : primaryIndex]
  if (primary === undefined) throw new Error('model-mask: route resolution produced no primary route')
  return {
    primaryRoute: primary,
    fallbackChain: orderChain(candidates, primary, pinnedFallback),
  }
}

/** Build one pinned route from its provider and model halves, or nothing when either is empty. */
function pinOf(provider: string | undefined, model: string | undefined): Route | undefined {
  if (provider === undefined || provider === '' || model === undefined || model === '') return undefined
  return { provider, model }
}

/** Whether two routes name the same provider and model. */
function sameRoute(left: Route, right: Route): boolean {
  return left.provider === right.provider && left.model === right.model
}

/**
 * Every model advertised by a registered provider, in registry order.
 *
 * One provider's catalog failure must not remove the other routes from the
 * mask; the tenant still forwards the turn to a working provider.
 */
async function listCatalog(ctx: Context): Promise<Route[]> {
  const candidates: Route[] = []
  for (const provider of ctx.llm.listProviders()) {
    if (provider.id === VIRTUAL_PROVIDER) continue
    try {
      const models = await ctx.llm.listModels(provider.id)
      for (const model of models) {
        if (model.id === VIRTUAL_MODEL) continue
        candidates.push({ provider: provider.id, model: model.id })
      }
    } catch (error: unknown) {
      // One provider's catalog failure must not remove the other routes from
      // the mask; the tenant still forwards the turn to a working provider.
      ctx.logger.warn('model-mask: provider "%s" catalog unavailable (%s)', provider.id, String(error))
    }
  }
  return candidates
}

/**
 * The advertised routes that follow `primary`: the pinned contingency route
 * first when it is set and advertised, then the rest in catalog order.
 */
function orderChain(
  candidates: readonly Route[],
  primary: Route,
  pinnedFallback: Route | undefined,
): Route[] {
  const rest = candidates.filter(route => !sameRoute(route, primary))
  if (pinnedFallback === undefined || sameRoute(pinnedFallback, primary)) return rest
  return [pinnedFallback, ...rest.filter(route => !sameRoute(route, pinnedFallback))]
}

/** One masked Adapter registration for the virtual provider route. */
export interface VirtualAdapterDeps {
  readonly ctx: Context
  /**
   * Current mask identity. The adapter resolves the real routes itself from the
   * live registry for every turn, so a provider added in `Settings > Models`
   * participates without an administrator write.
   */
  readonly getPolicy: () => LlmRoutingPolicy
}

/**
 * Build the adapter that serves the virtual provider route. Its `stream`
 * reissues the call on the resolved primary route, failing over down the chain
 * before the first emitted chunk; every other method reports virtual-model
 * metadata so catalog and resolution paths succeed without naming a real route.
 * @param deps - plugin context and the resolved routing policy provider.
 * @returns an `LlmAdapter` whose `stream` executes routing and contingency failover.
 */
export function buildVirtualAdapter(deps: VirtualAdapterDeps): LlmAdapter {
  const { ctx, getPolicy } = deps

  return new (class VirtualLlmAdapter extends LlmAdapter {
    override providerInfo() {
      const policy = getPolicy()
      return {
        id: policy.virtualProvider ?? VIRTUAL_PROVIDER,
        name: policy.virtualModelName ?? VIRTUAL_MODEL_NAME,
      }
    }

    override async listModels() {
      const policy = getPolicy()
      const provider = policy.virtualProvider ?? VIRTUAL_PROVIDER
      const model = policy.virtualModel ?? VIRTUAL_MODEL
      const name = policy.virtualModelName ?? VIRTUAL_MODEL_NAME
      return [{ provider, id: model, name }]
    }

    override async resolveModel(_provider: string, model: string) {
      const policy = getPolicy()
      const provider = policy.virtualProvider ?? VIRTUAL_PROVIDER
      const name = policy.virtualModelName ?? VIRTUAL_MODEL_NAME
      return {
        provider,
        id: model,
        name,
        description: VIRTUAL_MODEL_DESCRIPTION,
      }
    }

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      // 1. Check if the central LLM loopback gateway is active
      const policy = getPolicy()
      if (isGatewayConfigured(policy)) {
        const gatewayConfig = resolveGatewayConfig(policy)
        if (gatewayConfig) {
          yield* streamGateway(options, gatewayConfig)
          return
        }
      }

      // 2. Snapshot the mask identity and resolve the live route chain for this turn
      const { primaryRoute, fallbackChain } = await resolveRouteChain(ctx, policy)
      const fallbackPolicy = policy.fallbackPolicy ?? {}
      const chain = [primaryRoute, ...fallbackChain]
        .slice(0, fallbackPolicy.enabled === false ? 1 : Math.max(1, fallbackPolicy.maxAttempts ?? 3))

      let chunkCount = 0
      let lastError: unknown

      // 2. Try each route in turn until one produces its first chunk
      for (const [index, route] of chain.entries()) {
        const hasNextRoute = index < chain.length - 1
        const routeOptions = { ...options, provider: route.provider, model: route.model } satisfies GenerateOptions
        let iterator: AsyncIterator<StreamChunk>
        let firstResult: IteratorResult<StreamChunk>
        try {
          iterator = (await ctx.llm.stream(routeOptions))[Symbol.asyncIterator]()
          firstResult = await iterator.next()
        } catch (error: unknown) {
          // Failover stays available only before any chunk reached the client:
          // a partial generation cannot be replaced by another route.
          if (hasNextRoute && chunkCount === 0 && isEligibleFailoverError(error)) {
            lastError = error
            ctx.logger.warn(
              'model-mask: route "%s/%s" failed before output (%s); trying the next available route',
              route.provider,
              route.model,
              String(error),
            )
            continue
          }
          throw error
        }

        // 3. Once the first chunk is emitted, failover is STRICTLY FORBIDDEN
        if (firstResult.done) return
        chunkCount++
        yield firstResult.value
        while (true) {
          const nextResult = await iterator.next()
          if (nextResult.done) return
          chunkCount++
          yield nextResult.value
        }
      }

      // 4. Every route in the chain failed before producing output
      throw lastError ?? new Error('model-mask: every available route failed before producing output')
    }
  })()
}

/**
 * Service exposing the live mask identity and its last resolved route chain.
 *
 * The adapter itself re-resolves the chain for every turn, so a provider added
 * in `Settings > Models` participates on the next request. This service keeps a
 * snapshot for display and refreshes it when the registry or the deployment
 * default changes.
 */
export class ModelMaskService extends Service {
  private identity: LlmRoutingPolicy
  private routes: { readonly primaryRoute: Route; readonly fallbackChain: readonly Route[] } =
    { primaryRoute: { provider: 'none', model: 'none' }, fallbackChain: [] }

  constructor(ctx: Context, config: Config) {
    super(ctx, 'modelMask')
    this.identity = plain(config)
  }

  /**
   * Current mask identity and pinned routes.
   * @returns the virtual provider, model, name, pinned routes, and failover policy.
   */
  getPolicy(): LlmRoutingPolicy {
    return { ...this.identity }
  }

  /**
   * Last resolved routes, refreshed by {@link refresh}.
   * @returns the primary route and ordered fallback chain.
   */
  currentRoutes(): { readonly primaryRoute: Route; readonly fallbackChain: readonly Route[] } {
    return this.routes
  }

  /**
   * Adopt the current values of a volatile Config without rebuilding the plugin.
   * @param config - the plugin Config whose references were just updated.
   */
  reload(config: Config): void {
    this.identity = plain(config)
  }

  /** Re-read the route chain from the live LLM registry and the pinned routes. */
  async refresh(): Promise<void> {
    this.routes = await resolveRouteChain(this.ctx, this.identity)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host service managing the CopyMonster model mask and its routing policy. */
    modelMask: ModelMaskService
  }
}

/**
 * Register the virtual adapter for the mask and keep its display snapshot current.
 * @param ctx - plugin Context that owns the listener and registration lifetime.
 * @param config - validated mask configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new ModelMaskService(ctx, config)
  // Volatile fields update in place without remounting the plugin, so the
  // running policy must re-read the Config when the profile is saved.
  ctx.on('loader/volatile-update', () => {
    service.reload(config)
    void service.refresh().catch((error: unknown) => {
      ctx.logger.warn('model-mask: route chain refresh failed (%s)', String(error))
    })
  })
  // Any provider or model change re-resolves the display snapshot, so a
  // provider added in Settings > Models appears without an admin write.
  ctx.on('llm/adapters-updated', () => { void service.refresh().catch((error: unknown) => {
    ctx.logger.warn('model-mask: route chain refresh failed (%s)', String(error))
  }) })
  ctx.on('settings/document-updated', () => { void service.refresh().catch((error: unknown) => {
    ctx.logger.warn('model-mask: route chain refresh failed (%s)', String(error))
  }) })
  void service.refresh().catch((error: unknown) => {
    ctx.logger.warn('model-mask: initial route chain resolution failed (%s)', String(error))
  })

  const adapter = buildVirtualAdapter({
    ctx,
    getPolicy: () => ({ ...service.getPolicy(), ...service.currentRoutes() }),
  })

  const virtualProvider = config.virtualProvider.get() ?? VIRTUAL_PROVIDER
  ctx.llm.registerAdapter([virtualProvider], adapter)

  // `settings` is optional for this plugin: the mask works without a settings
  // page, so read it through `ctx.get` instead of widening `inject`.
  ctx.inject(['settings'], (child) => {
    const settings: SettingsForms | undefined = child.get('settings')
    if (settings === undefined) return
    child.effect(() => settings.configure({ auto: false }, ctx.fiber))
  })
}
