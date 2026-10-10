/**
 * Positioning-mapping persistence over the service-role Supabase client.
 * @module @deepseek-ai/dsh-host-positioning-injection/persistence
 */

import { supabaseAdminClient, type PositioningMappingRow } from '@deepseek-ai/dsh-supabase-client'

/**
 * Fetch one positioning mapping, confined to the session's user: the RPC
 * returns rows only where `user_id` matches, so a foreign mapping id reads
 * as absent. Never logs mapping content — only the failure reason — so the
 * creator's DNA never reaches host logs. Any failure reads as absent and
 * the assembly proceeds DNA-free.
 * @param mappingId - the positioning mapping the session carries.
 * @param userId - the session's user identity.
 * @returns the mapping row, or undefined when absent or unreadable.
 */
export async function fetchPositioningMapping(
  mappingId: string,
  userId: string,
): Promise<PositioningMappingRow | undefined> {
  try {
    const { data, error } = await supabaseAdminClient.rpc('get_positioning_mapping', {
      p_mapping_id: mappingId,
      p_user_id: userId,
    })
    if (error !== null) {
      console.error('positioning-injection: get_positioning_mapping request failed:', error.message)
      return undefined
    }
    return (data ?? [])[0]
  } catch (error) {
    console.error('positioning-injection: get_positioning_mapping threw:',
      error instanceof Error ? error.message : String(error))
    return undefined
  }
}
