# 🚀 CopyMonster - Plano de Transformação SaaS Multi-Tenant

**Projeto:** DeepSeek Harness (DSH) → CopyMonster  
**Empresa:** Integridade Digital  
**Data:** 2025-01-XX  
**Status:** Em Planejamento  

---

## 📋 VISÃO GERAL DO PROJETO

O CopyMonster é um SaaS de copywriting e funis de lançamento para infoprodutores, construído a partir de um fork do DeepSeek Harness (DSH). O produto operará em dois níveis de gestão:

### Nível Administrativo (Integridade Digital)
- Gestão de provedores de LLM
- Configuração de modelos
- Listagem de usuários e tenants
- Configuração do sistema
- Raiz de instalação do servidor
- Workspaces do servidor
- Filesystem
- Histórico de sessões de todos os usuários
- Métricas globais
- Auditoria
- Painel administrativo completo

### Nível de Usuário Comum (Clientes do SaaS)
- Próprias sessões de chat
- Próprios dados do tenant
- Própria assinatura
- Próprio histórico
- **NÃO vê:** gestão de provedores, configuração de modelos, raiz do servidor, workspaces do servidor, filesystem, histórico de outros usuários, painel admin, listagem de usuários/tenants

### Sistema de Roles
| Role | Descrição | Acesso |
|------|-----------|--------|
| `owner` | Proprietário da conta | Acesso total administrativo |
| `admin` | Administrador operacional | Acesso administrativo limitado |
| `member` | Usuário comum | Apenas próprio conteúdo |
| `anonymous` | Visitante não autenticado | Acesso público limitado |

---

## 📊 RESUMO EXECUTIVO DA ANÁLISE DO CÓDIGO ATUAL

### Estado Atual do Fork DSH

O projeto analisado é um monorepo do DeepSeek Harness (DSH) versão 0.1.6-alpha.2, estruturado em `packages/`, `apps/` e `vendor/`. 

**CONCLUSÃO CRÍTICA:** Este NÃO é um fork com multi-tenancy implementado — é o projeto base original sem separação de níveis administrativos vs. usuário comum.

### Lacunas Identificadas

| Componente | Status | Observação |
|------------|--------|------------|
| Modelo de tenant | ❌ Inexistente | Nenhuma tabela, schema ou conceito de tenant |
| Sistema de roles | ❌ Inexistente | Nenhum middleware, guard ou verificação de role |
| Autenticação Supabase | ❌ Inexistente | Nenhum código de integração |
| Integração Stripe | ❌ Inexistente | Nenhum webhook, customer, subscription |
| Banco de dados relacional | ❌ Inexistente | Apenas storage JSON file-based |
| Painel administrativo | ❌ Inexistente | Nenhuma página admin |
| Filtro por tenant | ❌ Inexistente | Controllers não filtram por tenant |
| RLS policies | ❌ Inexistente | Sem políticas de segurança por linha |

### O Que Já Existe (DSH Original)

- ✅ Sistema de sessões e histórico (mas sem isolamento)
- ✅ Gerenciamento de workspaces (mas sem tenant)
- ✅ Configuração de modelos LLM (mas global, não por tenant)
- ✅ Filesystem access (mas sem restrição)
- ✅ Sistema de plugins/extensões
- ✅ Sistema de autorização para credenciais LLM (OAuth/API keys) — **NÃO É RBAC**

### Riscos Críticos

1. **Listagem de workspaces** retorna paths absolutos do servidor sem filtragem
2. **Histórico de sessões** expõe todas as sessões de todos os usuários
3. **Configuração de provedores LLM** é global, não isolada por tenant
4. **Filesystem access** pode ler qualquer arquivo acessível pelo processo
5. **Nenhuma proteção** contra vazamento de dados entre usuários

---

## 🗺️ ROADMAP DAS 5 FASES

### Fase 1: Fundação de Identidade (Semanas 1-2)
- Integrar Supabase Auth
- Criar tabelas users, tenants, user_tenant_roles
- Implementar middleware de extração de identidade
- Adicionar migration script

### Fase 2: Isolamento por Tenant (Semanas 3-4)
- Adicionar tenant_id a todas as tabelas relevantes
- Implementar RLS policies no Supabase
- Adicionar filtro por tenant em todos os controllers
- Testar vazamento de dados entre tenants

### Fase 3: Sistema de Roles RBAC (Semanas 5-6)
- Implementar guards/decorators para roles
- Proteger endpoints administrativos
- Adicionar condicionamento de UI no frontend por role
- Ocultar menus administrativos para members

### Fase 4: Painel Administrativo Completo (Semanas 7-8)
- Criar páginas de gestão de usuários
- Criar páginas de gestão de tenants
- Criar página de configuração global de provedores LLM
- Implementar logging de auditoria
- Dashboard de métricas globais

### Fase 5: Monetização com Stripe (Semanas 9-10)
- Integrar Stripe Checkout/Portal
- Implementar webhooks de subscription
- Criar página de planos no frontend
- Adicionar limits por plano (tokens, sessões, etc.)
- Políticas de URL no Supabase

---

# 📘 FASE 1: FUNDAÇÃO DE IDENTIDADE COM SUPABASE AUTH
## Plano de Implementação Detalhado

### 🎯 OBJETIVO DA FASE
Criar toda a infraestrutura de autenticação e identidade do zero, permitindo que:
- Usuários possam fazer login via OAuth (Google/GitHub) ou email/senha
- Cada request carregue consigo `user_id`, `tenant_id` e `role`
- O sistema saiba QUEM está fazendo O QUE
- Estejamos prontos para isolar dados por tenant na Fase 2

---

## 📋 ENTREGÁVEIS DA FASE 1

### 1.1 Schema do Supabase (Banco de Dados)

**Arquivo:** `/workspace/supabase/migrations/001_initial_identity.sql`

**Tabelas:**

```sql
-- Tabela de tenants (empresas/clientes do SaaS)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL, -- para URL amigável
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Tabela de usuários (vinculada ao auth.users do Supabase)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Tabela de associação usuário-tenant com roles
CREATE TABLE user_tenant_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'anonymous')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tenant_id)
);

-- Tabela de sessões de aplicação (para rastrear sessões ativas)
CREATE TABLE app_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_user_tenant_roles_user ON user_tenant_roles(user_id);
CREATE INDEX idx_user_tenant_roles_tenant ON user_tenant_roles(tenant_id);
CREATE INDEX idx_app_sessions_token ON app_sessions(token_hash);
CREATE INDEX idx_app_sessions_user ON app_sessions(user_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_tenant_roles_updated_at BEFORE UPDATE ON user_tenant_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

### 1.2 Configuração do Cliente Supabase no Backend

**Pacote:** `/workspace/packages/server/supabase-client/`

**Estrutura:**
```
/workspace/packages/server/supabase-client/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Export público
│   ├── supabase.client.ts    # Cliente admin (service role)
│   ├── supabase.types.ts     # Tipos gerados
│   └── config/
│       └── supabase.config.ts # Variáveis de ambiente
```

**Variáveis de ambiente (.env):**
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Implementação:**
- Singleton do cliente Supabase para o backend
- Tipagem automática das tabelas
- Validação das variáveis de ambiente no boot

---

### 1.3 Middleware de Autenticação no Backend

**Pacote:** `/workspace/packages/api/auth-middleware/`

**Estrutura:**
```
/workspace/packages/api/auth-middleware/
├── package.json
├── src/
│   ├── index.ts
│   ├── auth.middleware.ts      # Extrai token do request
│   ├── identity-extractor.ts   # Extrai user_id, tenant_id, role
│   ├── request-context.ts      # Contexto tipado por request
│   └── types/
│       └── auth.types.ts       # Tipos de identidade
```

**Fluxo do middleware:**
1. Extrai token JWT do header `Authorization: Bearer <token>`
2. Valida token com Supabase
3. Busca `user_id` do token
4. Consulta tabela `user_tenant_roles` para obter `tenant_id` e `role`
5. Injeta no contexto do request: `ctx.identity = { userId, tenantId, role }`

**Contexto tipado:**
```typescript
interface RequestContext {
  identity?: {
    userId: string;
    tenantId: string;
    role: 'owner' | 'admin' | 'member' | 'anonymous';
    email: string;
  };
  // ... resto do contexto atual
}
```

---

### 1.4 Integração Supabase Auth no Frontend

**Localização:** `/workspace/apps/web/src/lib/auth/`

**Componentes:**
```tsx
// /workspace/apps/web/src/components/auth/LoginButton.tsx
// Botão de login com provedores OAuth

// /workspace/apps/web/src/components/auth/ProtectedRoute.tsx
// Wrapper para rotas que exigem autenticação

// /workspace/apps/web/src/hooks/useAuth.ts
// Hook para estado de autenticação
```

**Implementação:**
- Provider React para estado de autenticação
- Hook `useAuth()` para acessar usuário atual
- Componente `<AuthProvider>` para envolver a aplicação
- Login via OAuth (Google/GitHub) configurado no Supabase
- Logout e refresh de token
- Persistência de sessão no localStorage

---

### 1.5 Seed Inicial de Dados

**Script:** `/workspace/scripts/seed-initial-tenant.ts`

**Funcionalidades:**
1. Criar tenant "Integridade Digital" (slug: `integridade-digital`)
2. Identificar primeiro usuário que logar como owner deste tenant
3. Atribuir role `owner` automaticamente para o primeiro usuário
4. Registrar no log que o seed foi executado

**Execução:**
```bash
pnpm dsh seed-tenant
```

---

### 1.6 Testes e Validação

**Testes a implementar:**

| Teste | Descrição | Critério de Sucesso |
|-------|-----------|---------------------|
| `auth-middleware.spec.ts` | Middleware extrai identidade corretamente | Token válido → identity injetada |
| `auth-middleware-invalid-token.spec.ts` | Middleware rejeita token inválido | Token inválido → 401 Unauthorized |
| `identity-extractor.spec.ts` | Extração de tenant_id e role funciona | Usuário tem role correta |
| `frontend-auth-flow.spec.ts` | Login OAuth funciona no frontend | Redireciona após login |
| `protected-route.spec.ts` | Rotas protegidas bloqueiam anônimos | 403 para não autenticados |

---

## 🔐 CONFIGURAÇÃO DO SUPABASE (Pré-requisitos)

### 1. Habilitar provedores OAuth:
- Ir para **Authentication → Providers**
- Habilitar Google (requer OAuth Client ID e Secret)
- Habilitar GitHub (requer OAuth Client ID e Secret)
- Configurar redirect URLs: `https://seu-dominio.com/auth/v1/callback`

### 2. Configurar políticas de segurança (RLS):
- Por enquanto, RLS ficará desabilitado
- Será habilitado na Fase 2 com as policies corretas

### 3. Obter chaves de API:
- **Settings → API**
- Copiar `anon public key`
- Copiar `service_role key` (manter em segredo!)

---

## 📁 ARQUIVOS QUE SERÃO CRIADOS/MODIFICADOS

### Novos arquivos:
```
/workspace/supabase/migrations/001_initial_identity.sql
/workspace/packages/server/supabase-client/package.json
/workspace/packages/server/supabase-client/src/index.ts
/workspace/packages/server/supabase-client/src/supabase.client.ts
/workspace/packages/server/supabase-client/src/supabase.types.ts
/workspace/packages/server/supabase-client/src/config/supabase.config.ts
/workspace/packages/api/auth-middleware/package.json
/workspace/packages/api/auth-middleware/src/index.ts
/workspace/packages/api/auth-middleware/src/auth.middleware.ts
/workspace/packages/api/auth-middleware/src/identity-extractor.ts
/workspace/packages/api/auth-middleware/src/request-context.ts
/workspace/packages/api/auth-middleware/src/types/auth.types.ts
/workspace/apps/web/src/lib/auth/auth.provider.tsx
/workspace/apps/web/src/lib/auth/use-auth.ts
/workspace/apps/web/src/lib/auth/protected-route.tsx
/workspace/apps/web/src/components/auth/LoginButton.tsx
/workspace/scripts/seed-initial-tenant.ts
/workspace/.env.example (atualizar com vars do Supabase)
```

### Arquivos modificados:
```
/workspace/apps/web/src/main.tsx (adicionar AuthProvider)
/workspace/packages/boot/src/bootstrap.ts (inicializar cliente Supabase)
/workspace/packages/context/src/cordis.ts (adicionar identidade ao contexto)
/workspace/package.json (adicionar scripts de migration)
```

---

## ⚠️ RISCOS E MITIGAÇÕES

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Mudança no schema depois | Quebra migrations futuras | Revisar schema cuidadosamente antes de criar |
| Token JWT expirar durante sessão | Usuário é deslogado inesperadamente | Implementar refresh token automático |
| OAuth não funcionar no primeiro teste | Bloqueia testes de login | Ter fallback email/senha habilitado |
| Vazamento de service_role_key | Compromete todo banco | Usar .env.local, nunca commitar |
| Performance da query de identidade | Lentidão em cada request | Adicionar índices, cache em memória |

---

## ✅ CRITÉRIOS DE APROVAÇÃO DA FASE 1

- [ ] Migration do schema executada com sucesso no Supabase
- [ ] Cliente Supabase configurado e conectado no backend
- [ ] Middleware de autenticação extrai `user_id`, `tenant_id`, `role`
- [ ] Login OAuth (Google/GitHub) funciona no frontend
- [ ] Hook `useAuth()` retorna dados do usuário logado
- [ ] Rotas protegidas bloqueiam usuários não autenticados
- [ ] Primeiro tenant "Integridade Digital" criado via seed
- [ ] Primeiro usuário logado recebe role `owner` automaticamente
- [ ] Tests de autenticação passando (coverage > 80%)
- [ ] Documentação atualizada com setup do Supabase

---

## 🚀 PRÓXIMOS PASSOS APÓS APROVAÇÃO

1. **Passo 1:** Criar arquivo de migration SQL
2. **Passo 2:** Criar pacote `supabase-client` no backend
3. **Passo 3:** Criar pacote `auth-middleware` no backend
4. **Passo 4:** Integrar autenticação no frontend
5. **Passo 5:** Criar script de seed inicial
6. **Passo 6:** Implementar testes
7. **Passo 7:** Validar tudo funcionando junto

---

## 📝 HISTÓRICO DE REVISÕES

| Versão | Data | Autor | Descrição |
|--------|------|-------|-----------|
| 1.0 | 2025-01-XX | AI Assistant | Documento inicial do plano |

---

**Aguardando aprovação para início da implementação.**
