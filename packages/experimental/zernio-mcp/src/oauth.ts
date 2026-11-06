/**
 * dsh-experimental-zernio-mcp — OAuth 2.1 orchestration.
 *
 * The MCP SDK performs discovery, dynamic client registration, PKCE, and the
 * token exchange; this module supplies the persistent provider and the
 * two-phase flow the settings panel and agent tools drive.
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import {
  auth,
  type AuthResult,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import { MCP_URL, ZernioMcpStore } from './store.ts'

/** How long `begin()` waits for the authorization URL to materialize (ms). */
const AUTHORIZE_URL_TIMEOUT_MS = 30_000

/** How long a pending authorization flow stays valid (ms). */
const PENDING_FLOW_TTL_MS = 10 * 60_000

/** One in-flight authorization flow. */
interface PendingFlow {
  state: string
  authorizeUrlPromise: Promise<string>
  resolveAuthorizeUrl: (url: string) => void
  rejectAuthorizeUrl: (error: Error) => void
  startedAt: number
}

/** Result of one OAuth completion attempt. */
export interface OAuthCompletion {
  /** Whether the token exchange succeeded. */
  ok: boolean
  /** Human-readable outcome. */
  message: string
}

/**
 * OAuth client provider backed by the credential store. Implements the MCP
 * SDK's provider contract: persisted client registration and tokens,
 * memory-held PKCE verifier, and a captured authorization URL for the GUI.
 */
export class ZernioOAuthProvider implements OAuthClientProvider {
  private pending: PendingFlow | null = null
  private codeVerifierValue: string | null = null
  private callbackUrlValue: string

  /**
   * @param store - credential store shared with the MCP transport.
   * @param callbackUrl - loopback callback URL registered with Zernio.
   */
  constructor(private readonly store: ZernioMcpStore, callbackUrl: string) {
    this.callbackUrlValue = callbackUrl
  }

  /**
   * Point the provider at the callback URL the active flow registered.
   * @param callbackUrl - absolute callback URL.
   */
  setCallbackUrl(callbackUrl: string): void {
    this.callbackUrlValue = callbackUrl
  }

  /** The callback URL registered with the authorization server. */
  get redirectUrl(): string {
    return this.callbackUrlValue
  }

  /** Client metadata for dynamic registration (public client + PKCE). */
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'dsh-zernio-mcp',
      redirect_uris: [this.callbackUrlValue],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'posts:read posts:write accounts:read accounts:write analytics:read ads:write messaging:write automations:write commerce:write calendar:write files:write campaigns:write money:write',
    }
  }

  /**
   * Flow-bound state verified on the callback.
   *
   * The MCP SDK builds the authorize URL by calling this method itself; if it
   * returned a fresh UUID every time, the URL's `state` would differ from the
   * one `begin()` recorded in the pending flow, and the callback's state could
   * never match. Return the active pending flow's state so the authorize
   * request reuses the exact value the pending flow will verify.
   */
  state(): string {
    const pending = this.pending
    if (pending !== null) return pending.state
    return randomUUID()
  }

  /** Load the persisted dynamic client registration. */
  async clientInformation(): Promise<StoredOAuthClientInformation | undefined> {
    return (await this.store.load()).clientInformation ?? undefined
  }

  /**
   * Persist a dynamic client registration.
   * @param information - the registered client metadata.
   */
  async saveClientInformation(information: StoredOAuthClientInformation): Promise<void> {
    const cfg = await this.store.load()
    cfg.clientInformation = information
    await this.store.save(cfg)
  }

  /** Load the persisted token set, including a remaining lifetime. */
  async tokens(): Promise<StoredOAuthTokens | undefined> {
    const cfg = await this.store.load()
    if (cfg.tokens === null) return undefined
    const tokens: StoredOAuthTokens = {
      access_token: cfg.tokens.access_token,
      token_type: cfg.tokens.token_type ?? 'Bearer',
    }
    if (cfg.tokens.refresh_token !== undefined) tokens.refresh_token = cfg.tokens.refresh_token
    if (cfg.tokens.scope !== undefined) tokens.scope = cfg.tokens.scope
    if (cfg.tokens.issuer !== undefined) tokens.issuer = cfg.tokens.issuer
    if (cfg.tokens.expires_at !== undefined) {
      tokens.expires_in = Math.max(0, Math.floor((cfg.tokens.expires_at - Date.now()) / 1000))
    }
    return tokens
  }

  /** Persist a token set and its absolute expiry. */
  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    const cfg = await this.store.load()
    cfg.tokens = {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      ...tokens.refresh_token === undefined ? {} : { refresh_token: tokens.refresh_token },
      ...tokens.expires_in === undefined ? {} : { expires_at: Date.now() + tokens.expires_in * 1000 },
      ...tokens.scope === undefined ? {} : { scope: tokens.scope },
      ...tokens.issuer === undefined ? {} : { issuer: tokens.issuer },
    }
    cfg.tokenUpdatedAt = new Date().toISOString()
    await this.store.save(cfg)
  }

  /** Persist the discovery cache. */
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const cfg = await this.store.load()
    cfg.discoveryState = state
    await this.store.save(cfg)
  }

  /** Load the discovery cache. */
  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.store.load()).discoveryState ?? undefined
  }

  /** Drop the credential scope the SDK reports as invalid. */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all') await this.store.clearAll()
    else if (scope === 'client') await this.store.clearClientInformation()
    else if (scope === 'tokens') await this.store.clearTokens()
    else if (scope === 'verifier') this.codeVerifierValue = null
    else await this.store.clearDiscoveryState()
  }

  /** Hold the PKCE verifier for the redirect round-trip. */
  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierValue = codeVerifier
  }

  /** Read the PKCE verifier for the token exchange. */
  codeVerifier(): string {
    if (this.codeVerifierValue === null) {
      throw new Error('OAuth flow: missing PKCE code verifier (flow may have expired)')
    }
    return this.codeVerifierValue
  }

  /** Capture the authorization URL the SDK wants the browser to open. */
  redirectToAuthorization(authorizationUrl: URL): void {
    const pending = this.pending
    if (pending !== null) pending.resolveAuthorizeUrl(authorizationUrl.toString())
  }

  /**
   * Wait for the pending flow's authorization URL.
   * @param timeoutMs - maximum wait in milliseconds.
   * @returns the authorization URL.
   */
  waitForAuthorizationUrl(timeoutMs: number): Promise<string> {
    const pending = this.pending
    if (pending === null) return Promise.reject(new Error('OAuth flow: no pending authorization'))
    return Promise.race([
      pending.authorizeUrlPromise,
      new Promise<string>((_resolve, reject) => {
        setTimeout(() => { reject(new Error('OAuth flow: authorization URL timed out')) }, timeoutMs).unref()
      }),
    ])
  }

  /**
   * Register the pending flow slot.
   * @param state - state value the authorize request must reuse.
   * @returns the pending flow.
   * @throws when another unexpired flow is active.
   */
  beginPending(state: string): PendingFlow {
    const current = this.pending
    if (current !== null && Date.now() - current.startedAt < PENDING_FLOW_TTL_MS) {
      throw new Error('A Zernio authorization flow is already pending; finish it or wait for it to expire.')
    }
    let resolveAuthorizeUrl: (url: string) => void = () => {}
    let rejectAuthorizeUrl: (error: Error) => void = () => {}
    const authorizeUrlPromise = new Promise<string>((resolve, reject) => {
      resolveAuthorizeUrl = resolve
      rejectAuthorizeUrl = reject
    })
    const pending: PendingFlow = {
      state,
      authorizeUrlPromise,
      resolveAuthorizeUrl,
      rejectAuthorizeUrl,
      startedAt: Date.now(),
    }
    this.pending = pending
    this.codeVerifierValue = null
    return pending
  }

  /** The active pending flow, or null once it expires. */
  get pendingFlow(): PendingFlow | null {
    const pending = this.pending
    if (pending === null) return null
    if (Date.now() - pending.startedAt > PENDING_FLOW_TTL_MS) {
      this.pending = null
      return null
    }
    return pending
  }

  /**
   * Settle a pending flow after the callback state matches.
   * @param state - state parameter from the callback.
   * @returns the settled flow, or null when the state does not match.
   */
  settlePending(state: string): PendingFlow | null {
    const pending = this.pendingFlow
    if (pending === null || pending.state !== state) return null
    this.pending = null
    return pending
  }

  /**
   * Settle the pending flow from a manually pasted code, where the browser
   * cannot supply the original state. PKCE still binds the code exchange to
   * this client.
   * @returns the settled flow, or null when none is pending.
   */
  settlePendingManual(): PendingFlow | null {
    const pending = this.pendingFlow
    if (pending === null) return null
    this.pending = null
    return pending
  }

  /** Abort any pending flow, rejecting a waiting `begin()`. */
  settlePendingAbort(): void {
    const pending = this.pending
    this.pending = null
    this.codeVerifierValue = null
    if (pending !== null) pending.rejectAuthorizeUrl(new Error('The authorization flow was cancelled.'))
  }
}

/**
 * OAuth orchestration shared by the routes and the agent tools.
 *
 * Phase 1 (`begin`) starts discovery/registration and returns the
 * authorization URL; phase 2 (`complete`) exchanges the code. The provider
 * instance is created once per callback URL and reused across flows: it
 * reads/writes tokens through the store, so the MCP transport keeps working
 * (and auto-refreshing) between authorizations.
 */
export class OAuthFlow {
  private provider: ZernioOAuthProvider | null = null

  /** @param store - credential store shared with the MCP transport. */
  constructor(private readonly store: ZernioMcpStore) {}

  /** The provider used by the MCP transport, if one has been created. */
  get activeProvider(): ZernioOAuthProvider | null {
    return this.provider
  }

  /**
   * Get (creating if needed) the provider bound to this callback URL.
   * @param callbackUrl - callback URL the active flow registers.
   * @returns the shared provider.
   */
  getProvider(callbackUrl: string): ZernioOAuthProvider {
    if (this.provider === null) this.provider = new ZernioOAuthProvider(this.store, callbackUrl)
    return this.provider
  }

  /**
   * Start an authorization: fresh dynamic client registration, then the
   * discovery and authorize-URL dance.
   * @param callbackUrl - callback URL registered with Zernio.
   * @returns the authorization URL and its state.
   */
  async begin(callbackUrl: string): Promise<{ authorizeUrl: string; state: string }> {
    await this.store.clearClientInformation()
    const provider = this.getProvider(callbackUrl)
    provider.setCallbackUrl(callbackUrl)
    provider.settlePendingAbort()
    const state = provider.state()
    const pending = provider.beginPending(state)
    auth(provider, { serverUrl: MCP_URL }).catch((error: unknown) => {
      pending.rejectAuthorizeUrl(error instanceof Error ? error : new Error(String(error)))
    })
    return {
      authorizeUrl: await provider.waitForAuthorizationUrl(AUTHORIZE_URL_TIMEOUT_MS),
      state,
    }
  }

  /**
   * Complete the flow with the authorization code.
   * @param code - authorization code from the callback or manual paste.
   * @param state - state parameter from the callback; empty for manual paste.
   * @param iss - optional RFC 9207 issuer parameter from the callback.
   * @returns the outcome.
   */
  async complete(code: string, state: string, iss?: string): Promise<OAuthCompletion> {
    const provider = this.provider
    if (provider === null) {
      return { ok: false, message: 'No pending authorization flow: click Authorize first.' }
    }
    const settled = state === '' ? provider.settlePendingManual() : provider.settlePending(state)
    if (settled === null) {
      return {
        ok: false,
        message: state === ''
          ? 'No pending authorization flow: click Authorize first.'
          : 'State validation failed (the authorization flow may have expired or been repeated). Click Authorize again.',
      }
    }
    let result: AuthResult
    try {
      result = await auth(provider, {
        serverUrl: MCP_URL,
        authorizationCode: code,
        ...iss === undefined || iss === '' ? {} : { iss },
      })
    } catch (error) {
      return {
        ok: false,
        message: 'Token exchange failed: ' + (error instanceof Error ? error.message : String(error)),
      }
    }
    if (result !== 'AUTHORIZED') {
      return { ok: false, message: 'Authorization did not finish (unknown state).' }
    }
    return {
      ok: true,
      message: 'Authorization successful: the Zernio MCP token is saved and the MCP tools are ready.',
    }
  }

  /** Drop any pending flow (used by clear/reset). */
  abort(): void {
    if (this.provider !== null) this.provider.settlePendingAbort()
  }
}
