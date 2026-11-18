/**
 * Read-only administrator view of the CopyMonster model mask.
 *
 * The mask has no administrator configuration: tenants always use the
 * `copymonster/copy-monster-default` alias, and the runtime resolves it against
 * whatever provider and model `Settings > Models` has active. This route only
 * reports the result so an operator can confirm that a newly added provider is
 * already serving tenant turns.
 * @module @deepseek-ai/dsh-api-auth-http/model-mask-status
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { BEARER_PREFIX } from '@deepseek-ai/dsh-constants'
import { isPlatformOperator } from './payout-executor.ts'

/** Route reporting the mask's alias and its currently resolved real routes. */
export const MODEL_MASK_STATUS_PATH = '/api/admin/model-mask'

/**
 * Serve the mask status to a platform operator.
 * @param ctx - Host context carrying `auth` and the optional `modelMask` service.
 * @param req - the HTTP request; only `GET` is accepted.
 * @param res - the HTTP response receiving the JSON body.
 */
export async function handleModelMaskStatus(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  if (req.method !== 'GET') {
    send(405, { error: 'method_not_allowed' })
    return
  }
  const header = req.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  const token = value === undefined || !value.startsWith(BEARER_PREFIX)
    ? undefined
    : value.slice(BEARER_PREFIX.length).trim()
  if (token === undefined || token === '') {
    send(401, { error: 'unauthorized' })
    return
  }
  const identity = await ctx.auth.resolveIdentity(token)
  if (identity === undefined) {
    send(401, { error: 'invalid_identity' })
    return
  }
  // The real provider and model behind the mask are platform-operator data.
  if (!await isPlatformOperator(identity)) {
    send(403, { error: 'forbidden' })
    return
  }
  const mask = ctx.get('modelMask')
  if (mask === undefined) {
    send(404, { error: 'mask_not_mounted' })
    return
  }
  const routes = mask.currentRoutes()
  send(200, {
    alias: { provider: 'copymonster', model: 'copy-monster-default' },
    primaryRoute: routes.primaryRoute.provider === 'none' ? null : routes.primaryRoute,
    fallbackChain: routes.fallbackChain,
  })
}
