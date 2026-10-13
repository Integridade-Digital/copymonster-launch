# Plano de Correção e Execução dos 5 Fixes

**Projeto:** CopyMonster Launch (`Integridade-Digital/copymonster-launch`)
**Data:** 13 de Outubro de 2026
**Regra Canônica:**
> Admin (`metadata.is_admin === true`) tem acesso total ao Settings → Models, Admin Providers, seletor de modelos no Chat e item Admin na barra lateral. Usuário comum visualiza consumo de tokens, mas não tem acesso nem visualização a Models, Admin Providers, Admin sidebar ou seletor de modelos.

---

## 1. Diagnóstico dos 3 Problemas Visuais no Browser

### Problema 1: Abas Profile / Plans / My DNA em branco no Settings
* **Causa Raiz:** O commit `8e8d0bf45b` registrou as três seções em `packages/client/ui-settings-general/src/client/index.ts`, porém os arquivos dos componentes `ProfileSection.tsx`, `PlansSection.tsx` e `MyDnaSection.tsx` não existiam no disco. Além disso, os slots de conteúdo (`settings.profile.item`, `settings.plans.item`, `settings.my-dna.item`) não estavam associados aos componentes de página existentes em `apps/web/src/main.tsx`.
* **Solução:** Criar os três componentes de seção e injetar `ProfilePage`, `PlansPage` e `MyDnaPage` nos slots correspondentes durante o boot de `apps/web`.

### Problema 2: Admin não vê o seletor de modelos no Chat
* **Causa Raiz:** Em `packages/client/ui-model-selection/src/client/index.ts:124–131`, a função `isPlatformAdminSession()` verificava `session.isPlatformAdmin === true`. O shell `apps/web/src/main.tsx` e os testes unitários utilizam a flag `isAdmin` (`users.metadata.is_admin`). Por falha de chave, o gate fechava para o admin.
* **Solução:** Ajustar a verificação de sessão para validar `session.isAdmin === true || session.isPlatformAdmin === true`.

### Problema 3: Sidebar ainda exibe botões redundantes de Plans, Profile e My DNA
* **Causa Raiz:** O componente `FooterActionsRoot.tsx` manteve os botões e modais legados para não perder funcionalidade antes de o Settings estar totalmente operacional.
* **Solução:** Remover a navegação e modais de Plans, Profile e My DNA do FooterActionsRoot após a ativação do Settings, preservando estritamente Sign Out, Admin (gated) e OnboardingDnaModal.

---

## 2. Ordem Canônica de Execução dos 5 Fixes

```
┌──────────────────────────────────────────────────────────────┐
│ FIX 1: Seções Profile / Plans / My DNA conectadas ao Settings │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ FIX 2: Seletor de Modelos em Chat usando `isAdmin`            │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ FIX 3: Credenciais Host permitindo escrita local de Admin    │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ FIX 4: Limpeza de botões/modais do FooterActionsRoot         │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ FIX 5: Blindagem do Admin na Sidebar com fail-closed estrito │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Detalhamento Técnico de Cada Fix

### FIX 1 — Seções Profile, Plans e My DNA no Settings
* **Arquivos Criados:**
  - `packages/client/ui-settings-general/src/client/ProfileSection.tsx`
  - `packages/client/ui-settings-general/src/client/PlansSection.tsx`
  - `packages/client/ui-settings-general/src/client/MyDnaSection.tsx`
* **Arquivos Modificados:**
  - `apps/web/src/main.tsx` (registro das páginas `ProfilePage`, `PlansPage` e `MyDnaPage` nos slots)
* **Validação:**
  - `pnpm --filter @deepseek-ai/dsh-client-ui-settings-general run bundle`
  - `pnpm run build:lib:client`
  - `pnpm run build:web`

### FIX 2 — Model Selector alinhado com `isAdmin`
* **Arquivo Modificado:**
  - `packages/client/ui-model-selection/src/client/index.ts`
* **Ajuste:**
  - Função `isPlatformAdminSession` atualizada para aceitar `session.isAdmin === true`.
* **Validação:**
  - `pnpm exec vitest run packages/client/ui-model-selection` (100% de aprovação na suíte).

### FIX 3 — Credenciais Host (`SupabaseLlmCredentialsProvider`)
* **Arquivo Modificado:**
  - `packages/host/llm-credentials-supabase/src/index.ts`
* **Ajuste:**
  - Permitir `set()` e `unset()` delegando para o provider local (`LocalCredentialProvider`), salvando a chave exclusivamente em disco (`~/.dsh/.credentials.yaml`) e mantendo `ADMIN_MANAGED_MESSAGE` restrito a não-administradores.
* **Validação:**
  - `pnpm exec vitest run packages/host/llm-credentials-supabase`

### FIX 4 — Limpeza da Navegação do `FooterActionsRoot`
* **Arquivo Modificado:**
  - `apps/web/src/components/layout/FooterActionsRoot.tsx`
* **Ajuste:**
  - Remoção dos botões de linha de Plans, Profile e My DNA.
  - Remoção da montagem dos modais `PlansModal`, `ProfileModal` e `DnaModal`.
  - Preservação intacta de:
    - Botão e modal `AdminModal` (exclusivo para admin).
    - Botão de `Sign Out`.
    - Modal `OnboardingDnaModal`.
* **Validação:**
  - `pnpm run build:web`

### FIX 5 — Blindagem do Botão Admin na Sidebar
* **Arquivo Modificado:**
  - `apps/web/src/components/layout/FooterActionsRoot.tsx`
* **Ajuste:**
  - Exibição do botão Admin exclusivamente quando `isAdminFlag === true`, correspondendo a `(globalThis.__DSH_AUTH__?.isAdmin === true)` de forma fail-closed.
* **Validação:**
  - `pnpm run build:web`
  - `pnpm run build:lib:host`
  - `pnpm run build:lib:client`

---

## 4. Protocolo de Git e Integração
* 1 commit individual por Fix.
* Push via GitHub API / Git Connector após cada etapa validada.
* Emissão de relatório com SHA, arquivos alterados e status de testes.
