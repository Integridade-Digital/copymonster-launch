/**
 * `GET /api/healthz`: public liveness and readiness probe for the load balancer
 * and Cloudflare in front of the CopyMonster host.
 *
 * Two checks run on every call:
 * - a service-role Supabase ping (a `plans` HEAD count standing in for
 *   `SELECT 1`, because PostgREST exposes no raw-SQL endpoint);
 * - the in-memory LLM catalog (`ctx.llm`), which must hold at least one provider
 *   with at least one model.
 *
 * The probe is fail-closed: any failed check yields `503`.
 * @module @deepseek-ai/dsh-api-auth-http/health
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { supabaseAdminClient } from '@deepseek-ai/dsh-supabase-client'

/** Public path probed by the load balancer and Cloudflare. */
export const HEALTHZ_PATH = '/api/healthz'

/** One check's outcome in the response body. */
type CheckStatus = 'ok' | 'fail'

/** The in-memory LLM catalog surface the probe needs. */
interface CatalogService {
  listProviders(): readonly { readonly id: string }[]
  listModels(provider: string): Promise<readonly unknown[]>
}

/** Fail-closed Supabase reachability check via the service-role client. */
async function pingSupabase(): Promise<void> {
  const client = supabaseAdminClient as unknown as {
    from(table: string): {
      select(columns: string, options: { count: 'exact'; head: true }): Promise<{ error: unknown }>
    }
  }
  const { error } = await client.from('plans').select('id', { count: 'exact', head: true })
  if (error !== null && error !== undefined) throw new Error('supabase ping failed')
}

/** Reject an absent, providerless, or modelless in-memory catalog. */
async function checkCatalog(ctx: Context): Promise<void> {
  const llm = ctx.get('llm') as unknown as CatalogService | undefined
  if (llm === undefined) throw new Error('llm service absent')
  const providers = llm.listProviders()
  if (providers.length === 0) throw new Error('no providers registered')
  let models = 0
  for (const provider of providers) models += (await llm.listModels(provider.id)).length
  if (models === 0) throw new Error('no models registered')
}

/**
 * Handle `GET /api/healthz`.
 * @param ctx - plugin Context carrying the optional `llm` catalog service.
 * @param req - the incoming request.
 * @param res - the response to write.
 */
export async function handleHealthz(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'method-not-allowed' }))
    return
  }

  const started = Date.now()
  let supabase: CheckStatus = 'ok'
  let catalog: CheckStatus = 'ok'
  try {
    await pingSupabase()
  } catch {
    // Fail-closed: any transport or query failure marks Supabase down.
    supabase = 'fail'
  }
  try {
    await checkCatalog(ctx)
  } catch {
    // Fail-closed: an absent or empty catalog marks the runtime down.
    catalog = 'fail'
  }

  const healthy = supabase === 'ok' && catalog === 'ok'
  const body = {
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks: { supabase, catalog, latency_ms: Date.now() - started },
  }
  res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
