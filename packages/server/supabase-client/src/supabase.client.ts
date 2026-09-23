/**
 * CopyMonster Supabase clients: one anon-scoped client for caller-visible reads
 * and one service-role client for backend administration.
 *
 * Environment is read at module load; the Harness boot loads `.env` before the
 * composing plugins import, and a missing variable fails loud here rather than
 * surfacing as an opaque network fault later. `supabaseAdminClient` bypasses
 * row-level security and must never reach a browser bundle.
 * @module @copymonster/supabase-client
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TENANT_SLUG } from '@deepseek-ai/dsh-constants'
import type { Database } from './supabase.types.ts'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (SUPABASE_URL === undefined || SUPABASE_URL === '') {
  throw new Error('supabase-client: SUPABASE_URL is required')
}
if (SUPABASE_ANON_KEY === undefined || SUPABASE_ANON_KEY === '') {
  throw new Error('supabase-client: SUPABASE_ANON_KEY is required')
}
if (SUPABASE_SERVICE_ROLE_KEY === undefined || SUPABASE_SERVICE_ROLE_KEY === '') {
  throw new Error('supabase-client: SUPABASE_SERVICE_ROLE_KEY is required')
}

/** Anonymous client: subject to row-level security. */
export const supabaseAnonClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

/** Service-role client: bypasses row-level security. Backend only. */
export const supabaseAdminClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

/**
 * Read the default CopyMonster tenant.
 * @returns the active default tenant row, or `null` when absent.
 */
export async function getDefaultTenant() {
  const { data, error } = await supabaseAdminClient
    .from('tenants')
    .select('*')
    .eq('slug', DEFAULT_TENANT_SLUG)
    .eq('status', 'active')
    .single()

  if (error !== null || data === null) return null
  return data
}

/**
 * Report whether a profile exists for one Supabase user.
 * @param userId - `auth.users` identity.
 * @returns `true` when `public.users` carries the identity.
 */
export async function userExists(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdminClient
    .from('users')
    .select('id')
    .eq('id', userId)
    .single()

  if (error !== null || data === null) return false
  return true
}

/**
 * Read one identity's role inside one tenant.
 * @param userId - `auth.users` identity.
 * @param tenantId - tenant to scope the lookup.
 * @returns the role, or `null` when no assignment exists.
 */
export async function getUserRole(
  userId: string,
  tenantId: string,
): Promise<'owner' | 'admin' | 'member' | 'anonymous' | null> {
  const { data, error } = await supabaseAdminClient
    .from('user_tenant_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .single()

  if (error !== null || data === null) return null
  return data.role as 'owner' | 'admin' | 'member' | 'anonymous'
}

export default {
  anon: supabaseAnonClient,
  admin: supabaseAdminClient,
}
