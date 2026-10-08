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
 * It registers two documented agent-loop waterfalls and touches no `packages/llm/`
 * code: `agent/request-error` decides the failover, and `agent/request` returns
 * the fallback route for the rest of that turn. The loop already logs the switched
 * request header, so the redirect is reconstructable from the session log. The
 * fallback route must be registered by an adapter (for example an `llm-pi-ai`
 * `openrouter` provider profile).
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

/** One primary route and the fallback route it fails over to. */
export interface FallbackRule {
  /** Provider route whose failures trigger the fallback. */
  primary: string
  /** Fallback provider route to redirect to. */
  fallbackProvider: string
  /** Model id to use on the fallback provider route. */
  fallbackModel: string
  /** Failure codes eligible for this rule; defaults to the transient set. */
  codes?: string[]
}

/** Plugin configuration. */
export interface Config {
  /** Failover rules; an empty list disables the plugin. */
  rules: FallbackRule[]
}

/** Loader schema for {@link Config}. */
export const Config: z<Config> = z.object({
  rules: z.array(z.object({
    primary: z.string().required(),
    fallbackProvider: z.string().required(),
    fallbackModel: z.string().required(),
    codes: z.array(z.string()).default([...DEFAULT_FALLBACK_CODES]),
  })).default([]),
})

/** One resolved fallback rule. */
interface ResolvedRule {
  readonly primary: string
  readonly fallbackProvider: string
  readonly fallbackModel: string
  readonly codes: ReadonlySet<string>
}

/**
 * Register the failover waterfalls.
 * @param ctx - plugin Context that owns the listener lifetime.
 * @param config - validated failover rules.
 */
export function apply(ctx: Context, config: Config): void {
  const rules: ResolvedRule[] = config.rules.map(rule => ({
    primary: rule.primary,
    fallbackProvider: rule.fallbackProvider,
    fallbackModel: rule.fallbackModel,
    codes: new Set(rule.codes ?? DEFAULT_FALLBACK_CODES),
  }))
  if (rules.length === 0) return

  // Agent -> turn that already switched to its fallback. Scoping by turn means
  // later turns re-resolve to the primary route without a turn-end listener.
  const fallbackTurn = new WeakMap<Agent, number>()

  ctx.on('agent/request-error', async (
    { agent, turn, provider, failure, signal },
    next,
  ): Promise<RequestErrorAction> => {
    // Resume the rest of the chain first: a downstream policy that is still
    // retrying the same route (llm-retry) keeps its budget.
    const downstream = await next()
    if (signal.aborted) return downstream
    if (downstream?.kind === 'retry') return downstream
    if (fallbackTurn.get(agent) === turn) return downstream
    const rule = rules.find(candidate => candidate.primary === provider && candidate.codes.has(failure.code))
    if (rule === undefined) return downstream
    fallbackTurn.set(agent, turn)
    ctx.logger.warn(
      'llm-fallback: provider "%s" failed with %s; retrying on "%s" (%s)',
      provider, failure.code, rule.fallbackProvider, rule.fallbackModel,
    )
    return { kind: 'retry' }
  })

  ctx.on('agent/request', async ({ agent, turn }, next): Promise<LlmCallConfig> => {
    const base = await next()
    if (fallbackTurn.get(agent) !== turn) return base
    const rule = rules.find(candidate => candidate.primary === base.provider)
    if (rule === undefined) return base
    // Drop the primary model's reasoning effort: the fallback model owns its own.
    const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = base
    return { ...withoutInheritedEffort, provider: rule.fallbackProvider, model: rule.fallbackModel }
  })
}
