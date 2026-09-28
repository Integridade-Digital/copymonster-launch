/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: serves the built frontend directory with explicit index
 * entry points. A readable index renders at the dist root, the configured index
 * path, and client-side routes; a missing path that names a file extension
 * returns 404, traversal outside the dist root is 403, unknown extensions ship
 * as octet-stream, and non-GET/HEAD is 405. Authenticated index responses pass
 * Connection's browser authentication and then the webserver's index render
 * (structured injection rows, then raw taps); anonymous document requests
 * receive a public shell rendered with no boot injection at all, so the SPA
 * boots only its own auth flow and every data transport stays 401-guarded by
 * Connection. Non-index assets stay public. The dist location is workspace
 * knowledge of the composing application, so `distIndex` is typically supplied
 * through a `!!js` expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Services required before the authenticated fallback seat can be claimed. */
export const inject = ['webServer', 'connection']

/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
})

/**
 * How Connection's browser authentication classified one index request.
 * `authenticated` admits the injected shell, `public` admits the anonymous
 * shell without any boot injection, and `answered` means Connection already
 * owned the response (launch-token exchange or its hard refusal).
 */
export type IndexAccess = 'authenticated' | 'public' | 'answered'

const HTML_MIME = 'text/html; charset=utf-8'

const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  // The packed VFS image. Served as its own bytes, never as a Content-Encoding:
  // the worker inflates the body itself, and a transport-level encoding would
  // leave it inflating an already-decoded archive.
  '.gz': 'application/gzip',
}

const STATIC_MISS_CODES: ReadonlySet<string | undefined> = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
])

/**
 * Read one dist target, reporting absence rather than raising it.
 * @param target - absolute file path to read.
 * @returns the file's bytes, or `undefined` when the target holds nothing the
 *   browser can be given.
 */
async function readTarget(target: string): Promise<Buffer | undefined> {
  try {
    return await readFile(target)
  } catch (error) {
    // Only absent or non-file targets are misses; other filesystem failures
    // reach the webserver's request-failure handling.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    return undefined
  }
}

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param authorizeIndex - classifies an index response through Connection's
 *   browser authentication before its bytes are read; `answered` responses are
 *   already owned and written by Connection.
 * @param renderIndex - produces the authenticated index.html body (structured
 *   injection rendering) from the raw index for the dist root, the configured
 *   index path, and client routes.
 * @param renderPublicIndex - produces the anonymous shell body from the same
 *   raw index, without any boot injection.
 */
export async function serveStatic(
  pathname: string, res: ServerResponse, distRoot: string, distIndex: string,
  authorizeIndex: () => IndexAccess,
  renderIndex: (html: string) => string,
  renderPublicIndex: (html: string) => string,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  /** Answer with the shell, or an empty 404 when the configured index is absent. */
  const respondWithIndex = async (): Promise<void> => {
    const access = authorizeIndex()
    if (access === 'answered') return
    const html = await readTarget(distIndex)
    if (html === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    if (access === 'public') {
      // The anonymous shell ships the SPA's own entry document and nothing
      // else: no boot manifest, no injection rows, no taps. `no-store` keeps
      // intermediaries from serving it to (or caching it for) an
      // authenticated browser.
      res.writeHead(200, { 'content-type': HTML_MIME, 'cache-control': 'no-store' })
      res.end(renderPublicIndex(html.toString('utf8')))
      return
    }
    res.writeHead(200, { 'content-type': HTML_MIME })
    res.end(renderIndex(html.toString('utf8')))
  }
  if (target === distRoot || target === distIndex) {
    await respondWithIndex()
    return
  }
  const body = await readTarget(target)
  if (body !== undefined) {
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
    res.end(body)
    return
  }
  // Nothing is behind this path. A last segment naming no file extension is a
  // client-side route the SPA resolves from the shell, so it renders index.html
  // like the root does. A request naming an extension stays 404: answering a
  // missing asset with HTML would hand the browser a shell where it asked for
  // the bundle.
  if (extname(target) === '') {
    await respondWithIndex()
    return
  }
  res.writeHead(404)
  res.end()
}

/**
 * Capturing index response that absorbs Connection's refusal writes and
 * records the status, so a refusal can be classified without emitting bytes.
 */
interface IndexProbe {
  status: number | undefined
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

function createIndexProbe(): IndexProbe {
  const probe: IndexProbe = {
    status: undefined,
    writeHead(status: number): unknown {
      probe.status = status
      return probe
    },
    end(): unknown {
      return probe
    },
  }
  return probe
}

/**
 * Claim the webserver fallback seat and serve the dist.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  // The dist is built with a relative base so the same files mount under any
  // static directory; served pages also answer deep SPA-fallback paths, where
  // relative asset URLs would resolve under the request directory, so the
  // served form anchors them at the site root ahead of every URL-bearing tag.
  const anchorBase = (html: string): string => html
    .replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="/">`)
  const renderIndex = (html: string): string => anchorBase(ctx.webServer.renderIndex(html))
  // The public shell reuses only the base anchoring: rendering it through the
  // webserver would attach the boot manifest rows that leak the host's plugin
  // graph to anonymous visitors.
  const renderPublicIndex = anchorBase
  ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
    // Non-GET/HEAD without a matching named route is 405 (fallback-only
    // semantics: named routes own their method handling).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests */
    const url = new URL(req.url ?? '/', 'http://x')
    const rawPath = url.pathname
    // Connection's own launch-token query name. A token exchange owns the real
    // response (a valid token is answered with the minting 303, an invalid one
    // with Connection's 401), so it must bypass the public shell entirely.
    const hasLaunchToken = url.searchParams.getAll('token').length > 0
    await serveStatic(
      decodeURIComponent(rawPath),
      res,
      distRoot,
      distIndex,
      () => {
        if (hasLaunchToken) {
          ctx.connection.authorizeIndex(req, res)
          return 'answered'
        }
        // Probe on a discarding response: without a launch token, Connection's
        // only refusal path is its 401, whose bytes the probe absorbs so the
        // anonymous shell can replace it.
        const probe = createIndexProbe()
        if (ctx.connection.authorizeIndex(req, probe)) return 'authenticated'
        return probe.status === 401 ? 'public' : 'answered'
      },
      renderIndex,
      renderPublicIndex,
    )
  }), 'frontend-static: fallback seat')
}
