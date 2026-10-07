import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  registerBrandAssets,
  serveBrandAsset,
} from '../src/index.ts'

/** Minimal response double capturing the written status, headers, and body. */
class FakeResponse {
  status = 0
  headers: Record<string, unknown> = {}
  body: Buffer | undefined

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status
    if (headers !== undefined) this.headers = headers
    return this
  }

  end(body?: Buffer | string): void {
    if (body === undefined) return
    this.body = Buffer.isBuffer(body) ? body : Buffer.from(body)
  }
}

/** Request double with only the members the handler reads. */
function request(method: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method, headers } as unknown as IncomingMessage
}

const PNG_ASSET = { path: '/brand-text.png', file: 'brand-text.png', contentType: 'image/png' }

let dist: string

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'dsh-brand-assets-'))
  writeFileSync(join(dist, 'brand-text.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(dist, 'favicon.svg'), '<svg/>')
})

afterAll(() => {
  rmSync(dist, { recursive: true, force: true })
})

describe('serveBrandAsset', () => {
  it('serves a png with its media type, an etag, and no-cache', async () => {
    const res = new FakeResponse()
    await serveBrandAsset(dist, PNG_ASSET, request('GET'), res as unknown as ServerResponse)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.headers['etag']).toMatch(/^"[0-9a-f]{32}"$/)
    expect(res.body).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('answers 304 when If-None-Match carries the current tag', async () => {
    const first = new FakeResponse()
    await serveBrandAsset(dist, PNG_ASSET, request('GET'), first as unknown as ServerResponse)
    const etag = first.headers['etag'] as string

    const res = new FakeResponse()
    await serveBrandAsset(dist, PNG_ASSET, request('GET', { 'if-none-match': etag }), res as unknown as ServerResponse)
    expect(res.status).toBe(304)
    expect(res.body).toBeUndefined()
  })

  it('serves HEAD without a body', async () => {
    const res = new FakeResponse()
    await serveBrandAsset(dist, PNG_ASSET, request('HEAD'), res as unknown as ServerResponse)
    expect(res.status).toBe(200)
    expect(res.body).toBeUndefined()
  })

  it('rejects non-GET/HEAD methods', async () => {
    const res = new FakeResponse()
    await serveBrandAsset(dist, PNG_ASSET, request('POST'), res as unknown as ServerResponse)
    expect(res.status).toBe(405)
  })

  it('404s a missing file', async () => {
    const res = new FakeResponse()
    await serveBrandAsset(dist, { path: '/x.png', file: 'x.png', contentType: 'image/png' }, request('GET'), res as unknown as ServerResponse)
    expect(res.status).toBe(404)
  })

  it('uses the configured media type for svg', async () => {
    const res = new FakeResponse()
    await serveBrandAsset(dist, { path: '/favicon.svg', file: 'favicon.svg', contentType: 'image/svg+xml' }, request('GET'), res as unknown as ServerResponse)
    expect(res.headers['content-type']).toBe('image/svg+xml')
  })
})

describe('registerBrandAssets', () => {
  it('registers one exact route per brand asset and unwinds with the effect', () => {
    const registered: { kind: string; path: string }[] = []
    const disposed: string[] = []
    const fake = {
      effect: (callback: () => () => void) => { callback()() },
      webServer: {
        register: (route: { kind: string; path: string }) => {
          registered.push(route)
          return () => { disposed.push(route.path) }
        },
      },
    }
    registerBrandAssets(fake as never, dist)
    expect(registered.map(route => route.path)).toEqual([
      '/brand.png',
      '/brand-text.png',
      '/brand-text-black.png',
      '/favicon.png',
      '/favicon.svg',
    ])
    expect(registered.every(route => route.kind === 'exact')).toBe(true)
    expect(disposed).toEqual(registered.map(route => route.path))
  })
})
