import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { SupabaseLlmCredentialsProvider } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { RuntimeCatalog, RuntimeProviderEntry } from '../src/types.ts'

const LOCAL_REF = credentialRef('DSH_LOCAL_KEY')
const MANAGED_REF = credentialRef('DEEPSEEK_API_KEY')
const SECRET = 'sk-secret-value'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.restoreAllMocks()
  let cleanup = cleanups.pop()
  while (cleanup !== undefined) {
    await cleanup()
    cleanup = cleanups.pop()
  }
})

/** Fake runtime catalog with a mutable row list and a load counter. */
class FakeCatalog implements RuntimeCatalog {
  calls = 0
  constructor(private rows: RuntimeProviderEntry[]) {}
  setRows(rows: RuntimeProviderEntry[]): void {
    this.rows = rows
  }
  load(): Promise<readonly RuntimeProviderEntry[]> {
    this.calls += 1
    return Promise.resolve(this.rows)
  }
}

/** Class that mounts the provider with the given catalog source. */
function providerClass(catalog: RuntimeCatalog): typeof SupabaseLlmCredentialsProvider {
  return class extends SupabaseLlmCredentialsProvider {
    protected override createCatalog(): RuntimeCatalog {
      return catalog
    }
  }
}

function providerRow(overrides: Partial<RuntimeProviderEntry> = {}): RuntimeProviderEntry {
  return {
    id: 'p1', name: 'DeepSeek', provider_type: 'deepseek', base_url: null, is_active: true,
    api_key: null, provider_route: 'deepseek-official', api_key_env: null, allowed_plans: null,
    models: [], ...overrides,
  }
}

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    ttlMs: 300_000,
    refreshDebounceMs: 5,
    refreshEvent: '',
    localPath: '',
    localDshHome: '',
    localWatch: false,
    localDebounceMs: 100,
    ...overrides,
  }
}

async function writeLocalStore(ref: string, value: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-creds-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, '.credentials.yaml')
  await writeFile(file, `version: 1\nrefs:\n  ${ref}: ${value}\n`, { mode: 0o600 })
  return file
}

async function boot(file: string, catalog: RuntimeCatalog, overrides: Partial<Config> = {}): Promise<Context> {
  const ctx = new Context()
  const config = baseConfig({ localPath: file, ...overrides })
  const fiber = ctx.plugin(providerClass(catalog), config)
  cleanups.push(async () => {
    await fiber.dispose()
  })
  await fiber
  return ctx
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('SupabaseLlmCredentialsProvider', () => {
  it('delegates unmanaged references to the isolated local provider', async () => {
    const file = await writeLocalStore('DSH_LOCAL_KEY', 'from-file')
    const ctx = await boot(file, new FakeCatalog([]))
    expect(await ctx.credentials.resolve(LOCAL_REF)).toEqual({ value: 'from-file', source: 'file' })
    expect(await ctx.credentials.describe(LOCAL_REF)).toEqual({ configured: true, source: 'file', writable: true })
  })

  it('serves a managed reference from the runtime catalog', async () => {
    const file = await writeLocalStore('DSH_LOCAL_KEY', 'from-file')
    const catalog = new FakeCatalog([providerRow({ api_key_env: 'DEEPSEEK_API_KEY', api_key: SECRET })])
    const ctx = await boot(file, catalog)
    expect(await ctx.credentials.resolve(MANAGED_REF)).toEqual({ value: SECRET, source: 'supabase' })
    expect(await ctx.credentials.describe(MANAGED_REF)).toEqual({ configured: true, source: 'supabase', writable: false })
  })

  it('fails closed for a managed reference with no key and does not fall back', async () => {
    const file = await writeLocalStore('DSH_LOCAL_KEY', 'from-file')
    const catalog = new FakeCatalog([providerRow({ api_key_env: 'DSH_LOCAL_KEY', api_key: null })])
    const ctx = await boot(file, catalog)
    expect(await ctx.credentials.resolve(LOCAL_REF)).toBeUndefined()
    expect(await ctx.credentials.describe(LOCAL_REF)).toEqual({ configured: false, writable: false })
  })

  it('caches the catalog within the TTL and reloads after invalidation', async () => {
    const file = await writeLocalStore('DSH_LOCAL_KEY', 'from-file')
    const catalog = new FakeCatalog([providerRow({ api_key_env: 'DEEPSEEK_API_KEY', api_key: 'sk-one' })])
    const ctx = await boot(file, catalog)
    expect(await ctx.credentials.resolve(MANAGED_REF)).toEqual({ value: 'sk-one', source: 'supabase' })
    expect(catalog.calls).toBe(1)
    expect(await ctx.credentials.resolve(MANAGED_REF)).toEqual({ value: 'sk-one', source: 'supabase' })
    expect(catalog.calls).toBe(1)

    catalog.setRows([providerRow({ api_key_env: 'DEEPSEEK_API_KEY', api_key: 'sk-two' })])
    ;(ctx.credentials as SupabaseLlmCredentialsProvider).invalidate()
    await sleep(30)
    expect(await ctx.credentials.resolve(MANAGED_REF)).toEqual({ value: 'sk-two', source: 'supabase' })
    expect(catalog.calls).toBe(2)
  })

  it('reloads after the TTL expires', async () => {
    const file = await writeLocalStore('DSH_LOCAL_KEY', 'from-file')
    const catalog = new FakeCatalog([providerRow({ api_key_env: 'DEEPSEEK_API_KEY', api_key: SECRET })])
    const ctx = await boot(file, catalog, { ttlMs: 0 })
    await ctx.credentials.resolve(MANAGED_REF)
    await ctx.credentials.resolve(MANAGED_REF)
    expect(catalog.calls).toBe(3)
  })

  it('refreshes on the configured event, debounced', async () => {
    const file = await writeLocalStore('DSH_LOCAL_KEY', 'from-file')
    const catalog = new FakeCatalog([providerRow({ api_key_env: 'DEEPSEEK_API_KEY', api_key: 'sk-one' })])
    const ctx = await boot(file, catalog, { refreshEvent: 'llm/providers-changed' })
    await ctx.credentials.resolve(MANAGED_REF)
    catalog.setRows([providerRow({ api_key_env: 'DEEPSEEK_API_KEY', api_key: 'sk-two' })])
    ;(ctx as unknown as { emit(name: string): void }).emit('llm/providers-changed')
    await sleep(30)
    expect(await ctx.credentials.resolve(MANAGED_REF)).toEqual({ value: 'sk-two', source: 'supabase' })
    expect(catalog.calls).toBe(2)
  })

  it('refuses set and unset with the admin-panel message without writing disk', async () => {
    const file = await writeLocalStore('DSH_LOCAL_KEY', 'from-file')
    const before = await readFile(file, 'utf8')
    const ctx = await boot(file, new FakeCatalog([]))
    await expect(ctx.credentials.set(MANAGED_REF, 'nope')).rejects.toThrow(/admin panel/i)
    await expect(ctx.credentials.unset(MANAGED_REF)).rejects.toThrow(/admin panel/i)
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('delegates authorization records to the local provider', async () => {
    const file = await writeLocalStore('DSH_LOCAL_KEY', 'from-file')
    const ctx = await boot(file, new FakeCatalog([]))
    const key = credentialKey('llm-pi-ai', 'codex')
    const record: CredentialRecord = { kind: 'grant', payload: { token: 'granted' } }
    await ctx.credentials.modifyRecord(key, async () => record)
    expect(await ctx.credentials.readRecord(key)).toEqual(record)
  })

  it('never logs a secret value', async () => {
    const file = await writeLocalStore('DSH_LOCAL_KEY', 'from-file')
    const ctx = await boot(file, new FakeCatalog([providerRow({ api_key_env: 'DEEPSEEK_API_KEY', api_key: SECRET })]))
    const warn = vi.spyOn(ctx.logger, 'warn')
    await ctx.credentials.resolve(MANAGED_REF)
    await ctx.credentials.describe(MANAGED_REF)
    const logged = warn.mock.calls.flat().map(value => String(value))
    expect(logged.some(line => line.includes(SECRET))).toBe(false)
  })
})
