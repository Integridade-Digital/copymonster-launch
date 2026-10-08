/**
 * Supabase-backed runtime LLM catalog.
 * @module @deepseek-ai/dsh-host-llm-credentials-supabase/catalog
 */

import type { RuntimeCatalog, RuntimeProviderEntry } from './types.ts'

/**
 * Catalog that reads `get_runtime_llm_catalog()` through the service-role
 * Supabase client. The client is imported dynamically so merely importing this
 * module never requires Supabase environment variables; the same import keeps
 * the decrypted key inside the RPC's service-role response and out of every
 * loader and diagnostic.
 */
export class SupabaseRuntimeCatalog implements RuntimeCatalog {
  /** @inheritdoc */
  async load(): Promise<readonly RuntimeProviderEntry[]> {
    const { supabaseAdminClient } = await import('@deepseek-ai/dsh-supabase-client')
    const { data, error } = await supabaseAdminClient.rpc('get_runtime_llm_catalog')
    if (error !== null) throw new Error(`get_runtime_llm_catalog failed: ${error.message}`)
    return (data ?? []) as readonly RuntimeProviderEntry[]
  }
}
