/**
 * CopyMonster virtual-model mask for the Host.
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
 * `ctx.llm.stream`. The logged `request/header` keeps the virtual alias, so
 * the real topology stays out of the durable log.
 *
 * No `packages/core/` or `packages/llm/` code is touched; routing happens
 * purely through the public `llm` service API.
 * @module @deepseek-ai/dsh-host-model-mask
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

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

/** Plugin configuration: the virtual alias and the primary route it resolves to. */
export interface Config {
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
  /** Whether masking applies only to non-admin callers. @default true */
  readonly applyToTenantsOnly?: boolean
}

import z from '@deepseek-ai/schemastery'

/** Loader schema for {@link Config}. */
export const Config: z<Config> = z.object({
  virtualProvider: z.string().default(VIRTUAL_PROVIDER),
  virtualModel: z.string().default(VIRTUAL_MODEL),
  virtualModelName: z.string().default(VIRTUAL_MODEL_NAME),
  primaryProvider: z.string().min(1),
  primaryModel: z.string().min(1),
  applyToTenantsOnly: z.boolean().default(true),
})

/** One masked Adapter registration for the virtual provider route. */
export interface VirtualAdapterDeps {
  readonly ctx: Context
  readonly primaryProvider: string
  readonly primaryModel: string
}

/**
 * Build the adapter that serves the virtual provider route. Its `stream`
 * reissues the call on the configured primary route; every other method
 * reports virtual-model metadata so catalog and resolution paths succeed.
 * @param deps - plugin context and the primary route to delegate to.
 * @returns an `LlmAdapter` whose `stream` delegates to `ctx.llm.stream` on the primary route.
 */
export function buildVirtualAdapter(deps: VirtualAdapterDeps): LlmAdapter {
  const { ctx, primaryProvider, primaryModel } = deps
  return new (class VirtualLlmAdapter extends LlmAdapter {
    override providerInfo() {
      return { id: VIRTUAL_PROVIDER, name: VIRTUAL_MODEL_NAME }
    }
    override async listModels() {
      return [
        { provider: VIRTUAL_PROVIDER, id: VIRTUAL_MODEL, name: VIRTUAL_MODEL_NAME },
      ]
    }
    override async resolveModel(_provider: string, model: string) {
      return {
        provider: VIRTUAL_PROVIDER,
        id: model,
        name: VIRTUAL_MODEL_NAME,
        description: VIRTUAL_MODEL_DESCRIPTION,
      }
    }
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      // Reissue on the primary route, hiding the real provider/model from the
      // request that the loop logs and the client observes.
      const real = {
        ...options,
        provider: primaryProvider,
        model: primaryModel,
      } as GenerateOptions
      const inner = await ctx.llm.stream(real)
      yield* inner
    }
  })()
}

/**
 * Register the virtual adapter and participate in the `agent/request`
 * waterfall so the alias is admitted for the loop.
 *
 * The alias itself is left intact on the config: the `agent/request`
 * validation compares the proposed config against the recorded selection,
 * which is also the alias. The real route is applied by the virtual adapter
 * at `stream` time, after step preparation has fixed the selection.
 * @param ctx - plugin Context that owns the listener and registration lifetime.
 * @param config - validated mask configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = Config(config)
  const { primaryProvider, primaryModel, virtualProvider } = resolved
  if (
    typeof primaryProvider !== 'string'
    || typeof primaryModel !== 'string'
    || typeof virtualProvider !== 'string'
  ) {
    throw new Error('model-mask: primaryProvider, primaryModel, and virtualProvider are required')
  }
  const adapter = buildVirtualAdapter({
    ctx,
    primaryProvider,
    primaryModel,
  })

  ctx.llm.registerAdapter([virtualProvider], adapter)
}
