/**
 * Tipos de identidade para o middleware de autenticação
 */

export type UserRole = 'owner' | 'admin' | 'member' | 'anonymous';

/**
 * Identidade do usuário extraída do token JWT
 */
export interface UserIdentity {
  /** ID único do usuário (UUID do Supabase auth.users) */
  userId: string;
  
  /** ID do tenant ao qual o usuário pertence */
  tenantId: string;
  
  /** Role do usuário no tenant */
  role: UserRole;
  
  /** E-mail do usuário */
  email: string;
  
  /** Nome completo do usuário (opcional) */
  fullName?: string;
  
  /** WhatsApp do usuário (opcional) */
  whatsapp?: string;
  
  /** URL do avatar (opcional) */
  avatarUrl?: string;
}

/**
 * Contexto de request estendido com identidade
 */
export interface AuthenticatedRequestContext {
  identity?: UserIdentity;
  isAuthenticated: boolean;
  isAnonymous: boolean;
}

/**
 * Payload decodificado do token JWT do Supabase
 */
export interface SupabaseJWTPayload {
  aud: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string; // user_id
  email?: string;
  phone?: string;
  app_metadata?: {
    provider?: string;
    providers?: string[];
  };
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
    whatsapp?: string;
  };
  role?: string;
  aal?: string;
  amr?: Array<{
    method: string;
    timestamp: number;
  }>;
}

/**
 * Resultado da extração de identidade
 */
export interface IdentityExtractionResult {
  success: boolean;
  identity?: UserIdentity;
  error?: string;
  errorCode?: 'INVALID_TOKEN' | 'TOKEN_EXPIRED' | 'USER_NOT_FOUND' | 'TENANT_NOT_FOUND' | 'ROLE_NOT_FOUND';
}

/**
 * Opções do middleware de autenticação
 */
export interface AuthMiddlewareOptions {
  /** Se true, requests não autenticados recebem 401. Se false, continuam com identity=undefined */
  requireAuth: boolean;
  
  /** Roles permitidas (se definido, verifica se o usuário tem uma das roles) */
  allowedRoles?: UserRole[];
  
  /** Mensagem de erro personalizada para não autorizado */
  unauthorizedMessage?: string;
}
