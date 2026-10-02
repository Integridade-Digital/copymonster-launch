# Plano de Implementação: Modais Admin/Profile/Plans (Padrão Settings), i18n (EN/ZH) e Provedor OpenRouter

**Documento:** `docs/roadmap/plano-modals-layout-i18n-openrouter.md`  
**Data:** Outubro de 2026  
**Status:** Planejado / Pronto para execução  
**Alvo:** `master`

---

## 1. Visão Geral e Objetivos

Este plano detalha a reestruturação arquitetural e visual dos modais acionados pelo rodapé da aplicação (`FooterActionsRoot`: Admin, Profile e Plans), eliminando layouts horizontais e desalinhados para adotar o padrão canônico do `SettingsRoot` (rail vertical à esquerda + área de conteúdo à direita + paleta institucional Dark/Gold), a remoção integral do idioma Português em favor do suporte estrito a Inglês (EN) e Chinês (ZH), e a adição do provedor OpenRouter via migration `021`.

---

## 2. Diagnóstico da Estrutura Atual

### 2.1. AdminModal (`apps/web/src/components/layout/AdminModal.tsx`)
- **Problema atual:** Utiliza barra de abas horizontal (`.adminTabBar`), fontes e paddings desalinhados do visual do core da plataforma.
- **Referência:** `packages/client/ui-settings-general/src/client/SettingsRoot.tsx` e `SettingsRoot.module.css`.
- **Meta:**
  - Trilho vertical (left rail, largura ~188-200px) com as 9 abas:
    1. Overview (概览)
    2. Users (用户)
    3. Tenants (租户)
    4. LLM Providers (LLM 提供商)
    5. Models (模型)
    6. Settings (设置)
    7. Sessions (会话)
    8. Audit (审计)
    9. Billing (账单)
  - Área de conteúdo à direita com scroll independente.
  - Overlay: `position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center`.
  - Painel: `width: 800px; max-width: calc(100vw - 48px); height: min(800px, calc(100vh - 48px)); border-radius: 24px/32px; background: #0d1117 / var(--dsw-alias-bg-layer-2); border: 1px solid #30363d`.
  - Tipografia: 13-14px, labels secundárias `#8b949e`, item ativo destacado com fundo sutil e acento dourado `#E7BF73`.
  - Botão Fechar (X) no topo superior direito.

### 2.2. ProfileModal & ProfilePage (`apps/web/src/components/layout/ProfileModal.tsx` e `apps/web/src/pages/ProfilePage.tsx`)
- **Problema atual:** Layout de formulário vertical único sem separação de seções em trilho lateral.
- **Meta:**
  - Left rail com 2 seções selecionáveis:
    1. Account Data (账户数据) - Nome, Email, WhatsApp (com sanitização E.164)
    2. Security & Password (安全与密码) - Nova Senha, Confirmação, Atualização segura
  - Área de conteúdo exibindo apenas a seção selecionada.
  - Mesmo dimensionamento, overlay e paleta do AdminModal.

### 2.3. PlansModal & PlansPage (`apps/web/src/components/layout/PlansModal.tsx` e `apps/web/src/pages/billing/PlansPage.tsx`)
- **Problema atual:** Não necessita de trilho lateral (seção única), mas necessita alinhamento rigoroso ao padrão de design Dark/Gold (`#E7BF73`, `#161b22`, `#0d1117`, `#30363d`) e tipografia compacta.
- **Investigação do Bug "Subscribe to X":**
  - Nos botões "Subscribe to X", a chamada `handleSubscribe` invoca `supabase.auth.getSession()`.
  - É necessário garantir que `getSession()` e a chamada para `/api/billing/checkout` tratem o token JWT de forma resiliente, lidem com erro de sessão/tenant de forma amigável e redirecionem diretamente para `data.url` do Stripe Checkout Session.

### 2.4. Internacionalização (i18n): Suporte Estrito a EN + ZH (Zero Português)
- **Problema atual:** Existem labels e textos em português em `FooterActionsRoot.tsx`, `AdminModal.tsx`, `ProfilePage.tsx`, e em várias das 9 abas de administração (`AdminOverviewTab`, `AdminUsersTab`, etc.).
- **Meta:**
  - Criar módulo centralizado de traduções: `apps/web/src/locales/en.ts`, `apps/web/src/locales/zh.ts` e helper `apps/web/src/locales/i18n.ts` que detecta o idioma ativo (`navigator.language` ou preferência armazenada, padrão `en`).
  - Traduzir 100% das strings visíveis ao usuário nos 4 componentes principais e nas 9 abas de admin.

### 2.5. Provedor OpenRouter (Migration 021)
- Criar `supabase/migrations/021_add_openrouter_provider.sql` para cadastrar o provedor OpenRouter na tabela `public.llm_providers` com `provider_type = 'openrouter'`, `base_url = 'https://openrouter.ai/api/v1'`, `allowed_plans = ARRAY['starter', 'pro', 'legend']`.

---

## 3. Plano Passo a Passo de Execução

### Passo 1 — Criação e Estruturação do Sistema de Idiomas (EN/ZH)
1. Criar `apps/web/src/locales/en.ts` com todas as chaves de:
   - Footer actions ("Plans", "Profile", "Admin")
   - Admin tabs e conteúdo (Overview, Users, Tenants, LLM Providers, Models, Settings, Sessions, Audit, Billing)
   - Profile tabs e formulários (Account Data, Security & Password, labels, mensagens de sucesso/erro)
   - Plans (Monthly/Annual toggle, Subscribe, Current Plan, Features, erros)
2. Criar `apps/web/src/locales/zh.ts` com as traduções equivalentes em Chinês simplificado.
3. Criar `apps/web/src/locales/index.ts` fornecendo hook/função `t(key)` ou dicionário dinâmico.

### Passo 2 — Reconstrução do AdminModal com Padrão Settings
1. Atualizar `apps/web/src/components/layout/FooterActionsRoot.module.css` (ou criar `AdminModal.module.css`):
   - Estilos para `.overlay`, `.mask`, `.panel`, `.rail`, `.railTitle`, `.railList`, `.railItem`, `.railItemActive`, `.header`, `.closeButton`, `.contentArea`.
2. Reescrever `AdminModal.tsx`:
   - Trilho vertical à esquerda com as 9 abas.
   - Área de conteúdo à direita com renderização dinâmica da aba ativa.
   - Remoção de abas horizontais e classes legadas.

### Passo 3 — Reconstrução do ProfileModal e ProfilePage
1. Atualizar `ProfileModal.tsx` com o layout de duas colunas (left rail + content).
2. Refatorar `ProfilePage.tsx` para aceitar a aba ativa (`'account' | 'security'`) ou incorporar a navegação no próprio modal.
3. Traduzir todos os textos de validação (incluindo validação de WhatsApp e mensagens de erro de senha) para EN e ZH.

### Passo 4 — Alinhamento do PlansModal e Correção do Fluxo de Checkout
1. Atualizar `PlansModal.tsx` e `apps/web/src/pages/billing/billing.css` com tamanho 800px, fundo escuro `#0d1117`, bordas `#30363d`, acentos `#E7BF73`.
2. Em `PlansPage.tsx`, assegurar que `handleSubscribe`:
   - Recupere a sessão diretamente via `supabase.auth.getSession()`.
   - Lance erro legível e estilizado caso não autenticado.
   - Execute o fetch para `/api/billing/checkout` enviando `priceId`, `successUrl` e `cancelUrl`.
   - Redirecione para a URL do Stripe se retornado.

### Passo 5 — Tradução das 9 Abas de Administração para EN + ZH
Substituir todas as strings hardcoded em português nos seguintes arquivos:
- `apps/web/src/pages/admin/tabs/AdminOverviewTab.tsx`
- `apps/web/src/pages/admin/tabs/AdminUsersTab.tsx`
- `apps/web/src/pages/admin/tabs/AdminTenantsTab.tsx`
- `apps/web/src/pages/admin/tabs/AdminLLMProvidersTab.tsx`
- `apps/web/src/pages/admin/tabs/AdminModelsTab.tsx`
- `apps/web/src/pages/admin/tabs/AdminSystemTab.tsx`
- `apps/web/src/pages/admin/tabs/AdminSessionsTab.tsx`
- `apps/web/src/pages/admin/tabs/AdminAuditTab.tsx`
- `apps/web/src/pages/admin/tabs/AdminBillingTab.tsx`

### Passo 6 — Criação da Migration 021 (OpenRouter)
Criar `supabase/migrations/021_add_openrouter_provider.sql` com:
```sql
BEGIN;
INSERT INTO public.llm_providers (
  id, name, provider_type, base_url, is_active, allowed_plans,
  created_at, updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000005',
  'OpenRouter',
  'openrouter',
  'https://openrouter.ai/api/v1',
  true,
  ARRAY['starter', 'pro', 'legend']::TEXT[],
  NOW(),
  NOW()
)
ON CONFLICT (name) DO UPDATE SET
  provider_type = EXCLUDED.provider_type,
  base_url = EXCLUDED.base_url,
  is_active = EXCLUDED.is_active,
  allowed_plans = EXCLUDED.allowed_plans;
COMMIT;
```

### Passo 7 — Validação e Compilação
Executar os 3 builds de referência da plataforma:
1. `pnpm run build:web`
2. `pnpm run build:lib:host`
3. `pnpm run build:lib:client`

Garantir saída limpa (zero erros de TypeScript e zero falhas de bundling).

### Passo 8 — Commit e Push Final
- Commit com a mensagem: `feat(admin): settings-pattern modals, EN/ZH i18n, OpenRouter provider`
- Push para `origin/master`.
