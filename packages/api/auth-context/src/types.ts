/**
 * CopyMonster identity vocabulary shared by the auth service, its Typert Host
 * Context adapter, and consumers such as the HTTP auth routes.
 * @module @deepseek-ai/dsh-api-auth-context/types
 */

/** The four CopyMonster access levels. */
export type UserRole = 'owner' | 'admin' | 'member' | 'anonymous'

/** A resolved caller identity: who acts, in which tenant, with which role. */
export interface UserIdentity {
  /** Supabase `auth.users` identity. */
  readonly userId: string
  /** Tenant the identity acts within. */
  readonly tenantId: string
  /** Role held inside {@link tenantId}. */
  readonly role: UserRole
  /** Account e-mail. */
  readonly email: string
  /** Display name, when the profile carries one. */
  readonly fullName?: string
  /** Contact number in international format, when present. */
  readonly whatsapp?: string
  /** Avatar URL, when present. */
  readonly avatarUrl?: string
}

/**
 * Wire identity carried by a Remote method that declares the `auth` Context:
 * the bearer token the caller presents.
 */
export type AuthToken = string
