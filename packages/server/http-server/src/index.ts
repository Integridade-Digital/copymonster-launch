/**
 * @copymonster/http-server - Servidor HTTP para produção CopyMonster
 * 
 * Este pacote fornece um servidor Express com middleware de autenticação
 * já integrado, pronto para usar em produção no VPS.
 * 
 * @example
 * // server.ts
 * import { createCopyMonsterServer } from '@copymonster/http-server';
 * 
 * const app = createCopyMonsterServer();
 * 
 * // Adicionar rotas customizadas se necessário
 * app.get('/custom-endpoint', (req, res) => {
 *   res.json({ message: 'Hello!' });
 * });
 * 
 * const PORT = process.env.PORT || 3000;
 * app.listen(PORT, () => {
 *   console.log(`🚀 CopyMonster running on port ${PORT}`);
 * });
 */

// CRÍTICO: Importar bootstrap primeiro para registrar reflect-metadata
import '@copymonster/bootstrap';

import express, { Request, Response, NextFunction } from 'express';
import {
  authMiddleware,
  injectTenantContext,
  type AuthenticatedRequest,
} from '@copymonster/auth-middleware';

/**
 * Cria uma instância do servidor HTTP CopyMonster com auth configurado
 * 
 * @returns Aplicação Express configurada
 */
export function createCopyMonsterServer(): express.Application {
  const app = express();

  // Trust proxy para obter IP real atrás do Cloudflare/NGINX
  app.set('trust proxy', true);

  // Parser de JSON para todos os requests
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ==========================================================================
  // MIDDLEWARE DE AUTENTICAÇÃO
  // ==========================================================================
  // Aplica apenas às rotas /api/*
  // Extrai user_id, tenant_id e role do token JWT
  
  app.use('/api', authMiddleware);
  
  // Injeta contexto do tenant após autenticação
  app.use('/api', injectTenantContext);

  // ==========================================================================
  // LOGGING MIDDLEWARE (apenas em development)
  // ==========================================================================
  if (process.env.NODE_ENV === 'development') {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const authenticatedReq = req as Partial<AuthenticatedRequest>;
      
      if (authenticatedReq.identity) {
        const { userId, tenantId, role } = authenticatedReq.identity!;
        console.log(`[AUTH] ${role.toUpperCase()} ${userId.slice(0, 8)}... | tenant: ${tenantId.slice(0, 8)}... | ${req.method} ${req.path}`);
      } else {
        console.log(`[ANON] ${req.method} ${req.path}`);
      }
      
      next();
    });
  }

  // ==========================================================================
  // HEALTH CHECK (público, sem auth)
  // ==========================================================================
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    });
  });

  // ==========================================================================
  // ERROR HANDLER GLOBAL
  // ==========================================================================
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('[ERROR]', err.message, err.stack);

    // Não expor detalhes do erro em produção
    const isDev = process.env.NODE_ENV === 'development';

    res.status(err instanceof Error ? 500 : 400).json({
      error: {
        message: isDev ? err.message : 'Internal server error',
        ...(isDev && { stack: err.stack }),
      },
    });
  });

  // ==========================================================================
  // 404 HANDLER
  // ==========================================================================
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: 'Not found',
      },
    });
  });

  return app;
}

/**
 * Exemplo de uso com rotas protegidas
 */
export function setupExampleRoutes(app: express.Application): void {
  // Rota pública
  app.get('/api/public/info', (_req: Request, res: Response) => {
    res.json({
      message: 'Esta é uma rota pública',
      version: '0.1.0',
    });
  });

  // Rota protegida (requer autenticação)
  app.get('/api/workspace/list', (req: Request, res: Response) => {
    const authenticatedReq = req as AuthenticatedRequest;
    
    // Identidade injetada pelo middleware
    const { userId, tenantId, role } = authenticatedReq.identity!;

    // TODO: Implementar lógica real de listagem de workspaces
    // Filtrando automaticamente por tenant_id
    const workspaces = [
      { id: '1', name: 'Workspace 1', tenantId },
      { id: '2', name: 'Workspace 2', tenantId },
    ];

    res.json({
      workspaces,
      requestedBy: userId,
      tenantId,
      userRole: role,
    });
  });

  // Rota administrativa (requer role admin ou owner)
  app.get('/api/admin/users', (req: Request, res: Response) => {
    const authenticatedReq = req as AuthenticatedRequest;
    const { role } = authenticatedReq.identity!;

    // Verificação de role
    if (!['owner', 'admin'].includes(role)) {
      return res.status(403).json({
        error: {
          message: 'Forbidden: admin or owner role required',
        },
      });
    }

    // TODO: Implementar listagem real de usuários
    res.json({
      users: [
        { id: '1', email: 'user@example.com', role: 'member' },
        { id: '2', email: 'admin@example.com', role: 'admin' },
      ],
    });
  });
}

// Auto-inicialização se executado diretamente
if (require.main === module) {
  const app = createCopyMonsterServer();
  setupExampleRoutes(app);

  const PORT = parseInt(process.env.PORT || '3000', 10);
  
  app.listen(PORT, () => {
    console.log(`🚀 CopyMonster HTTP server running on port ${PORT}`);
    console.log(`   ├─ Health check: http://localhost:${PORT}/health`);
    console.log(`   ├─ API prefix: /api/*`);
    console.log(`   └─ Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}
