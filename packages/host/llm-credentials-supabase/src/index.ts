/**
 * Composite credential provider for CopyMonster: a Supabase runtime-LLM source
 * layered over the shipped local provider.
 *
 * The provider is the single root `credentials` service. It serves keys managed
 * in the admin panel (`llm_providers.api_key_env` -> decrypted `api_key` from
 * `get_runtime_llm_catalog()`) from an in-memory cache, and delegates every
 * other reference — `${DSH_HOME}/.credentials.yaml`, `.env`, authorization
 * records — to a `LocalCredentialProvider` mounted on an isolated service scope.
 * Managed values are never written to disk and never logged.
 * @module @deepseek-ai/dsh-host-llm-credentials-supabase
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CredentialProvider, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { SupabaseRuntimeCatalog } from './catalog.ts'
import type { RuntimeCatalog } from './types.ts'

/** Message every refused write carries (decision C1: keys live in the admin panel). */
export const ADMIN_MANAGED_MESSAGE =
  'Credentials are managed in the admin panel; use it to add or rotate provider keys.'

/** Config accepted by the composite provider. */
export interface Config {
  /** In-memory catalog freshness window in milliseconds. */
  ttlMs: number
  /** Debounce applied to refresh requests in milliseconds. */
  refreshDebounceMs: number
  /** Optional event name that schedules a debounced refresh; empty disables it. */
  refreshEvent: string
  /** Local store path; empty selects `${localDshHome}/.credentials.yaml`. */
  localPath: string
  /** Harness home for the local store; empty selects `$DSH_HOME` or `~/.dsh`. */
  localDshHome: string
  /** Whether the local delegate watches its document. */
  localWatch: boolean
  /** Local watcher write-settle window in milliseconds. */
  localDebounceMs: number
}

/** Context surface a dynamic refresh event name needs beyond the typed `Events` map. */
interface RefreshEventContext {
  on(name: string, listener: () => void): () => void
}

/** Local delegate config as the concrete provider expects it. */
type LocalConfig = ConstructorParameters<typeof LocalCredentialProvider>[1]

/**
 * Composite credentials provider (see the module doc).
 */
export class SupabaseLlmCredentialsProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    ttlMs: z.number().min(0).default(300_000),
    refreshDebounceMs: z.number().min(0).default(5_000),
    refreshEvent: z.string().default(''),
    localPath: z.string().default(''),
    localDshHome: z.string().default(''),
    localWatch: z.boolean().default(true),
    localDebounceMs: z.number().min(0).default(100),
  })

  private readonly isolated: Context
  private localProvider: CredentialProvider | undefined
  /** Managed reference -> decrypted key. Only refs whose `api_key` is present appear. */
  private readonly values = new Map<string, string>()
  /** Every reference the catalog declares, present or not (for fail-closed reads). */
  private readonly managed = new Set<string>()
  private loaded = false
  private loadedAt = 0
  private refreshPromise: Promise<void> | undefined
  private refreshTimer: ReturnType<typeof setTimeout> | undefined

  /** @param ctx - Host context that owns the root `credentials` service. */
  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.isolated = ctx.isolate('credentials')
  }

  /**
   * Mount the local delegate on the isolated scope, wire the optional refresh
   * event, prime the catalog, and release all of it on unload.
   */
  async *[Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    const provider = new LocalCredentialProvider(this.isolated, this.localConfig())
    const disposers: Array<() => Promise<void> | void> = []
    for await (const disposer of provider[Service.init]()) disposers.push(disposer)
    this.localProvider = provider

    if (this.config.refreshEvent !== '') {
      ;(this.ctx as unknown as RefreshEventContext).on(this.config.refreshEvent, () => {
        this.invalidate()
      })
    }

    try {
      await this.refresh()
    } catch (error) {
      this.warnRefresh(error)
    }

    yield async () => {
      if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
      let disposer = disposers.pop()
      while (disposer !== undefined) {
        await disposer()
        disposer = disposers.pop()
      }
    }
  }

  /**
   * Mark the cache stale and schedule one debounced reload. Safe to call from
   * an update event: concurrent calls collapse into the same reload.
   */
  invalidate(): void {
    this.loaded = false
    if (this.refreshTimer !== undefined) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.refresh().catch((error: unknown) => this.warnRefresh(error))
    }, this.config.refreshDebounceMs)
    this.refreshTimer.unref?.()
  }

  /** @inheritdoc */
  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    await this.ensureFresh()
    if (this.managed.has(ref)) {
      const value = this.values.get(ref)
      return value !== undefined && value.length > 0 ? { value, source: 'supabase' } : undefined
    }
    return this.local().resolve(ref)
  }

  /** @inheritdoc */
  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    await this.ensureFresh()
    if (this.managed.has(ref)) {
      const configured = (this.values.get(ref)?.length ?? 0) > 0
      return configured
        ? { configured: true, source: 'supabase', writable: false }
        : { configured: false, writable: false }
    }
    return this.local().describe(ref)
  }

  /** @inheritdoc */
  override set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.reject(new Error(ADMIN_MANAGED_MESSAGE))
  }

  /** @inheritdoc */
  override unset(_ref: CredentialRef): Promise<void> {
    return Promise.reject(new Error(ADMIN_MANAGED_MESSAGE))
  }

  /** @inheritdoc */
  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return this.local().readRecord(key)
  }

  /** @inheritdoc */
  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    return this.local().describeRecord(key)
  }

  /** @inheritdoc */
  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return this.local().listRecords()
  }

  /** @inheritdoc */
  override modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return this.local().modifyRecord(key, mutate)
  }

  /** @inheritdoc */
  override deleteRecord(key: CredentialKey): Promise<void> {
    return this.local().deleteRecord(key)
  }

  /** The catalog source; overridable so tests never touch Supabase. */
  protected createCatalog(): RuntimeCatalog {
    return new SupabaseRuntimeCatalog()
  }

  private local(): CredentialProvider {
    if (this.localProvider === undefined) throw new Error('llm-credentials-supabase: local provider is not mounted')
    return this.localProvider
  }

  private localConfig(): LocalConfig {
    return {
      ...this.config.localPath === '' ? {} : { path: this.config.localPath },
      ...this.config.localDshHome === '' ? {} : { dshHome: this.config.localDshHome },
      watch: this.config.localWatch,
      debounceMs: this.config.localDebounceMs,
    }
  }

  private async ensureFresh(): Promise<void> {
    if (this.loaded && Date.now() - this.loadedAt < this.config.ttlMs) return
    await this.refresh()
  }

  /** Reload the catalog, collapsing concurrent callers onto one load. */
  private async refresh(): Promise<void> {
    if (this.refreshPromise !== undefined) return this.refreshPromise
    this.refreshPromise = this.loadNow().finally(() => {
      this.refreshPromise = undefined
    })
    return this.refreshPromise
  }

  private async loadNow(): Promise<void> {
    const rows = await this.createCatalog().load()
    const values = new Map<string, string>()
    const managed = new Set<string>()
    for (const row of rows) {
      const ref = row.api_key_env
      if (ref === null || ref === '' || !isCredentialRefName(ref)) continue
      managed.add(ref)
      const key = row.api_key
      if (typeof key === 'string' && key.length > 0) values.set(ref, key)
    }
    this.values.clear()
    for (const [ref, key] of values) this.values.set(ref, key)
    this.managed.clear()
    for (const ref of managed) this.managed.add(ref)
    this.loaded = true
    this.loadedAt = Date.now()
  }

  private warnRefresh(error: unknown): void {
    this.ctx.logger.warn('llm-credentials-supabase: runtime LLM catalog refresh failed')
    this.ctx.logger.warn(error)
  }
}

export default SupabaseLlmCredentialsProvider
