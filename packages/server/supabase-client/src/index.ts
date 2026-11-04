/**
 * CopyMonster Supabase client package entry.
 * @module @deepseek-ai/dsh-supabase-client
 */

export {
  supabaseAnonClient,
  supabaseAdminClient,
  createUserClient,
  hasSupabaseAdminClient,
  getDefaultTenant,
  userExists,
  getUserRole,
} from './supabase.client.ts'
export { default as supabase } from './supabase.client.ts'
export type {
  Database,
  UserIdentity,
  SupabaseClientType,
  Json,
  PositioningMappingRow,
  TenantQuotaRow,
  MyProfileResult,
  MyTenantMetrics,
  AdminTenantRow,
  AuditLogRow,
} from './supabase.types.ts'
