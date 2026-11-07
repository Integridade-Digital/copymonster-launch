/** Zernio MCP plugin unit tests: naming, callback resolution, and credential storage. */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractText, publicToolName } from '../src/mcp.ts'
import { resolveCallbackUrl } from '../src/routes.ts'
import { configPath, ZernioMcpStore } from '../src/store.ts'

describe('publicToolName', () => {
  it('qualifies a raw Zernio tool name with the zernio namespace', () => {
    expect(publicToolName('accounts_list')).toBe('mcp__zernio__accounts_list')
  })

  it('normalizes invalid characters and appends a stable hash', () => {
    const first = publicToolName('posts.create')
    const second = publicToolName('posts.create')
    expect(first).toBe(second)
    expect(first).toMatch(/^mcp__zernio__posts_create_[0-9a-f]{12}$/)
  })
})

describe('extractText', () => {
  it('joins text blocks and labels discarded media', () => {
    expect(extractText([
      { type: 'text', text: 'first' },
      { type: 'image', mimeType: 'image/png' },
    ], 'tool')).toBe('first\n[image: image/png, content discarded]')
  })

  it('reports non-content output', () => {
    expect(extractText(undefined, 'tool')).toBe('(tool returned non-content output)')
  })
})

describe('resolveCallbackUrl', () => {
  it('uses X-Forwarded-Host and X-Forwarded-Proto when present (priority 1)', () => {
    expect(
      resolveCallbackUrl(
        {
          headers: {
            host: '127.0.0.1:44869',
            'x-forwarded-host': 'campaign.copymonster.co',
            'x-forwarded-proto': 'https',
          },
        },
        44869,
        'https://campaign.copymonster.co',
      ),
    ).toBe('https://campaign.copymonster.co/api/dsh-zernio-mcp/oauth/callback')
  })

  it('defaults X-Forwarded-Proto to https when absent (priority 1)', () => {
    expect(
      resolveCallbackUrl(
        { headers: { host: '127.0.0.1:44869', 'x-forwarded-host': 'campaign.copymonster.co' } },
        44869,
        undefined,
      ),
    ).toBe('https://campaign.copymonster.co/api/dsh-zernio-mcp/oauth/callback')
  })

  it('gives X-Forwarded-Host priority over publicOrigin and Host', () => {
    expect(
      resolveCallbackUrl(
        {
          headers: {
            host: '127.0.0.1:44869',
            'x-forwarded-host': 'other.example',
            'x-forwarded-proto': 'https',
          },
        },
        44869,
        'https://campaign.copymonster.co',
      ),
    ).toBe('https://other.example/api/dsh-zernio-mcp/oauth/callback')
  })

  it('uses the configured public origin when no X-Forwarded headers (priority 2)', () => {
    expect(resolveCallbackUrl({ headers: { host: '127.0.0.1:3080' } }, 3080, 'https://app.copymonster.co'))
      .toBe('https://app.copymonster.co/api/dsh-zernio-mcp/oauth/callback')
  })

  it('uses the loopback Host header when no public origin (priority 3)', () => {
    expect(resolveCallbackUrl({ headers: { host: '127.0.0.1:3080' } }, 3080, undefined))
      .toBe('http://127.0.0.1:3080/api/dsh-zernio-mcp/oauth/callback')
  })

  it('falls back to loopback for an untrusted Host header without public origin (priority 3)', () => {
    expect(resolveCallbackUrl({ headers: { host: 'evil.example' } }, 3080, undefined))
      .toBe('http://127.0.0.1:3080/api/dsh-zernio-mcp/oauth/callback')
  })
})

describe('credential store', () => {
  let directory: string
  let previous: string | undefined

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'dsh-zernio-mcp-'))
    previous = process.env.DSH_ZERNIO_MCP_CONFIG
    process.env.DSH_ZERNIO_MCP_CONFIG = path.join(directory, 'credentials.json')
  })

  afterEach(async () => {
    if (previous === undefined) delete process.env.DSH_ZERNIO_MCP_CONFIG
    else process.env.DSH_ZERNIO_MCP_CONFIG = previous
    await rm(directory, { recursive: true, force: true })
  })

  it('persists tokens with mode 0600 and masks the client id', async () => {
    const store = new ZernioMcpStore()
    await store.save({
      clientInformation: { client_id: 'client-abcdefgh' },
      tokens: { access_token: 'token-abcdefgh', token_type: 'Bearer' },
      tokenUpdatedAt: '2026-01-01T00:00:00.000Z',
      discoveryState: null,
    })
    const file = configPath()
    const mode = (await stat(file)).mode & 0o777
    expect(mode).toBe(0o600)
    const view = await store.view('http://127.0.0.1/callback')
    expect(view.authorized).toBe(true)
    expect(view.clientIdMasked).toBe('clie****efgh')
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      tokens: { access_token: 'token-abcdefgh' },
    })
  })

  it('namespaces the file by tenant', () => {
    delete process.env.DSH_ZERNIO_MCP_CONFIG
    expect(configPath('acme')).toMatch(/dsh-zernio-mcp\.acme\.json$/)
    expect(configPath()).toMatch(/dsh-zernio-mcp\.json$/)
  })
})
