/**
 * dsh-experimental-zernio-mcp — credential and token store.
 *
 * Persists the Zernio MCP OAuth state (dynamic client registration, tokens,
 * and discovery cache) to `~/.dsh/dsh-zernio-mcp.json` with mode 0600. Secrets
 * never leave this module; the public `view()` masks everything. The config
 * path can be overridden with `DSH_ZERNIO_MCP_CONFIG` (tests) or namespaced
 * with the plugin's `tenant` config.
 *
 * @module
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { OAuthDiscoveryState, StoredOAuthClientInformation } from '@modelcontextprotocol/client'
import { z } from 'zod'

/** Default machine-wide config location (mode 0600). */
const DEFAULT_CONFIG_FILE = path.join(homedir(), '.dsh', 'dsh-zernio-mcp.json')

/** The Zernio MCP endpoint. */
export const MCP_URL = 'https://mcp.zernio.com/mcp'

/** Stored OAuth tokens, including the absolute expiry used by the GUI. */
const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_at: z.number().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  issuer: z.string().optional(),
})

/** Stored dynamic client registration. */
const clientInformationSchema = z.looseObject({
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  client_id_issued_at: z.number().optional(),
  client_secret_expires_at: z.number().optional(),
  redirect_uris: z.array(z.string()).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  issuer: z.string().optional(),
})

/** Persisted OAuth token record, including the absolute expiry used by the GUI. */
export interface StoredTokenRecord {
  access_token: string
  refresh_token?: string | undefined
  expires_at?: number | undefined
  scope?: string | undefined
  token_type?: string | undefined
  issuer?: string | undefined
}

/** Persisted credentials record. */
interface Credentials {
  clientInformation: StoredOAuthClientInformation | null
  tokens: StoredTokenRecord | null
  tokenUpdatedAt: string
  discoveryState: OAuthDiscoveryState | null
}

/**
 * Resolve the credential file for one optional tenant key.
 * @param tenant - optional tenant key namespacing the file.
 * @returns absolute credential file path.
 */
export function configPath(tenant?: string): string {
  const override = process.env.DSH_ZERNIO_MCP_CONFIG
  if (override !== undefined && override !== '') return override
  if (tenant !== undefined) return path.join(homedir(), '.dsh', `dsh-zernio-mcp.${tenant}.json`)
  return DEFAULT_CONFIG_FILE
}

/**
 * Mask a credential for display, keeping only the head and tail.
 * @param value - secret value to mask.
 * @returns masked display text.
 */
export function mask(value: string): string {
  if (value === '') return ''
  if (value.length <= 8) return `${value.slice(0, 2)}****`
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

/** Empty credentials record. */
function empty(): Credentials {
  return {
    clientInformation: null,
    tokens: null,
    tokenUpdatedAt: '',
    discoveryState: null,
  }
}

/** Whether a parsed value is a discovery cache the MCP SDK can consume. */
function isDiscoveryState(value: unknown): value is OAuthDiscoveryState {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'authorizationServerUrl') === 'string'
}

/** Whether a parsed value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse an unknown JSON record into credentials, tolerating missing keys. */
function parse(raw: unknown): Credentials {
  const record = isRecord(raw) ? raw : {}
  const client = clientInformationSchema.safeParse(record.clientInformation)
  const tokens = tokensSchema.safeParse(record.tokens)
  const discovery = record.discoveryState
  const updated = record.tokenUpdatedAt
  return {
    clientInformation: client.success ? client.data : null,
    tokens: tokens.success ? tokens.data : null,
    tokenUpdatedAt: typeof updated === 'string' ? updated : '',
    discoveryState: isDiscoveryState(discovery) ? discovery : null,
  }
}

/** Public, secret-free status view. */
export interface StoreView {
  /** Whether a client registration or token is persisted. */
  configured: boolean
  /** Whether an access token is persisted. */
  authorized: boolean
  /** ISO timestamp of the last token write. */
  tokenUpdatedAt: string
  /** Masked dynamic client id. */
  clientIdMasked: string
  /** Callback URL the current flow uses. */
  callbackUrl: string
  /** Zernio MCP endpoint. */
  mcpUrl: string
  /** Credential file location. */
  configPath: string
}

/**
 * Small credential store backed by the tenant's JSON file. Reads are lazy and
 * cached; writes use mode 0600 so OAuth tokens never leak to other local users.
 */
export class ZernioMcpStore {
  private config: Credentials | null = null

  /** @param tenant - optional tenant key selecting a namespaced credential file. */
  constructor(private readonly tenant?: string) {}

  /**
   * Load the persisted credentials, or an empty record.
   * @returns the cached or freshly read credentials.
   */
  async load(): Promise<Credentials> {
    if (this.config !== null) return this.config
    try {
      const raw = await readFile(configPath(this.tenant), 'utf8')
      this.config = parse(JSON.parse(raw))
    } catch {
      this.config = empty()
    }
    return this.config
  }

  /**
   * Persist a credentials record with owner-only permissions.
   * @param next - complete credentials record to write.
   */
  async save(next: Credentials): Promise<void> {
    this.config = next
    const file = configPath(this.tenant)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(next, null, 2), { mode: 0o600 })
    await chmod(file, 0o600)
  }

  /**
   * Public, secret-free view.
   * @param callbackUrl - callback URL the active flow uses.
   * @returns status fields safe for the settings panel.
   */
  async view(callbackUrl: string): Promise<StoreView> {
    const cfg = await this.load()
    return {
      configured: cfg.clientInformation !== null || cfg.tokens !== null,
      authorized: cfg.tokens !== null && cfg.tokens.access_token.trim() !== '',
      tokenUpdatedAt: cfg.tokenUpdatedAt,
      clientIdMasked: cfg.clientInformation !== null ? mask(cfg.clientInformation.client_id) : '',
      callbackUrl,
      mcpUrl: MCP_URL,
      configPath: configPath(this.tenant),
    }
  }

  /** Clear every credential (tokens, client registration, discovery cache). */
  async clearAll(): Promise<void> {
    await this.save(empty())
  }

  /** Clear only tokens, keeping the client registration and discovery cache. */
  async clearTokens(): Promise<void> {
    const cfg = await this.load()
    cfg.tokens = null
    cfg.tokenUpdatedAt = ''
    await this.save(cfg)
  }

  /** Clear the client registration, forcing re-registration on the next auth. */
  async clearClientInformation(): Promise<void> {
    const cfg = await this.load()
    cfg.clientInformation = null
    await this.save(cfg)
  }

  /** Clear the discovery cache. */
  async clearDiscoveryState(): Promise<void> {
    const cfg = await this.load()
    cfg.discoveryState = null
    await this.save(cfg)
  }
}
