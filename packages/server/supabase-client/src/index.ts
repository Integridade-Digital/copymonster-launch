/**
 * @copymonster/supabase-client
 * 
 * Cliente Supabase para o backend do CopyMonster
 * Fornece clientes tipados para operações anon e admin
 */

export { supabaseAnonClient, supabaseAdminClient, getDefaultTenant, userExists, getUserRole } from './supabase.client';
export type { Database, UserIdentity, SupabaseClientType } from './supabase.types';
export { default as supabase } from './supabase.client';
