/**
 * CopyMonster Supabase clients: one anon-scoped client for caller-visible reads,
 * one caller-scoped client that carries a user's bearer token, and one
 * service-role client for backend administration.
 *
 * `SUPABASE_URL` and `SUPABASE_ANON_KEY` are required at module load: every
 * caller needs them. The service-role key is different — a tenant DSH runs
 * untrusted code and must not hold it — so the admin client is created on first
 * use and throws only when a privileged operation actually runs without the
 * key. `supabaseAdminClient` bypasses row-level security and must never reach a
 * browser bundle.
 * @module @copymonster/supabase-client
 */

import { createClient } from '@supabase/supabase-js'
import { DEFAULT_TENANT_SLUG } from '@deepseek-ai/dsh-constants'
import type { Database } from './supabase.types.ts'

const isTest = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test')

const SUPABASE_URL = process.env.SUPABASE_URL ?? (isTest ? 'https://placeholder.supabase.co' : undefined)
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? (isTest ? 'placeholder-anon-key' : undefined)
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? (isTest ? 'placeholder-service-role-key' : undefined)

if (SUPABASE_URL === undefined || SUPABASE_URL === '') {
  throw new Error('supabase-client: SUPABASE_URL is required')
}
if (SUPABASE_ANON_KEY === undefined || SUPABASE_ANON_KEY === '') {
  throw new Error('supabase-client: SUPABASE_ANON_KEY is required')
}

/**
 * Resolved connection facts.
 *
 * Held as annotated module constants because TypeScript drops the narrowing of
 * a captured `const` inside a nested function, and every client factory below
 * needs the non-optional types.
 */
const CLIENT_URL: string = SUPABASE_URL
const CLIENT_ANON_KEY: string = SUPABASE_ANON_KEY

/** The concrete client type `createClient<Database>` returns. */
type DatabaseClient = ReturnType<typeof createClient<Database>>

/** Anonymous client: subject to row-level security. */
export const supabaseAnonClient: DatabaseClient = createClient<Database>(
  CLIENT_URL,
  CLIENT_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

/**
 * Create a client that carries one caller's bearer token, so every query runs
 * under that caller's row-level security instead of the service role.
 * @param token - Supabase-issued JWT presented by the caller.
 * @returns a client scoped to that caller.
 */
export function createUserClient(token: string): DatabaseClient {
  return createClient<Database>(CLIENT_URL, CLIENT_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

let adminClient: DatabaseClient | undefined

/**
 * Whether this process holds the service-role key. A tenant DSH answers false;
 * the main app and the orchestrator answer true.
 * @returns true when privileged Supabase operations are available here.
 */
export function hasSupabaseAdminClient(): boolean {
  return SUPABASE_SERVICE_ROLE_KEY !== undefined && SUPABASE_SERVICE_ROLE_KEY !== ''
}

/**
 * Resolve the service-role client, creating it on first use.
 * @returns the shared admin client.
 * @throws Error when this process has no service-role key.
 */
function requireAdminClient(): DatabaseClient {
  if (adminClient !== undefined) return adminClient
  const key = SUPABASE_SERVICE_ROLE_KEY
  if (key === undefined || key === '') {
    throw new Error('supabase-client: SUPABASE_SERVICE_ROLE_KEY is required for privileged operations')
  }
  adminClient = createClient<Database>(CLIENT_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return adminClient
}

/**
 * Service-role client: bypasses row-level security. Backend only.
 *
 * Resolved on first property access so a process without the key can import
 * this module and run its caller-scoped paths; only a privileged call throws.
 */
export const supabaseAdminClient: DatabaseClient = new Proxy({} as DatabaseClient, {
  get(_target, property): unknown {
    const client = requireAdminClient()
    const value: unknown = Reflect.get(client, property)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

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
