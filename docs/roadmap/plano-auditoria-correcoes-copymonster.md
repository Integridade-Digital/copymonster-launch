# CopyMonster: Relatório Consolidado de Auditoria e Plano de Ação para Correções

**Repositório:** `Integridade-Digital/copymonster-launch`  
**Commit Auditado:** `914f022b91` (branch `master`)  
**Data:** 25 de Setembro de 2026  
**Status:** Aguardando Aprovação para Execução  

---

## 1. Sumário Executivo

A auditoria completa de segurança, arquitetura, runtime, frontend, banco de dados e performance no fork **CopyMonster** (baseado no *DeepSeek Harness*) revelou as causas-raiz dos comportamentos anômalos relatados em produção — em especial a **tela preta/pedindo token** para novos usuários e a impossibilidade de navegação administrativa e de planos.

Identificamos **28 achados principais**, distribuídos entre vulnerabilidades de isolamento multi-tenant, desconexão no transporte de identidade entre frontend e backend RPC, rotas isoladas em memória, e gargalos de performance que degradam o boot do sistema.

Abaixo está o mapeamento detalhado e exato de cada achado por seção técnica, seguido por um plano de ação ordenado em 6 fases de implementação.

---

## 2. Mapeamento Ordenado dos Erros Encontrados (Seções A a H)

### Seção B: Integridade em Relação ao Upstream (DeepSeek Harness)
* **B1. [ALTA] Hook de autenticação morto no cliente de conversação**
  * **Arquivo:** `packages/client/ui-conversation/src/client/service.ts:210-221`
  * **Problema:** O evento customizado `dsh:message-send-attempt` permanece interceptando tentativas de envio de mensagem no cliente DSH original, mesmo após a exclusão do componente `ChatMessageGuard.tsx`.
  * **Impacto:** Código residual sem efeito funcional que polui o fluxo de chat e pode gerar interferências silenciosas no envio de mensagens.
* **B2. [MÉDIA] Injeção direta de dependências CopyMonster no CLI upstream**
  * **Arquivo:** `apps/cli/package.json:109-112`
  * **Problema:** Pacotes do workspace CopyMonster (`auth-context`, `auth-http`, `copymonster`, etc.) foram injetados diretamente nas dependências do pacote central de linha de comando.
  * **Impacto:** Alto acoplamento e risco iminente de conflitos graves durante atualizações ou merges futuros da base do DeepSeek Harness.
* **B3. [BAIXA] Ponto de entrada alterado em `apps/web/index.html`**
  * **Arquivo:** `apps/web/index.html:12`
  * **Problema:** Mudança direta no arquivo upstream para carregar `/src/main.tsx` em vez de `main.ts`.
* **B4. [BAIXA] Sintaxe corrompida no `.gitignore`**
  * **Arquivo:** `.gitignore:1,78`
  * **Problema:** Presença de marcadores Markdown de blocos de código (três crases \`\`\`) envolvendo o arquivo de ignorados.

---

### Seção C: Pacotes Customizados CopyMonster
* **C1. [CRÍTICA] Tenant hardcoded no backend (`auth-context`)**
  * **Arquivo:** `packages/api/auth-context/src/index.ts:89-95`
  * **Problema:** A resolução de identidade busca invariavelmente a linha com `slug = DEFAULT_TENANT_SLUG` (`'integridade-digital'`), ignorando a tabela `user_tenant_roles` do usuário.
  * **Impacto:** Inviabiliza a arquitetura multi-tenant; todos os usuários ficam restritos ao tenant padrão, gerando vazamento cruzado ou bloqueio para novos clientes.
* **C2. [ALTA] Páginas de Admin e Billing sem rotas acessíveis**
  * **Arquivo:** `apps/web/src/main.tsx:59-74,94`
  * **Problema:** `AuthRoutes()` renderiza apenas login/registro e, ao logar, cai diretamente no `WebApp` DSH. `AdminTenantsPage` e `PlansPage` não estão configuradas em nenhuma rota.
  * **Impacto:** Código morto em runtime; ninguém consegue gerenciar tenants ou assinar planos pela interface.
* **C3. [ALTA] Fallback silencioso no cliente Supabase web**
  * **Arquivo:** `apps/web/src/lib/auth/supabase.client.ts:116-121`
  * **Problema:** Variáveis `VITE_SUPABASE_URL` ou `VITE_SUPABASE_ANON_KEY` indefinidas disparam apenas `console.warn` e criam um cliente Supabase com string vazia (`''`).
  * **Impacto:** Falhas silenciosas difíceis de rastrear em runtime em vez de interrupção imediata (*fail-fast*).
* **C4. [ALTA] Coexistência de arquivo órfão `main.ts`**
  * **Arquivo:** `apps/web/src/main.ts:1-55`
  * **Problema:** O ponto de entrada original do DSH coexiste no mesmo diretório de `main.tsx`.
* **C5. [MÉDIA] Namespace não atualizado em pacotes CopyMonster**
  * **Arquivo:** `packages/bundle/copymonster/package.json:2` e `packages/api/auth-context/package.json:2`
  * **Problema:** Pacotes mantêm o escopo `@deepseek-ai` em vez de `@copymonster` ou escopo próprio.
* **C6. [BAIXA] Risco de Host Header Injection em `/enter`**
  * **Arquivo:** `packages/api/auth-http/src/index.ts:105-117`
  * **Problema:** Montagem de URL de redirecionamento utilizando diretamente o header `Host` enviado pelo cliente, sem conferência contra uma lista segura (*allowlist*).

---

### Seção D: Supabase e Banco de Dados (Isolamento e RLS)
* **D1. [CRÍTICA] Função `get_current_tenant_id()` com ordenação instável**
  * **Arquivo:** `supabase/migrations/002_saas_complete_isolation.sql:119-129`
  * **Problema:** Retorna o tenant através de `ORDER BY created_at LIMIT 1`.
  * **Impacto:** Usuários com múltiplos papéis ou múltiplos tenants são vinculados arbitrariamente ao primeiro tenant criado historicamente, impedindo alternância de organização.
* **D2. [ALTA] Tabela `plans` sem Row Level Security (RLS)**
  * **Arquivo:** `supabase/migrations/002_saas_complete_isolation.sql:102-110`
  * **Problema:** A tabela `plans` foi criada na migração 002, mas foi omitida das diretivas `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
  * **Impacto:** Fica desprotegida caso clientes anônimos tentem manipulação direta de planos via API REST do Supabase.
* **D3. [ALTA] Políticas de Role Management com elevação de privilégio entre tenants**
  * **Arquivo:** `supabase/migrations/002_saas_complete_isolation.sql:176-177`
  * **Problema:** `CREATE POLICY "Admins can manage roles" ON user_tenant_roles FOR ALL USING (is_admin_or_owner());` criada sem cláusula `WITH CHECK`.
  * **Impacto:** Um administrador de um tenant pode inserir ou alterar papéis em outro tenant se possuir permissão administrativa em seu próprio contexto.
* **D4. [ALTA] Uso indiscriminado de `supabaseAdminClient` no backend**
  * **Arquivo:** `packages/server/supabase-client/src/supabase.client.ts:6-8,38-42`
  * **Problema:** Toda operação de backend utiliza a chave `service_role` contornando 100% das políticas de RLS no PostgreSQL.
  * **Impacto:** Toda a responsabilidade de isolamento recai sobre o código TypeScript; um filtro esquecido em query vaza dados globalmente.
* **D5. [MÉDIA] Tipos TypeScript defasados em relação às migrações**
  * **Arquivo:** `packages/server/supabase-client/src/supabase.types.ts:20-140`
  * **Problema:** As tabelas `sessions`, `workspaces_meta`, `tenant_llm_providers` e `audit_logs` não constam nas definições de tipos geradas.
* **D6. [MÉDIA] Política de sessões vaza conversas entre usuários do mesmo tenant**
  * **Arquivo:** `supabase/migrations/002_saas_complete_isolation.sql:140-143`
  * **Problema:** A política `"Users can view own sessions"` filtra unicamente por `tenant_id = get_current_tenant_id()`, sem checar `user_id = auth.uid()`.
  * **Impacto:** Qualquer membro de um tenant pode ler as sessões e históricos de conversas dos demais membros.

---

### Seção E: Autenticação e Identidade
* **E1. [ALTA] Falha de resolução de role rebaixa usuário para 'anonymous' em vez de rejeitar**
  * **Arquivo:** `packages/api/auth-context/src/index.ts:97-104`
  * **Problema:** Quando não é encontrado registro na tabela `user_tenant_roles`, o backend assume `role = 'anonymous'` e valida o login com sucesso.
  * **Impacto:** O usuário sem tenant ou role válida ganha identidade autenticada, podendo navegar no shell sem permissões estruturadas.
* **E2. [ALTA] Ausência de transporte automático do Bearer Token para o RPC**
  * **Arquivo:** `packages/api/auth-context/src/index.ts:56-60` e `apps/web/src/main.tsx:33-54`
  * **Problema:** O contexto `auth` está registrado no host Cordis, mas o cliente web não injeta o token Supabase nos transports de RPC nem expõe o adapter do cliente.
  * **Impacto:** A aplicação cliente sobe solicitando token manual ou exibe tela preta de conexão indisponível.
* **E3. [ALTA] Seed de Tenant com atribuição de dono por ordem indefinida**
  * **Arquivo:** `apps/cli/src/seed-tenant.ts`
  * **Problema:** Executa consulta em `users` sem `.order()`, e seleciona `const first = users[0]` para transformar em 'owner'.
  * **Impacto:** Dependendo da ordem de retorno do banco, o dono da conta principal pode ser atribuído aleatoriamente a outro usuário cadastrado.
* **E4. [MÉDIA] Trigger de criação de usuário não salva o campo WhatsApp**
  * **Arquivo:** `supabase/migrations/001_initial_identity.sql:102-109`
  * **Problema:** O trigger `handle_new_user()` copia `full_name` e `avatar_url` de `raw_user_meta_data`, mas omite `whatsapp`.
  * **Impacto:** O WhatsApp fornecido no formulário de cadastro é descartado na persistência de `public.users`.

---

### Seção F: Build e Runtime
* **F1. [CRÍTICA] Execução correta depende estritamente da flag `--patch` no serviço**
  * **Arquivo:** `packages/bundle/copymonster/cordis.patch.yml:8`
  * **Problema:** O carregamento dos plugins de autenticação só ocorre se o binário for iniciado com `--patch packages/bundle/copymonster/cordis.patch.yml`.
  * **Impacto:** Se um deploy manual ou atualização de serviço rodar `dsh` sem essa flag, o sistema sobe em modo DeepSeek Harness upstream sem autenticação CopyMonster.
* **F2. [ALTA] Pacotes CopyMonster omitidos de `tsconfig.client.json`**
  * **Arquivo:** `tsconfig.client.json` vs `tsconfig.host.json:401-405`
  * **Problema:** Apenas o tsconfig de host mapeia os pacotes `@deepseek-ai/dsh-api-auth-context` e `@deepseek-ai/dsh-api-auth-http`.
  * **Impacto:** Falhas de typecheck e compilação caso componentes clientes importem contratos compartilhados.
* **F3. [ALTA] `rejectStandaloneServe` impede teste e desenvolvimento desacoplado do web**
  * **Arquivo:** `apps/web/vite.config.ts:32-41`
  * **Problema:** O Vite bloqueia requisições caso não venham acompanhadas do cabeçalho de injeção gerado pelo host.
* **F4. [MÉDIA] Divergência na versão do compilador TypeScript**
  * **Arquivo:** `packages/bundle/copymonster/package.json:37` (`^5.3.0`) vs `package.json` raiz (`^6.0.3`).

---

### Seção G: Frontend (UI, Rotas e Estados)
* **G1. [CRÍTICA] `MemoryRouter` desconectado da barra de navegação do browser**
  * **Arquivo:** `apps/web/src/main.tsx:60-74`
  * **Problema:** O roteamento de telas de auth utiliza `MemoryRouter`, impedindo navegação por histórico (`Voltar`/`Avançar`), deep-links diretos e atualização da URL.
* **G2. [ALTA] Erro na obtenção do perfil joga o usuário autenticado na tela de registro**
  * **Arquivo:** `apps/web/src/lib/auth/auth.provider.tsx:29-38` e `apps/web/src/lib/auth/supabase.client.ts:148`
  * **Problema:** Se `getUserFullProfile` retornar `null` por instabilidade temporária, o estado `user` fica `null` e o app renderiza a tela de cadastro sem mensagem de erro.
* **G3. [ALTA] Componentes `RoleGate` e `ProtectedRoute` existem mas nunca são utilizados**
  * **Arquivo:** `apps/web/src/components/auth/RoleGate.tsx` e `apps/web/src/lib/auth/protected-route.tsx`
  * **Problema:** Os componentes de controle de acesso visual foram codificados de forma avulsa e não cercam nenhuma tela no app.
* **G4. [ALTA] Risco de tela em branco/preta caso `window.__DSH_BOOT__` falhe**
  * **Arquivo:** `apps/web/src/main.tsx:52,94`
  * **Problema:** O componente `WebApp` monta diretamente o DOM do DSH sem um `ErrorBoundary` do React. Se o bootstrap não tiver sido injetado, o app quebra silenciosamente.
* **G5. [MÉDIA] Login mascarando falhas de conexão como 'E-mail ou senha inválidos'**
  * **Arquivo:** `apps/web/src/pages/LoginPage.tsx:28-29`
  * **Problema:** Fallback de erro no `catch` exibe mensagem de credenciais incorretas mesmo quando o problema for timeout ou indisponibilidade de rede.
* **G6. [BAIXA] Strings residuais do DeepSeek em builds locais**
  * **Arquivo:** `packages/client/locale/src/locales/en.ts:33` e `zh.ts:31` (`'brand.localBuild': 'DSH Local Build'`).

---

### Seção H: Performance e Otimização
* **H1. [ALTA] Import estático da casca DSH degrada carregamento das telas de login/registro**
  * **Arquivo:** `apps/web/src/main.tsx:5` (`import { AppWebEntry } from '@deepseek-ai/dsh-client-web'`)
  * **Problema:** Usuários anônimos precisam baixar a biblioteca inteira da IDE antes de visualizar um simples formulário de login.
* **H2. [ALTA] Boot duplica queries de sessão em paralelo**
  * **Arquivo:** `apps/web/src/lib/auth/auth.provider.tsx:41-50`
  * **Problema:** `loadSession()` e o evento disparado por `onAuthStateChange` chamam `getUserFullProfile` simultaneamente no boot, duplicando requisições.
* **H3. [ALTA] `resolveIdentity` no backend sem cache executa 4 round-trips sequenciais por requisição**
  * **Arquivo:** `packages/api/auth-context/src/index.ts:78-102`
  * **Problema:** Cada chamada autenticada faz `getUser` + busca em `users` + busca em `tenants` + busca em `user_tenant_roles` sequencialmente.
* **H4. [MÉDIA] `AuthProvider` recria contexto em todos os renders gerando re-renders globais**
  * **Arquivo:** `apps/web/src/lib/auth/auth.provider.tsx:123-132`
  * **Problema:** Objeto `value` construído sem `useMemo`.
* **H5. [MÉDIA] `getUserFullProfile` no frontend encadeia 3 queries sequenciais**
  * **Arquivo:** `apps/web/src/lib/auth/supabase.client.ts:142-172`
  * **Problema:** `users` e `tenants` poderiam ser paralelizados com `Promise.all` ou substituídos por uma única RPC SQL no Supabase.

---

## 3. Plano de Ação Estruturado para Correção

Recomendamos executar as correções em **6 fases lineares**, garantindo que as dependências de infraestrutura e banco estejam resolvidas antes das alterações de frontend e runtime.

```
┌────────────────────────────────────────────────────────┐
│ FASE 1: Segurança no Banco de Dados e Isolamento (SQL) │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ FASE 2: Backend e Transporte de Autenticação (Cordis)  │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ FASE 3: Frontend - Roteamento e Telas Administrativas  │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ FASE 4: Resiliência de Estado, Telas de Erro e Boot    │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ FASE 5: Otimização de Performance e Latência           │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ FASE 6: Hardening de Build, Startup e Rebranding       │
└────────────────────────────────────────────────────────┘
```

---

### Fase 1: Segurança no Banco de Dados e Isolamento RLS (Supabase)
**Objetivo:** Eliminar brechas multi-tenant e corrigir a integridade dos dados no PostgreSQL.
1. **Nova Migração SQL (`003_security_and_profile_fixes.sql`):**
   * **Corrigir `get_current_tenant_id()`:** Adicionar suporte a parâmetro de tenant ativo ou buscar através de contexto de sessão, removendo o `ORDER BY created_at LIMIT 1` arbitrário.
   * **Habilitar RLS em `plans`:** Executar `ALTER TABLE plans ENABLE ROW LEVEL SECURITY;` com política pública de `SELECT` para planos ativos e restrição de escrita para administradores.
   * **Blindar `user_tenant_roles`:** Corrigir a política `"Admins can manage roles"`, adicionando a cláusula `WITH CHECK (tenant_id = get_current_tenant_id())` para impedir que um admin altere papéis de outros tenants.
   * **Isolar histórico de sessões:** Corrigir a política de `sessions` adicionando a checagem `AND user_id = auth.uid()` para evitar que membros leiam conversas alheias no mesmo tenant.
   * **Atualizar trigger `handle_new_user()`:** Adicionar o campo `whatsapp` para persistir dados vindos de `raw_user_meta_data->>'whatsapp'`.
   * **Criar função RPC `get_my_profile()`:** Função com `SECURITY DEFINER` que retorna perfil, tenant e role em um único retorno JSON (otimizando frontend e backend).

---

### Fase 2: Backend e Transporte de Autenticação (Cordis / Node)
**Objetivo:** Restaurar o fluxo de identidade dinâmico e o transporte de credenciais para as sessões de chat.
1. **Desacoplar Tenant em `packages/api/auth-context`:**
   * Substituir o uso de `DEFAULT_TENANT_SLUG` pela busca real da role do usuário em `user_tenant_roles`.
   * Tratar ausência de associação a tenant como rejeição estrita (não emitir `anonymous`).
2. **Implementar Ponte de RPC para Identidade:**
   * Registrar o adapter no cliente web para injetar o header `Authorization: Bearer <token>` nas conexões WebSocket/HTTP do RPC Typert/Cordis.
3. **Corrigir `apps/cli/src/seed-tenant.ts`:**
   * Inserir ordenação determinística (`.order('created_at', { ascending: true })`) e validação explícita de e-mail ao definir o proprietário inicial.

---

### Fase 3: Frontend - Roteamento e Telas Administrativas
**Objetivo:** Tornar todas as páginas do sistema navegáveis e sincronizadas com a URL.
1. **Migrar para `BrowserRouter`:**
   * Substituir `MemoryRouter` em `apps/web/src/main.tsx` por `BrowserRouter`, preservando a navegação nativa e o histórico do browser.
2. **Ativar Rotas Administrativas e de Planos:**
   * Expor `/admin/tenants` envolvendo `AdminTenantsPage` com `<RoleGate allowedRoles={['owner', 'admin']}>`.
   * Expor `/billing/plans` renderizando `PlansPage` para usuários autenticados.
3. **Limpeza de Arquivos Mortos:**
   * Excluir o arquivo órfão `apps/web/src/main.ts` e referências mortas no DSH.

---

### Fase 4: Resiliência de Estado, Telas de Erro e Boot
**Objetivo:** Eliminar telas pretas/brancas e falsos logouts.
1. **Adicionar `ErrorBoundary` em `WebApp`:**
   * Cercar o container `#dsh-web-root` com um componente visual de contingência caso o bootstrap do DSH falhe.
2. **Corrigir Tratamento de Erros no `AuthProvider`:**
   * Manter um estado `authError` explícito; não deslogar o usuário em caso de timeout transitório na busca do perfil.
3. **Melhorar Feedback em `LoginPage` e `RegisterPage`:**
   * Distinguir erros de credenciais (400) de erros de conexão/servidor (500/timeout).

---

### Fase 5: Otimização de Performance e Latência
**Objetivo:** Reduzir o tempo de boot e o consumo de rede.
1. **Code Splitting (Lazy Loading) no Entrypoint:**
   * Carregar `AppWebEntry` dinamicamente com `React.lazy()` apenas após a confirmação de sessão autenticada.
2. **Deduplicação de Boot no `AuthProvider`:**
   * Eliminar a chamada concorrente entre `loadSession()` e `onAuthStateChange`.
   * Memoizar o objeto de contexto via `useMemo`.
3. **Cache em Memória de Identidade no Backend:**
   * Armazenar a identidade validada em cache local (LRU com TTL de 60 segundos) no `auth-context`, reduzindo os round-trips ao Supabase de 4 para 0 na maioria das requisições subsequentes.

---

### Fase 6: Hardening de Build, Startup e Rebranding
**Objetivo:** Garantir a estabilidade da infraestrutura e atualização de marca.
1. **Script de Inicialização Blindado:**
   * Criar script dedicado `pnpm start:copymonster` no `package.json` raiz que inclua explicitamente a flag `--patch packages/bundle/copymonster/cordis.patch.yml`.
   * Atualizar a unidade do systemd (`copymonster.service`) para invocar este script, prevenindo remoções acidentais da flag.
2. **Harmonização de Build e Tipagem:**
   * Incluir os pacotes CopyMonster em `tsconfig.client.json`.
   * Alinhar a versão do TypeScript em `packages/bundle/copymonster/package.json` para `^6.0.3`.
   * Limpar as crases Markdown em `.gitignore`.
3. **Ajuste de Locales de Marca:**
   * Atualizar `brand.localBuild` em `packages/client/locale/src/locales/en.ts` e `zh.ts` para 'CopyMonster'.

---

## 4. Matriz de Prioridade de Execução

| Ordem | Fase | Descrição Principal | Criticidade | Risco de Regressão |
|:---:|:---|:---|:---:|:---:|
| **1º** | **Fase 1** | Migração SQL (RLS, isolamento multi-tenant, RPC de perfil) | **Crítica** | Baixo (aditivo) |
| **2º** | **Fase 2** | Backend `auth-context` dinâmico e injeção do Bearer no RPC | **Crítica** | Médio |
| **3º** | **Fase 4** | ErrorBoundary e prevenção de tela preta no frontend | **Alta** | Baixo |
| **4º** | **Fase 3** | `BrowserRouter`, rotas de `/admin/tenants` e `/billing/plans` | **Alta** | Baixo |
| **5º** | **Fase 5** | Cache de sessão no backend e Lazy loading do shell web | **Média** | Baixo |
| **6º** | **Fase 6** | Script `start:copymonster`, `tsconfig` e locales | **Média** | Muito Baixo |

---

*Este documento foi compilado para servir como roteiro único e determinístico para os trabalhos de correção no repositório CopyMonster.*
