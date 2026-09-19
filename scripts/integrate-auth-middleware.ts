# 📋 SCRIPT DE INTEGRAÇÃO DO AUTH MIDDLEWARE NO GATEWAY

## Objetivo
Este script analisa a estrutura do gateway DSH e gera instruções para integrar o middleware de autenticação.

---

## ANÁLISE DA ESTRUTURA ATUAL

O gateway DSH (`@deepseek-ai/dsh-api-gateway`) usa:
- `TypertGatewayService` como serviço principal
- `ConnectionRpcHandler` para interceptar requests RPC
- `webServer.registerUpgrade()` para WebSocket upgrades

**Ponto de Interceptação Ideal:**
No método `dispatchRpc()` da classe `TypertGatewayService` (linha ~352).

---

## IMPLEMENTAÇÃO RECOMENDADA

### Opção A: Plugin Cordis (RECOMENDADO)

Criar um plugin que intercepta o contexto antes do gateway processar requests:

```typescript
// packages/api/auth-plugin/src/index.ts
import { Context, Service } from '@deepseek-ai/cordis';
import { authMiddleware, extractIdentityFromRequest } from '@copymonster/auth-middleware';

export class AuthPluginService extends Service {
  static inject = ['typert', 'connection'];

  constructor(ctx: Context) {
    super(ctx, 'authPlugin');

    // Intercepta todos os requests RPC
    ctx.connection.rpc.intercept(
      '/api',
      (endpoint) => true, // Intercepta todos os endpoints
      async (endpoint, payload, signal) => {
        // Extrair headers do request (se disponíveis)
        const headers = this.extractHeadersFromContext(ctx);
        
        // Aplicar middleware de auth
        const identity = await extractIdentityFromRequest(headers);
        
        if (identity) {
          // Injetar identidade no contexto para handlers usarem
          ctx.provide('identity', identity);
        }
        
        // Continuar com dispatch normal
        return { ok: true as const, value: undefined };
      }
    );
  }

  private extractHeadersFromContext(ctx: Context): Record<string, string> {
    // Implementar extração de headers do contexto Cordis
    // Isso depende de como o webserver expõe headers
    return {};
  }
}
```

### Opção B: Wrapper do WebServer

Interceptar no nível do webserver antes de chegar ao gateway:

```typescript
// packages/server/auth-webserver-wrapper/src/index.ts
import { authMiddleware } from '@copymonster/auth-middleware';

export function createAuthWrapper(originalServer: any) {
  return {
    ...originalServer,
    registerUpgrade: (route: any) => {
      const wrappedHandler = async (req: any, socket: any, head: any) => {
        // Extrair token JWT dos headers
        const authHeader = req.headers['authorization'];
        
        if (authHeader) {
          try {
            // Validar token e extrair identidade
            const identity = await authMiddleware(req);
            
            // Injetar identidade no request
            req.identity = identity;
            
            // Log para auditoria
            console.log(`[AUTH] User ${identity.userId} (${identity.role}) accessing ${req.url}`);
          } catch (error) {
            // Token inválido - rejeitar upgrade
            console.error('[AUTH] Invalid token:', error);
            socket.destroy();
            return;
          }
        }
        
        // Chamar handler original
        route.handler(req, socket, head);
      };
      
      return originalServer.registerUpgrade({
        ...route,
        handler: wrappedHandler
      });
    }
  };
}
```

### Opção C: Middleware Express/HTTP (MAIS SIMPLES)

Se houver um servidor HTTP/Express rodando antes do gateway:

```typescript
// server.ts (ponto de entrada da aplicação)
import 'reflect-metadata'; // CRÍTICO: primeiro import!
import express from 'express';
import { authMiddleware } from '@copymonster/auth-middleware';

const app = express();

// Middleware de auth para todas as rotas /api/*
app.use('/api', authMiddleware);

// Rotas protegidas exemplo
app.get('/api/workspace/list', (req, res) => {
  // Identidade disponível em req.identity
  const { userId, tenantId, role } = req.identity;
  
  // Filtrar por tenant automaticamente
  const workspaces = await getWorkspacesByTenant(tenantId);
  
  res.json(workspaces);
});

// Handlers não autenticados (públicos)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});
```

---

## PASSOS PARA IMPLEMENTAÇÃO MANUAL

### Passo 1: Escolher Estratégia
- **Desenvolvimento Local:** Opção C (mais simples)
- **Produção VPS:** Opção A ou B (integração mais profunda)

### Passo 2: Instalar Dependências
```bash
pnpm add express @types/express
```

### Passo 3: Criar Servidor Wrapper
```bash
mkdir -p packages/server/http-server/src
```

Criar arquivo `packages/server/http-server/src/index.ts`:

```typescript
import 'reflect-metadata';
import express from 'express';
import { authMiddleware, injectTenantContext } from '@copymonster/auth-middleware';

export function createCopyMonsterServer() {
  const app = express();
  
  // Parser de JSON
  app.use(express.json());
  
  // Middleware de autenticação
  app.use('/api', authMiddleware);
  app.use('/api', injectTenantContext);
  
  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  // Expor app para configuração adicional
  return app;
}
```

### Passo 4: Atualizar Package.json
```json
{
  "name": "@copymonster/http-server",
  "dependencies": {
    "express": "^4.18.0",
    "@copymonster/auth-middleware": "workspace:*"
  }
}
```

### Passo 5: Integrar com Bootstrap
No entry point da aplicação:

```typescript
// main.server.ts
import '@copymonster/bootstrap'; // Importa reflect-metadata
import { createCopyMonsterServer } from '@copymonster/http-server';

const app = createCopyMonsterServer();

// Adicionar rotas específicas aqui
// ...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 CopyMonster server running on port ${PORT}`);
});
```

---

## VERIFICAÇÃO PÓS-IMPLEMENTAÇÃO

### Teste 1: Request sem Token
```bash
curl http://localhost:3000/api/workspace/list
# Deve retornar 401 Unauthorized
```

### Teste 2: Request com Token Inválido
```bash
curl -H "Authorization: Bearer invalid-token" http://localhost:3000/api/workspace/list
# Deve retornar 401 Unauthorized
```

### Teste 3: Request com Token Válido
```bash
curl -H "Authorization: Bearer <valid-jwt>" http://localhost:3000/api/workspace/list
# Deve retornar lista de workspaces do tenant
```

### Teste 4: Verificar Logs
```bash
# Deve aparecer no console:
[AUTH] User <user-id> (member) accessing /api/workspace/list
```

---

## ARQUIVOS PARA CRIAÇÃO IMEDIATA

1. `/workspace/packages/server/http-server/package.json`
2. `/workspace/packages/server/http-server/src/index.ts`
3. `/workspace/packages/server/http-server/README.md`
4. `/workspace/examples/server-with-auth.ts` (exemplo completo)

---

## PRÓXIMOS PASSOS

1. ✅ Escolher estratégia de integração
2. ⏳ Criar pacotes necessários
3. ⏳ Implementar código de exemplo
4. ⏳ Documentar no README
5. ⏳ Testar localmente

---

*Documento gerado pelo script de análise de integração do auth middleware*
