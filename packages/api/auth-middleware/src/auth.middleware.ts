import { Request, Response, NextFunction } from 'express';
import { supabaseAdminClient } from '@copymonster/supabase-client';
import type { UserIdentity, IdentityExtractionResult, SupabaseJWTPayload } from '../types/auth.types';

/**
 * Extrai o token JWT do header Authorization
 */
function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Valida e decodifica o token JWT com o Supabase
 */
async function validateToken(token: string): Promise<{ valid: boolean; payload?: SupabaseJWTPayload; error?: string }> {
  try {
    const { data, error } = await supabaseAdminClient.auth.getUser(token);

    if (error || !data.user) {
      return { valid: false, error: error?.message || 'Token inválido' };
    }

    // Construir payload a partir dos dados do usuário
    const payload: SupabaseJWTPayload = {
      aud: data.user.aud,
      exp: Math.floor((data.user.last_sign_in_at ? new Date(data.user.last_sign_in_at).getTime() : Date.now()) / 1000) + 3600,
      iat: Math.floor(new Date(data.user.created_at).getTime() / 1000),
      iss: 'supabase',
      sub: data.user.id,
      email: data.user.email || undefined,
      phone: data.user.phone || undefined,
      app_metadata: data.user.app_metadata as any,
      user_metadata: data.user.user_metadata as any,
    };

    return { valid: true, payload };
  } catch (err) {
    return { 
      valid: false, 
      error: err instanceof Error ? err.message : 'Erro ao validar token' 
    };
  }
}

/**
 * Busca o tenant padrão para usuários sem tenant explícito
 */
async function getDefaultTenantId(): Promise<string | null> {
  const { data, error } = await supabaseAdminClient
    .from('tenants')
    .select('id')
    .eq('slug', 'integridade-digital')
    .eq('status', 'active')
    .single();

  if (error || !data) {
    return null;
  }

  return data.id;
}

/**
 * Obtém a role do usuário em um tenant
 */
async function getUserRole(userId: string, tenantId: string): Promise<string | null> {
  const { data, error } = await supabaseAdminClient
    .from('user_tenant_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !data) {
    return null;
  }

  return data.role;
}

/**
 * Extrai a identidade completa do usuário a partir do token
 */
export async function extractIdentity(token: string): Promise<IdentityExtractionResult> {
  // Passo 1: Validar token
  const tokenValidation = await validateToken(token);
  
  if (!tokenValidation.valid || !tokenValidation.payload) {
    return {
      success: false,
      error: tokenValidation.error,
      errorCode: tokenValidation.error?.includes('expir') ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    };
  }

  const userId = tokenValidation.payload.sub;
  const email = tokenValidation.payload.email || '';

  // Passo 2: Verificar se usuário existe na tabela users
  const { data: userData, error: userError } = await supabaseAdminClient
    .from('users')
    .select('id, email, full_name, whatsapp, avatar_url')
    .eq('id', userId)
    .single();

  if (userError || !userData) {
    return {
      success: false,
      error: 'Usuário não encontrado no banco de dados',
      errorCode: 'USER_NOT_FOUND',
    };
  }

  // Passo 3: Obter tenant padrão
  const tenantId = await getDefaultTenantId();
  
  if (!tenantId) {
    return {
      success: false,
      error: 'Tenant padrão não encontrado',
      errorCode: 'TENANT_NOT_FOUND',
    };
  }

  // Passo 4: Obter role do usuário no tenant
  let role = await getUserRole(userId, tenantId);
  
  // Se usuário não tem role definida, é anonymous por padrão
  if (!role) {
    role = 'anonymous';
  }

  // Construir identidade
  const identity: UserIdentity = {
    userId,
    tenantId,
    role: role as 'owner' | 'admin' | 'member' | 'anonymous',
    email: userData.email || email,
    fullName: userData.full_name || undefined,
    whatsapp: userData.whatsapp || undefined,
    avatarUrl: userData.avatar_url || undefined,
  };

  return {
    success: true,
    identity,
  };
}

/**
 * Middleware Express que extrai identidade do request e injeta no contexto
 */
export function authMiddleware(options: { requireAuth?: boolean } = {}) {
  const requireAuth = options.requireAuth ?? false;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Extrair token do header
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      if (requireAuth) {
        return res.status(401).json({
          error: 'Não autorizado',
          message: 'Token de autenticação não fornecido',
        });
      }
      
      // Request continua sem identidade
      (req as any).context = {
        ...(req as any).context,
        identity: undefined,
        isAuthenticated: false,
        isAnonymous: true,
      };
      return next();
    }

    // Extrair identidade do token
    const result = await extractIdentity(token);

    if (!result.success) {
      if (requireAuth) {
        return res.status(401).json({
          error: 'Não autorizado',
          message: result.error || 'Falha na autenticação',
          code: result.errorCode,
        });
      }
      
      // Request continua sem identidade
      (req as any).context = {
        ...(req as any).context,
        identity: undefined,
        isAuthenticated: false,
        isAnonymous: true,
      };
      return next();
    }

    // Injetar identidade no contexto da request
    (req as any).context = {
      ...(req as any).context,
      identity: result.identity,
      isAuthenticated: true,
      isAnonymous: result.identity?.role === 'anonymous',
    };

    next();
  };
}

// Exportar funções utilitárias
export { extractTokenFromHeader, validateToken };
