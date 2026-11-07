/**
 * Cross-provider model-request failover for the CopyMonster host.
 *
 * When the agent loop's model request for a configured primary provider fails
 * with a transient code, this plugin redirects the retried step to a fallback
 * provider route. It is order-robust with `dsh-llm-retry`: it only fails over
 * once no downstream policy is still retrying the same route, so the primary
 * gets its retry budget first (retry-then-failover) whether or not this listener
 * is registered before `llm-retry`.
 *
 * Failover is cascading: each rule declares an ordered chain of fallback routes.
 * On every eligible failure the active route advances one step down the chain
 * for the rest of that turn. If the chain is exhausted, no retry is requested
 * and the failure surfaces to the caller. Later turns re-resolve to the primary
 * route without a turn-end listener.
 *
 * It registers two documented agent-loop waterfalls and touches no `packages/llm/`
 * code: `agent/request-error` decides the failover, and `agent/request` returns
 * the active route for the rest of that turn. The loop already logs the switched
 * request header, so the redirect is reconstructable from the session log.
 * The fallback routes must be registered by an adapter (for example an
 * `llm-pi-ai` `openrouter` provider profile).
 * @module @deepseek-ai/dsh-host-llm-fallback
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

/** Stable Cordis plugin name. */
export const name = 'llm-fallback'

/** This plugin consumes no services; it only contributes waterfall listeners. */
export const inject: string[] = []

/** Failure codes that trigger failover by default. */
const DEFAULT_FALLBACK_CODES = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'] as const

/** One fallback route in a cascade chain. */
export interface FallbackRoute {
  /** Provider route to redirect to. */
  readonly provider: string
  /** Model id to use on the fallback provider route. */
  readonly model: string
}

/** One primary route and its ordered chain of fallback routes. */
export interface FallbackRule {
  /** Provider route whose failures trigger the failover chain. */
  readonly primary: string
  /** Ordered fallback routes; the first eligible one is tried on failure. */
  readonly fallbacks: FallbackRoute[]
  /** Failure codes eligible for this rule; defaults to the transient set. */
  readonly codes?: string[]
}

/** Plugin configuration. */
export interface Config {
  /** Failover rules; an empty list disables the plugin. */
  readonly rules: FallbackRule[]
}

/** Loader schema for {@link Config}. */
export const Config: z<Config> = z.object({
  rules: z.array(z.object({
    primary: z.string().required(),
    fallbacks: z.array(z.object({
      provider: z.string().required(),
      model: z.string().required(),
    })),
    codes: z.array(z.string()).default([...DEFAULT_FALLBACK_CODES]),
  })).default([]),
})

/** One resolved fallback rule. */
interface ResolvedRule {
  readonly primary: string
  readonly fallbacks: readonly ResolvedFallbackRoute[]
  readonly codes: ReadonlySet<string>
}

/** One resolved fallback route. */
interface ResolvedFallbackRoute {
  readonly provider: string
  readonly model: string
}

/**
 * The active route for one agent turn while a failover chain is in progress.
 * `index` points into `rule.fallbacks`: `0` means the first fallback is active.
 * `turn` is the turn this route was selected for, so later turns re-resolve to
 * the primary route without a turn-end listener.
 */
interface ActiveRoute {
  readonly rule: ResolvedRule
  readonly index: number
  readonly turn: number
}

/**
 * Register the failover waterfalls.
 * @param ctx - plugin Context that owns the listener lifetime.
 * @param config - validated failover configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = Config(config)
  const rules: ResolvedRule[] = resolved.rules.map(rule => ({
    primary: rule.primary,
    fallbacks: rule.fallbacks.map(route => ({
      provider: route.provider,
      model: route.model,
    })),
    codes: new Set(rule.codes ?? DEFAULT_FALLBACK_CODES),
  }))
  if (rules.length === 0) return

  // Agent -> turn that already advanced down its fallback chain. Scoping by
  // turn means later turns re-resolve to the primary route without a
  // turn-end listener.
  const activeRoute = new WeakMap<Agent, ActiveRoute>()

  /** Resolve the rule for a provider, or undefined when none owns it. */
  const ruleFor = (provider: string): ResolvedRule | undefined =>
    rules.find(candidate => candidate.primary === provider)

  ctx.on('agent/request-error', async (
    { agent, turn, provider, failure, signal },
    next,
  ): Promise<RequestErrorAction> => {
    // Resume the rest of the chain first: a downstream policy that is still
    // retrying the same route (llm-retry) keeps its budget.
    const downstream = await next()
    if (signal.aborted) return downstream
    if (downstream?.kind === 'retry') return downstream

    const current = activeRoute.get(agent)
    if (current !== undefined && current.turn === turn) {
      // Already failing over this turn: advance one step down the same chain.
      const nextIndex = current.index + 1
      if (nextIndex >= current.rule.fallbacks.length) {
        // Chain exhausted: do not request a retry, let the failure surface.
        return downstream
      }
      activeRoute.set(agent, { rule: current.rule, index: nextIndex, turn })
      const route = current.rule.fallbacks[nextIndex]!
      ctx.logger.warn(
        'llm-fallback: provider "%s" failed with %s; retrying on "%s" (%s) (fallback %d of %d)',
        provider,
        failure.code,
        route.provider,
        route.model,
        nextIndex + 1,
        current.rule.fallbacks.length,
      )
      return { kind: 'retry' }
    }

    // Not failing over yet: resolve the rule that owns the failing provider.
    const rule = ruleFor(provider)
    if (rule === undefined) return downstream
    if (!rule.codes.has(failure.code)) return downstream

    if (rule.fallbacks.length === 0) return downstream
    activeRoute.set(agent, { rule, index: 0, turn })
    const route = rule.fallbacks[0]!
    ctx.logger.warn(
      'llm-fallback: provider "%s" failed with %s; retrying on "%s" (%s) (fallback 1 of %d)',
      provider,
      failure.code,
      route.provider,
      route.model,
      rule.fallbacks.length,
    )
    return { kind: 'retry' }
  })

  ctx.on('agent/request', async ({ agent, turn }, next): Promise<LlmCallConfig> => {
    const base = await next()
    const current = activeRoute.get(agent)
    if (current === undefined || current.turn !== turn) return base
    const fallback = current.rule.fallbacks[current.index]!
    // Drop the primary model's reasoning effort: the fallback model owns its own.
    const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = base
    return { ...withoutInheritedEffort, provider: fallback.provider, model: fallback.model }
  })
}
