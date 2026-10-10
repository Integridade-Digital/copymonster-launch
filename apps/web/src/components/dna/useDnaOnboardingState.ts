import { useEffect, useState } from 'react'
import { supabaseClient, type PositioningMappingRow } from '../../lib/auth/supabase.client'
import type { TranslationKey } from '../../locales'

export type PositioningMapping = PositioningMappingRow

/** One block's persistence column and display-name key. */
export interface DnaBlockMeta {
  readonly column: Extract<keyof PositioningMappingRow, `block_${string}`>
  readonly nameKey: TranslationKey
}

const DNA_BLOCKS: readonly DnaBlockMeta[] = [
  { column: 'block_1_public', nameKey: 'onboarding.dna.block.1' },
  { column: 'block_2_pains', nameKey: 'onboarding.dna.block.2' },
  { column: 'block_3_solution', nameKey: 'onboarding.dna.block.3' },
  { column: 'block_4_differentiators', nameKey: 'onboarding.dna.block.4' },
  { column: 'block_5_awareness_stage', nameKey: 'onboarding.dna.block.5' },
  { column: 'block_6_urgency', nameKey: 'onboarding.dna.block.6' },
  { column: 'block_7_social_proof', nameKey: 'onboarding.dna.block.7' },
  { column: 'block_8_objections', nameKey: 'onboarding.dna.block.8' },
  { column: 'block_9_emotional', nameKey: 'onboarding.dna.block.9' },
  { column: 'block_10_transformation', nameKey: 'onboarding.dna.block.10' },
  { column: 'block_11_voice', nameKey: 'onboarding.dna.block.11' },
  { column: 'block_12_promises', nameKey: 'onboarding.dna.block.12' },
]

/** Metadata of block `block` (1..12), or undefined outside the interview range. */
export function dnaBlock(block: number): DnaBlockMeta | undefined {
  return DNA_BLOCKS[block - 1]
}

/** Blocks the interview may skip; block 12 must be saved to complete the mapping. */
export const DNA_ADAPTIVE_BLOCKS = [2, 5, 6, 7, 8] as const

export async function listMyPositioningMappings(): Promise<PositioningMappingRow[]> {
  const { data, error } = await supabaseClient.rpc('list_my_positioning_mappings')
  if (error !== null) throw new Error(error.message)
  return data ?? []
}

export async function createPositioningMapping(
  name: string,
  productName: string,
): Promise<PositioningMappingRow> {
  const { data, error } = await supabaseClient.rpc('create_positioning_mapping', {
    p_name: name,
    p_product_name: productName,
  })
  if (error !== null) throw new Error(error.message)
  if (data === null) throw new Error('create_positioning_mapping returned no row')
  return data
}

export async function updatePositioningBlock(
  mappingId: string,
  blockNumber: number,
  content: string,
): Promise<PositioningMappingRow> {
  const { data, error } = await supabaseClient.rpc('update_positioning_block', {
    p_mapping_id: mappingId,
    p_block_number: blockNumber,
    p_content: content,
  })
  if (error !== null) throw new Error(error.message)
  if (data === null) throw new Error('update_positioning_block returned no row')
  return data
}

/** Mapping bootstrap state the chrome renders from. */
export interface DnaOnboardingState {
  readonly mapping: PositioningMappingRow | null
  readonly mappingError: boolean
  readonly setMapping: (mapping: PositioningMappingRow) => void
}

/**
 * Load the creator's in-progress DNA mapping, creating the first one when none exists.
 * @param active - whether the onboarding route is showing.
 * @param firstName - name for a newly created first mapping.
 * @returns the mapping (or its load failure) and its setter.
 */
export function useDnaOnboardingState(active: boolean, firstName: string): DnaOnboardingState {
  const [mapping, setMapping] = useState<PositioningMappingRow | null>(null)
  const [mappingError, setMappingError] = useState(false)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const rows = await listMyPositioningMappings()
        if (cancelled) return
        const open = rows.find(row => row.status === 'in_progress')
        if (open !== undefined) {
          setMapping(open)
          setMappingError(false)
          return
        }
        const created = await createPositioningMapping(firstName, '')
        if (cancelled) return
        setMapping(created)
        setMappingError(false)
      } catch {
        if (!cancelled) setMappingError(true)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [active, firstName])
  return { mapping, mappingError, setMapping }
}
