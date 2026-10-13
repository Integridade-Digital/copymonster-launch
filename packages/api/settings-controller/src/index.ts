/**
 * Host Remote owner for the configuration surfaces over the settings-domain
 * seams. Two namespaces: `settings`, the redacted reads and writes of
 * `ctx.settings`, owned by the class below; and `credentials`, mounted from
 * here as its own plugin.
 *
 * @module @deepseek-ai/dsh-api-settings-controller
 */

import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
// Type-only: resolves the `agentPresets` Context augmentation this controller reads.
import type {} from '@deepseek-ai/dsh-agent-presets'
// Type-only: resolves the `authIdentity` Context augmentation this controller reads.
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import {
  canOpenNativePath,
  openNativePath,
  openNativeTextFile,
} from '@deepseek-ai/dsh-native-command'
import type { SettingsDescriptor, SettingsPathOp, SettingsProvider } from '@deepseek-ai/dsh-settings'
import type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-settings/types'
import { Remote, RemoteScope, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { supabaseAdminClient, type Json } from '@deepseek-ai/dsh-supabase-client'
import { z } from 'zod'
import { CredentialsController } from './credentials.ts'
import type {
  AgentPresetDirectoryOpenValue,
  AuditLogQueryRequest,
  AuditLogRecordRequest,
  AuditLogView,
  SettingsDocumentOpenValue,
  TenantAdminView,
  TenantMetricsView,
  TenantPlanDetails,
  TokenUsageRecordRequest,
  TokenUsageRecordValue,
} from './types.ts'

export { CredentialsController } from './credentials.ts'
export type * from './types.ts'

const settingsNamespaceRequestSchema = z.object({ ns: z.string().min(1) })

/** Native document-opening policy. */
export interface Config {
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
}

/** Read abort state afresh after an awaited provider or opener call. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Host integrations replaceable by direct unit tests. */
export interface SettingsControllerInternals {
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  readonly openTextFile?: (path: string, signal: AbortSignal) => Promise<void>
  readonly canOpenPath?: () => boolean
}

/**
 * Project one redacted descriptor onto its wire view, field by field. The
 * Gateway returns a business result without decoding it, so a provider whose
 * descriptor carried extra enumerable properties would otherwise serialize them
 * to the caller.
 * @param descriptor - one descriptor read under `redactSecrets`.
 * @returns the same facts with nothing else attached.
 */
function namespaceView(descriptor: SettingsDescriptor): SettingsNamespaceView {
  return {
    ns: String(descriptor.ns),
    schema: descriptor.schema as JsonValue,
    value: descriptor.value as JsonValue,
    ...descriptor.base === undefined ? {} : { base: descriptor.base as JsonValue },
    ...descriptor.user === undefined ? {} : { user: descriptor.user as JsonValue },
    applies: descriptor.applies,
    secrets: (descriptor.secrets ?? []).map(secret => ({ path: [...secret.path], set: secret.set })),
    revision: descriptor.revision,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `settings` Remote namespace. */
    settingsController: SettingsController
  }
}

/**
 * Safely extracts the authenticated user identity from the Context without
 * triggering the Cordis Proxy 'without inject' trap when authIdentity is absent.
 */
function getAuthIdentity(ctx: Context): UserIdentity | undefined {
  if (Reflect.has(ctx, 'authIdentity')) {
    return (ctx as unknown as { authIdentity?: UserIdentity }).authIdentity
  }
  return undefined
}

/** Protected namespaces that require administrative privileges (owner or admin). */
function isProtectedNamespace(ns: string): boolean {
  return ns.startsWith('llm-') || ns === 'llm' || ns.includes('model')
}

/**
 * Asserts that the authenticated caller has administrative privileges.
 * @param ctx - Host context carrying the caller's identity.
 * @param action - Portuguese clause completing the refusal message.
 * @param ns - namespace the caller may not configure.
 * @throws RemoteError `settings/forbidden` for a non-administrative caller.
 */
function assertAdminRole(ctx: Context, action: string, ns: string): void {
  const identity = getAuthIdentity(ctx)
  if (identity !== undefined && identity.role !== 'owner' && identity.role !== 'admin') {
    throw new RemoteError('settings/forbidden', `Apenas administradores podem ${action}.`, { ns })
  }
}

/**
 * Asserts that the caller is authenticated and holds administrative privileges (owner or admin).
 * @param ctx - Host context carrying the caller's identity.
 * @param action - Portuguese clause completing the refusal message.
 * @throws RemoteError `settings/unauthorized` if unauthenticated, or `settings/forbidden` if not admin.
 */
function assertAdminOrOwnerAuth(ctx: Context, action: string): void {
  const identity = getAuthIdentity(ctx)
  if (identity === undefined) {
    throw new RemoteError('settings/unauthorized', 'Autenticação necessária para acessar recursos administrativos.', {})
  }
  if (identity.role !== 'owner' && identity.role !== 'admin') {
    throw new RemoteError('settings/forbidden', `Apenas administradores podem ${action}.`, { ns: 'admin' })
  }
}

/** Service providing access to tenant settings, audit logs, and usage metrics. */
export class SettingsController extends TypertRemoteService {
  static Config: Schema<Config> = Schema.object({ nativeOpen: Schema.boolean() })

  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly openTextFile: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean

  /**
   * Register the settings namespace and mount the credentials namespace beside
   * it. Both namespaces stay registered when a provider is absent so calls can
   * return the configuration API's actionable missing-provider diagnostic.
   * @param ctx - Host context where settings and credential providers may be mounted.
   */
  constructor(ctx: Context, config: Config = {}, internals: SettingsControllerInternals = {}) {
    super(ctx, 'settingsController', { namespace: 'settings' })
    this.openPath = internals.openPath ?? openNativePath
    this.openTextFile = internals.openTextFile ?? openNativeTextFile
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(CredentialsController)
  }

  /**
   * Describe every registered namespace for a configuration page: redacted
   * layered values plus the serialized schema the page renders its form from.
   * @returns provider writability, local-document presence, and one view per namespace.
   * @throws RemoteError when no settings provider is mounted.
   */
  @Remote
  describe(): SettingsDescribeValue {
    const settings = this.provider()
    const identity = getAuthIdentity(this.ctx)
    const isNonAdmin = identity !== undefined && identity.role !== 'owner' && identity.role !== 'admin'
    let descriptors = settings.describe({ redactSecrets: true })
    if (isNonAdmin) {
      descriptors = descriptors.filter(d => !isProtectedNamespace(String(d.ns)))
    }
    return {
      writable: isNonAdmin ? false : settings.writable,
      hasDocument: isNonAdmin ? false : settings.documentPath !== undefined,
      namespaces: descriptors.map(namespaceView),
    }
  }

  /**
   * Report whether this deployment can open an authored Agent preset directory natively.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenAgentPresetDirectory(): boolean {
    return this.canOpenPath()
  }

  /**
   * Merge a patch into one namespace's stored user section.
   * @param ns - namespace key to write.
   * @param patch - fields to merge into the user section.
   * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
   * @returns the namespace's redacted view after the write.
   * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
   */
  @Remote
  async update(
    ns: string,
    patch: Record<string, JsonValue>,
    expectedRevision: number | undefined,
  ): Promise<SettingsNamespaceView> {
    if (isProtectedNamespace(ns)) {
      assertAdminRole(this.ctx, 'configurar provedores de IA', ns)
    }
    return this.write(ns, 'update', patch, expectedRevision)
  }

  /**
   * Replace one namespace's stored user section wholesale.
   * @param ns - namespace key to write.
   * @param section - complete replacement user section.
   * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
   * @returns the namespace's redacted view after the write.
   * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
   */
  @Remote
  async replace(
    ns: string,
    section: Record<string, JsonValue>,
    expectedRevision: number | undefined,
  ): Promise<SettingsNamespaceView> {
    if (isProtectedNamespace(ns)) {
      assertAdminRole(this.ctx, 'configurar provedores de IA', ns)
    }
    return this.write(ns, 'replace', section, expectedRevision)
  }

  /**
   * Apply path-addressed edits to one namespace's user section, resolved against
   * the section as stored rather than against whatever the caller last read,
   * then answer with that namespace's new redacted view.
   * @param ns - namespace key to write.
   * @param ops - the edits to apply, in order.
   * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
   * @returns the namespace's redacted view after the write.
   * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
   */
  @Remote
  async mutate(
    ns: string,
    ops: SettingsPathOpView[],
    expectedRevision: number | undefined,
  ): Promise<SettingsNamespaceView> {
    if (isProtectedNamespace(ns)) {
      assertAdminRole(this.ctx, 'configurar provedores de IA', ns)
    }
    return this.write(ns, 'mutate', ops, expectedRevision)
  }

  /**
   * Materialize the provider-owned settings document and open it in a native text editor.
   * @param signal - caller lifetime; abort terminates preparation or the native command.
   * @returns confirmation after the native opener accepts the document.
   * @throws RemoteError when no document exists, preparation fails, or opening fails.
   */
  @Remote
  async openSettingsDocument(signal: AbortSignal): Promise<SettingsDocumentOpenValue> {
    assertAdminRole(this.ctx, 'abrir o documento de configurações do servidor', 'document')
    const settings = this.provider()
    if (isAborted(signal)) throw new RemoteError('gateway/cancelled', 'settings document open was aborted', {})
    let path: string | undefined
    try {
      path = await settings.prepareDocument()
    } catch (error: unknown) {
      if (isAborted(signal)) throw new RemoteError('gateway/cancelled', 'settings document preparation was aborted', {})
      throw new RemoteError('gateway/internal', `settings document preparation failed: ${messageOf(error)}`, {}, { cause: error })
    }
    if (path === undefined) {
      throw new RemoteError('gateway/internal', 'settings provider has no local document to open', {})
    }
    if (isAborted(signal)) throw new RemoteError('gateway/cancelled', 'settings document open was aborted', {})
    try {
      await this.openTextFile(path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (isAborted(signal)) throw new RemoteError('gateway/cancelled', 'settings document open was aborted', {})
      throw new RemoteError('gateway/internal', `path open failed: ${messageOf(error)}`, {}, { cause: error })
    }
  }

  /**
   * Open one user-authored Agent preset directory or return its path when no native opener exists.
   * @param agentPreset - preset id resolved against Host-owned roots.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns an opened confirmation or the resolved directory for text display.
   * @throws RemoteError when the preset is missing, read-only, invalid, or cannot be opened.
   */
  @Remote
  async openAgentPresetDirectory(
    agentPreset: string,
    signal: AbortSignal,
  ): Promise<AgentPresetDirectoryOpenValue> {
    if (agentPreset.length === 0) {
      throw new RemoteError('gateway/bad-request', 'agent preset id must not be empty', {})
    }
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) {
      throw new RemoteError(
        'agent-preset/not-found',
        'this deployment composes no agent presets',
        { agentPreset, available: [] },
      )
    }
    const preset = await presets.resolve(agentPreset)
    if (preset.trust !== 'user') {
      throw new RemoteError(
        'agent-preset/read-only',
        `agent-presets: preset "${preset.id}" cannot be written: it ships with the deployment`,
        { agentPreset: preset.id, reason: 'it ships with the deployment' },
      )
    }
    const directory = dirname(preset.path)
    if (!this.canOpenPath()) return { opened: false, path: directory }
    try {
      await this.openPath(directory, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'path open was aborted', {})
      throw new RemoteError('gateway/internal', `path open failed: ${messageOf(error)}`, {}, { cause: error })
    }
  }

  /**
   * List tenants with their plan, subscription status, and token usage for admin users.
   * Restricted to callers with role 'owner' or 'admin'.
   * @returns list of tenant admin views with subscription and token usage details
   */
  @RemoteScope('auth', 'listTenants')
  async listTenants(): Promise<TenantAdminView[]> {
    assertAdminOrOwnerAuth(this.ctx, 'listar tenants')
    const { data, error } = await supabaseAdminClient
      .from('tenants')
      .select('id, name, slug, status, subscription_status, plan_id, trial_ends_at, trial_used, trial_tokens_used, current_period_tokens_used, created_at')
      .order('created_at', { ascending: false })

    if (error !== null) {
      throw new RemoteError('gateway/internal', `Erro ao listar tenants: ${error.message}`, {})
    }

    return (data || []).map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      subscription_status: t.subscription_status || 'trialing',
      plan_id: t.plan_id ?? null,
      trial_ends_at: t.trial_ends_at ?? null,
      trial_used: Boolean(t.trial_used),
      trial_tokens_used: Number(t.trial_tokens_used ?? 0),
      current_period_tokens_used: Number(t.current_period_tokens_used ?? 0),
      created_at: t.created_at,
    }))
  }

  /**
   * Fetch token consumption metrics, trial status, and plan allowances for a tenant.
   * Regular members query their own tenant; administrators may query any tenant.
   * @param request - optional tenantId for admin cross-tenant queries
   * @returns tenant metrics including token consumption and trial status
   */
  @RemoteScope('auth', 'getTenantMetrics')
  async getTenantMetrics(request?: { tenantId?: string }): Promise<TenantMetricsView> {
    const identity = getAuthIdentity(this.ctx)
    if (identity === undefined) {
      throw new RemoteError('settings/unauthorized', 'Autenticação necessária para consultar métricas.', {})
    }

    let targetTenantId = identity.tenantId
    if (request?.tenantId !== undefined && request.tenantId !== identity.tenantId) {
      if (identity.role !== 'owner' && identity.role !== 'admin') {
        throw new RemoteError('settings/forbidden', 'Acesso negado: impossível consultar métricas de outro tenant.', { ns: 'metrics' })
      }
      targetTenantId = request.tenantId
    }

    const { data: tenant, error: tenantErr } = await supabaseAdminClient
      .from('tenants')
      .select('id, subscription_status, plan_id, trial_ends_at, trial_used, trial_tokens_used, current_period_tokens_used')
      .eq('id', targetTenantId)
      .single()

    if (tenantErr !== null || tenant === null) {
      throw new RemoteError('gateway/bad-request', `Tenant não encontrado: ${targetTenantId}`, {})
    }

    let planData: TenantPlanDetails | null = null
    if (tenant.plan_id) {
      const { data: plan } = await supabaseAdminClient
        .from('plans')
        .select('id, name, slug, monthly_price_cents, annual_price_cents, token_limit_input, token_limit_output, max_workspaces, max_sessions, storage_gb, ai_tier')
        .eq('id', tenant.plan_id)
        .single()
      if (plan) {
        planData = {
          id: plan.id,
          name: plan.name,
          slug: plan.slug,
          monthly_price_cents: plan.monthly_price_cents ?? null,
          annual_price_cents: plan.annual_price_cents ?? null,
          token_limit_input: plan.token_limit_input ?? null,
          token_limit_output: plan.token_limit_output ?? null,
          max_workspaces: plan.max_workspaces ?? null,
          max_sessions: plan.max_sessions ?? null,
          storage_gb: plan.storage_gb ?? null,
          ai_tier: plan.ai_tier ?? null,
        }
      }
    }

    const trialEndsAt = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null
    const now = new Date()
    const daysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0
    const maxTrialTokens = 1000000
    const trialTokensUsed = Number(tenant.trial_tokens_used ?? 0)
    const isExpired = tenant.subscription_status === 'trial_expired' || (trialEndsAt !== null && trialEndsAt < now) || trialTokensUsed >= maxTrialTokens

    const totalLimit = (Number(planData?.token_limit_input ?? 0) + Number(planData?.token_limit_output ?? 0)) || 3000000

    return {
      tenantId: tenant.id,
      subscriptionStatus: tenant.subscription_status || 'trialing',
      plan: planData,
      trial: {
        trialEndsAt: tenant.trial_ends_at ?? null,
        trialUsed: Boolean(tenant.trial_used),
        trialTokensUsed,
        maxTrialTokens,
        isExpired,
        daysLeft,
      },
      usage: {
        currentPeriodTokensUsed: Number(tenant.current_period_tokens_used ?? 0),
        totalTokensLimit: totalLimit,
      },
    }
  }

  /**
   * Query the tenant audit trail. Restricted to administrators.
   * @param request - optional query parameters (limit, offset, tenantId)
   * @returns list of audit log entries
   */
  @RemoteScope('auth', 'listAuditLogs')
  async listAuditLogs(request?: AuditLogQueryRequest): Promise<AuditLogView[]> {
    assertAdminOrOwnerAuth(this.ctx, 'consultar logs de auditoria')
    const limit = Math.min(request?.limit ?? 50, 100)
    const offset = request?.offset ?? 0

    let query = supabaseAdminClient
      .from('audit_logs')
      .select('id, tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, ip_address, user_agent, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (request?.tenantId) {
      query = query.eq('tenant_id', request.tenantId)
    }
    if (request?.action) {
      query = query.eq('action', request.action)
    }

    const { data, error } = await query
    if (error !== null) {
      throw new RemoteError('gateway/internal', `Erro ao buscar logs de auditoria: ${error.message}`, {})
    }

    return (data || []).map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      oldValue: (row.old_value ?? null) as unknown as JsonValue,
      newValue: (row.new_value ?? null) as unknown as JsonValue,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    }))
  }

  /**
   * Record an action into the audit trail.
   * @param request - the audit log entry to record
   * @returns confirmation with the recorded log id
   */
  @RemoteScope('auth', 'recordAuditLog')
  async recordAuditLog(request: AuditLogRecordRequest): Promise<{ recorded: true; id: string }> {
    const identity = getAuthIdentity(this.ctx)
    if (identity === undefined) {
      throw new RemoteError('settings/unauthorized', 'Autenticação necessária para registrar auditoria.', {})
    }

    const { data, error } = await supabaseAdminClient
      .from('audit_logs')
      .insert([
        {
          tenant_id: identity.tenantId,
          user_id: identity.userId,
          action: request.action,
          resource_type: request.resourceType ?? null,
          resource_id: request.resourceId ?? null,
          old_value: (request.oldValue ?? null) as unknown as Json,
          new_value: (request.newValue ?? null) as unknown as Json,
        },
      ])
      .select('id')
      .single()

    if (error !== null) {
      throw new RemoteError('gateway/internal', `Erro ao gravar log de auditoria: ${error.message}`, {})
    }

    return { recorded: true, id: data.id }
  }

  /**
   * Increment token usage for the caller's tenant via the atomic database RPC.
   * @param request - token usage details to record
   * @returns the updated token usage record
   */
  @RemoteScope('auth', 'recordTokenUsage')
  async recordTokenUsage(request: TokenUsageRecordRequest): Promise<TokenUsageRecordValue> {
    const identity = getAuthIdentity(this.ctx)
    if (identity === undefined) {
      throw new RemoteError('settings/unauthorized', 'Autenticação necessária para registrar consumo.', {})
    }

    let targetTenantId = identity.tenantId
    if (request.tenantId && request.tenantId !== identity.tenantId) {
      if (identity.role !== 'owner' && identity.role !== 'admin') {
        throw new RemoteError('settings/forbidden', 'Não autorizado: impossível alterar consumo de outro tenant.', { ns: 'usage' })
      }
      targetTenantId = request.tenantId
    }

    if (!Number.isFinite(request.tokens) || request.tokens <= 0) {
      throw new RemoteError('gateway/bad-request', 'Quantidade de tokens deve ser um número positivo.', {})
    }

    const { error } = await supabaseAdminClient.rpc('increment_tenant_token_usage', {
      p_tenant_id: targetTenantId,
      p_tokens: Math.round(request.tokens),
    })

    if (error !== null) {
      throw new RemoteError('gateway/internal', `Erro ao registrar consumo de tokens: ${error.message}`, {})
    }

    return {
      recorded: true,
      tenantId: targetTenantId,
      tokensAdded: Math.round(request.tokens),
    }
  }

  private async write(
    ns: string,
    mode: 'update' | 'replace' | 'mutate',
    input: Record<string, JsonValue> | SettingsPathOpView[],
    expectedRevision: number | undefined,
  ): Promise<SettingsNamespaceView> {
    const parsed = settingsNamespaceRequestSchema.safeParse({ ns })
    if (!parsed.success) {
      throw new RemoteError('gateway/bad-request', `invalid payload for settings.${mode}`, { issues: parsed.error.issues })
    }
    const settings = this.provider()
    const namespace = parsed.data.ns
    try {
      if (mode === 'update') await settings.update(namespace, input, expectedRevision)
      else if (mode === 'replace') await settings.replace(namespace, input, expectedRevision)
      else await settings.mutate(namespace, input as SettingsPathOp[], expectedRevision)
    } catch (error: unknown) {
      throw rejected(ns, error)
    }
    const descriptor = settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === namespace)
    if (descriptor === undefined) {
      // The write committed but the namespace vanished before this read: only a
      // concurrent registrant disposal can produce it.
      throw new RemoteError('gateway/internal', `settings namespace "${ns}" was disposed after the ${mode}`, {})
    }
    return namespaceView(descriptor)
  }

  /** Resolve the optional provider or report how to supply it. */
  private provider(): SettingsProvider {
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings-file) in its composition',
        {},
      )
    }
    return settings
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface SettingsConflict {
  readonly code: 'SETTINGS_CONFLICT'
  readonly message: string
  readonly expected: number
  readonly actual: number
}

function settingsConflictOf(error: unknown): SettingsConflict | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if (Reflect.get(error, 'code') !== 'SETTINGS_CONFLICT'
    || typeof Reflect.get(error, 'message') !== 'string'
    || typeof Reflect.get(error, 'expected') !== 'number'
    || typeof Reflect.get(error, 'actual') !== 'number') return undefined
  return error as SettingsConflict
}

/**
 * Classify one seam refusal. A stale writer is its own outcome, not a malformed
 * request: the client must re-read and re-apply rather than treat the write as
 * invalid.
 * @param ns - the namespace the write addressed.
 * @param error - whatever the seam threw.
 * @returns the failure to raise for that refusal.
 */
function rejected(ns: string, error: unknown): RemoteError {
  const conflict = settingsConflictOf(error)
  if (conflict !== undefined) {
    return new RemoteError(
      'settings/conflict',
      conflict.message,
      { ns, expected: conflict.expected, actual: conflict.actual },
      { cause: error },
    )
  }
  return new RemoteError('settings/rejected', messageOf(error), { ns }, { cause: error })
}

export default SettingsController
