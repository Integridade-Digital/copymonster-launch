/**
 * Admin-only model guard for the `dsh-automation` RPC channel.
 *
 * The automation plugin accepts `provider`/`model` on task create and update.
 * Its UI hides the model picker for non-admins, but a direct RPC request can
 * still carry an explicit model. This guard resolves the caller's CopyMonster
 * identity from the Supabase bearer token and rewrites non-admin writes to
 * `provider: null` / `model: null`, which the plugin documents as "follow the
 * runtime global model selection". Admin requests pass through unchanged.
 * @module @deepseek-ai/dsh-api-auth-http/automation-model-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcGuardResult } from '@deepseek-ai/dsh-client-connection'
import { bearerToken } from './bearer-token.ts'
import type {} from '@deepseek-ai/dsh-api-auth-context'

/** RPC channel registered by the `dsh-automation` host plugin. */
export const AUTOMATION_RPC_CHANNEL = '/dsh-automation'

const MODEL_ENDPOINTS = new Set(['create', 'update'])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Force the runtime global model on non-admin scheduled-task writes.
 * @param ctx - context carrying the CopyMonster auth service.
 * @param request - decoded RPC request, including the caller's bearer token.
 * @param endpoint - RPC endpoint name (`create`, `update`, or another).
 * @param payload - decoded RPC payload.
 * @returns the original payload for admins/read paths, or a payload with the
 *   explicit model fields replaced by the plugin's global-selection sentinel.
 */
export async function guardAutomationModel(
  ctx: Context,
  request: Request,
  endpoint: string,
  payload: unknown,
): Promise<ConnectionRpcGuardResult> {
  if (!MODEL_ENDPOINTS.has(endpoint)) return { payload }
  const body = asRecord(payload)
  const input = asRecord(body?.input)
  if (body === undefined || input === undefined) return { payload }
  if (input.provider === undefined && input.model === undefined && input.modelKey === undefined) {
    return { payload }
  }

  const token = bearerToken(request.headers.get('authorization') ?? undefined)
  const identity = token === undefined ? undefined : await ctx.auth.resolveIdentity(token)
  if (identity?.isAdmin === true) return { payload }

  const {
    provider: _provider,
    model: _model,
    modelKey: _modelKey,
    reasoningEffort: _reasoningEffort,
    ...rest
  } = input
  return {
    payload: {
      ...body,
      input: {
        ...rest,
        provider: null,
        model: null,
        reasoningEffort: null,
      },
    },
  }
}
