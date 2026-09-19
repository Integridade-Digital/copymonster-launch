import { Request, Response, NextFunction } from 'express';
import 'reflect-metadata';
import { UserRole, getRequiredRoles } from '../decorators/roles.decorator';

/**
 * Guard de autorização baseado em roles
 * 
 * Deve ser aplicado após o authMiddleware e injectTenantContext
 * 
 * Uso:
 * app.post('/workspace/create', 
 *   authMiddleware, 
 *   injectTenantContext,
 *   authorizationGuard,
 *   WorkspaceController.create
 * );
 */
export function authorizationGuard(req: Request, res: Response, next: NextFunction) {
  // Obter handler que será executado
  const handler = (req as any).handler;
  
  if (!handler) {
    // Sem handler definido - não há restrição
    return next();
  }

  // Obter roles requeridas pelo decorator @Roles()
  const requiredRoles = getRequiredRoles(handler);

  if (!requiredRoles || requiredRoles.length === 0) {
    // Endpoint não tem restrição de role
    return next();
  }

  // Obter role do usuário do contexto da request
  const userRole = (req as any).userRole as UserRole | undefined;

  if (!userRole) {
    // Usuário não tem role atribuída
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Authentication required. No role assigned to user.'
    });
  }

  // Verificar se role do usuário está entre as permitidas
  if (!requiredRoles.includes(userRole)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: `Insufficient permissions. Required role: ${requiredRoles.join(' or ')}. Your role: ${userRole}`
    });
  }

  // Role verificada com sucesso
  next();
}

/**
 * Versão simplificada para uso inline
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).userRole as UserRole | undefined;

    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Required role: ${roles.join(' or ')}`
      });
    }

    next();
  };
}
