/**
 * Positioning-mapping persistence over the caller's own Supabase client.
 * @module @deepseek-ai/dsh-host-positioning-injection/persistence
 */

import { createUserClient, type PositioningMappingRow } from '@deepseek-ai/dsh-supabase-client'

/**
 * Fetch one positioning mapping for the caller who owns the session.
 *
 * `get_my_positioning_mapping()` derives the user from `auth.uid()`, so a
 * foreign mapping id reads as absent and the tenant DSH needs no service-role
 * key. Never logs mapping content — only the failure reason — so the creator's
 * DNA never reaches host logs. Any failure, including a missing caller token,
 * reads as absent and the assembly proceeds DNA-free.
 * @param mappingId - the positioning mapping the session carries.
 * @param token - bearer token of the session's user.
 * @returns the mapping row, or undefined when absent or unreadable.
 */
export async function fetchPositioningMapping(
  mappingId: string,
  token?: string,
): Promise<PositioningMappingRow | undefined> {
  if (token === undefined || token === '') return undefined
  try {
    const { data, error } = await createUserClient(token).rpc('get_my_positioning_mapping', {
      p_mapping_id: mappingId,
    })
    if (error !== null) {
      console.error('positioning-injection: get_my_positioning_mapping request failed:', error.message)
      return undefined
    }
    return (data ?? [])[0]
  } catch (error) {
    console.error('positioning-injection: get_my_positioning_mapping threw:',
      error instanceof Error ? error.message : String(error))
    return undefined
  }
}
