/**
 * @copymonster/auth-middleware
 *
 * Middleware de autenticação para CopyMonster API
 * Extrai identidade do usuário (user_id, tenant_id, role) de cada request
 */

export { authMiddleware, extractIdentity, extractTokenFromHeader, validateToken } from './auth.middleware';
export { injectTenantContext, hasTenantContext, getTenantContext } from './tenant-context';
export { authorizationGuard, requireRole } from './guards/authorization.guard';
export { Roles, getRequiredRoles } from './decorators/roles.decorator';
export type {
  UserIdentity,
  UserRole,
  AuthenticatedRequestContext,
  SupabaseJWTPayload,
  IdentityExtractionResult,
  AuthMiddlewareOptions
} from './types/auth.types';
