/** Shared projection of the live LLM registry into the browser model catalog. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ModelCatalog,
  ModelCatalogModel,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/** The CopyMonster virtual provider route advertised to masked tenants. */
export const VIRTUAL_PROVIDER = 'copymonster'
/** The virtual model id advertised to masked tenants. */
export const VIRTUAL_MODEL = 'copy-monster-default'
/** The human-readable virtual model name advertised to masked tenants. */
export const VIRTUAL_MODEL_NAME = 'Model CopyMonster'
/** The CopyMonster model-selection alias offered to tenants. */
export const VIRTUAL_ALIAS = { provider: VIRTUAL_PROVIDER, model: VIRTUAL_MODEL }

/** Stable description shown for the virtual CopyMonster model. */
export const VIRTUAL_MODEL_DESCRIPTION = 'Standard CopyMonster model managed by the platform.'

/**
 * Build the browser model catalog without requiring a Session.
 *
 * When `isAdmin` is `false` the tenant sees only the single virtual CopyMonster
 * model and the real provider topology stays out of the catalog payload.
 * When `isAdmin` is `true` (or omitted, preserving existing behaviour) the full
 * real provider catalog is returned for platform administration.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @param isAdmin - whether the caller is a platform administrator; omitted keeps the full catalog.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
  isAdmin?: boolean,
): Promise<ModelCatalog> {
  if (isAdmin === false) {
    return {
      default: { ...VIRTUAL_ALIAS },
      routableProviders: [VIRTUAL_PROVIDER],
      groups: [
        {
          id: VIRTUAL_PROVIDER,
          name: VIRTUAL_MODEL_NAME,
          models: [
            {
              id: VIRTUAL_MODEL,
              name: VIRTUAL_MODEL_NAME,
              description: VIRTUAL_MODEL_DESCRIPTION,
              capabilities: {},
            },
          ],
        },
      ],
      failures: [],
    }
  }

  const providers = ctx.llm.listProviders()

  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)

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

        const entry: ModelCatalogModel = {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(resolved.context?.contextWindow === undefined
            ? {}
            : { contextWindow: resolved.context.contextWindow }),
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
  // The virtual CopyMonster alias is always available: it resolves privately to
  // the configured primary route at dispatch time, so the real provider never
  // enters selection validation or the wire.
  if (selection.provider === VIRTUAL_PROVIDER && selection.model === VIRTUAL_MODEL) return true
  if (!ctx.llm.listProviders().some(provider => provider.id === selection.provider)) return false
  let models: readonly LlmModelInfo[]
  try { models = await ctx.llm.listModels(selection.provider) }
  catch {
    // The provider's own message names the route and its endpoint; the caller
    // gets the stable unavailable copy instead.
    throw new RemoteError('session/model-unavailable',
      'Model unavailable. Please try again or contact support.',
      { model: selection.model })
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
