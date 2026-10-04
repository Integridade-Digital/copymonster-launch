# CopyMonster: Auditoria Completa — Segurança, Branding, Funcionalidades, Layout e Operação

**Repositório:** `Integridade-Digital/copymonster-launch`
**Commit Auditado:** `bcfe43fedb` (branch `master`)
**Data:** 04 de Outubro de 2026
**Status:** Roadmap Reorganizado e Aprovado — Pronto para execução por blocos prioritários
**Escopo:** apenas auditoria com evidência (arquivo:linha); "a confirmar" = não verificável pelo repo; "não encontrado" = procurado e ausente

---

## 1. Sumário Executivo

A auditoria atravessou os 5 eixos (Segurança, Branding, Funcionalidades, Layout/UX, Operação/Infra) e identificou **4 achados CRÍTICOS**, **15 ALTO**, **20 MÉDIO** e **12 BAIXO**. Os quatro críticos:

| # | Achado | Evidência |
|---|--------|-----------|
| C-1 | `is_admin_or_owner()` confia em claims do JWT controláveis pelo cliente (`app_metadata.role` / `user_metadata.role`) → qualquer usuário se eleva a **admin global** (todas as políticas e RPCs "admin-only" colapsam) | `supabase/migrations/008_admin_expanded_backend.sql:20-24` |
| C-2 | `workspace.create` com path relativo **não passa por `assertPathInSandbox`** → `../../../../etc/passwd` resolve fora do sandbox; qualquer usuário registra workspace em diretório arbitrário do host (inclusive de outro tenant) | `packages/api/workspace-controller/src/commands.ts:52-56` |
| C-3 | Chave Stripe de produção corrompida no `.env` carregado pelo harness: `STRIPE_SECRET_KEY=sk_live_…>STRIPE_WEBHOOK_SECRET=…` (as duas variáveis coladas com um `>`) → autenticação Stripe com key inválida em runtime | `.env:17` (arquivo local, git-ignored) |
| C-4 | Webhook Stripe **fail-open**: sem `STRIPE_WEBHOOK_SECRET` no ambiente, a assinatura NÃO é verificada e o webhook é processado → webhook forjado ativa assinatura/tenant | `packages/api/auth-http/src/billing.ts:335-344` |

Além disso: billing não persiste `current_period_end`, trial expirado não bloqueia sessões, metering de tokens não tem caller em runtime, price IDs mensais divergem UI×DB, e o produto ainda se apresenta como "DeepSeek Harness" em 5+ pontos visíveis (incluindo a identidade no system-prompt da IA).

**Verificado como OK (amostra):** `.env*` git-ignored e sem segredos em arquivos rastreados; nenhum segredo no bundle do frontend; `sessions.create` confina `cwd` corretamente; logout revoga refresh token; isolamento de sandbox FS coberto por testes (`isolation-sandboxing.spec.ts`); 9 abas do admin existem com RPCs correspondentes; webhooks têm HMAC+`timingSafeEqual` quando o secret está configurado.

---

## 2. EIXO 1 — Segurança

### 2.1 RLS (migrations 001–024)

Inventário consolidado:

| Tabela | RLS | Política final | Risco |
|---|---|---|---|
| `sessions`, `workspaces_meta` | ON (002/005/006) | `tenant_id = get_current_tenant_id() AND (user_id = auth.uid() OR is_admin_or_owner())` | OK em si; colapsa via C-1 |
| `user_tenant_roles` | ON | SELECT p/ qualquer membro do tenant (`002:173-174`) | Membro enumera membros/roles — **SEC-14** |
| `audit_logs` | ON | `USING (is_admin_or_owner())` **sem filtro de tenant** (`002:214-215`) | Leitura cross-tenant — **SEC-05** |
| `llm_providers`, `llm_models`, `system_config`, `sessions_index`, `metrics_daily` | ON | `is_admin_or_owner()` FOR ALL (`008`) | Colapsa via C-1 |
| `trial_rate_limits` | **OFF** | nenhuma política (`007:57-62`) | **SEC-10** (a confirmar grants) |
| `tenants`, `users`, `app_sessions` | ON | own-row / admin-in-tenant | OK |
| `plans` | ON | ativo para todos | OK (público por design) |

- `anonymous`: só lê `plans` ativo; demais tabelas em deny implícito (RLS ON, sem política TO anon). **OK.**
- Nenhum `BYPASSRLS`, nenhum `GRANT … TO PUBLIC` em tabela; único grant de tabela: `SELECT user_tenant_roles TO supabase_auth_admin` (`004:51`, papel de sistema confiável).
- `system_config_safe` é a única view, com `security_invoker = true` (`008:143`) — configuração correta.
- Triggers 023/024: novo usuário vira `member` no tenant convidado/padrão, **nunca** owner; 024 demote owners legados e exige exatamente 1 owner. **OK.**

### 2.2 RPCs SECURITY DEFINER

~35 funções `SECURITY DEFINER`. Todas as RPCs de admin (012–022) chegam a ter: gate `is_admin_or_owner()` no início + `SET search_path = public` + `REVOKE … FROM PUBLIC` + `GRANT … TO authenticated` — **exceto**:

- `get_admin_workspaces` (6-arg, `022:49-127`): **sem REVOKE/GRANT** → EXECUTE para PUBLIC por padrão. **SEC-12**
- Sem `REVOKE … FROM PUBLIC`: `get_system_secret` (`008`), `get_llm_encryption_key` (`014`), `get_my_profile` (`003`), `increment_tenant_token_usage` (`007`). **SEC-13**
- `search_path` não fixado em: `trigger_initialize_tenant_trial` (`007:70`), `increment_tenant_token_usage` (`007:104`), `log_audit_event` (`002:245`). **SEC-23**
- `base_url` aceita e persistida sem validação de URL/host (`014:113,184,204`). **SEC-11**
- Nenhum SQL dinâmico, sem `dblink`/conexão a host.

**Achado estrutural central — `is_admin_or_owner()` (`008:10-32`):**

```sql
RETURN (
  COALESCE(auth.jwt() ->> 'role', '') IN ('owner','admin')
  OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('owner','admin')  -- cliente-controleável
  OR COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('owner','admin') -- cliente-controleável
  OR EXISTS (SELECT 1 FROM public.user_tenant_roles
             WHERE user_id = auth.uid() AND role IN ('owner','admin')) );        -- sem escopo de tenant
```

`user_metadata`/`app_metadata` são graváveis pelo próprio usuário no Supabase → **auto-elevação a admin global** (relogin). O claim derivado e tenanted `user_role` (injetado por `custom_access_token_hook`, `004:39-41`) é **ignorado** por esta função. Cascata: `get_system_secret('LLM_ENCRYPTION_KEY')` + `llm_providers.api_key_encrypted` expõe a chave mestra e todas as API keys dos providers (C-2 cascade); `admin_update_user_role` (`013:13-75`) vira primitiva de promoção arbitrária; RPCs de admin vazam dados de todos os tenants (`012:63`, `018:52`, `020:48,150`). Nota de correção: `get_system_secret` hoje grava `audit_logs(resource, metadata)` — colunas que não existem (`002:33-45` define `resource_type/resource_id`), então o RPC erroa em runtime; ao "corrigir" viraria o exploit limpo.

### 2.3 Validação de input / sandbox

- `sessions.create`: **OK** — `cwd` resolve para `resolveUserSandboxRoot(tenant,user)` e passa por `assertPathInSandbox` (`packages/api/session-controller/src/commands.ts:93,105-108`), erro `session/cwd-outside-sandbox`.
- `workspace.create`: **VIOLADO** — ramo absoluto contém (`assertPathInSandbox`), ramo relativo só faz `resolve(sandboxRoot, request.path)` (`commands.ts:52-56`), que normaliza `..` lexicalmente: `resolve('/var/cm/T/U/workspaces', '../../../../etc')` → fora do sandbox. Downstream (`Workspace.create`, `packages/workspace/workspace/src/index.ts:158-163`) só `realpathNormalize`; `assertPathInManagedWorkspaces` (`sandbox.ts:106-122`) existe mas **não tem chamador em produção**. **SEC-04**
- `directory-picker`: `list`/`createDirectory` contêm (`:90`, `:158-159`); o retorno nativo `pick` não re-confina (`:59-68`) — aceitável pois o `create` real confina (exceto pelo SEC-04).
- `assertPathInSandbox` é lexical: não faz `realpath` no alvo (symlink pré-existente dentro do sandbox apontando para fora passaria). `~` não é expandido (íngreme mas contido). **SEC-22**

### 2.4 Autenticação

- **Dois sistemas**: cookie de sessão do harness (`browser-auth.ts`) + conta Supabase (`apps/web/src/lib/auth/`).
- Supabase client **sem opção `storage`** → sessão em `localStorage` (XSS exfiltra access+refresh token). Sem PKCE/flowType. **SEC-07**
- `autoRefreshToken: true` → há refresh flow. **OK**
- Logout: `supabaseClient.auth.signOut()` (`auth.provider.tsx:177-181`) → revoga refresh no servidor. **OK**
- Cookie do harness: `HttpOnly; SameSite=Strict`, mas **sem `Secure`** (`browser-auth.ts:121-123`); vida fixa 30 dias (`cookieMaxAgeDays`, `packages/client/connection/src/index.ts:108`), sem renovação. **SEC-09**
- Rate limit: **não encontrado** na camada Node (grep `429|rate.?limit|throttle` em webserver/api) → delegado a Supabase/Cloudflare, **a confirmar**. **SEC-17**
- Enumeração de e-mail: `/register` revela "já cadastrado" (`auth-error-utils.ts:24-26`); login diferencia "não confirmado" de credenciais inválidas (`:18-22`). **SEC-18**

### 2.5 CORS e headers

- **Sem CORS** no sentido clássico: modelo de confiança via fence same-origin — `isTrustedApiRequest` rejeita `sec-fetch-site: cross-site` e exige `Origin === Host` (`packages/client/connection/src/api-request-trust.ts:91-118`; rejeição em `rpc-host.ts:97-100`). `trustedHosts` = IPs LAN + flag `--trusted-host` (`web-app` index.ts:125-132; `packages/bundle/web-app/cordis.patch.yml:188`). `app.copymonster.co` **não aparece em nenhum config do repo** → a confirmar no deploy (se ausente, `/api` responde 403 para aquela origem).
- Headers de segurança: **nenhum** `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options: nosniff` global, `Referrer-Policy` global, HSTS em HTML/assets. O único CSP existe em `/api/file` (mídia): `Content-Security-Policy: sandbox; default-src 'none'` + `nosniff` (`media-references.ts:17-19`); `referrer-policy: no-referrer` só no redirect `/enter` (`auth-http/index.ts:119`). **SEC-08**
- HSTS: **não encontrado** no Node → depende do Cloudflare, a confirmar.

### 2.6 Dependências

- `pnpm audit`: **105 vulnerabilidades — 1 critical, 43 high, 51 moderate, 10 low**.
  - **Critical:** `vitest 1.6.1` (<3.2.6, GHSA-5xrq-8626-4rwp) via `auth-context`/`auth-http`/`supabase-client` declarando `^1.0.0`.
  - High relevantes: `js-yaml <4.3.0` (root, cli, app-boot), `pnpm` (apps/desktop), `vite ≤6.4.2` (via vitest), `undici` (jsdom, http-proxy, web-fetch-http), `fast-uri` (electron-builder), `brace-expansion`.
- Versões: `@supabase/supabase-js 2.116.0` (OK), `react/react-dom 18.3.1`, `vite 5.4.21/6.4.3/8.0.16`, `typescript 5.9.3/6.0.3`.
- `stripe` **não é dependência** — integração hand-rolled (`fetch` + `node:crypto` em `billing.ts`), server-side apenas.
- Nenhum segredo no `pnpm-lock.yaml`.

---

## 3. EIXO 2 — Branding (DeepSeek Harness → CopyMonster)

Renomeação **parcial**: title da aba, wordmark, manifest e README de produto estão OK; shell DSH embutido ainda vaza a marca.

| # | Ponto | Evidência | Classif. |
|---|---|---|---|
| BRN-01 | **System-prompt: a IA se identifica como "DeepSeek Harness"** — `includeHarnessIdentity` default `true` e o bundle `copymonster` não o desliga | `packages/core/system-prompt/src/index.ts:426-430` (`'You are an AI agent powered by DeepSeek Harness.'`); `packages/bundle/copymonster/cordis.patch.yml` não configura system-prompt | UI-visível (model) — ALTO |
| BRN-02 | Boas-vindas do modal Models: "DeepSeek Harness 0.1 remains in testing for Harness developers… DSH plugin ecosystem" | `packages/client/ui-settings-models/src/client/locales.ts:100` (en) / `:211` (zh) | ALTO |
| BRN-03 | Guia de plugins: "can damage DeepSeek Harness or leak your data" | `packages/client/ui-plugin-manager/src/client/locales.ts:236` / `:74` | ALTO |
| BRN-04 | Erro do preview Office: "Enable the document preview service on the computer running DeepSeek Harness" | `packages/client/ui-sidebar-documentpreview/src/client/office/locales.ts:37` / `:13` | ALTO |
| BRN-05 | **Erros exibidos crús sem sanitização**: ErrorBoundary mostra `error.message` verbatim; `displayFailure` mostra `record.message` ou `JSON.stringify(failure)`; auth errors não mapeados retornam `rawMessage` → nomes `@deepseek-ai/dsh-*` e paths podem surfar | `apps/web/src/main.tsx:109`; `packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts:151-162`; `apps/web/src/lib/auth/auth-error-utils.ts:51` | ALTO |
| BRN-06 | README raiz ainda é "# DeepSeek Harness" (EN+ZH), docs deepseek-harness.github.io, `npx @deepseek-ai/dsh` | `README.md:1,5,9,24,34-38`; `README.zh.md` | MÉDIO |
| BRN-07 | Painel admin: selo "DSH Web Frontend" e paths `/var/dsh/*` exibidos ao admin | `apps/web/src/pages/admin/tabs/AdminSystemTab.tsx:448,374-376`; `AdminSessionsTab.tsx:42` | MÉDIO |
| BRN-08 | HTML/manifest incompletos: sem `meta description`, `og:*`, `theme_color` | `apps/web/index.html:6-8`; `apps/web/public/manifest.webmanifest` | MÉDIO |
| BRN-09 | Risco de rebuild: `DEFAULT_CLIENT_TITLE = 'DSH Local Build'` e `build:official` injeta `DSH_CLIENT_TITLE: 'DeepSeek Harness'` (build atual NÃO define o title → hoje mostra "CopyMonster" via `brand.localBuild`) | `apps/web/vite.config.ts:14`; `scripts/client-build-environment.ts:22`; `.dsh-build/client-build-environment.json` | MÉDIO |
| BRN-10 | E-mails transacionais (magic link, reset, confirmação): **não existem no repo** — vivem no dashboard do Supabase; revisar lá o branding (CopyMonster, sem "DeepSeek") | `não encontrado` no repo | MÉDIO (a confirmar no dashboard) |
| BRN-11 | Logs de diagnóstico de startup sem redação (`util.inspect showHidden:true, depth:null`), aviso próprio: "Raw diagnostics may contain configuration or credential values" | `apps/cli/src/startup-diagnostics.ts:40-56`; logs em `~/.dsh/logs` (`packages/util/home-paths/src/index.ts:12`) | MÉDIO |
| BRN-12 | Badge de versão alpha do harness no sidebar (`0.1.6-alpha.2-…`) | `packages/client/ui-sidebar/src/client/SidebarRoot.tsx:41-48` | BAIXO |
| BRN-13 | Internos: tokens CSS `--dsw-static-deepseek-*`, `#dsh-web-root`, `__DSH_*` em `globalThis` (não visíveis ao usuário) | `design-platform.css:22-32`; `apps/web/src/main.tsx:19,33,59,66,173` | BAIXO |

**Verificado OK:** `<title>CopyMonster</title>` (`index.html:8`); `manifest.webmanifest` name "CopyMonster"; `favicon.svg`/`brand.png` sem marca DSH; `BrandWordmark.tsx` renomeado p/ "CopyMonster"; `brand.localBuild` = "CopyMonster"; `AdminLLMProvidersTab.tsx:20` `label: 'DeepSeek'` é **provedor LLM legítimo** (manter).

---

## 4. EIXO 3 — Funcionalidades

### 4.1 Fluxos principais (3.1)

| Etapa | Estado | Evidência |
|---|---|---|
| Signup | `signUp` ok; **sem landing de "confirme seu e-mail"** — banner + redirect p/ `/login` em 3s | `RegisterPage.tsx:68-69` — FUN-06 |
| Email confirm | `detectSessionInUrl: true` cobre hash de reset; confirmação depende do redirect padrão do Supabase p/ root — a confirmar | `supabase.client.ts:293` |
| Login | `signInWithPassword` + erros mapeados | `auth.provider.tsx:150` |
| Reset | `ResetPasswordPage` reidrata sessão do hash do URL via `getSession()` — **não testado em repo** (recovery-hash) | `ResetPasswordPage.tsx:16-38,58` — FUN-07 |
| Tenant | trigger `handle_new_user` (023) cria user como **member** no tenant convidado ou default `…000000000001` ("Integridade Digital", seed 001:135-143); nunca cria tenant nem owner → **SaaS mono-tenant na prática** | `023:31-83` |
| Workspace → chat | chat = shell DSH web (`LazyWebApp` = `dsh-client-web`), não há página custom; sessão criada via `SessionCommandController.create` com CWD contido | `main.tsx:132-176,366-373`; `session-controller/commands.ts:88-141` |
| JWT claims | `tenant_id`/`user_role` entram no JWT **apenas** se `custom_access_token_hook` estiver habilitado no dashboard Supabase (comentário `004:9-11`) → a confirmar no deploy | `004:14-44` — FUN-09 |

### 4.2 Painel Admin (9 abas)

**As 9 abas existem** (`AdminModal.tsx:39-49`): Overview (`AdminOverviewTab`), Users (`AdminUsersTab`), Tenants (`AdminTenantsPage`), LLM Providers (`AdminLLMProvidersTab`), Models (`AdminModelsTab`), Settings (`AdminSystemTab`), Sessions (`AdminSessionsTab`), Audit (`AdminAuditPage`), Billing (`AdminBillingTab`).

- Guard: botão só renderiza p/ admin (`FooterActionsRoot.tsx:78,123`) + `isAuthorized = role ∈ {owner,admin}` (`AdminModal.tsx:77`); server-side todas as RPCs admin têm `IF NOT is_admin_or_owner() THEN RAISE`.
- Cross-check RPC↔migrations: todos existem com `GRANT EXECUTE TO authenticated` (012/013 users, 014 providers, 015 models, 016/017 config+storage, 018/019 sessions, 020 billing, 009/011 metrics).
- **MÉDIO (FUN-08):** tabs também fazem reads diretos de tabelas (`audit_logs`, `llm_providers`, `metrics_daily`, `sessions_index`, `tenants`) — defesa 100% RLS e **nenhum teste de RLS verificado no repo**.

### 4.3 Billing / Stripe

- Stripe: **sem dependência npm**; Node fala direto com `api.stripe.com/v1` com `STRIPE_SECRET_KEY` (`billing.ts:13,93-120,190`).
- Webhooks (`billing.ts:355-458`): `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_succeeded` (zera `current_period_tokens_used`), `invoice.payment_failed` → `past_due`. Assinatura HMAC-SHA256 + `timingSafeEqual`, tolerância 300s (`:125-167`) — **mas só quando `STRIPE_WEBHOOK_SECRET` está set** (`:335-344`). **FUN-04/SEC-06**
- **`current_period_end` nunca é escrito** por nenhum handler/trigger — apenas coluna (`002:28`), reads na UI (`PlansPage.tsx:392`, `AdminBillingTab.tsx:579`) e projeção em `020:182`. "Próxima cobrança" sempre nula. **FUN-01**
- Trial: start por trigger (`007:67-95`, 7 dias); expiração por 1M tokens via `increment_tenant_token_usage` (`007:98-131`); **expiração por tempo não é aplicada em lugar nenhum** — `isExpired` é só view em `settings-controller/src/index.ts:422`; `session-controller` **não verifica `subscription_status`** (grep zero) → tenant com trial expirado continua criando sessões. **FUN-02**
- Metering: `recordTokenUsage` (`settings-controller:529-560`) **não tem caller em runtime** (só testes) → `trial_tokens_used`/`current_period_tokens_used` nunca avançam; `public.sessions`/`sessions_index` não têm writer no repo (só backfill de leitura `010:62-80`) → abas Sessions/Billing podem ficar vazias em runtime. **FUN-03**
- **Price IDs mensais divergem UI × DB** (anuais batem):
  - UI `PlansPage.tsx:39,65`: Starter `price_1UMC67…`, Pro `price_1UMC4l…`
  - DB `007:19-20`: Starter `price_1SqRcb…`, Pro `price_1SqRe4…`
  - checkout envia o `priceId` da UI (`PlansPage.tsx:246-269` → `billing.ts:202`); webhook resolve `plan_id` pelos IDs do DB (`billing.ts:383-388`) → assinatura monthly ativa sem `plan_id` correto no tenant. **FUN-05**
- Cancel: `BillingCancelPage` é só landing de `cancel_url` (estático); cancelamento real via Customer Portal (URL hardcoded `PlansPage.tsx:28`) ou `POST /api/billing/portal` (`billing.ts:271-323`). **FUN-10**
- Verificado por teste: `billing.spec.ts` (checkout, webhook c/ assinatura, portal).

### 4.4 Isolamento multi-tenant

- **Coberto por teste** (`workspace-controller/tests/isolation-sandboxing.spec.ts`): picker rejeita `/etc/shadow` e criação em `/root`; feed filtra workspaces de outro tenant e "VPS host secret"; `create` fora do sandbox rejeitado; `delete` alheio rejeitado; auto-provision de workspace `default` dentro do sandbox.
- Scoping: sandbox FS `<COPYMONSTER_DATA_DIR>/<tenant>/<user>/workspaces` (`sandbox.ts:33-44`); CWD de sessão contido (`commands.ts:93,108`); RLS de `sessions`/`workspaces_meta` por tenant+user (`006`); `sessions_index` member vê só `user_id = auth.uid()` (`008:202-206`); browse cross-tenant só via `get_admin_sessions` (guard).
- Lacunas: SEC-04 (traversão em `create` relativo) e C-1 (admin colapsa tudo). `get_current_tenant_id` lê `app.current_tenant_id` do session var (`006:30-34`) — a confirmar se client pode setar. **SEC-15**

### 4.5 Features DSH

- Bundle `copymonster` = só auth-context + auth-http sobre o profile `web` (`cordis.patch.yml:10-17`); presets vêm do bundle `web-app` (`web-app/cordis.patch.yml:513-515`): `default: standard`.
- Presets shipped: **standard, minimal, cordis, ptc**. **"creator" e "sdr": não encontrados** (não existem no repo).
- Tools do `standard`: bash (off em win32), fs, fs-search, jobs, skill, goal, plan-mode, compaction, subagent (fork/control), workflow-ptc, todo, web-fetch, ask-user, present — **funcionam por snapshot** (`snapshots/web/minimal-preset`, `preset-migration`, `ptc-round`); **não há snapshot nomeado "copymonster"**.
- **LLM providers desconectados (FUN-07, ALTO):** tabelas `llm_providers`/`llm_models` + OpenRouter seed (`021`) + admin UI **não são lidas por nenhum pacote do harness** (grep zero fora RPCs/UI). O runtime usa settings próprios do harness (`settings-controller/src/index.ts:108`, namespaces `llm-*`; catálogo `llm-pi-ai` suporta `openrouter` em `packages/llm/llm-pi-ai/src/catalog.ts:102`). Gerenciar provider/secret no admin **não afeta** a rota de modelo efetiva.

---

## 5. EIXO 4 — Layout / UX

### 5.1 Consistência visual

- Paleta institucional **coerente** (cores `#E7BF73` 14 arquivos, `#161b22` 14, `#0d1117` 13, `#30363d` 13, `#D8AE5F` 10).
- Off-palette: `#58a6ff` (`billing.css:200`, `AdminAuditPage:110`, `AdminTenantsPage:142`), `#388bfd` (`billing.css:106`), `#2ea043` (`billing.css:64`), `text-blue-400/bg-blue-500` (badge DeepSeek, `AdminLLMProvidersTab:243`), laranja `#ff6b00` (`AppFrame.css:31`). **UX-10**
- Fontes: 13px×16 / 14px×10 dominantes; outliers `text-[11px]`×71, `text-[10px]`×25 (admin), 28/26/20/18/16px em títulos. **UX-11**

### 5.2 Estados de UI

- Loading: spinners em todos os 8 tabs admin + main + RoleGate; skeletons em Sessions/Overview/Billing; auth tem "saving". **OK** (padronizar em `<Spinner/>` — UX-12).
- Erro+retry: presente em 6 tabs; **misto** — "Tentar novamente"×6 vs "Retry" (`AdminBillingTab:467`). **UX-09**
- Vazio: "Nenhum…" consistente em todos os tabs. **OK**
- Sem permissão: RoleGate com fallback null; não há tela de acesso negado dedicada.

### 5.3 Responsividade

- **Modais 800px fixos sem `@media`** no module CSS; em telas <~600px o `navRail` (196px) não colapsa e comprime o conteúdo (`FooterActionsRoot.module.css:81-95,103`). Único `@media (max-width:768px)` do app é `billing.css:79`. **UX-05**
- AppFrame é topbar (breadcrumb+back) sem sidebar; a "sidebar" real é o navRail dos modais (não colapsa). **UX-05/UX-17**
- Tabelas: `overflow-x-auto` em todas as tabelas admin. **OK**
- Touch targets: `.railCell height:36px`, botões de back `padding:6px 14px` — abaixo de 44px. **UX-08**

### 5.4 Acessibilidade

- Modais (Admin/Plans/Profile): `role="dialog"` + `aria-modal="true"` + `aria-label` + `tabIndex=-1`, focus no open, Escape fecha, foco restaurado ao trigger (`AdminModal.tsx:59-71,84-90`; idem em `PlansModal.tsx`, `ProfileModal.tsx`). **Faltando: focus-trap** (Tab escapa para o background) e `aria-labelledby`. **UX-06**
- Botões só-ícone (modo compacto) usam `title` (SVG aria-hidden), não `aria-label` (`FooterActionsRoot.tsx:93,110,129,151`). **UX-07**
- **Zero `:focus-visible` no app** (só `:focus` de inputs/select) → teclado sem indicador de foco. **UX-04**

### 5.5 Internacionalização (EN + ZH)

- Dicionários `en.ts`/`zh.ts`: **31 chaves idênticas em ambos** (paridade total), mas só **21 chamadas de `t()` em 5 arquivos** (`AdminModal`, `ProfileModal`, `PlansModal`, `FooterActionsRoot`, `ProfilePage`).
- **PT-BR hardcoded** (viola política "nunca PT-BR na UI"): mapa completo de erros auth (`auth-error-utils.ts:22-48`), `main.tsx` (103/109/117/183/197/284/299), `auth.provider.tsx:228`, 8 admin tabs (ex.: `AdminUsersTab.tsx:265,296,325,424,527,541,550,559`; `AdminModelsTab.tsx:246,358,481,612,818`), `AdminAuditPage:185`, `AdminTenantsPage:195`. **UX-01**
- **EN hardcoded** em JSX: `PlansPage.tsx` inteiro (33/47/87/98-105/330/349/353/358/389/404/457/507), `AppFrame.tsx:10,36` ("Plans & Billing", "Voltar ao Chat"). **UX-01**
- **Sem seletor de idioma na UI**: `getActiveLocale()` lê só `localStorage('dsh_locale')`/`navigator.language` (`locales/index.ts:7-13`); sem React context/provider; 3 mecanismos paralelos (dict `t()`, arrays `labelEn/labelZh` inline em `AdminModal.tsx:39-49`/`ProfileModal.tsx:21-24`, hardcoded). **UX-02**
- Datas/moeda: tags **hardcoded e mistas** — `en-US` em `AdminBillingTab.tsx:141,148,155,315,326,337` (com `currency:'USD'`) e `PlansPage.tsx:394`; `pt-BR` em `AdminOverviewTab:134,141`, `AdminSystemTab:562,657,746,936`, `AdminSessionsTab:256,372,379,386,393,801`, `AdminUsersTab:197`, `AdminAuditPage:192,267`, `AdminTenantsPage:218`. Nenhum `Intl` usa o locale ativo. **UX-03**

### 5.6 Páginas específicas

- Login/Register/Forgot/Reset: existem; sem PT-BR **não** (há PT hardcoded — UX-01).
- Sidebar: Plans/Profile/Admin visíveis via `FooterActionsRoot`; Settings não é item da rail (é modal/aba admin) — verificar se atende ao esperado.
- Chat: input/envio/streaming pelo shell DSH web (`ui-chat`/`ui-conversation`); teste de snapshot de PTC existe.

---

## 6. EIXO 5 — Operação / Infra

*(Itens de VPS marcados "a confirmar" — o repo não contém o artefato.)*

| # | Item | Estado no repo | Evidência |
|---|---|---|---|
| OPS-01 | systemd unit `copymonster.service` | **Não existe no repo** (só menções em docs) → `Restart=`, `User=`, `EnvironmentFile=`, `ExecStart` a confirmar; hoje `User=root` subótimo | menções: `docs/roadmap/plano-auditoria-correcoes-copymonster.md:264`, `docs/AUDIT-REPORT-COMPLETE.md` |
| OPS-02 | Cloudflare Tunnel | **Não documentado no repo** (sem config.toml/token/hostname); webserver default `127.0.0.1:3080` → tunnel deve apontar para `127.0.0.1:3080`; HSTS a confirmar | `packages/bundle/web-app/cordis.patch.yml:138-139`; `docs/AUDIT-REPORT-COMPLETE.md:259` |
| OPS-03 | Backups | 1 tarball manual de 2026-09-27 (58 MB, git-ignored) em `backups/`; **sem procedimento** de `pg_dump` do Supabase nem de `~/.dsh` (sessions/workspaces) documentado | `backups/copymonster-backup-20260927-0622.tar.gz` |
| OPS-04 | Monitoramento | **Sem endpoint `/health`** em webserver/api (grep `/health|/ready|/status` vazio); sem alertas/métricas de 5xx no repo | `packages/host/webserver/src` (só boot-injection em `injections.ts:79`) |
| OPS-05 | Deploy/rollback/staging | **Sem scripts** — apenas checklists manuais (`docs/AUDIT-REPORT-COMPLETE.md` "Fase C"); sem staging | grep `deploy\|rollback\|staging` |
| OPS-06 | Build/serve | `apps/web` **não** serve via Vite standalone (plugin `rejectStandaloneServe` lança erro em `vite serve`); produção = processo `dsh web` servindo `apps/web/dist` na 3080 (`webserver` + `web-runtime` resolvem o dist) → documentar `ExecStart` exato | `apps/web/vite.config.ts`; `web-app/cordis.patch.yml:134-161,181-188` |
| OPS-07 | `.env.systemd` | Existe na raiz (git-ignored) com as 5 variáveis de produção (`SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) — precisa estar no `EnvironmentFile=`; perm 600; a linha 1 comenta rotação do webhook secret | `.env.systemd` |

---

## 7. Tabela-Mestre de Achados

Legenda esforço: **S** < 1 dia · **M** 1–5 dias · **L** > 1 semana.

| # | Eixo | Item | Arquivo:linha | Severidade | Recomendação | Esforço |
|---|---|---|---|---|---|---|
| SEC-01 | 1.2/1.3 | `is_admin_or_owner()` confia em `app_metadata.role`/`user_metadata.role` do JWT + `EXISTS` sem escopo de tenant → auto-admin global | `supabase/migrations/008_admin_expanded_backend.sql:20-29` | CRÍTICO | Nova migration: autoridade **somente** via `user_tenant_roles` com escopo de tenant (ou claim `user_role` derivado p/ UI, nunca claims metadata do JWT); auditoria de quem já se elevou | M |
| SEC-02 | 1.3 | `get_system_secret`/`get_llm_encryption_key` expõem chave mestra + API keys (cascata do SEC-01); `get_system_secret` grava colunas inexistentes (`resource`,`metadata`) | `008:146-173`; `014:26-45`; `008:163` vs `002:33-45` | CRÍTICO | Corrigir junto do SEC-01; REVOKE/GRANT; corrigir insert em audit_logs para `resource_type/resource_id` | S |
| SEC-03 | 1.3 | `admin_update_user_role` promove qualquer usuário a owner/admin (guards assumem admin legítimo) | `013:13-75` | CRÍTICO | Com SEC-01: escopar por tenant, banir self-promotion, exigir log de auditoria | M |
| SEC-04 | 1.4 | `workspace.create` path relativo sem `assertPathInSandbox` → registro de workspace em diretório arbitrário do host | `packages/api/workspace-controller/src/commands.ts:52-56` | CRÍTICO | Sempre passar por `assertPathInSandbox` (ou rejeitar relativo); aplicar `assertPathInManagedWorkspaces` no create; teste de traversão (`../../../../`) | S |
| SEC-05 | 1.2 | Admin RPCs/políticas vazam dados de **todos** os tenants (audit_logs sem tenant_id; get_admin_users/sessions/billing; FOR ALL em 008) | `002:214-215`; `012:63`; `018:52`; `020:48,150`; `008:49-54,80-85,195-234` | ALTO | (Mono-tenant hoje: impacto futuro) escopar policies/RPCs por `tenant_id` ou documentar "admin global por design" com gate forte do SEC-01 | M |
| SEC-06 | 1.3/3.3 | Webhook Stripe processa sem verificar assinatura quando `STRIPE_WEBHOOK_SECRET` ausente (fail-open) | `packages/api/auth-http/src/billing.ts:335-344` | ALTO | Fail-closed: 500/400 permanente se secret não configurado (ou startup abort) | S |
| SEC-07 | 1.5 | Sessão Supabase em `localStorage` (sem `storage` override/PKCE) → XSS exfiltra tokens | `apps/web/src/lib/auth/supabase.client.ts:286-296` | ALTO | Cookie+PKCE (flowType) ou, no mínimo, CSP forte (SEC-08) + sanitização de erros | M |
| SEC-08 | 1.6 | Sem CSP, X-Frame-Options/frame-ancestors, nosniff global, Referrer-Policy global, HSTS (Node) | `packages/host/webserver/src/index.ts`; `packages/host/frontend-static/src/index.ts:134-147` | ALTO | Headers de segurança na camada Node p/ HTML/assets; HSTS via CF (a confirmar) | M |
| SEC-09 | 1.5 | Cookie de sessão sem `Secure` (pode trafegar por HTTP) | `packages/client/connection/src/browser-auth.ts:121-123` | ALTO | Adicionar `Secure` (TLS garantido no CF) | S |
| SEC-10 | 1.2 | `trial_rate_limits` sem RLS e sem policies (única tabela "desprotegida") | `007:57-62` | ALTO | `ENABLE ROW LEVEL SECURITY` + deny default (ou validar grants efetivos no DB) | S |
| SEC-11 | 1.3 | `base_url` de LLM persistida sem validação (config poisoning / vetor SSRF) | `014:113,184,204` | ALTO | Validar scheme/host (allow-list https) no save RPC | S |
| SEC-12 | 1.3 | `get_admin_workspaces` (6-arg, 022) sem REVOKE FROM PUBLIC/GRANT | `022:49-127` | ALTO | Adicionar `REVOKE … FROM PUBLIC` + `GRANT … TO authenticated` | S |
| SEC-13 | 1.3 | Helpers DEFINER abertos a PUBLIC: `get_system_secret`, `get_llm_encryption_key`, `get_my_profile`, `increment_tenant_token_usage` | `008`; `014`; `003`; `007` | MÉDIO | REVOKE/GRANT nas 4 funções | S |
| SEC-14 | 1.2 | Membro lê todas as roles do tenant (enumeração de membros) | `002:173-174` | MÉDIO | Restringir SELECT a `user_id = auth.uid() OR is_admin_or_owner()` | S |
| SEC-15 | 1.2 | `get_current_tenant_id` lê `app.current_tenant_id` (session var) — a confirmar se client pode setar | `006:30-34` | MÉDIO | Validar caminho de set no deploy; preferir JWT-first, fallback owner-of-tenant | S |
| SEC-16 | 1.3 | Wildcards ILIKE/LIKE não escapados em buscas admin (`%`,`_`) | `012:91-93`; `018:83-85`; `020:156-160`; `016:46`; `022:101-103` | MÉDIO | Escapar metacaracteres nos parâmetros | S |
| SEC-17 | 1.5 | Sem rate limit na camada Node (delegado a Supabase/CF) — a confirmar | grep em webserver/api | MÉDIO | Verificar config GoTrue/CF; adicionar 429 na front de auth se ausente | M |
| SEC-18 | 1.5 | Enumeração de e-mail via mensagens de register/login | `apps/web/src/lib/auth/auth-error-utils.ts:18-26` | MÉDIO | Mensagem única p/ conhecido/desconhecido | S |
| SEC-19 | 1.1/5 | `.env:17` corrompido: `STRIPE_SECRET_KEY=sk_live_…>STRIPE_WEBHOOK_SECRET=whsec_…` → key Stripe inválida em runtime (harness carrega `.env`) | `.env:17` (local, git-ignored) | CRÍTICO (ops) | Quebrar em 2 linhas; validar parse do env; `set -a; source` em smoke test | S |
| SEC-20 | 1.1/5 | Segredos live em disco (`.env`, `.env.local`, `.env.systemd`): service-role JWT, sk_live, whsec | raiz do repo | ALTO (ops) | `chmod 600`; fora de backups/logs; rotação periódica; git-ignore já ok | S |
| SEC-21 | 1.7 | `pnpm audit`: 1 critical (vitest 1.6.1), 43 high (js-yaml, pnpm, vite, undici…) | `pnpm-lock.yaml`; pkg jsons | MÉDIO | Bump vitest ≥3.2.6 (ou alinhar 4.x), js-yaml ≥4.3.0; triage o resto (maioria dev tooling) | M |
| SEC-22 | 1.4 | `assertPathInSandbox` lexical (sem realpath no alvo) — symlink p/ fora passaria | `packages/workspace/workspace/src/sandbox.ts:79-90` | BAIXO | `realpath` o alvo antes do `startsWith` | S |
| SEC-23 | 1.3 | `search_path` não fixado em `trigger_initialize_tenant_trial`, `increment_tenant_token_usage`, `log_audit_event` | `007:70,104`; `002:245` | BAIXO | `SET search_path = public` nas funções vivas | S |

| # | Eixo | Item | Arquivo:linha | Severidade | Recomendação | Esforço |
|---|---|---|---|---|---|---|
| BRN-01 | 2 | System-prompt: IA se identifica "powered by DeepSeek Harness" (default `true`, bundle não desliga) | `packages/core/system-prompt/src/index.ts:426-430` | ALTO | `includeHarnessIdentity: false` no bundle `copymonster` + personaPrefix CopyMonster; snapshot | S |
| BRN-02 | 2.1 | Welcome do modal Models "DeepSeek Harness 0.1… DSH plugin ecosystem" | `ui-settings-models/src/client/locales.ts:100,211` | ALTO | Reescrever copy p/ CopyMonster (en+zh) | S |
| BRN-03 | 2.1 | Guia de plugins "damage DeepSeek Harness" | `ui-plugin-manager/src/client/locales.ts:236,74` | ALTO | Reescrever (en+zh) | S |
| BRN-04 | 2.1 | Erro Office preview "computer running DeepSeek Harness" | `ui-sidebar-documentpreview/.../office/locales.ts:37,13` | ALTO | Reescrever (en+zh) | S |
| BRN-05 | 2.4 | Erros crús na UI (ErrorBoundary `error.message`, `displayFailure`, auth raw) → nomes de pacote/paths podem surfar | `apps/web/src/main.tsx:109`; `event-projection.ts:151-162`; `auth-error-utils.ts:51` | ALTO | Sanitizar/truncar: mapear erros conhecidos, fallback genérico, bloquear regex de `@deepseek-ai/`/`packages/`/paths | M |
| BRN-06 | 2 | README raiz EN+ZH ainda "DeepSeek Harness" + doc link upstream | `README.md:1,5,9,24,34-38`; `README.zh.md` | MÉDIO | README de produto CopyMonster na raiz (ou mover upstream p/ `docs/`) | S |
| BRN-07 | 2.1 | Admin: "DSH Web Frontend" + paths `/var/dsh/*` | `AdminSystemTab.tsx:448,374-376`; `AdminSessionsTab.tsx:42` | MÉDIO | Usar `get_admin_storage_paths` como fonte (já existe, mig 017) e renomear selo | S |
| BRN-08 | 2.2 | Meta description, og:*, theme_color ausentes | `apps/web/index.html:6-8`; `public/manifest.webmanifest` | MÉDIO | Completar metadata + manifest + OG p/ app.copymonster.co | S |
| BRN-09 | 2.2 | `build:official` injetaria `DSH_CLIENT_TITLE: 'DeepSeek Harness'`; default `DSH Local Build` | `apps/web/vite.config.ts:14`; `scripts/client-build-environment.ts:22` | MÉDIO | Definir `DSH_CLIENT_TITLE=CopyMonster` no ambiente de build oficial | S |
| BRN-10 | 2.3 | E-mails transacionais vivem no dashboard Supabase (não no repo) — branding a revisar lá | não encontrado no repo | MÉDIO | Configurar templates Supabase com marca CopyMonster (a confirmar) | S |
| BRN-11 | 2.5 | Diagnostics de startup sem redação (podem conter credenciais) | `apps/cli/src/startup-diagnostics.ts:40-56` | MÉDIO | Redigir chaves/headers no dump; documentar "não compartilhar" | M |
| BRN-12 | 2.1 | Badge de versão alpha do harness no sidebar | `ui-sidebar/.../SidebarRoot.tsx:41-48` | BAIXO | Ocultar/mapear p/ versão do produto | S |
| BRN-13 | 2.1 | Internos `--dsw-static-deepseek-*`, `#dsh-web-root`, `__DSH_*` (não visíveis) | `design-platform.css:22-32`; `main.tsx:19,33,59,66,173` | BAIXO | Deixar como está (rename global do fork = L, sem ganho de segurança) | L |

| # | Eixo | Item | Arquivo:linha | Severidade | Recomendação | Esforço |
|---|---|---|---|---|---|---|
| FUN-01 | 3.3 | `current_period_end` nunca escrito → "próxima cobrança" sempre nula; período de billing inexistente no DB | `002:28` (coluna); reads em `PlansPage.tsx:392`, `020:182`; zero writers | ALTO | Escrever no webhook `customer.subscription.updated` (`current_period_end` do objeto Stripe) e em `checkout.session.completed` | M |
| FUN-02 | 3.3 | Trial expirado não bloqueia sessões — `isExpired` é só view; `session-controller` não checa subscription | `settings-controller/src/index.ts:422`; grep zero em session-controller | ALTO | Gate em `sessions.create` (ou middleware do loop): bloquear criação p/ `trial_expired`/`canceled`/`past_due`, mensagem de upgrade | M |
| FUN-03 | 3.3 | Metering de tokens sem caller em runtime → limites de plano/trial não efetivos; `sessions`/`sessions_index` sem writer → abas Sessions/Billing vazias | `settings-controller/src/index.ts:529-560` (sem caller); `010:62-80` (só backfill de leitura) | ALTO | Chamar `recordTokenUsage` no fim de cada turno do loop (hook do harness) e popular `sessions_index` por sessão (trigger/insert) | L |
| FUN-04 | 3.3 | Webhook fail-open sem `STRIPE_WEBHOOK_SECRET` (idem SEC-06) | `billing.ts:335-344` | ALTO | ver SEC-06 | S |
| FUN-05 | 3.3 | Price IDs mensais divergem UI×DB → plan_id não casado no tenant após checkout mensal | `PlansPage.tsx:39,65` vs `007:19-20` | ALTO | Migration UPDATE dos IDs do DB p/ os do Stripe live (ou inverso, decidir única fonte) + teste de contrato UI↔webhook | S |
| FUN-06 | 3.1 | Sem landing de "confirme seu e-mail" (banner + redirect 3s) | `RegisterPage.tsx:68-69` | MÉDIO | Tela de confirmação + rota p/ o redirect do Supabase | S |
| FUN-07 | 3.1 | `ResetPasswordPage` depende de reidratação de hash não testada | `ResetPasswordPage.tsx:16-38` | MÉDIO | Teste de fluxo de recovery; tratar hash explicitamente | S |
| FUN-08 | 3.2/3.4 | Admin tabs fazem reads diretos de tabelas defendidos só por RLS; sem teste de RLS no repo | `AdminAuditPage.tsx:47`; `AdminOverviewTab.tsx:50,74,89` | MÉDIO | Adicionar testes de isolamento (postgres testcontainers/fixtures RLS) p/ os 5 reads diretos | M |
| FUN-09 | 3.1 | `custom_access_token_hook` exige habilitação manual no dashboard (claims tenant_id/user_role) | `004:9-11,14-44` | MÉDIO | Verificar no dashboard; documentar em runbook; falhar-loud se ausente (claim vazio quebra RLS) | S |
| FUN-10 | 3.3 | URL do Customer Portal hardcoded no cliente (duplica `/api/billing/portal`) | `PlansPage.tsx:28` | BAIXO | Usar o endpoint server; remover hardcode | S |
| FUN-11 | 3.2 | RoleGate/AdminModal são guards client-side (defesa real no server) — documentar | `RoleGate.tsx:20-40`; `AdminModal.tsx:77` | BAIXO | Nota em docs; sem mudança de código | S |
| FUN-12 | 3.5 | Tabelas `llm_providers`/`llm_models` (admin UI + seed OpenRouter 021) desconectadas do runtime LLM do harness | grep zero em pacotes llm/*; runtime usa settings `llm-*` (`settings-controller/src/index.ts:108`; `llm-pi-ai/src/catalog.ts:102`) | ALTO | Decidir: (a) runtime lê `llm_providers/llm_models` via service (prefere esta, single-source) ou (b) admin UI gerencia os settings do harness; hoje gerenciar no admin não muda a rota de modelo | L |
| FUN-13 | 3.5 | Presets "creator"/"sdr" mencionados na task **não existem** no repo (shipped: standard, minimal, cordis, ptc) | `packages/preset/agent-presets/presets/` | BAIXO | Não encontrado — alinhar expectativas/renomear | S |

| # | Eixo | Item | Arquivo:linha | Severidade | Recomendação | Esforço |
|---|---|---|---|---|---|---|
| UX-01 | 4.5 | PT-BR hardcoded fora dos locales (auth map, main.tsx, 8 tabs admin) + EN hardcoded em PlansPage/AppFrame; só 21 usos de `t()` em 5 arquivos | `auth-error-utils.ts:22-48`; `main.tsx:103-299`; `PlansPage.tsx:33-507`; `AdminUsersTab.tsx:265-559` etc. | ALTO | Keyificar todo o app p/ dict en+zh (política: EN+ZH, nunca PT-BR) | L |
| UX-02 | 4.5 | Sem seletor de idioma; 3 mecanismos de i18n paralelos (dict, arrays inline, hardcoded); locale só via `navigator` | `locales/index.ts:7-13`; `AdminModal.tsx:39-49,79,100` | ALTO | Único `LocaleContext`+`useT()`; remover arrays inline; botão de troca EN/ZH persistido | M |
| UX-03 | 4.5 | Datas/moedas com tags hardcoded e mistas (en-US × pt-BR), nenhuma usa locale ativo | `AdminBillingTab.tsx:141-337`; `PlansPage.tsx:394`; `AdminOverviewTab.tsx:134,141` etc. | ALTO | Helper `formatCurrency/date(value)` injetando locale ativo (USD, en/zh) | M |
| UX-04 | 4.4 | Zero `:focus-visible` → navegação por teclado sem indicador | grep vazio em `apps/web/src` | ALTO | Regra global `:focus-visible { outline: 2px solid #E7BF73 }` | S |
| UX-05 | 4.3 | Modais 800px fixos; navRail (196px) não colapsa em mobile; sem `@media` no module CSS | `FooterActionsRoot.module.css:81-95,103`; `billing.css:79` (único 768px) | ALTO | Breakpoint mobile: rail vira drawer/abas; modal `calc(100vw - 48px)` (já existe) com rail adaptável | M |
| UX-06 | 4.4 | Modais sem focus-trap; `aria-label` em vez de `aria-labelledby` | `AdminModal.tsx:84-90` (idem Plans/Profile) | MÉDIO | Trap de Tab/Shift-Tab + `aria-labelledby` p/ heading | S |
| UX-07 | 4.4 | Botões só-ícone usam `title` (não `aria-label`) no modo compacto | `FooterActionsRoot.tsx:93,110,129,151` | MÉDIO | Trocar p/ `aria-label` (keys do dict) | S |
| UX-08 | 4.3 | Touch targets < 44px (railCell 36px) | `FooterActionsRoot.module.css:129` | MÉDIO | `min-height:44px` nos alvos primários | S |
| UX-09 | 4.2 | Retry com idioma misto ("Tentar novamente" × "Retry") | `AdminBillingTab.tsx:467` vs 6 tabs em PT | BAIXO | Alinhar via dict (derivado do UX-01) | S |
| UX-10 | 4.1 | Acentos fora da paleta (azuis #58a6ff/#388bfd/#388bfd, verde #2ea043, laranja #ff6b00) | `billing.css:64,106,200`; `AdminAuditPage.tsx:110`; `AppFrame.css:31` | BAIXO | Restringir accents a gold+neutros; tokens CSS | S |
| UX-11 | 4.1 | Fontes 10–11px em admin (71× text-[11px], 25× text-[10px]) | grep em `apps/web/src` | BAIXO | Floor de 12px | S |
| UX-12 | 4.2 | Spinners/skeletons não padronizados em componente | múltiplos tabs | BAIXO | Extrair `<Spinner/>`/`<Skeleton/>` | S |

| # | Eixo | Item | Arquivo:linha | Severidade | Recomendação | Esforço |
|---|---|---|---|---|---|---|
| OPS-01 | 5.1 | `copymonster.service` fora do repo → Restart=/User=/EnvironmentFile/ExecStart a confirmar; User=root subótimo | não encontrado no repo (só docs) | ALTO | Versionar unit no repo (`deploy/copymonster.service`): `Restart=always`, `User=copymonster` (ou non-root dedicado), `EnvironmentFile=/etc/copymonster/.env.systemd`, `ExecStart` explícito | S |
| OPS-02 | 5.2 | Cloudflare Tunnel não documentado; HSTS a confirmar; webserver em `127.0.0.1:3080` | `web-app/cordis.patch.yml:138-139`; `docs/AUDIT-REPORT-COMPLETE.md:259` | ALTO | Documentar/ versionar config do tunnel (service) apontando p/ `127.0.0.1:3080`; exigir TLS+HSTS no CF | S |
| OPS-03 | 5.3 | Sem backup documentado de Supabase (pg_dump) nem de `~/.dsh`; só 1 tarball manual de 27/09 | `backups/` (git-ignored, 58 MB) | ALTO | systemd-timer: pg_dump diário + rsync `~/.dsh` → storage offsite; teste de restore trimestral; runbook | M |
| OPS-04 | 5.4 | Sem `/health`, sem alertas de 5xx, sem métricas | grep vazio em webserver/api | ALTO | `GET /health` (process + ping Supabase); alerta externo (CF health/UptimeRobot); log de 5xx agregado | M |
| OPS-05 | 5.5 | Sem script de deploy/rollback/staging; só checklists | `docs/AUDIT-REPORT-COMPLETE.md` (Fase C) | MÉDIO | `deploy.sh` idempotente (build → swap dist → `systemctl restart`), tag por release, rollback p/ tag anterior; staging opcional p/ validar webhooks | M |
| OPS-06 | 5.5/2.2 | Comando exato de produção não documentado: `dsh web` servindo `apps/web/dist` na 3080 (bare Vite é bloqueado por design) | `apps/web/vite.config.ts` (rejectStandaloneServe); `web-app/cordis.patch.yml:134-188` | MÉDIO | Documentar `ExecStart`/runbook de build+serve; smoke test pós-deploy p/ `/enter` | S |
| OPS-07 | 5.1 | `.env.systemd` com segredos live na raiz do repo (git-ignored) | `.env.systemd` | MÉDIO | Mover p/ `/etc/copymonster/`, perm 600, dono non-root | S |

---

## 8. Prioridades e Matriz de Ação para Produção

Critério de ordenação: **Severidade Crítica > Risco Financeiro/Billing > Integridade do Sandbox > Identidade de Produto (Branding) > Robustez e Sustentabilidade de Longo Prazo.**

| Ordem | Bloco | Escopo Principal | Impacto Direto | Esforço |
|---|---|---|---|---|
| **1** | **Bloco 1: Blindagem de Segurança & RLS** | Migration 025 (`is_admin_or_owner` estrito por `user_tenant_roles`, `REVOKE/GRANT` em RPCs `SECURITY DEFINER`, RLS em `trial_rate_limits`, correção de inserts em `audit_logs`) + Confinamento de caminhos relativos em `workspace.create` com `assertPathInSandbox` | Elimina auto-elevação a admin global e escape de diretório cross-tenant | Médio |
| **2** | **Bloco 2: Integridade de Billing & Stripe** | Webhook Stripe fail-closed (rejeitar se sem secret), sincronização dos Price IDs mensais (DB↔UI), persistência de `current_period_end` no banco e gate de assinatura em `session.create` | Evita ativação indevida e encerra uso de infraestrutura por tenants expirados | Médio |
| **3** | **Bloco 3: Identidade Institucional (Branding & Bundle)** | Desativar `includeHarnessIdentity` no bundle `copymonster`, injetar persona oficial do CopyMonster no system prompt e higienizar resíduos textuais de DSH nos modais | A IA se apresenta como CopyMonster para clientes finais sem vazamento de marca fork | Curto |
| **4** | **Bloco 4: Saneamento de UX, i18n & Operação** | Migração total de strings residuais em PT-BR para dicionário EN/ZH, formatação de datas/moedas com locale ativo, `:focus-visible` global e documentação de runbook e serviços systemd | Prepara o SaaS para lançamento com consistência internacional e operação estável | Médio |

---

## 9. Roteiro Passo a Passo de Execução

### Bloco 1 — Blindagem de Segurança & RLS (Imediato)
1. **Migration 025 (`025_security_and_role_hardening.sql`):**
   - Reescrever `public.is_admin_or_owner()`: autoridade derivada exclusivamente de `public.user_tenant_roles` vinculada ao `tenant_id` ativo (ou claim assinada `user_role` via hook confiável), expurgando validações em `user_metadata` ou `app_metadata` controladas pelo usuário.
   - Adicionar `REVOKE EXECUTE ON FUNCTION public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT) FROM PUBLIC;` e `GRANT EXECUTE TO authenticated;` (migração 022).
   - Adicionar `REVOKE ... FROM PUBLIC` e `GRANT ... TO authenticated` em `get_system_secret`, `get_llm_encryption_key`, `get_my_profile` e `increment_tenant_token_usage`.
   - Executar `ALTER TABLE public.trial_rate_limits ENABLE ROW LEVEL SECURITY;` com política restritiva.
   - Corrigir chamada interna de auditoria em `get_system_secret` para usar as colunas válidas `resource_type` e `resource_id`.
   - Adicionar escape de metacaracteres (`%`, `_`) em consultas administrativas com `ILIKE`.
2. **Confinamento de Paths em `workspace.create` (`packages/api/workspace-controller/src/commands.ts`):**
   - Garantir que caminhos relativos em `request.path` passem obrigatoriamente por `assertPathInSandbox(targetPath, sandboxRoot)`.
   - Adicionar teste unitário de traversão (`../../../../`) validando erro `workspace/invalid-path`.

### Bloco 2 — Integridade de Billing & Stripe
1. **Webhook Stripe Fail-Closed (`packages/api/auth-http/src/billing.ts`):**
   - Se `STRIPE_WEBHOOK_SECRET` não estiver configurado no ambiente, retornar status HTTP 500 com log de erro, impedindo o processamento de payloads não assinados.
2. **Sincronização de Price IDs (DB ↔ UI):**
   - Criar migration `026_sync_billing_price_ids.sql` atualizando os Price IDs mensais na tabela `public.plans` para espelhar a produção ativa (`price_1UMC67RiKNxooUH0MrL1dIoD` para Starter e `price_1UMC4lRiKNxooUH0ltHJ1pOf` para Pro), ou vice-versa, garantindo paridade entre checkout e webhook.
3. **Persistência de `current_period_end`:**
   - Atualizar os handlers `customer.subscription.updated` e `checkout.session.completed` para gravar o timestamp `current_period_end` retornado pelo Stripe na tabela `public.tenants`.
4. **Gate de Assinatura em Runtime:**
   - Adicionar verificação em `session.create` impedindo que tenants com status `trial_expired`, `canceled` ou `past_due` criem novas sessões de IA, exibindo aviso claro para upgrade.

### Bloco 3 — Identidade Institucional (Branding & Prompt)
1. **System Prompt Oficial do CopyMonster (`packages/core/system-prompt` e `packages/bundle/copymonster`):**
   - Configurar `includeHarnessIdentity: false` no patch de bundle do CopyMonster.
   - Injetar `PERSONA_PREFIX` institucional com as diretrizes e tom de voz do CopyMonster.
2. **Limpeza de Textos em Modais de Configuração:**
   - Atualizar boas-vindas do modal Models (`ui-settings-models`), document preview e guias de plugins para referenciar exclusivamente CopyMonster.
   - Aplicar sanitização de erros no `ErrorBoundary` e no chat para não expor nomes de pacotes internos `@deepseek-ai/*`.

### Bloco 4 — Layout, Acessibilidade, i18n & Operação
1. **Internacionalização Estrita (EN + ZH):**
   - Migrar todas as mensagens em português remanescentes (`auth-error-utils.ts`, `main.tsx`, abas do painel admin) para os dicionários `en.ts` e `zh.ts`.
   - Padronizar formatação de valores monetários e datas com o locale ativo da aplicação.
2. **Acessibilidade & Estilos:**
   - Adicionar regra global `:focus-visible { outline: 2px solid #E7BF73; }`.
   - Adicionar focus-trap acessível nos modais de Admin, Profile e Plans.
3. **Runbooks de Infraestrutura & Deploy:**
   - Versionar o modelo de unidade systemd `copymonster.service` com execução non-root e carregamento seguro de variáveis de ambiente.
   - Criar endpoint `GET /health` reportando integridade do servidor Node e conectividade com o Supabase.

## 10. Verificado OK / Não Encontrado / A Confirmar

**Verificado OK (amostra não exaustiva):**
- Nenhum segredo em arquivos rastreados; `.env*` git-ignored (`git check-ignore` ok); `git log -S sk_live_/whsec_` limpo.
- Nenhum segredo no bundle do frontend (só `VITE_SUPABASE_URL/ANON_KEY`).
- `sessions.create` confina `cwd`; `directory-picker.list/createDirectory` contêm; isolamento de sandbox FS coberto por `isolation-sandboxing.spec.ts`.
- Logout revoga refresh token; refresh flow presente (`autoRefreshToken`).
- 9 abas admin presentes; RPCs ↔ migrations 009–022 conferem, com `GRANT EXECUTE TO authenticated`.
- Webhook com HMAC + `timingSafeEqual` (quando secret set); teste em `billing.spec.ts`.
- Presets standard/minimal/ptc/cordis montam (snapshots `web/*`); tools do preset `standard` incl. bash/fs/subagent/todo/goal/workflow.
- Title/wordmark/manifest/favicon = CopyMonster; `DeepSeek` como provedor LLM é legítimo.
- Tabelas admin com RLS ON + `security_invoker` view; `anonymous` só lê `plans`; sem `BYPASSRLS`/grants a PUBLIC em tabelas.

**Não encontrado:**
- Presets "creator"/"sdr" (não existem no repo).
- `/health`, alertas, métricas, scripts de deploy/rollback, unit systemd, config de Cloudflare Tunnel, templates de e-mail transacionais (fora do repo).
- Writer de `public.sessions`/`sessions_index` em runtime (só backfill de leitura em 010).
- Caller de `recordTokenUsage` fora de testes.

**A confirmar (VPS/dashboard/CF — não verificável pelo repo):**
- Habilitação do `custom_access_token_hook` no dashboard (FUN-09).
- HSTS/rate-limit no Cloudflare; tunnel → `127.0.0.1:3080` (OPS-02).
- `Restart=`/`User=`/`EnvironmentFile=` da unidade em produção (OPS-01).
- Grants efetivos sobre `trial_rate_limits` no banco live (SEC-10).
- Se `app.current_tenant_id` é setável por cliente no caminho pgbouncer/SQL (SEC-15).
- Abas admin carregando sem erro em runtime (dados reais — depende do FUN-03).

---

*Documento gerado pela auditoria de 04/10/2026 sobre o commit `6224d0a858`. Nenhuma linha de código foi modificada para produzir este relatório.*
