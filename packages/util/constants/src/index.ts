/**
 * Shared constants for CopyMonster SaaS
 * Single source of truth for tenant identifiers and other shared values
 */

/** Default tenant slug for "Integridade Digital" */
export const DEFAULT_TENANT_SLUG = 'integridade-digital'

/** Default tenant UUID (fixed in migration 001_initial_identity.sql) */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

/** Auth context key for Typert Context Provider */
export const AUTH_CONTEXT_NAME = 'auth'

/** Header name for Bearer token extraction */
export const AUTH_HEADER_NAME = 'authorization'

/** Bearer token prefix */
export const BEARER_PREFIX = 'Bearer '

/** Cookie name for session token (if using cookie-based auth) */
export const SESSION_COOKIE_NAME = 'cm_session'
