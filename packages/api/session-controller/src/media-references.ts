/**
 * Authenticated GET/HEAD /api/file reads bounded file responses through
 * the composed filesystem provider. The connection service authenticates
 * requests before this handler, and every read is confined to the process's
 * sandbox root: a browser admitted to this Host cannot turn the route into a
 * reader for the rest of the machine. A request without the current `v` version
 * is redirected, uncached, to the versioned URL, whose response is cacheable
 * indefinitely.
 * @module @deepseek-ai/dsh-api-session-controller/media-references
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { FsError, type FileSystem } from '@deepseek-ai/dsh-fs'
import mime from 'mime-types'

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  // HTML and SVG files may be opened directly on the authenticated API origin.
  'Content-Security-Policy': "sandbox; default-src 'none'",
}
const NO_STORE = { ...BASE_HEADERS, 'Cache-Control': 'private, no-store' }
// A versioned URL names one file version, so its response never changes.
const VERSIONED = { ...BASE_HEADERS, 'Cache-Control': 'private, max-age=31536000, immutable' }

async function serveFile(request: Request, fs: FileSystem, sandboxRoot: string, maxBytes: number): Promise<Response> {
  const fail = (status: number, text: string): Response =>
    new Response(request.method === 'HEAD' ? null : text, { status, headers: NO_STORE })
  const params = new URL(request.url).searchParams
  const path = params.get('path')
  if (path === null || path.length === 0) return fail(400, 'missing path')
  if (path.includes('\0') || !isAbsolute(path)) return fail(400, 'absolute path required')
  try {
    const sandbox = await fs.resolve(sandboxRoot, { signal: request.signal })
    const target = await fs.resolve(path, { signal: request.signal })
    if (!fs.contains(sandbox, target)) return fail(403, 'outside sandbox')
    const info = await fs.stat(target, request.signal)
    if (info === undefined) return fail(404, 'not found')
    if (info.type !== 'file') return fail(403, 'not a regular file')
    if (info.size !== undefined && info.size > maxBytes) return fail(413, 'file exceeds byte limit')
    if (params.get('v') !== info.version) {
      // Relative to the request URL, so deployment prefixes and the Desktop scheme are kept.
      const location = `?${new URLSearchParams({ path, v: info.version }).toString()}`
      return new Response(null, { status: 302, headers: { ...NO_STORE, Location: location } })
    }
    const headers: Record<string, string> = {
      ...VERSIONED,
      'Content-Type': mime.lookup(target.displayPath) || 'application/octet-stream',
    }
    if (request.method === 'HEAD') {
      if (info.size !== undefined) headers['Content-Length'] = String(info.size)
      return new Response(null, { headers })
    }
    const bytes = await fs.readBytes(target, request.signal, maxBytes)
    headers['Content-Length'] = String(bytes.byteLength)
    return new Response(bytes.slice(), { headers })
  } catch (error: unknown) {
    if (!(error instanceof FsError)) throw error
    const statuses: Partial<Record<FsError['code'], number>> = {
      FS_NOT_FOUND: 404,
      FS_NOT_REGULAR_FILE: 403,
      FS_PERMISSION_DENIED: 403,
      FS_SANDBOX_DENIED: 403,
      FS_TOO_LARGE: 413,
      FS_ABORTED: 499,
    }
    return fail(statuses[error.code] ?? 500, error.code)
  }
}

/**
 * File-display contribution. The connection service supplies authentication;
 * `ctx.fs` supplies the execution world's paths and reads; `ctx.sandboxPolicy`
 * supplies the root every read is confined to.
 */
export const SessionMediaReferences = {
  inject: ['connection', 'fs', 'attachments', 'sandboxPolicy'],
  apply(ctx: Context): void {
    const maxBytes = ctx.attachments.imageLimits.maxImageBytes
    const sandboxRoot = ctx.sandboxPolicy.workspaceRoot
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/file',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: request => serveFile(request, ctx.fs, sandboxRoot, maxBytes),
    }), 'session-controller: /api/file')
  },
}
