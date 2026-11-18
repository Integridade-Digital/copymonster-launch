/**
 * CopyMonster virtual-model mask for the Host with streaming failover.
 *
 * Tenants see exactly one selectable model — `copy-monster-default` / "Model
 * CopyMonster" — in the browser model catalog. The underlying provider and
 * model id never reach the client payload, error messages, the session log,
 * or the wire. The alias is admitted by `modelAvailable()` (owned by the
 * session-controller) and resolved privately to the configured primary route
 * at model-request time, so the Agent turn executes on the real provider
 * without exposing it.
 *
 * Platform administrators (`isAdmin === true`) keep the full real provider
 * catalog; that branch is owned by the session-controller's `buildModelCatalog`.
 *
 * This plugin registers an adapter for the virtual provider route. When the
 * Agent loop dispatches a request whose provider/model is the virtual alias,
 * this adapter's `stream` reissues the call on the primary route through
 * `ctx.llm.stream`. If the primary route fails with an eligible transient error
 * (e.g. 429, 5xx, timeout, transport) BEFORE any chunk is emitted to the
 * client, it safely fails over to the configured contingency route.
 * Once any chunk has been emitted, failover is strictly forbidden to prevent
 * corrupted or mixed generation outputs.
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

/** Stable Cordis plugin name. */
export const name = 'model-mask'

/** The plugin consumes the live `llm` registry to register the virtual adapter. */
export const inject = ['llm'] as const

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

/** Configuration for failover policy. */
export interface FallbackPolicyConfig {
  /** Whether automatic failover is enabled. @default true */
  readonly enabled?: boolean
  /** Maximum retry/failover attempts. @default 2 */
  readonly maxAttempts?: number
  /** Timeout in ms before failing over. @default 30000 */
  readonly timeoutMs?: number
}

/** Central model routing policy. */
export interface LlmRoutingPolicy {
  /** Virtual provider route advertised in the masked catalog. @default 'copymonster' */
  readonly virtualProvider?: string
  /** Virtual model id advertised in the masked catalog. @default 'copy-monster-default' */
  readonly virtualModel?: string
  /** Human-readable virtual model name. @default 'Model CopyMonster' */
  readonly virtualModelName?: string
  /** Real provider route the virtual alias resolves to at dispatch time. */
  readonly primaryProvider: string
  /** Real model id the virtual alias resolves to at dispatch time. */
  readonly primaryModel: string
  /** Optional fallback provider route when primary experiences transient failure. */
  readonly fallbackProvider?: string
  /** Optional fallback model id when primary experiences transient failure. */
  readonly fallbackModel?: string
  /** Failover policy options. */
  readonly fallbackPolicy?: FallbackPolicyConfig
  /** Whether masking applies only to non-admin callers. @default true */
  readonly applyToTenantsOnly?: boolean
}

/** Plugin configuration: the virtual alias, primary route, and optional fallback. */
export interface Config {
  /** Virtual provider route advertised in the masked catalog. */
  virtualProvider: Volatile<string>
  /** Virtual model id advertised in the masked catalog. */
  virtualModel: Volatile<string>
  /** Human-readable virtual model name. */
  virtualModelName: Volatile<string>
  /** Real provider route the virtual alias resolves to at dispatch time. */
  primaryProvider: Volatile<string>
  /** Real model id the virtual alias resolves to at dispatch time. */
  primaryModel: Volatile<string>
  /** Optional fallback provider route when the primary fails transiently. */
  fallbackProvider: Volatile<string | undefined>
  /** Optional fallback model id when the primary fails transiently. */
  fallbackModel: Volatile<string | undefined>
  /** Failover policy options. */
  fallbackPolicy: Volatile<FallbackPolicyConfig | undefined>
  /** Whether masking applies only to non-admin callers. */
  applyToTenantsOnly: Volatile<boolean>
}

/** Project a plugin Config to its plain values, dropping the live references. */
function plain(config: Config): LlmRoutingPolicy {
  const fallbackProvider = config.fallbackProvider.get()
  const fallbackModel = config.fallbackModel.get()
  const fallbackPolicy = config.fallbackPolicy.get()
  return {
    virtualProvider: config.virtualProvider.get(),
    virtualModel: config.virtualModel.get(),
    virtualModelName: config.virtualModelName.get(),
    primaryProvider: config.primaryProvider.get(),
    primaryModel: config.primaryModel.get(),
    ...fallbackProvider === undefined ? {} : { fallbackProvider },
    ...fallbackModel === undefined ? {} : { fallbackModel },
    ...fallbackPolicy === undefined ? {} : { fallbackPolicy },
    applyToTenantsOnly: config.applyToTenantsOnly.get(),
  }
}

/** Loader schema for {@link Config}. */
export const Config = z.object({
  virtualProvider: z.string().default(VIRTUAL_PROVIDER).volatile(),
  virtualModel: z.string().default(VIRTUAL_MODEL).volatile(),
  virtualModelName: z.string().default(VIRTUAL_MODEL_NAME).volatile(),
  primaryProvider: z.string().min(1).volatile(),
  primaryModel: z.string().min(1).volatile(),
  fallbackProvider: z.string().volatile(),
  fallbackModel: z.string().volatile(),
  fallbackPolicy: z.object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().default(2),
    timeoutMs: z.number().default(30000),
  }).default({ enabled: true, maxAttempts: 2, timeoutMs: 30000 }).volatile(),
  applyToTenantsOnly: z.boolean().default(true).volatile(),
})

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
 * over to the configured fallback route.
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
    // 401: the route's own key was rejected. A stale or revoked platform key must not
    // take every tenant down while a configured fallback route can still serve the turn.
    if (status === 401) return true
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
    if (upperCode.includes('AUTH') || upperCode.includes('KEY')) return true
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

/** One masked Adapter registration for the virtual provider route. */
export interface VirtualAdapterDeps {
  readonly ctx: Context
  readonly primaryProvider?: string
  readonly primaryModel?: string
  readonly getPolicy?: () => LlmRoutingPolicy
}

/**
 * Build the adapter that serves the virtual provider route. Its `stream`
 * reissues the call on the configured primary route with streaming failover;
 * every other method reports virtual-model metadata so catalog and resolution
 * paths succeed.
 * @param deps - plugin context and routing policy provider.
 * @returns an `LlmAdapter` whose `stream` executes routing and contingency failover.
 */
export function buildVirtualAdapter(deps: VirtualAdapterDeps): LlmAdapter {
  const { ctx } = deps
  const resolvePolicy = (): LlmRoutingPolicy => {
    if (deps.getPolicy) return deps.getPolicy()
    return {
      primaryProvider: deps.primaryProvider ?? 'deepseek-official',
      primaryModel: deps.primaryModel ?? 'deepseek-chat',
    }
  }

  return new (class VirtualLlmAdapter extends LlmAdapter {
    override providerInfo() {
      const policy = resolvePolicy()
      return {
        id: policy.virtualProvider ?? VIRTUAL_PROVIDER,
        name: policy.virtualModelName ?? VIRTUAL_MODEL_NAME,
      }
    }

    override async listModels() {
      const policy = resolvePolicy()
      const provider = policy.virtualProvider ?? VIRTUAL_PROVIDER
      const model = policy.virtualModel ?? VIRTUAL_MODEL
      const name = policy.virtualModelName ?? VIRTUAL_MODEL_NAME
      return [{ provider, id: model, name }]
    }

    override async resolveModel(_provider: string, model: string) {
      const policy = resolvePolicy()
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
      // 1. Snapshot policy at the start of generation (immutable for this turn)
      const policy = resolvePolicy()
      const primary = { provider: policy.primaryProvider, model: policy.primaryModel }
      const hasFallback = policy.fallbackProvider !== undefined
        && policy.fallbackProvider !== ''
        && policy.fallbackModel !== undefined
        && policy.fallbackModel !== ''
        && policy.fallbackPolicy?.enabled !== false
      const fallback = hasFallback
        ? { provider: policy.fallbackProvider, model: policy.fallbackModel }
        : undefined

      let chunkCount = 0
      let primaryStream: AsyncIterable<StreamChunk> | undefined

      // 2. Attempt primary stream initialization
      try {
        const primaryOptions = {
          ...options,
          provider: primary.provider,
          model: primary.model,
        } as GenerateOptions
        primaryStream = await ctx.llm.stream(primaryOptions)
      } catch (error) {
        if (fallback && isEligibleFailoverError(error) && chunkCount === 0) {
          ctx.logger.warn(
            'model-mask: primary route "%s/%s" failed before stream (%s); failing over to "%s/%s"',
            primary.provider,
            primary.model,
            String(error),
            fallback.provider,
            fallback.model,
          )
          const fallbackOptions = {
            ...options,
            provider: fallback.provider,
            model: fallback.model,
          } as GenerateOptions
          const fallbackStream = await ctx.llm.stream(fallbackOptions)
          yield* fallbackStream
          return
        }
        throw error
      }

      // 3. Pull initial chunk before yielding to verify primary stream health
      const iterator = primaryStream[Symbol.asyncIterator]()
      let firstResult: IteratorResult<StreamChunk>
      try {
        firstResult = await iterator.next()
      } catch (error) {
        if (fallback && isEligibleFailoverError(error) && chunkCount === 0) {
          ctx.logger.warn(
            'model-mask: primary route "%s/%s" failed on initial chunk (%s); failing over to "%s/%s"',
            primary.provider,
            primary.model,
            String(error),
            fallback.provider,
            fallback.model,
          )
          const fallbackOptions = {
            ...options,
            provider: fallback.provider,
            model: fallback.model,
          } as GenerateOptions
          const fallbackStream = await ctx.llm.stream(fallbackOptions)
          yield* fallbackStream
          return
        }
        throw error
      }

      // 4. Once the first chunk is emitted, failover is STRICTLY FORBIDDEN
      if (!firstResult.done) {
        chunkCount++
        yield firstResult.value
        while (true) {
          const nextResult = await iterator.next()
          if (nextResult.done) break
          chunkCount++
          yield nextResult.value
        }
      }
    }
  })()
}

/**
 * Service managing live model routing policy on the Host.
 */
export class ModelMaskService extends Service {
  private activePolicy: LlmRoutingPolicy

  constructor(ctx: Context, initialConfig: Config) {
    super(ctx, 'modelMask')
    this.activePolicy = plain(initialConfig)
  }

  getPolicy(): LlmRoutingPolicy {
    return { ...this.activePolicy }
  }

  /**
   * Adopt the current values of a volatile Config without rebuilding the plugin.
   * @param config - the plugin Config whose references were just updated.
   */
  reload(config: Config): void {
    this.activePolicy = plain(config)
  }

  updatePolicy(next: Partial<LlmRoutingPolicy>): LlmRoutingPolicy {
    this.activePolicy = { ...this.activePolicy, ...next }
    return { ...this.activePolicy }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host service managing CopyMonster model mask and routing policy. */
    modelMask: ModelMaskService
  }
}

/**
 * Register the virtual adapter and participate in the `agent/request`
 * waterfall so the alias is admitted for the loop.
 *
 * @param ctx - plugin Context that owns the listener and registration lifetime.
 * @param config - validated mask configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new ModelMaskService(ctx, config)
  // Volatile fields update in place without remounting the plugin, so the
  // running policy must re-read the Config when the profile is saved.
  ctx.on('loader/volatile-update', () => { service.reload(config) })
  const resolved = service.getPolicy()
  const virtualProvider = resolved.virtualProvider ?? VIRTUAL_PROVIDER

  const adapter = buildVirtualAdapter({
    ctx,
    getPolicy: () => service.getPolicy(),
  })

  ctx.llm.registerAdapter([virtualProvider], adapter)

  // `settings` is optional for this plugin: the mask works without a settings
  // page, so read it through `ctx.get` instead of widening `inject`.
  ctx.inject(['settings'], (child) => {
    const settings: SettingsForms | undefined = child.get('settings')
    if (settings === undefined) return
    child.effect(() => settings.configure({ auto: false }, ctx.fiber))
  })
}
