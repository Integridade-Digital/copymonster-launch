‎# 🚀 Roadmap: Transformação do DSH em SaaS Multi-Tenant CopyMonster
**Projeto:** CopyMonster - Integridade Digital  
**Objetivo:** Transformar o DeepSeek Harness (DSH) em um SaaS multi-tenant de copywriting e funis de lançamento para infoprodutores  
**Data de Criação:** 2025  
**Status:** Em Planejamento
---
## 📋 VISÃO GERAL DO PROJETO
O CopyMonster será operado pela **Integridade Digital** e terá dois níveis de gestão:
### Nível Administrativo (Integridade Digital)
O admin vê e controla tudo:
- ✅ Gestão de provedores de LLM
- ✅ Configuração de modelos
- ✅ Listagem de usuários
- ✅ Listagem de tenants
- ✅ Configuração do sistema
- ✅ Raiz de instalação do servidor
- ✅ Workspaces do servidor
- ✅ Filesystem
- ✅ Histórico de sessões de todos os usuários
- ✅ Métricas globais
- ✅ Auditoria
- ✅ Painel administrativo completo
### Nível de Usuário Comum (Clientes do SaaS)
O usuário vê apenas o próprio conteúdo:
- ✅ Próprias sessões de chat
- ✅ Próprios dados do tenant ao qual pertence
- ✅ Própria assinatura
- ✅ Próprio histórico
**NÃO tem acesso a:**
- ❌ Gestão de provedores de LLM
- ❌ Configuração de modelos
- ❌ Raiz de instalação do servidor
- ❌ Workspaces do servidor
- ❌ Filesystem
- ❌ Histórico de outros usuários
- ❌ Painel administrativo
- ❌ Listagem de usuários
- ❌ Listagem de tenants
---
## 👥 NÍVEIS DE ROLE
Existem quatro níveis de role:
| Role | Descrição | Acesso |
|------|-----------|--------|
| `owner` | Proprietário da Integridade Digital | Acesso total administrativo |
| `admin` | Administrador da Integridade Digital | Acesso administrativo completo |
| `member` | Usuário comum (cliente do SaaS) | Apenas próprio conteúdo |
| `anonymous` | Visitante não autenticado | Acesso limitado/none |
---
## 🗺️ ROADMAP DAS 5 FASES
### Fase 1: Fundação de Identidade (Semanas 1-2)
- [ ] Integração com Supabase Auth (OAuth + Email/Senha)
- [ ] Schema do banco: users, tenants, user_tenant_roles
- [ ] Middleware de extração de identidade (user_id, tenant_id, role)
- [ ] Autenticação no frontend (useAuth, ProtectedRoute)
- [ ] Seed inicial do primeiro tenant "Integridade Digital"
- [ ] Primeiro usuário logado recebe role `owner` automaticamente
### Fase 2: Isolamento por Tenant (Semanas 3-4)
- [ ] Adicionar tenant_id a todas as tabelas relevantes
- [ ] Implementar RLS Policies no Supabase
- [ ] Filtrar todas as queries por tenant_id no backend
- [ ] Testar vazamento de dados entre tenants
- [ ] Migrar dados existentes para o novo schema
### Fase 3: Sistema de Roles RBAC (Semanas 5-6)
- [ ] Implementar guards/decorators para roles
- [ ] Proteger endpoints administrativos (owner/admin apenas)
- [ ] Condicionar UI do frontend por role
- [ ] Ocultar menus administrativos para members
- [ ] Implementar verificação de permissão em ações críticas
### Fase 4: Painel Administrativo Completo (Semanas 7-8)
- [ ] Página de gestão de usuários (CRUD)
- [ ] Página de gestão de tenants (CRUD)
- [ ] Página de configuração global de provedores LLM
- [ ] Página de auditoria de ações
- [ ] Dashboard de métricas globais
- [ ] Visualização de workspaces do servidor
- [ ] Visualização de filesystem do servidor
- [ ] Histórico de sessões de todos os usuários
### Fase 5: Monetização com Stripe (Semanas 9-10)
- [ ] Integração com Stripe Checkout
- [ ] Integração com Stripe Customer Portal
- [ ] Webhooks de subscription (create, update, cancel)
- [ ] Tabela de subscriptions no banco
- [ ] Página de planos no frontend
- [ ] Limits por plano (tokens, sessões, workspaces)
- [ ] Políticas de URL no Supabase para controle de acesso por plano
---
# 📘 FASE 1: FUNDAÇÃO DE IDENTIDADE COM SUPABASE AUTH
## 🎯 OBJETIVO DA FASE
Criar toda a infraestrutura de autenticação e identidade do zero, permitindo que:
- Usuários possam fazer login via OAuth (Google/GitHub) ou email/senha
- Cada request carregue consigo `user_id`, `tenant_id` e `role`
- O sistema saiba QUEM está fazendo O QUE
- Estejamos prontos para isolar dados por tenant na Fase 2
---
## 📋 ENTREGÁVEIS DA FASE 1
### 1.0 Princípios de Design e Identidade Visual
**Regra fundamental:** Todas as novas páginas DEVEM herdar o layout original existente.
**O que será mantido:**
- Paleta de cores atual do DSH
- Tipografia e escalas existentes
- Componentes de UI do sistema de design atual
- Estrutura de layout (sidebar, header, content area)
- Responsividade e breakpoints existentes
**Implementação:**
- Novos componentes usarão os mesmos providers de tema
- Páginas de auth usarão o mesmo `ThemeProvider` existente
- Botões, inputs e cards seguirão o estilo atual
- Nenhuma introdução de novas dependências de UI
---
### 1.1 Schema do Supabase (Banco de Dados)
**Arquivo:** `/workspace/supabase/migrations/001_initial_identity.sql`
**Tabelas propostas:**
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
**Variáveis de ambiente necessárias (.env):**
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
**Contexto tipado exemplo:**
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
### 1.4 Rotas de Autenticação e Fluxo de Usuário
**Localização:** `/workspace/apps/web/src/routes/` (ou estrutura de rotas existente)
**Novas rotas a serem criadas:**
| Rota | Descrição | Acesso | Comportamento |
|------|-----------|--------|---------------|
| `/` | Chat público | Público | Visitante digita → Se logado, processa. Se não, redireciona `/register` |
| `/register` | Registro de nova conta | Público | Formulário: Nome, E-mail, WhatsApp (intl), Senha |
| `/login` | Login de usuário existente | Público | Formulário: E-mail, Senha |
| `/forgot-password` | Recuperação de senha | Público | Formulário: E-mail |
| `/reset-password` | Redefinição de senha | Público (com token) | Formulário: Nova senha (via token do email) |
**Comportamento da rota raiz `/`:**
```typescript
// Pseudo-código do fluxo
async function handleSendMessage(message: string) {
  const { user } = useAuth();
  
  if (!user || !user.isActive) {
    // Redireciona para registro preservando a mensagem
    navigate('/register', { state: { pendingMessage: message } });
    return;
  }
  
  // Usuário logado e ativo → processa mensagem
  await processMessage(message);
}
```
**Campos do formulário de registro (`/register`):**
- `full_name` (obrigatório)
- `email` (obrigatório, validação de formato)
- `whatsapp` (obrigatório, formato internacional ex: +5511999999999)
- `password` (obrigatório, mín. 8 caracteres, 1 número, 1 letra)
- `confirm_password` (obrigatório, deve matcher com password)
- Checkbox: "Li e concordo com os Termos de Uso" (obrigatório)
**Integração com Supabase Auth:**
- Registro cria usuário em `auth.users` + tabela `users` + tenant padrão
- Login via email/senha ou OAuth (Google/GitHub se configurado)
- Forgot password envia email via Supabase Auth
- Reset password usa token de reset do Supabase
---
### 1.5 Integração Supabase Auth no Frontend
**Localização:** `/workspace/apps/web/src/lib/auth/`
**Implementação:**
- Provider React para estado de autenticação herdando tema atual
- Hook `useAuth()` para acessar usuário atual
- Componente `<AuthProvider>` para envolver a aplicação
- Login via email/senha (obrigatório) + OAuth opcional (Google/GitHub)
- Logout e refresh de token
- Persistência de sessão no localStorage
- Validação de formulário com mesmo estilo dos inputs existentes
**Componentes novos:**
```tsx
// /workspace/apps/web/src/components/auth/LoginForm.tsx
// Formulário de login com email/senha - herda estilo atual
// /workspace/apps/web/src/components/auth/RegisterForm.tsx
// Formulário de registro com todos os campos - herda estilo atual
// /workspace/apps/web/src/components/auth/ForgotPasswordForm.tsx
// Formulário de recuperação de senha
// /workspace/apps/web/src/components/auth/ResetPasswordForm.tsx
// Formulário de redefinição de senha com token
// /workspace/apps/web/src/components/auth/ProtectedRoute.tsx
// Wrapper para rotas que exigem autenticação
// /workspace/apps/web/src/hooks/useAuth.ts
// Hook para estado de autenticação
```
**Estilização:**
- Todos os formulários usarão os mesmos componentes de input do sistema atual
- Cores, bordas, sombras e tipografia idênticas ao restante da aplicação
- Botões seguirão o mesmo padrão dos botões existentes
- Layout responsivo mantendo breakpoints atuais
---
### 1.6 Seed Inicial de Dados (Primeiro Tenant e Admin)
**Script:** `/workspace/scripts/seed-initial-tenant.ts`
**O que o script fará:**
1. Criar tenant "Integridade Digital" (slug: `integridade-digital`)
2. Identificar primeiro usuário que logar como owner deste tenant
3. Atribuir role `owner` automaticamente para o primeiro usuário
4. Registrar no log que o seed foi executado
**Execução:**
- Script rodará uma vez após o deploy inicial
- Ou via comando CLI: `pnpm dsh seed-tenant`
---
### 1.6 Testes e Validação da Fase 1
**Testes a serem implementados:**
| Teste | Descrição | Critério de Sucesso |
|-------|-----------|---------------------|
| `auth-middleware.spec.ts` | Middleware extrai identidade corretamente | Token válido → identity injetada |
| `auth-middleware-invalid-token.spec.ts` | Middleware rejeita token inválido | Token inválido → 401 Unauthorized |
| `identity-extractor.spec.ts` | Extração de tenant_id e role funciona | Usuário tem role correta |
| `frontend-auth-flow.spec.ts` | Login OAuth funciona no frontend | Redireciona após login |
| `protected-route.spec.ts` | Rotas protegidas bloqueiam anônimos | 403 para não autenticados |
---
## 🔐 CONFIGURAÇÃO DO SUPABASE (Pré-requisitos)
**Configuração manual necessária no dashboard do Supabase:**
### 1. Habilitar provedores OAuth:
- Ir para **Authentication → Providers**
- Habilitar Google (requer OAuth Client ID e Secret)
- Habilitar GitHub (requer OAuth Client ID e Secret)
- Configurar redirect URLs: `https://seu-dominio.com/auth/v1/callback`
### 2. Configurar políticas de segurança (RLS) - **Fase 2**:
- Por enquanto, RLS ficará desabilitado
- Será habilitado na Fase 2 com as policies corretas
### 3. Obter chaves de API:
- **Settings → API**
- Copiar `anon public key`
- Copiar `service_role key` (manter em segredo!)
---
## 📁 ARQUIVOS QUE SERÃO CRIADOS/MODIFICADOS NA FASE 1
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
/workspace/apps/web/src/components/auth/LoginForm.tsx
/workspace/apps/web/src/components/auth/RegisterForm.tsx
/workspace/apps/web/src/components/auth/ForgotPasswordForm.tsx
/workspace/apps/web/src/components/auth/ResetPasswordForm.tsx
/workspace/apps/web/src/pages/RegisterPage.tsx
/workspace/apps/web/src/pages/LoginPage.tsx
/workspace/apps/web/src/pages/ForgotPasswordPage.tsx
/workspace/apps/web/src/pages/ResetPasswordPage.tsx
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
## ⚠️ RISCOS E MITIGAÇÕES DA FASE 1
| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Mudança no schema depois | Quebra migrations futuras | Revisar schema cuidadosamente antes de criar |
| Token JWT expirar durante sessão | Usuário é deslogado inesperadamente | Implementar refresh token automático |
| OAuth não funcionar no primeiro teste | Bloqueia testes de login | Ter fallback email/senha habilitado |
| Vazamento de service_role_key | Compromete todo banco | Usar .env.local, nunca commitar |
| Performance da query de identidade | Lentidão em cada request | Adicionar índices, cache em memória |
---
## ✅ CRITÉRIOS DE APROVAÇÃO DA FASE 1
Para considerar a Fase 1 completa, todos os itens abaixo devem estar funcionando:
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
## 🚀 PRÓXIMOS PASSOS APÓS APROVAÇÃO DA FASE 1
Uma vez aprovada esta fase, a implementação seguirá esta ordem:
1. **Passo 1:** Criar arquivo de migration SQL
2. **Passo 2:** Criar pacote `supabase-client` no backend
3. **Passo 3:** Criar pacote `auth-middleware` no backend
4. **Passo 4:** Integrar autenticação no frontend (mantendo identidade visual atual)
5. **Passo 5:** Criar páginas de auth (/register, /login, /forgot-password, /reset-password)
6. **Passo 6:** Implementar fluxo de redirecionamento na rota raiz `/`
7. **Passo 7:** Criar script de seed inicial
8. **Passo 8:** Implementar testes
9. **Passo 9:** Validar tudo funcionando junto
**Importante:** Não implementarei nada até você dar **APROVAÇÃO EXPLÍCITA** deste plano.
---
## 📊 STATUS DO PROJETO
| Fase | Status | Data Início | Data Fim |
|------|--------|-------------|----------|
| Fase 1: Identidade | 📋 Planejamento | - | - |
| Fase 2: Isolamento Tenant | ⏳ Pendente | - | - |
| Fase 3: Sistema de Roles | ⏳ Pendente | - | - |
| Fase 4: Painel Admin | ⏳ Pendente | - | - |
| Fase 5: Monetização Stripe | ⏳ Pendente | - | - |
---
## 📝 HISTÓRICO DE REVISÕES
| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2025 | 1.0 | Criação do roadmap completo das 5 fases | Integridade Digital |
---
**Próxima Ação:** Aguardar aprovação explícita para iniciar implementação da Fase 1.
**Contato:** Integridade Digital - CopyMonster Team
