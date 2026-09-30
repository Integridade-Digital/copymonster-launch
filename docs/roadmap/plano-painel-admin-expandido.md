# Plano de Expansão e Correção do Painel Admin — CopyMonster Launch

**Documento:** `docs/roadmap/plano-painel-admin-expandido.md`  
**Data:** 30 de Setembro de 2026  
**Status:** Proposta Técnica Corrigida — Aguardando Aprovação  
**Repositório:** `Integridade-Digital/copymonster-launch` (`master`)  

---

## 1. Visão Geral e Contexto da Expansão

O CopyMonster necessita de uma padronização arquitetural definitiva para a abertura de modais na interface (eliminando rotas espúrias para Plans, Profile e Admin) e da expansão do painel administrativo de 2 abas atuais para 9 abas completas de governança.

Este plano consolida:
1. Adoção do padrão nativo do Settings para abertura de todos os painéis auxiliares (estado local + overlay, sem `pushState`, sem rotas).
2. Limpeza integral de rotas residuais no roteador React.
3. Unificação visual dark/gold (#E7BF73, #D8AE5F, #B0955E, #FBF0DA).
4. Arquitetura, governança RBAC via `RoleGate`, modelagem de dados no Supabase com RLS estrita e esteira sequencial de implementação para as 9 abas administrativas.

---

## 2. Estrutura de Abas do Painel Admin (9 Abas)

Todas as abas serão renderizadas no modal administrativo com proteção estrita por `RoleGate` para as roles `owner` e `admin`.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ MODAL ADMIN (RoleGate: owner | admin)                                                  │
├───────┬──────────┬─────────┬──────────────┬─────────┬────────┬──────────┬───────┬──────┤
│ Visão │ Usuários │ Tenants │ LLM          │ Modelos │ Config │ Sessões  │ Audit │ Bill │
│ Geral │          │         │ Providers    │         │ Sist.  │ Globais  │       │      │
└───────┴──────────┴─────────┴──────────────┴─────────┴────────┴──────────┴───────┴──────┘
```

### 2.1 Aba 1 — Visão Geral (Dashboard Executivo)
- **Métricas Globais:** Total de usuários, tenants ativos/suspensos, sessões ativas no momento, consumo de tokens no mês, MRR (Monthly Recurring Revenue), ARR (Annual Recurring Revenue) e taxa de churn.
- **Gráficos e Séries Temporais:** Volume de tokens e requisições por dia, ranking de top tenants por consumo e distribuição de modelos mais utilizados.
- **Saúde do Sistema:** Uptime do servidor, uso de CPU e memória do processo, status das filas e latência média de resposta.
- **Fonte de Dados:** `public.metrics_daily`, agregadores em `public.sessions_index` e telemetria do host.

### 2.2 Aba 2 — Usuários
- **Listagem e Filtros:** Busca por nome/e-mail, filtro por role (`owner`, `admin`, `member`), tenant associado, status (`active`, `suspended`) e data de cadastro.
- **Ações Administrativas:**
  - Promover / rebaixar role do usuário.
  - Suspender ou reativar conta.
  - Disparar reset de senha administrativo.
  - Forçar encerramento de sessões ativas (logout forçado).
  - Visualizar lista de sessões recentes vinculadas ao usuário.
- **Fonte de Dados:** `public.users` e tabela gerenciada `auth.users` via RPC administrativa protegida.

### 2.3 Aba 3 — Tenants (Expansão da Gestão Existente)
- **Filtros e Visualização:** Filtragem por plano (Free, Starter, Pro, Enterprise), status (ativo, suspenso) e nível de consumo de cotas.
- **Ações de Gestão:** Criar novo tenant, suspender/ativar, exclusão lógica/arquivamento, migração de plano, visualização de assinatura Stripe e membros vinculados.
- **Visão Detalhada do Tenant (Drawer/Detalhe):**
  - Lista de membros e suas permissões.
  - Gráfico de uso de cotas no período corrente.
  - Histórico de sessões do tenant.
  - Configurações locais de workspaces e limites.
  - Histórico de faturamento.
- **Fonte de Dados:** `public.tenants`, `public.subscriptions`, `public.tenant_members`.

### 2.4 Aba 4 — LLM Providers
- **Catálogo de Provedores:** Suporte a DeepSeek, OpenAI, Anthropic, Google, Groq, OpenRouter e endpoints locais/customizados.
- **Configuração de Credenciais:** Cadastro e rotação de API keys armazenadas server-side com criptografia.
- **Gating por Plano:** Habilitar ou desabilitar provedores específicos conforme o plano de assinatura do tenant.
- **Diagnóstico:** Botão de teste de conectividade e validação de latência com resposta em tempo real.
- **Fonte de Dados:** `public.llm_providers`.

### 2.5 Aba 5 — Modelos
- **Catálogo Unificado:** Listagem de modelos por provedor com metadados técnicos (janela de contexto, custo de entrada/saída por 1k tokens, capacidades como raciocínio, visão, chamadas de ferramenta).
- **Controle de Acesso por Plano:** Atribuição de modelos liberados por nível de assinatura.
- **Modelo Padrão:** Definição do modelo padrão de fallback por plano.
- **Fonte de Dados:** `public.llm_models`.

### 2.6 Aba 6 — Configuração do Sistema
- **Infraestrutura do Servidor:** Exibição da raiz de instalação do servidor e diretórios de workspaces ativos.
- **Filesystem Browser Controlado:** Navegador de arquivos com guardas estritas de sandbox (somente leitura sob caminhos autorizados, bloqueio de escape para `/`, `/etc` ou segredos do sistema).
- **Feature Flags:** Chaves booleanas e parâmetros para ativação granular de novos recursos.
- **Limites Globais:** Rate limits globais por IP/token e cotas de emergência do cluster.
- **Fonte de Dados:** `public.system_config`.

### 2.7 Aba 7 — Sessões Globais
- **Histórico Unificado:** Visão consolidada de todas as sessões executadas na plataforma.
- **Filtros Avançados:** Filtro por usuário, tenant, período e modelo utilizado.
- **Visualizador de Transcripts:** Inspeção em modo somente-leitura dos nós e mensagens da sessão para auditoria e suporte.
- **Exclusão de Sessão:** Remoção com confirmação de segurança e geração obrigatória de registro na trilha de auditoria.
- **Fonte de Dados:** `public.sessions_index`.

### 2.8 Aba 8 — Auditoria (Expansão da Trilha Existente)
- **Filtros Avançados:** Filtragem combinada por tipo de ação (`CREATE`, `UPDATE`, `DELETE`, `AUTH`), recurso afetado, tenant, usuário executor e intervalo de datas.
- **Exportação de Dados:** Exportação dos registros filtrados nos formatos CSV e JSON.
- **Políticas de Retenção:** Visualização do período de retenção configurado.
- **Fonte de Dados:** `public.audit_logs`.

### 2.9 Aba 9 — Billing e Assinaturas
- **Gestão de Assinaturas:** Listagem de assinaturas agrupadas por status (`active`, `trialing`, `past_due`, `canceled`).
- **Operações Financeiras:** Visualização de faturas emitidas via Stripe, processamento de cancelamentos/reembolsos e aplicação de cupons e descontos promocionais.
- **Fonte de Dados:** `public.subscriptions` sincronizado via Webhooks do Stripe.

---

## 3. Matriz de Níveis de Role e Segurança

### 3.1 Níveis de Acesso
- **`owner`:** Acesso irrestrito a todas as 9 abas do painel admin, gestão financeira completa, troca de chaves e configuração do sistema.
- **`admin`:** Acesso administrativo operacional a todas as abas, gestão de usuários, tenants, modelos e auditoria.
- **`member`:** Acesso restrito ao seu próprio workspace, sessões próprias e visualização da assinatura do seu próprio tenant.
- **`anonymous`:** Nenhum acesso administrativo nem operacional; redirecionamento obrigatório para login/auth.

### 3.2 Regra Rígida de Isolamento (Guarda de Member)
O usuário com role `member` **NUNCA** terá permissão de visualizar, requisitar ou receber metadados de:
- Provedores LLM e suas API keys.
- Catálogo interno de modelos e custos.
- Configurações do sistema, caminhos de filesystem, instalação ou workspaces de terceiros.
- Sessões ou transcrições de outros usuários e tenants.
- Estrutura do painel admin, listagem global de usuários ou listagem de tenants.

Essa guarda é aplicada em duas camadas:
1. **Frontend:** Bloqueio via `RoleGate` impedindo montagem dos componentes.
2. **Backend/Database:** Políticas RLS e RPCs que rejeitam a execução com erro de autorização caso o token JWT não pertença a `owner` ou `admin`.

---

## 4. Integração Supabase — Modelagem e RLS

### 4.1 Tabelas Existentes
- `public.users`
- `public.tenants`
- `public.tenant_members`
- `public.subscriptions`
- `public.audit_logs`

### 4.2 Novas Tabelas a Criar (Migrations)
1. **`public.llm_providers`**
   - Colunas: `id` (uuid), `name` (text), `provider_type` (text), `api_key_encrypted` (text), `base_url` (text), `is_active` (boolean), `allowed_plans` (text[]), `created_at` (timestamptz), `updated_at` (timestamptz).
2. **`public.llm_models`**
   - Colunas: `id` (uuid), `provider_id` (uuid references llm_providers), `model_id` (text), `display_name` (text), `context_window` (integer), `cost_input_1k` (numeric), `cost_output_1k` (numeric), `capabilities` (jsonb), `is_default_for_plans` (text[]), `allowed_plans` (text[]), `created_at` (timestamptz).
3. **`public.system_config`**
   - Colunas: `key` (text primary key), `value` (jsonb), `description` (text), `is_secret` (boolean), `updated_at` (timestamptz), `updated_by` (uuid references users).
4. **`public.sessions_index`**
   - Colunas: `id` (text primary key), `tenant_id` (uuid references tenants), `user_id` (uuid references users), `title` (text), `model_used` (text), `tokens_total` (integer), `status` (text), `created_at` (timestamptz), `updated_at` (timestamptz).
5. **`public.metrics_daily`**
   - Colunas: `id` (uuid), `date` (date unique), `active_users` (integer), `active_tenants` (integer), `tokens_consumed` (bigint), `estimated_mrr` (numeric), `new_subscriptions` (integer), `canceled_subscriptions` (integer), `created_at` (timestamptz).

### 4.3 Políticas RLS (Row Level Security)
- **Tabelas de Infraestrutura (`llm_providers`, `llm_models`, `system_config`, `metrics_daily`):**
  - `owner` e `admin`: Acesso total (SELECT, INSERT, UPDATE, DELETE).
  - `member` e `anonymous`: `DENY ALL` (bloqueio total no banco).
- **Tabela de Índices Globais (`sessions_index`):**
  - `owner` e `admin`: SELECT e DELETE irrestritos.
  - `member`: SELECT restrito a `auth.uid() = user_id` e tenant ao qual pertence.
  - `anonymous`: `DENY ALL`.

---

## 5. Sequenciamento dos Blocos de Execução

```
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 1 — Análise do padrão Settings (modal nativo)                    │
│ • Investigar como o botão "Settings" é renderizado (SidebarRoot.tsx,   │
│   slot sidebar.settings).                                              │
│ • Identificar quem ocupa o slot e como o painel é aberto               │
│   (estado local? portal? overlay? rota?).                              │
│ • Documentar o fluxo botão → painel → fechamento.                      │
│ • Entregável: relatório no chat, SEM alterar código.                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 2 — Modelar Plans/Profile/Admin com o padrão Settings            │
│ • Ocupar o slot sidebar.footer.action com UM BOTÃO POR LINHA:          │
│   Plans, Profile, Admin (este último só se owner/admin).               │
│ • Cada botão abre o painel pelo MESMO mecanismo do Settings            │
│   (estado local + overlay, sem rota, sem pushState).                   │
│ • Remover qualquer pushState/Link/rota para /plans, /profile,          │
│   /admin, /admin/audit.                                                │
│ • RoleGate para admin.                                                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 3 — Limpar rotas residuais                                       │
│ • Auditar apps/web/src/main.tsx e remover qualquer <Route> residual    │
│   para /plans, /profile, /admin, /admin/audit.                         │
│ • Auditar packages/client/ui-sidebar/src/client/* e remover            │
│   pushState/Link para essas rotas.                                     │
│ • Manter APENAS /billing/success e /billing/cancel como rotas          │
│   standalone (Stripe).                                                 │
│ • Critério: grep -rn "pushState\|/plans\|/profile\|/admin" retorna     │
│   apenas Stripe.                                                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 4 — Estilo dark/gold dos modais                                  │
│ • Garantir consistência visual do Settings + Plans + Profile + Admin.  │
│ • Tokens institucionais #E7BF73 / #D8AE5F / #B0955E / #FBF0DA.         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 5 — Estrutura de abas do Admin (UI + Navegação)                  │
│ • Componentização: AdminOverviewTab, AdminUsersTab, AdminTenantsTab,   │
│   AdminLLMProvidersTab, AdminModelsTab, AdminSystemTab,                │
│   AdminSessionsTab, AdminAuditTab, AdminBillingTab.                    │
│ • Navegação interna por abas horizontais dark/gold dentro do modal.    │
│ • RoleGate aplicado em cada aba (owner/admin apenas).                  │
│ • Placeholders funcionais de interface sem chamadas a tabelas novas.   │
│ • Entregável: Abas navegáveis com layout institucional e RoleGate.     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 6 — Backend Supabase para Admin                                  │
│ • Migrations para llm_providers, llm_models, system_config,            │
│   sessions_index, metrics_daily.                                       │
│ • RLS policies em todas as tabelas e RPCs necessárias.                 │
│ • Seed inicial (providers e modelos conhecidos).                       │
│ • Entregável: Tabelas criadas, RLS ativa, dados iniciais.              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 7 — Implementação das abas (uma por vez)                         │
│ • 7.1 Visão Geral (Métricas globais, gráficos, saúde do sistema)       │
│ • 7.2 Usuários (Listagem, filtros, role, suspensão, logout)            │
│ • 7.3 LLM Providers (Catálogo, credenciais server-side, conectividade) │
│ • 7.4 Modelos (Catálogo, controle por plano, modelo padrão)            │
│ • 7.5 Config. Sistema (Raiz, workspaces, filesystem protegido, flags)  │
│ • 7.6 Sessões globais (Histórico global, transcript, auditoria)        │
│ • 7.7 Billing (Assinaturas, faturas, reembolsos, Stripe)               │
│ • Cada sub-bloco: diff + build + teste + aprovação antes de commitar.  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Regras Gerais de Governança (Mantidas)

1. **Uma fase por vez:** 1 fase/sub-bloco = 1 commit por fase.
2. **Autorização Prévia:** NÃO commitar NEM dar push sem aprovação explícita.
3. **Builds Obrigatórios:** Rodar `pnpm run build:lib:host` e `pnpm run build:lib:client` e exibir o output antes de cada proposta de commit.
4. **Resolução de Erros:** Build quebrado = corrigir antes de commitar.
5. **Dúvida:** PARAR e perguntar.
6. **Ação Imediata:** Bloco 1 (análise do Settings, sem alteração de código). Os Blocos 2 a 7 entram em sequência após aprovação individual de cada fase.
