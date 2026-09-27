/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The caller lacks administrative privileges for the refused operation. The
     * details name only the namespace, never a stored value.
     */
    'settings/forbidden': { readonly ns: string }
    /**
     * Authentication required to perform operation.
     */
    'settings/unauthorized': Record<string, never>
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because a
     * read-only source shadows the reference. The details name only the
     * reference, never the value.
     */
    'credential/rejected': { readonly ref: string }
    /**
     * The caller lacks administrative privileges for the refused credential
     * write. The details name only the reference, never the value.
     */
    'credential/forbidden': { readonly ref: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Result of opening or revealing one locally authored Agent preset directory. */
export type AgentPresetDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/** View of a tenant for administrative management. */
export interface TenantAdminView {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly status: 'active' | 'suspended' | 'deleted'
  readonly subscription_status: string
  readonly plan_id: string | null
  readonly trial_ends_at: string | null
  readonly trial_used: boolean
  readonly trial_tokens_used: number
  readonly current_period_tokens_used: number
  readonly created_at: string
}

/** Plan details accompanying metrics. */
export interface TenantPlanDetails {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly monthly_price_cents?: number | null
  readonly annual_price_cents?: number | null
  readonly token_limit_input?: number | null
  readonly token_limit_output?: number | null
  readonly max_workspaces?: number | null
  readonly max_sessions?: number | null
  readonly storage_gb?: number | null
  readonly ai_tier?: string | null
}

/** Real-time metrics view of token consumption and trial limits. */
export interface TenantMetricsView {
  readonly tenantId: string
  readonly subscriptionStatus: string
  readonly plan: TenantPlanDetails | null
  readonly trial: {
    readonly trialEndsAt: string | null
    readonly trialUsed: boolean
    readonly trialTokensUsed: number
    readonly maxTrialTokens: number
    readonly isExpired: boolean
    readonly daysLeft: number
  }
  readonly usage: {
    readonly currentPeriodTokensUsed: number
    readonly totalTokensLimit: number
  }
}

/** View of an audit trail log entry. */
export interface AuditLogView {
  readonly id: string
  readonly tenantId: string | null
  readonly userId: string | null
  readonly action: string
  readonly resourceType: string | null
  readonly resourceId: string | null
  readonly oldValue: unknown
  readonly newValue: unknown
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly createdAt: string
}

/** Filter and pagination parameters for querying audit logs. */
export interface AuditLogQueryRequest {
  readonly tenantId?: string
  readonly action?: string
  readonly limit?: number
  readonly offset?: number
}

/** Payload for recording an audit entry. */
export interface AuditLogRecordRequest {
  readonly action: string
  readonly resourceType?: string
  readonly resourceId?: string
  readonly oldValue?: unknown
  readonly newValue?: unknown
}

/** Request payload for recording incremental token consumption. */
export interface TokenUsageRecordRequest {
  readonly tokens: number
  readonly tenantId?: string
}

/** Receipt confirming token usage consumption. */
export interface TokenUsageRecordValue {
  readonly recorded: true
  readonly tenantId: string
  readonly tokensAdded: number
}
