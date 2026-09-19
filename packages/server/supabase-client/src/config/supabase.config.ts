/**
 * Configuração do Supabase
 * Variáveis de ambiente necessárias
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseConfig: SupabaseConfig = {
  url: SUPABASE_URL || '',
  anonKey: SUPABASE_ANON_KEY || '',
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY || '',
};

export function validateSupabaseConfig(): void {
  const errors: string[] = [];

  if (!supabaseConfig.url) {
    errors.push('SUPABASE_URL não está definida');
  }

  if (!supabaseConfig.anonKey) {
    errors.push('SUPABASE_ANON_KEY não está definida');
  }

  if (!supabaseConfig.serviceRoleKey) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY não está definida');
  }

  if (errors.length > 0) {
    throw new Error(`Configuração inválida do Supabase:\n${errors.join('\n')}`);
  }
}
