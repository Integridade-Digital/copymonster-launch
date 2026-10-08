/**
 * `POST /api/admin/llm/test`: an admin-only live connectivity probe for one LLM
 * provider route.
 *
 * The probe reflects the CopyMonster vault architecture: the browser never sees
 * a provider key, so the endpoint resolves it Host-side through the credentials
 * seam and reports only success, latency, and a stable error code. The target
 * endpoint and credential reference are resolved server-side from the
 * `llm-pi-ai` settings profiles (with the native `deepseek-official` route
 * mapped to the official DeepSeek endpoint), so a caller cannot point the probe
 * at an arbitrary URL.
 * @module @deepseek-ai/dsh-api-auth-http/llm-test
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-auth-context'
import { BEARER_PREFIX } from '@deepseek-ai/dsh-constants'
import { readRawBody } from './billing.ts'

/** Public admin path the Admin -> LLM Providers card probes. */
export const LLM_TEST_PATH = '/api/admin/llm/test'

/** Probe deadline in milliseconds. */
const TEST_TIMEOUT_MS = 5_000

/** Official DeepSeek endpoint the native `deepseek-official` route serves from. */
const DEEPSEEK_OFFICIAL_BASE_URL = 'https://api.deepseek.com'

/** Credential reference the native DeepSeek adapter resolves. */
const DEEPSEEK_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Minimal shape of the `llm-pi-ai` settings section the probe reads. */
interface PiAiSettings {
  providers?: Record<string, { baseURL?: string; apiKeyEnv?: string }>
}

/** One provider route's resolved probe target. */
interface ProbeTarget {
  baseURL: string
  apiKeyEnv: string
}

/** Result body returned to the Admin card. */
export interface LlmTestResult {
  /** Whether the endpoint answered the authenticated listing request. */
  ok: boolean
  /** Round-trip milliseconds; `0` when the key was missing before any request. */
  latency_ms: number
  /** Stable error code when `ok` is false. */
  error?: string
}

/** Extract the bearer token from an Authorization header value. */
function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || !value.startsWith(BEARER_PREFIX)) return undefined
  const token = value.slice(BEARER_PREFIX.length).trim()
  return token === '' ? undefined : token
}

/** Write one JSON response and end it. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Build the OpenAI-compatible model-listing URL for one resolved base.
 * @param baseURL - the route's configured endpoint.
 * @returns the `{base}/models` URL, with a trailing chat endpoint normalized away.
 */
function modelsUrl(baseURL: string): string {
  // A profile that spelled the full chat endpoint (`.../v1/chat/completions`)
  // is normalized to its root before the listing path is appended.
  return `${baseURL.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/models`
}

/**
 * Resolve one route's probe target from the settings document, with the native
 * DeepSeek route as the documented default.
 * @param ctx - plugin Context carrying the optional `settings` service.
 * @param route - provider route named by the request.
 * @returns the base URL and credential reference, or undefined for an unknown route.
 */
function resolveTarget(ctx: Context, route: string): ProbeTarget | undefined {
  // Structural read of the optional `settings` service keeps this Host adapter
  // out of the settings package's build graph; the settings schema already
  // validated `apiKeyEnv` as a credential reference at this boundary.
  const getService = ctx.get.bind(ctx) as unknown as (name: string) => unknown
  const settings = getService('settings') as { get(ns: string): unknown } | undefined
  const section = settings?.get('llm-pi-ai') as PiAiSettings | undefined
  const profile = section?.providers?.[route]
  if (
    profile !== undefined
    && profile.baseURL !== undefined && profile.baseURL !== ''
    && profile.apiKeyEnv !== undefined && profile.apiKeyEnv !== ''
  ) {
    return { baseURL: profile.baseURL, apiKeyEnv: profile.apiKeyEnv }
  }
  if (route === 'deepseek-official') {
    return { baseURL: DEEPSEEK_OFFICIAL_BASE_URL, apiKeyEnv: DEEPSEEK_API_KEY_ENV }
  }
  return undefined
}

/**
 * Handle `POST /api/admin/llm/test`: authenticate an admin/owner bearer token,
 * resolve the route's key from the vault, and probe `GET {baseURL}/models`.
 * @param ctx - plugin Context carrying `auth`, `settings`, and `credentials`.
 * @param req - the incoming request.
 * @param res - the response to write.
 */
export async function handleLlmTest(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method-not-allowed' })
    return
  }

  const token = bearerToken(req.headers.authorization)
  const identity = token === undefined ? undefined : await ctx.auth.resolveIdentity(token)
  if (identity === undefined) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }
  if (identity.role !== 'admin' && identity.role !== 'owner') {
    sendJson(res, 403, { error: 'forbidden' })
    return
  }

  let route: unknown
  try {
    const parsed = JSON.parse((await readRawBody(req)).toString('utf8')) as { providerRoute?: unknown }
    route = parsed.providerRoute
  } catch {
    sendJson(res, 400, { error: 'invalid-json' })
    return
  }
  if (typeof route !== 'string' || route === '') {
    sendJson(res, 400, { error: 'provider-route-required' })
    return
  }

  const target = resolveTarget(ctx, route)
  if (target === undefined) {
    sendJson(res, 404, { error: 'unknown-route' })
    return
  }

  const getService = ctx.get.bind(ctx) as unknown as (name: string) => unknown
  const credentials = getService('credentials') as {
    resolve(ref: string): Promise<{ value: string } | undefined>
  } | undefined
  const key = credentials === undefined ? undefined : (await credentials.resolve(target.apiKeyEnv))?.value
  if (key === undefined || key === '') {
    sendJson(res, 200, { ok: false, latency_ms: 0, error: 'missing-key' } satisfies LlmTestResult)
    return
  }

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, TEST_TIMEOUT_MS)
  try {
    const response = await fetch(modelsUrl(target.baseURL), {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: controller.signal,
    })
    const result: LlmTestResult = response.ok
      ? { ok: true, latency_ms: Date.now() - started }
      : { ok: false, latency_ms: Date.now() - started, error: `http-${String(response.status)}` }
    sendJson(res, 200, result)
  } catch {
    // The response body is never read or logged, so a failure exposes neither
    // the key nor provider output.
    sendJson(res, 200, {
      ok: false,
      latency_ms: Date.now() - started,
      error: controller.signal.aborted ? 'timeout' : 'network',
    } satisfies LlmTestResult)
  } finally {
    clearTimeout(timer)
  }
}
