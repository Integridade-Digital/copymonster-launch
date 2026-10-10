/**
 * CopyMonster Brand DNA injection for positioned sessions.
 *
 * Registers a global `system-prompt/assemble` waterfall listener that
 * prepends the canonical POSITIONING CONTEXT section when the assembling
 * session carries a `positioningMappingId` (the session-controller's
 * sessionTenantMap). Sessions without one run DNA-free, and so do sessions
 * whose mapping is missing, unreadable, or not completed.
 *
 * The scope key of one assembly is the assembling Agent itself
 * (`createScope(loopCtx, this)` in the agent loop), so `scope.session` is
 * the Session the tenant map is keyed on; subagent scopes carry their own
 * sessions and therefore inherit nothing.
 *
 * One fetched mapping is cached per Session for the mapping id it was
 * fetched under; a session switching ids refetches, and a service restart
 * empties the cache with the process.
 * @module @deepseek-ai/dsh-host-positioning-injection
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { sessionTenantMap } from '@deepseek-ai/dsh-api-session-controller'
import type { PositioningMappingRow } from '@deepseek-ai/dsh-supabase-client'
import { buildPositioningText, POSITIONING_SECTION } from './prompt.ts'
import { fetchPositioningMapping } from './persistence.ts'

/** Stable Cordis plugin name. */
export const name = 'positioning-injection'

/** The prompt registry whose assemble waterfall this plugin intercepts. */
export const inject = ['systemPrompt']

export { POSITIONING_SECTION, buildPositioningText } from './prompt.ts'

/** The Session type the tenant map is keyed on, derived from the map itself. */
type MappedSession = Parameters<typeof sessionTenantMap.get>[0]

/** One fetched mapping per Session, keyed by the id it was fetched for. */
const cache = new WeakMap<MappedSession, { mappingId: string; mapping: PositioningMappingRow }>()

/**
 * Fetch (and cache) one session's mapping; a fetch that finds no row leaves
 * no cache entry, so the next turn retries.
 * @param session - the Session the assembly belongs to.
 * @param mappingId - the positioning mapping the session carries.
 * @param userId - the session's user identity.
 * @returns the mapping row, or undefined when absent or unreadable.
 */
async function loadAndCache(
  session: MappedSession,
  mappingId: string,
  userId: string,
): Promise<PositioningMappingRow | undefined> {
  const mapping = await fetchPositioningMapping(mappingId, userId)
  if (mapping !== undefined) cache.set(session, { mappingId, mapping })
  return mapping
}

/**
 * Prepend the POSITIONING CONTEXT section to positioned, completed sessions.
 * @param ctx - Host context carrying the prompt registry.
 */
export function apply(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (_assembly, context, next): Promise<PromptAssembly> => {
    const downstream = await next()
    const agent = context.scope as { session?: MappedSession } | undefined
    const session = agent?.session
    if (session === undefined) return downstream
    const meta = sessionTenantMap.get(session)
    if (meta === undefined || meta.positioningMappingId === undefined) return downstream
    const cached = cache.get(session)
    const mapping = cached !== undefined && cached.mappingId === meta.positioningMappingId
      ? cached.mapping
      : await loadAndCache(session, meta.positioningMappingId, meta.userId)
    if (mapping === undefined || mapping.status !== 'completed') return downstream
    return {
      ...downstream,
      sections: [
        // interpolate false: the creator's block content stays verbatim.
        { name: POSITIONING_SECTION, text: buildPositioningText(mapping), interpolate: false },
        ...downstream.sections,
      ],
    }
  }, { global: true, prepend: true })
}
