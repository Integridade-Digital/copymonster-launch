/**
 * @copymonster/bootstrap - Bootstrap server para produção CopyMonster
 * 
 * Este pacote garante que reflect-metadata seja importado ANTES de qualquer
 * decorator ser usado, habilitando o sistema de autorização baseado em roles.
 * 
 * @example
 * // No entry point da sua aplicação servidor:
 * import '@copymonster/bootstrap';
 * 
 * // Agora decorators @Roles() funcionarão corretamente
 */

// ============================================================================
// CRÍTICO: Import MUST be first - before any decorators are used
// ============================================================================
import 'reflect-metadata';

// ============================================================================
// Re-exportar módulos de autenticação para conveniência
// ============================================================================
export {
  authMiddleware,
  extractIdentityFromRequest,
} from '@copymonster/auth-middleware';

export {
  injectTenantContext,
  hasTenantContext,
  getTenantContext,
} from '@copymonster/auth-middleware';

export {
  authorizationGuard,
  requireRole,
  Roles,
  getRequiredRoles,
} from '@copymonster/auth-middleware';

export type {
  IdentityContext,
  AuthenticatedRequest,
  Role,
} from '@copymonster/auth-middleware';

// ============================================================================
// Re-exportar Cordis para compatibilidade com DSH original
// ============================================================================
export * from '@deepseek-ai/cordis';

// ============================================================================
// Utilitários de bootstrap
// ============================================================================

/**
 * Inicializa o ambiente de produção CopyMonster
 * Deve ser chamado no início do script de inicialização do servidor
 * 
 * @param options - Opções de configuração
 */
export function bootstrapCopyMonster(options?: {
  enableAuthMiddleware?: boolean;
  enableTenantIsolation?: boolean;
  enableRoleAuthorization?: boolean;
}): void {
  const config = {
    enableAuthMiddleware: true,
    enableTenantIsolation: true,
    enableRoleAuthorization: true,
    ...options,
  };

  // Log de inicialização (apenas em development)
  if (process.env.NODE_ENV === 'development') {
    console.log('🚀 CopyMonster Bootstrap initialized');
    console.log('   ├─ reflect-metadata: loaded ✓');
    console.log(`   ├─ Auth Middleware: ${config.enableAuthMiddleware ? 'enabled' : 'disabled'}`);
    console.log(`   ├─ Tenant Isolation: ${config.enableTenantIsolation ? 'enabled' : 'disabled'}`);
    console.log(`   └─ Role Authorization: ${config.enableRoleAuthorization ? 'enabled' : 'disabled'}`);
  }
}

// ============================================================================
// Auto-inicialização quando importado como módulo principal
// ============================================================================
if (require.main === module) {
  bootstrapCopyMonster();
  console.log('✅ CopyMonster bootstrap running in standalone mode');
}
