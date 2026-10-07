/**
 * @deepseek-ai/dsh-host-brand-assets — CopyMonster brand image routes over the
 * built frontend dist.
 *
 * The SPA dist server maps only a small extension table, so `.png` responses
 * leave the origin as `application/octet-stream` with no cache directive.
 * Intermediaries (Cloudflare) and browsers then apply their own long TTLs to the
 * unhashed brand URLs, which keeps serving a stale logo after the file content
 * changes. This plugin claims the brand paths as exact routes ahead of the dist
 * fallback and answers them with the right media type, a strong `etag`, and
 * `cache-control: no-cache`, so a changed logo is revalidated on the next
 * request without a URL change.
 *
 * The brand files stay owned by `apps/web/public` (copied to the served dist);
 * this package only changes how they are served.
 * @module @deepseek-ai/dsh-host-brand-assets
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'brand-assets'

/** Services required before the brand routes can be registered. */
export const inject = ['webServer']

/** One brand asset: its public URL path, dist filename, and media type. */
interface BrandAsset {
  /** Absolute URL pathname the browser requests. */
  path: string
  /** Filename inside the served dist root. */
  file: string
  /** `content-type` served for the file. */
  contentType: string
}

/**
 * The brand asset set. These filenames are the fork's branding contract, not a
 * deployment choice: the SPA components request them by fixed absolute URL, so
 * the list moves only with a coordinated component change.
 */
const BRAND_ASSETS: readonly BrandAsset[] = [
  { path: '/brand.png', file: 'brand.png', contentType: 'image/png' },
  { path: '/brand-text.png', file: 'brand-text.png', contentType: 'image/png' },
  { path: '/brand-text-black.png', file: 'brand-text-black.png', contentType: 'image/png' },
  { path: '/favicon.png', file: 'favicon.png', contentType: 'image/png' },
  { path: '/favicon.svg', file: 'favicon.svg', contentType: 'image/svg+xml' },
]

/**
 * Resolve the served frontend dist root from the installed frontend package, the
 * same anchor the Web runtime uses for the SPA shell.
 * @returns absolute path of the frontend `dist` directory.
 */
export function resolveDistRoot(): string {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist')
}

/** Whether an `If-None-Match` header value matches the entity tag. */
function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (header === undefined) return false
  const values = Array.isArray(header) ? header : [header]
  return values.some(value => value.trim() === '*' || value.split(',').some(part => part.trim() === etag))
}

/**
 * Serve one brand asset with a revalidating cache policy.
 * @param distRoot - absolute dist root holding the brand files.
 * @param asset - the asset to serve.
 * @param req - the incoming request.
 * @param res - the response to write.
 */
export async function serveBrandAsset(
  distRoot: string,
  asset: BrandAsset,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  const target = join(distRoot, asset.file)
  let body: Buffer
  let modified: Date
  try {
    const [bytes, info] = await Promise.all([readFile(target), stat(target)])
    body = bytes
    modified = info.mtime
  } catch (error) {
    // Only absence is a client-visible miss; other filesystem failures reach the
    // webserver's request-failure handling.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    res.writeHead(404)
    res.end()
    return
  }
  const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`
  if (etagMatches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, { 'cache-control': 'no-cache', 'etag': etag })
    res.end()
    return
  }
  res.writeHead(200, {
    'content-type': asset.contentType,
    'content-length': String(body.byteLength),
    'cache-control': 'no-cache',
    'etag': etag,
    'last-modified': modified.toUTCString(),
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

/**
 * Register the brand asset routes on a composing webserver.
 * @param ctx - plugin Context carrying `webServer`.
 * @param distRoot - absolute dist root holding the brand files.
 */
export function registerBrandAssets(ctx: Context, distRoot: string): void {
  for (const asset of BRAND_ASSETS) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: asset.path,
      handler: (req: IncomingMessage, res: ServerResponse) => serveBrandAsset(distRoot, asset, req, res),
    }), `brand-assets: ${asset.path}`)
  }
}

/**
 * Register the brand routes against the installed frontend dist.
 * @param ctx - plugin Context carrying `webServer`.
 */
export function apply(ctx: Context): void {
  registerBrandAssets(ctx, resolveDistRoot())
}
