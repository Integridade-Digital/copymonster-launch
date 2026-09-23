/**
 * Wire bodies returned by the CopyMonster HTTP auth routes.
 * @module @deepseek-ai/dsh-api-auth-http/types
 */

import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context/types'

/** `GET /api/auth/me` response. */
export interface AuthIdentityResponse {
  /** Whether a token resolved to a live identity. */
  readonly authenticated: boolean
  /** The resolved identity; present only when authenticated. */
  readonly identity?: UserIdentity
  /** Stable machine reason when authentication failed. */
  readonly error?: string
}

/** Error body shared by the auth routes. */
export interface AuthErrorResponse {
  /** Stable machine-readable failure code. */
  readonly error: string
}
