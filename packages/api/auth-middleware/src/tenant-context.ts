import { Request, Response, NextFunction } from 'express';
import { createClient } from '@copymonster/supabase-client';

/**
 * Middleware para injetar contexto do tenant na request
 * 
 * Este middleware:
 * 1. Extrai token JWT do header Authorization
 * 2. Valida token com Supabase
 * 3. Busca user_tenant_roles para obter tenant_id e role
 * 4. Injeta no contexto da request para uso em controllers
 */
export async function injectTenantContext(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    // Request sem token - pode ser usuário anônimo
    return next();
  }

  const token = authHeader.replace('Bearer ', '');
  
  try {
    const supabase = createClient(); // cliente anon
    
    // Verificar token e extrair user_id
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      // Token inválido ou expirado
      return next();
    }

    // Buscar tenant principal do usuário (primeiro role encontrado)
    const { data: userRole, error: roleError } = await supabase
      .from('user_tenant_roles')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (roleError || !userRole) {
      // Usuário não tem role atribuída ainda
      // Isso pode acontecer se o seed não foi rodado
      return next();
    }

    // Injetar no contexto da request
    (req as any).tenantId = userRole.tenant_id;
    (req as any).userRole = userRole.role;
    (req as any).userId = user.id;

    next();
  } catch (error) {
    // Erro inesperado - logar e continuar sem contexto
    console.error('[injectTenantContext] Error:', error);
    next();
  }
}

/**
 * Helper para verificar se request tem contexto de tenant
 */
export function hasTenantContext(req: Request): boolean {
  return !!(req as any).tenantId;
}

/**
 * Helper para obter contexto completo
 */
export function getTenantContext(req: Request) {
  return {
    tenantId: (req as any).tenantId,
    userId: (req as any).userId,
    role: (req as any).userRole
  };
}
