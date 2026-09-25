/**
 * CopyMonster identity vocabulary shared by the auth service, its Typert Host
 * and Client Context adapters, and consumers such as the HTTP auth routes.
 *
 * The `auth` Context kind is declared here so both compiler faces resolve the
 * same merge; this module holds types only, keeping the Host service's
 * Supabase and Node imports out of the browser program.
 * @module @deepseek-ai/dsh-api-auth-context/types
 */

import type { TypertContext } from '@deepseek-ai/dsh-typert-protocol'

/**
 * The four CopyMonster access levels.
 *
 * `anonymous` remains a storable `user_tenant_roles.role` value, but no
 * identity is ever issued with it: a caller holding only that role has no
 * membership to act within.
 */
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

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertContextMap {
    /** CopyMonster identity derived from the caller's bearer token. */
    auth: TypertContext<AuthToken>
  }
}
