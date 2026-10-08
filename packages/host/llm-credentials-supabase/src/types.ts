/**
 * Types for the Supabase-backed runtime LLM credential source.
 * @module @deepseek-ai/dsh-host-llm-credentials-supabase/types
 */

/** One LLM model row nested in a `get_runtime_llm_catalog()` provider. */
export interface RuntimeModelEntry {
  /** `llm_models.id`. */
  id: string
  /** Provider-native model id, e.g. `deepseek-chat`. */
  model_id: string
  /** Human-facing display name. */
  display_name: string | null
  /** Model context window in tokens. */
  context_window: number | null
  /** Cost in USD per 1K input tokens. */
  cost_input_1k: number | null
  /** Cost in USD per 1K output tokens. */
  cost_output_1k: number | null
  /** Modality capabilities advertised to the runtime. */
  capabilities: unknown
  /** Plans this model is the default for. */
  is_default_for_plans: string[] | null
  /** Plans allowed to select this model. */
  allowed_plans: string[] | null
}

/** One active provider row returned by `get_runtime_llm_catalog()`. */
export interface RuntimeProviderEntry {
  /** `llm_providers.id`. */
  id: string
  /** Human-facing provider name. */
  name: string
  /** Provider adapter type, e.g. `deepseek`. */
  provider_type: string
  /** Provider API base URL. */
  base_url: string | null
  /** Whether the provider is active. */
  is_active: boolean
  /** Decrypted provider API key, or null when none is configured. */
  api_key: string | null
  /** Explicit runtime route id, e.g. `deepseek-official`. */
  provider_route: string | null
  /** Environment-variable reference the runtime resolves this key against. */
  api_key_env: string | null
  /** Plans allowed to use this provider. */
  allowed_plans: string[] | null
  /** Active models nested under this provider. */
  models: RuntimeModelEntry[]
}

/** Source of the runtime LLM catalog. */
export interface RuntimeCatalog {
  /**
   * Read the active providers with decrypted keys.
   * @returns the provider rows, or an empty list when none are active.
   */
  load(): Promise<readonly RuntimeProviderEntry[]>
}
