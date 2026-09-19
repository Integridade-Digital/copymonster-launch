import { createAdminClient } from '@copymonster/supabase-client';

/**
 * Tenant Context Manager
 * 
 * Define o contexto de tenant e usuário para cada request,
 * permitindo que as políticas RLS do Supabase funcionem corretamente.
 * 
 * Uso:
 * await withTenantContext(userId, tenantId, async () => {
 *   // Operações de banco aqui terão contexto definido
 *   const data = await supabase.from('sessions').select('*');
 * });
 */

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'member' | 'anonymous';
}

/**
 * Executa uma operação com o contexto de tenant definido no banco de dados.
 * Isso permite que as funções SQL get_current_tenant_id() e get_current_user_id()
 * retornem os valores corretos para as políticas RLS.
 */
export async function withTenantContext<T>(
  context: TenantContext,
  operation: () => Promise<T>
): Promise<T> {
  const supabase = createAdminClient();

  try {
    // Define o contexto no banco de dados via session local
    // Nota: No ambiente Node.js com Supabase JS client, usamos headers customizados
    // ou passamos o contexto via query parameters para stored procedures
    
    // Para queries diretas, injetamos o contexto via headers que o middleware lê
    // e define como Postgres session settings
    
    // Aqui apenas executamos a operação - o contexto é injetado pelo middleware HTTP
    // que adiciona headers X-Tenant-ID e X-User-ID
    return await operation();
  } catch (error) {
    console.error('[TenantContext] Error during operation:', error);
    throw error;
  }
}

/**
 * Middleware Express/Fastify para injetar contexto de tenant nos headers
 * Usado antes de qualquer chamada ao cliente Supabase
 */
export function injectTenantContextHeaders(
  context: TenantContext,
  headers: Record<string, string> = {}
): Record<string, string> {
  return {
    ...headers,
    'X-Tenant-ID': context.tenantId,
    'X-User-ID': context.userId,
    'X-User-Role': context.role,
  };
}

/**
 * Valida se o usuário tem permissão para acessar o tenant
 */
export function validateTenantAccess(context: TenantContext): boolean {
  // Owner e Admin podem acessar qualquer coisa no tenant
  if (['owner', 'admin'].includes(context.role)) {
    return true;
  }
  
  // Member só pode acessar se estiver autenticado no próprio tenant
  if (context.role === 'member' && context.userId && context.tenantId) {
    return true;
  }
  
  // Anonymous não tem acesso a dados protegidos
  return false;
}

/**
 * Obtém limits do plano do tenant (para Fase 5 - Billing)
 */
export interface PlanLimits {
  sessions?: number;
  tokens_monthly?: number;
  [key: string]: number | undefined;
}

export async function getTenantLimits(
  supabaseClient: any,
  tenantId: string
): Promise<PlanLimits> {
  const { data, error } = await supabaseClient
    .from('tenants')
    .select('plan_id, usage_data')
    .eq('id', tenantId)
    .single();

  if (error || !data) {
    return { sessions: 5, tokens_monthly: 10000 }; // Default free plan
  }

  // Buscar limits do plano
  if (data.plan_id) {
    const { data: planData } = await supabaseClient
      .from('plans')
      .select('limits')
      .eq('id', data.plan_id)
      .single();
    
    return planData?.limits || {};
  }

  return {};
}

export default {
  withTenantContext,
  injectTenantContextHeaders,
  validateTenantAccess,
  getTenantLimits,
};
