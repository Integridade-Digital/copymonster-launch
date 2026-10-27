/** Shared projection of the live LLM registry into the browser model catalog. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'
import type {
  ModelCatalog,
  ModelCatalogModel,
  ModelReasoning,
  ModelSelection,
} from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

interface DbModelMetadata {
  id?: string
  model_id: string
  display_name?: string
  context_window?: number
  cost_input_1k?: number
  cost_output_1k?: number
  capabilities?: Record<string, unknown>
  is_default_for_plans?: string[]
  allowed_plans?: string[]
}

interface DbProviderEntry {
  id?: string
  name?: string
  provider_type?: string
  base_url?: string
  is_active?: boolean
  api_key?: string | null
  allowed_plans?: string[]
  models?: DbModelMetadata[]
}

async function fetchRuntimeDbCatalog(): Promise<DbProviderEntry[] | null> {
  try {
    if (!supabaseAdminClient || typeof (supabaseAdminClient as unknown as Record<string, unknown>).rpc !== 'function') {
      return null
    }
    const { data, error } = await (supabaseAdminClient as unknown as { rpc: (name: string) => Promise<{ data: unknown; error: unknown }> }).rpc('get_runtime_llm_catalog')
    if (error || !Array.isArray(data)) {
      return null
    }
    return data as DbProviderEntry[]
  } catch {
    return null
  }
}

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const dbCatalog = await fetchRuntimeDbCatalog()

  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)

      const matchingDbProvider = dbCatalog?.find((dbp) => {
        if (dbp.provider_type && dbp.provider_type.toLowerCase() === provider.id.toLowerCase()) return true
        if (dbp.name && dbp.name.toLowerCase() === provider.name.toLowerCase()) return true
        if (dbp.id && dbp.id.toLowerCase() === provider.id.toLowerCase()) return true
        return false
      })

      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }

        const dbModel = matchingDbProvider?.models?.find(m =>
          m.model_id?.toLowerCase() === model.id.toLowerCase(),
        )

        const entry: ModelCatalogModel = {
          id: model.id,
          name: (dbModel?.display_name && dbModel.display_name.trim() !== '') ? dbModel.display_name : model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(dbModel?.context_window !== undefined
            ? { contextWindow: dbModel.context_window }
            : resolved.context?.contextWindow !== undefined
              ? { contextWindow: resolved.context.contextWindow }
              : typeof (model as unknown as Record<string, unknown>).contextWindow === 'number'
                ? { contextWindow: (model as unknown as Record<string, unknown>).contextWindow as number }
                : {}),
          ...(dbModel?.cost_input_1k !== undefined
            ? { costInput1k: Number(dbModel.cost_input_1k) }
            : (model as unknown as Record<string, unknown>).costInput1k !== undefined
              ? { costInput1k: Number((model as unknown as Record<string, unknown>).costInput1k) }
              : {}),
          ...(dbModel?.cost_output_1k !== undefined
            ? { costOutput1k: Number(dbModel.cost_output_1k) }
            : (model as unknown as Record<string, unknown>).costOutput1k !== undefined
              ? { costOutput1k: Number((model as unknown as Record<string, unknown>).costOutput1k) }
              : {}),
          ...(dbModel?.capabilities !== undefined
            ? { capabilities: dbModel.capabilities as Record<string, JsonValue> }
            : (resolved as unknown as Record<string, unknown>).capabilities !== undefined
              ? { capabilities: (resolved as unknown as Record<string, unknown>).capabilities as Record<string, JsonValue> }
              : (model as unknown as Record<string, unknown>).capabilities !== undefined
                ? { capabilities: (model as unknown as Record<string, unknown>).capabilities as Record<string, JsonValue> }
                : {}),
          ...(dbModel?.is_default_for_plans !== undefined
            ? { isDefaultForPlans: dbModel.is_default_for_plans as readonly string[] }
            : (model as unknown as Record<string, unknown>).isDefaultForPlans !== undefined
              ? { isDefaultForPlans: (model as unknown as Record<string, unknown>).isDefaultForPlans as readonly string[] }
              : {}),
          ...(dbModel?.allowed_plans !== undefined
            ? { allowedPlans: dbModel.allowed_plans as readonly string[] }
            : (model as unknown as Record<string, unknown>).allowedPlans !== undefined
              ? { allowedPlans: (model as unknown as Record<string, unknown>).allowedPlans as readonly string[] }
              : {}),
        }
        return entry
      }))

      return {
        kind: 'group' as const,
        group: { id: provider.id, name: provider.name, models: entries },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  const groups = catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
    .filter(group => group.models.length > 0)
  return {
    default: { ...defaultSelection },
    routableProviders: groups.map(group => group.id),
    groups,
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/**
 * Check a GUI selection against the current available provider catalog.
 * @param ctx - Host LLM registry.
 * @param selection - stored or explicitly requested selection.
 * @returns whether the exact model is currently advertised as available.
 */
export async function modelAvailable(ctx: Context, selection: ModelSelection): Promise<boolean> {
  if (!ctx.llm.listProviders().some(provider => provider.id === selection.provider)) return false
  let models: readonly LlmModelInfo[]
  try { models = await ctx.llm.listModels(selection.provider) }
  catch (error) {
    throw new RemoteError('session/model-unavailable',
      error instanceof Error ? error.message : String(error),
      { provider: selection.provider, model: selection.model })
  }
  return models.some(model => model.id === selection.model)
}

/**
 * Check configured provider API-key references independently of model availability.
 * @param ctx - Host registry, settings, and credential services.
 * @returns whether any API-key provider has a configured credential.
 */
export async function hasProviderApiKey(ctx: Context): Promise<boolean> {
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings === undefined || credentials === undefined) {
    throw new RemoteError('session/provider-credentials-unavailable', 'provider credentials are unavailable', {})
  }
  const namespaces = settings.describe({ redactSecrets: true })
  for (const provider of ctx.llm.listConfigurableProviders()) {
    if (provider.provider === 'deepseek-account') continue
    let profile = namespaces.find(namespace => namespace.ns === provider.settingsNs)?.value
    for (const key of provider.settingsPath) {
      profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
    }
    if (typeof profile !== 'object' || profile === null) continue
    const ref: unknown = Reflect.get(profile, 'apiKeyEnv')
    if (typeof ref === 'string' && ref.length > 0
      && (await credentials.describe(credentialRef(ref))).configured) return true
  }
  return false
}
