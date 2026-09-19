import { config } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';

config();

/**
 * Configuração do cliente Supabase
 * Valida variáveis de ambiente necessárias
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL não está definida nas variáveis de ambiente');
}

if (!SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_ANON_KEY não está definida nas variáveis de ambiente');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY não está definida nas variáveis de ambiente');
}

/**
 * Cliente Supabase com chave anon (para operações públicas)
 */
export const supabaseAnonClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Cliente Supabase com service role (para operações administrativas no backend)
 * CUIDADO: Este cliente bypassa RLS e tem acesso total ao banco
 */
export const supabaseAdminClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Função utilitária para obter o tenant padrão "Integridade Digital"
 */
export async function getDefaultTenant() {
  const { data, error } = await supabaseAdminClient
    .from('tenants')
    .select('*')
    .eq('slug', 'integridade-digital')
    .eq('status', 'active')
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Função utilitária para verificar se um usuário existe
 */
export async function userExists(userId: string) {
  const { data, error } = await supabaseAdminClient
    .from('users')
    .select('id')
    .eq('id', userId)
    .single();

  if (error || !data) {
    return false;
  }

  return true;
}

/**
 * Função utilitária para obter role de um usuário em um tenant
 */
export async function getUserRole(userId: string, tenantId: string) {
  const { data, error } = await supabaseAdminClient
    .from('user_tenant_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !data) {
    return null;
  }

  return data.role as 'owner' | 'admin' | 'member' | 'anonymous';
}

/**
 * Exportação padrão com ambos os clientes
 */
export default {
  anon: supabaseAnonClient,
  admin: supabaseAdminClient,
};
