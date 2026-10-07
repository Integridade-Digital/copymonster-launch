# Plano de Produção — LLM Providers + Billing + Free Trial (Campanha 48h)

**Documento:** `docs/roadmap/plano-producao-llm-providers-billing-trial.md`

**Status:** PROPOSTA — AGUARDANDO APROVAÇÃO. Nenhuma mutação foi executada.

**Data:** 2026-10-07

**Base analisada:** `master` @ `e9b880edae` (fork `copymonster-launch`)

**Regras invioláveis:** nunca logar valores de chave; não executar INSERT/UPDATE no Supabase sem aprovação do SQL; não tocar em `packages/llm/` sem parar e reportar; fail-closed em qualquer gate; nunca usar `--no-verify`; cada commit com SHA reportado.

---

## 0. Como este plano funciona

Este documento é o contrato de execução. A regra de ouro é: **uma etapa por vez, com validação e commit próprios**, e **parada obrigatória para aprovação em todo ponto de mutação** (banco, segredos, `packages/llm/`, deleção de dados).

Os marcadores usados:

- **[LEITURA]** — comando somente leitura, seguro.
- **[APROVAÇÃO]** — ponto de parada; só executa após aprovação explícita do resultado/artefato apresentado.
- **[SQL]** — proposta de SQL, nunca aplicada sem aprovação.
- **[STOP/REPORT]** — parada obrigatória por tocar área sensível (`packages/llm/`, segredos, produção).

Cada etapa termina com: testes/validações executados, critérios de aceite, e `git commit` + `git push` com SHA reportado. Nunca commitar `.env`, `.env.local`, chaves, tokens, dumps ou qualquer segredo.

Branch de trabalho sugerida: `release/prod-llm-billing-trial` (não trabalhar direto na `master`).

---

## 1. Análise do projeto (estado real)

### 1.1 Arquitetura relevante

O CopyMonster é um fork do DeepSeek Harness. A composição de produto fica em `packages/bundle/copymonster/cordis.patch.yml`, que insere três camadas sobre o perfil web do upstream: `@deepseek-ai/dsh-api-auth-context` (identidade), `@deepseek-ai/dsh-api-auth-http` (rotas de auth e billing) e `@deepseek-ai/dsh-host-brand-assets` (serviço de imagens de marca).

A identidade do usuário (`UserIdentity`) carrega `userId`, `tenantId`, `role` (`owner|admin|member|anonymous`), `email` e perfil. Ela é derivada do bearer token no `AuthService.resolveIdentity` (`packages/api/auth-context/src/index.ts:148`), a partir das claims `tenant_id` e `user_role`.

O runtime LLM (`ctx.llm`) registra adapters por rota. A rota do DeepSeek nativo é `deepseek-official` (`packages/llm/llm-deepseek/src/index.ts:57`), com display name `DeepSeek`. A resolução da chave passa pelo seam de credenciais: o adapter chama `ctx.credentials.resolve(ref)` com `ref = apiKeyEnv` (padrão `DEEPSEEK_API_KEY`, `packages/llm/llm-deepseek/src/config.ts:13`). O serviço `ctx.credentials` é implementado por `packages/credentials/credentials-local` (arquivo `$DSH_HOME/.credentials.yaml`, formato com `version`, `refs`, `records`). O OpenRouter entra por `packages/llm/llm-pi-ai`.

O `catalog.ts` do session-controller (`packages/api/session-controller/src/catalog.ts`) lê `ctx.llm.listProviders()` (registro vivo) e, em paralelo, chama `get_runtime_llm_catalog()` no Supabase apenas para **sobrescrever metadados** (nome de exibição, contexto, custos, `allowed_plans`). Ou seja: a chave e o endpoint reais vêm do DSH nativo; o banco é hoje informativo para o catálogo do browser.

### 1.2 Banco de dados (Supabase) e migrations

As migrations do fork vão de `001` a `031` (arquivos exclusivos do fork; o upstream não tem `supabase/`).

Tabelas-chave:

- `public.llm_providers` (`008_admin_expanded_backend.sql:35`): `id, name, provider_type, api_key_encrypted, base_url, is_active, allowed_plans, created_at, updated_at`. RLS restrita a admin/owner.
- `public.llm_models` (`008:61`): `id, provider_id, model_id, display_name, context_window, cost_input_1k, cost_output_1k, capabilities, is_default_for_plans, allowed_plans, is_active, created_at, updated_at`.
- `public.plans` (`002:10`, expandida em `007`): `slug, name, stripe_price_id_monthly, stripe_price_id_annual, monthly_price_cents, annual_price_cents, token_limit_input, token_limit_output, max_workspaces, max_sessions, storage_gb, ai_tier`, além de `limits JSONB` legado.
- `public.tenants` (`002:24`, expandida em `007`): `subscription_status, stripe_customer_id, stripe_subscription_id, current_period_end, plan_id, trial_ends_at, trial_used, trial_tokens_used, current_period_tokens_used, subscription_interval, cancel_at_period_end`.
- `public.system_config` (`008:88`): guarda `LLM_ENCRYPTION_KEY` (secret, 32 bytes em hex).
- `public.tenant_llm_providers` (`002:85`): BYOK por tenant (`provider_name, api_key_encrypted, base_url, models_enabled`), **criada mas não usada**.
- `public.audit_logs`, `public.metrics_daily`, `public.sessions`, `public.workspaces_meta`, `public.trial_rate_limits`.

Infra de criptografia de chaves (confirmada):

- `pgcrypto` habilitado (`014`).
- `LLM_ENCRYPTION_KEY` semeada em `system_config` (`014:14`).
- `admin_save_llm_provider` criptografa a chave com `pgp_sym_encrypt` (`014:176`).
- `get_runtime_llm_catalog()` (recriada em `028`) **descriptografa** com `pgp_sym_decrypt` e é restrita a `service_role`. Retorna a chave descriptografada no campo `api_key`.
- Auxiliares `get_llm_encryption_key()` e `safe_decrypt_masked()` existem (`014`).
- **Não existem** `encrypt_llm_key`, `decrypt_llm_key` nem `set_llm_encryption_key` (a solicitação os citou por engano).

Dados de seed dos providers/models:

- `008:238` insere 4 providers stub (OpenAI, Anthropic, DeepSeek, Google) **sem `api_key_encrypted`**.
- `021` insere o provider OpenRouter stub, também sem chave.
- `008:252` insere 4 modelos (gpt-4o, claude-3.5-sonnet, `deepseek-v3`, gemini-1.5-pro) com custos em `cost_input_1k`/`cost_output_1k`. Note que o `model_id` `deepseek-v3` não coincide com o catálogo nativo atual (`deepseek-v4-flash`/`deepseek-v4-pro` visto em `packages/client/ui-model-selection/src/client/index.ts`).

Planos (`007:17`):

- `starter` — R$ 97,00/mês, `token_limit_input=2.000.000`, `token_limit_output=1.000.000`, 1 workspace, 5 sessões.
- `pro` — R$ 297,00/mês, `7.000.000` / `3.000.000`, 5 workspaces, 20 sessões.
- `legend` — R$ 997,00/mês, `25.000.000` / `10.000.000`, ilimitado (`-1`), 100 GB.

Trial (`007`): o trigger `trg_initialize_tenant_trial` roda em `INSERT` de tenant e define `subscription_status='trialing'`, `trial_ends_at = now()+7 dias`, `plan_id = pro`, `trial_tokens_used=0`. O `increment_tenant_token_usage` incrementa `current_period_tokens_used` e, quando `trialing`, `trial_tokens_used`, e marca `trial_expired` ao atingir **1.000.000 de tokens** (limite hardcoded).

**Descoberta crítica (muda o desenho):** as migrations `023` e `024` estabelecem um **SaaS de tenant único**. `handle_new_user()` (`023:31`) **não cria tenant por usuário**; ele apenas insere o usuário em `public.users` e vincula o role `member` ao tenant oficial `00000000-0000-0000-0000-000000000001` ("Integridade Digital"). `024` rebaixa vínculos históricos e declara o operador `5302ad3a-f6a9-4fc3-890e-3e8af8b767c7` como o único `owner`. Portanto, hoje **não existe trial por inscrito**: todos os membros compartilham o estado de assinatura, o plano e os contadores do tenant único.

### 1.3 Runtime LLM: como a chave é resolvida hoje

O fluxo real é a **Opção B** da solicitação: o chat usa a chave do DSH nativo (`~/.dsh/.credentials.yaml`), resolvida pelo adapter via `ctx.credentials`. O painel Admin → LLM Providers lê a tabela `llm_providers`, mostra "Not configured" quando `has_api_key` é falso (o que ocorre hoje, pois os seeds não têm chave), e a chave salva por `admin_save_llm_provider` fica cifrada no banco, **sem caminho de consumo pelo runtime**.

O `catalog.ts` casa o provider do banco com a rota viva por `provider_type`/`name`/`id` em minúsculas (`catalog.ts:68`). Como o nome do banco é `DeepSeek` e o nome da rota é `DeepSeek`, o casamento ocorre hoje por nome — um acoplamento frágil que merece um campo explícito de mapeamento (ex.: `provider_route` e `api_key_env`) em qualquer plano de Opção A.

### 1.4 Billing

O billing está **substancialmente implementado** em `packages/api/auth-http/src/billing.ts` e registrado em `packages/api/auth-http/src/index.ts`:

- `POST /api/billing/checkout` cria Stripe Checkout (cria/reaproveita `stripe_customer_id` no tenant).
- `POST /api/billing/portal` cria o Customer Portal.
- `POST /api/billing/webhook` valida assinatura HMAC-SHA256 e trata `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded` (reseta `current_period_tokens_used` no ciclo) e `invoice.payment_failed`.
- Segredos vêm de `process.env.STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET`.

RPCs administrativas de billing existem em `020` (`get_admin_billing_kpis`, `get_admin_billing_tenants`) e os price IDs oficiais em `007`/`026`.

### 1.5 Frontend: admin e seletor de modelo

Admin → LLM Providers (`apps/web/src/pages/admin/tabs/AdminLLMProvidersTab.tsx`) chama `get_admin_llm_providers`, `admin_save_llm_provider`, `admin_toggle_llm_provider`, `admin_delete_llm_provider`. Admin → Models (`AdminModelsTab.tsx`) chama `get_admin_llm_models`, `admin_save_llm_model`, `admin_toggle_llm_model`, `admin_delete_llm_model`.

O seletor de modelo vive em `packages/client/ui-model-selection` (`ModelSelect.tsx`, `directory.ts`, `service.ts`), alimentado pelo catálogo de sessão. O padrão de gating por papel já existe em `packages/client/ui-settings-general/src/client/SettingsRoot.tsx`, que lê `globalThis.__DSH_AUTH__.role` e só exibe a seção para `owner`/`admin` (fail-closed), conforme o commit `afb45d9c99`. Esse é o padrão a reusar na Parte 6.

### 1.6 Divergências entre a solicitação e o estado real

1. **Trial por inscrito não existe.** `023`/`024` tornaram o produto um SaaS de tenant único; todo novo usuário vira `member` do tenant oficial. "Free trial para novos inscritos" precisa ser reinterpretado (tenant-level) ou exige reintroduzir tenant por usuário (decisão D2).
2. **Nomes de colunas diferentes.** A solicitação usa `cost_per_1k_input/output`, `max_tokens_monthly`, `tenant_tokens_used`, `tenant_tokens_limit`. O real é `cost_input_1k`/`cost_output_1k`, `token_limit_input`/`token_limit_output`, `tenants.trial_tokens_used`/`current_period_tokens_used`.
3. **Sem `check_tenant_quota`.** Não existe RPC de verificação de quota; só o incremento. O gate deve ser criado.
4. **Sem infra `encrypt_llm_key`/`decrypt_llm_key`.** A criptografia é inline nas RPCs e a descriptografia só em `get_runtime_llm_catalog()` (service_role).
5. **Metering não separa input/output.** `turn/end` soma `inputTokens+outputTokens` e chama `increment_tenant_token_usage(p_tenant_id, p_tokens)` com um único total, enquanto os planos têm limites separados de input e output.
6. **Admin vazio não quebra o chat.** O chat funciona pela chave nativa; o painel vazio é um problema de gestão/visibilidade, não de runtime.
7. **Já existe gate de assinatura.** `commands.create` (`packages/api/session-controller/src/commands.ts:93`) já bloqueia `trial_expired`, `canceled`, `past_due`. Falta apenas o gate de quota de tokens.
8. **`tenant_llm_providers` (BYOK) existe e não é usada.** Serve de base para a Opção C.
9. **Existem dois data dirs relevantes:** `/var/copymonster/data` (`packages/workspace/workspace/src/sandbox.ts:12`) para sandbox de workspace e `~/.dsh/sessions` para sessões — ambos citados na Parte 7.

---

## 2. Análise da solicitação e decisões necessárias

### 2.1 Matriz de decisão Parte 2 (resolução de modelo/chave para novos usuários)

| Critério | Opção A (chave global no admin) | Opção B (DSH nativo) | Opção C (A + BYOK) |
|---|---|---|---|
| Funciona hoje | Não (chave no banco não chega ao runtime) | **Sim** | Não |
| Alinha ao admin multi-tenant | Sim | Não | Sim |
| Escala para vários provedores/planos | Sim | Não | Sim |
| Esforço 48h | Médio | **Zero** | Médio-alto |
| Sustentável / vendável como unicórnio | **Sim** | Não | **Sim** |

**Recomendação:** Opção A como arquitetura-alvo, implementada de forma sustentável e, na campanha, com **ponte pragmática**: manter a chave nativa funcionando (o que hoje equivale a um fallback global) enquanto o runtime passa a consumir o catálogo global chaveado do banco, e depois evoluir para C (BYOK) usando a tabela `tenant_llm_providers` que já existe. O ponto técnico decisivo é **como** o runtime consome a chave do banco sem violar a regra de não tocar `packages/llm/`.

Duas rotas técnicas para a Opção A (decisão D1):

- **A1 — Overlay sem tocar `packages/llm/` (preferida):** um plugin do fork (em `packages/bundle/copymonster/` ou novo pacote `packages/host/llm-credentials-supabase`) resolve o catálogo via `get_runtime_llm_catalog()` e alimenta o seam `ctx.credentials` com o `apiKeyEnv` da rota. A viabilidade exata (escrever via `ctx.credentials.set` apenas no processo, ou registrar um provedor de credenciais em camada) **deve ser confirmada na Etapa 1**; se exigir alterar `packages/llm/`, disparamos [STOP/REPORT].
- **A2 — Alterar `packages/llm/`:** requer parada e relatório antes de qualquer código.

Riscos da A1 a mitigar: persistir a chave descriptografada em disco (`.credentials.yaml`) e o ciclo de atualização (re-sync ao salvar no admin). Nunca logar a chave.

### 2.2 Outras decisões

- **D2 — Modelo de trial:** (a) manter trial no nível do tenant único (simples, consistente com `023`) ou (b) reintroduzir tenant por usuário (grande, pós-lançamento). Recomendação: (a) para as 48h, com reset de janela de trial no primeiro acesso/compra; documentar (b) como evolução.
- **D3 — Quota input/output:** agregar `token_limit_input + token_limit_output` num único contador para o gate (simples, 48h), mantendo o split como evolução.
- **D4 — Markup:** registrar fator de markup (ex.: `3x`) apenas para relatórios/admin; **não** usar como gate.
- **D5 — Mapeamento provider↔rota:** adicionar campos explícitos (`provider_route`, `api_key_env`) em `llm_providers` para eliminar o casamento por nome.
- **D6 — Modo do gate:** `enforce` (padrão, fail-closed) com opção de `observe` para a janela de lançamento, controlada por Config validada.

---

## 3. Plano por etapas

Cada etapa entrega um incremento testável. Nenhuma etapa de mutação avança sem aprovação. Todas terminam em commit + push com SHA reportado.

### Etapa 0 — Pré-flight e isolamento [LEITURA]

**Objetivo:** garantir base limpa e ponto de retorno.

Passos:
- `git status` limpo; `git fetch --all`.
- Criar branch `release/prod-llm-billing-trial` a partir de `master`.
- Criar tag de retorno `pre-prod-llm-billing-YYYYMMDD`.
- Confirmar variáveis obrigatórias presentes no ambiente (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) **sem imprimir valores** (`[ -n "$VAR" ] && echo set || echo missing`).
- Confirmar que `.env*` está no `.gitignore`.

Validação: `git rev-parse HEAD`, `git status --porcelain`, tag criada.

Aceite: branch e tag existem; nenhum segredo exposto; nenhum arquivo sensível rastreado.

Commit: nenhum (etapa de preparação). Reportar SHA da base e da tag.

### Etapa 1 — Descoberta read-only do estado real (Parte 1) [LEITURA]

**Objetivo:** medir o estado real sem alterar nada.

`.credentials.yaml` (sem valores): listar apenas chaves de topo e, se útil, os ids em `records` — nunca os valores.
```
grep -E '^[a-zA-Z_]+:' ~/.dsh/.credentials.yaml          # só chaves de topo
grep -E '^  [a-z0-9-]+:' ~/.dsh/.credentials.yaml | sed 's/[: ].*//'  # ids, sem valores
```

Supabase (somente SELECT), com os nomes reais:
```sql
-- 1.2 providers
SELECT id, name, provider_type, base_url, is_active, allowed_plans,
       (api_key_encrypted IS NOT NULL AND api_key_encrypted <> '') AS has_key, created_at
FROM public.llm_providers ORDER BY name;

-- 1.3 models
SELECT id, provider_id, model_id, display_name, is_active, context_window,
       cost_input_1k, cost_output_1k, is_default_for_plans, allowed_plans
FROM public.llm_models ORDER BY provider_id, model_id;

-- 1.4 plans
SELECT id, slug, name, monthly_price_cents, annual_price_cents,
       token_limit_input, token_limit_output, max_workspaces, max_sessions, storage_gb, ai_tier
FROM public.plans ORDER BY monthly_price_cents;

-- 1.4b tenants (estado de trial/assinatura)
SELECT id, name, slug, status, subscription_status, plan_id, trial_used, trial_ends_at,
       trial_tokens_used, current_period_tokens_used, current_period_end
FROM public.tenants ORDER BY created_at;

-- 1.5 infra de criptografia
SELECT proname FROM pg_proc
WHERE proname IN ('get_llm_encryption_key','safe_decrypt_masked','get_runtime_llm_catalog','increment_tenant_token_usage')
ORDER BY proname;
SELECT key, is_secret FROM public.system_config WHERE key = 'LLM_ENCRYPTION_KEY';
```

Validar que `get_runtime_llm_catalog()` retorna `api_key` **sem imprimir** (`SELECT count(*) FROM get_runtime_llm_catalog();` apenas).

Validação/aceite: relatório com (a) quais providers têm chave, (b) quais modelos, (c) planos e limites, (d) estado de assinatura do tenant único, (e) confirmada a infra de criptografia, (f) confirmada a viabilidade da rota A1 (se o seam de credenciais aceita uma fonte adicional sem tocar `packages/llm/`).

Riscos: leitura do `.credentials.yaml` vazar valor — usar apenas comandos que cortam após `:`.

Commit: nenhum (só relatório). Registro do relatório no corpo da aprovação.

### Etapa 2 — Congelamento da decisão de arquitetura (Parte 2) [APROVAÇÃO]

**Objetivo:** escolher A/B/C e a rota A1/A2, além de D1–D6.

Entregável: a decisão assinalada no topo deste documento, com o parecer da Etapa 1.

Aceite: decisão registrada; se A2, abrir [STOP/REPORT] e suspender até haver um plano para `packages/llm/`.

Commit: atualização do status deste documento (opcional).

### Etapa 3 — Migrations de quota, mapeamento e markup (Parte 3) [SQL] [APROVAÇÃO]

**Objetivo:** criar o gate de quota e os metadados que faltam. **Nenhum INSERT/UPDATE sem aprovação.**

Proposta de migration `supabase/migrations/032_plan_quota_and_markup.sql` (rascunho, sujeita a revisão):

```sql
BEGIN;

-- 032: quota gate, mapeamento provider<->rota e markup

-- 1. Mapeamento explícito provider do admin -> rota do runtime e ref de credencial
ALTER TABLE public.llm_providers
  ADD COLUMN IF NOT EXISTS provider_route TEXT,
  ADD COLUMN IF NOT EXISTS api_key_env TEXT;

-- 2. Markup por plano (apenas relatório)
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS markup_multiplier NUMERIC(6,3) DEFAULT 3.000;

-- 3. Gate de quota (fail-closed)
CREATE OR REPLACE FUNCTION public.check_tenant_quota(p_tenant_id UUID)
RETURNS TABLE (
  allowed BOOLEAN, reason TEXT, plan_slug TEXT,
  limit_tokens BIGINT, used_tokens BIGINT, remaining_tokens BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status TEXT; v_plan UUID; v_trial_used BIGINT; v_period_used BIGINT;
  v_limit BIGINT; v_slug TEXT; v_used BIGINT;
BEGIN
  SELECT t.subscription_status, t.plan_id, t.trial_tokens_used, t.current_period_tokens_used
    INTO v_status, v_plan, v_trial_used, v_period_used
  FROM public.tenants t WHERE t.id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'tenant_not_found', NULL::TEXT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT;
    RETURN;
  END IF;

  IF v_status IN ('canceled','past_due','unpaid','incomplete','trial_expired') THEN
    RETURN QUERY SELECT false, v_status, NULL::TEXT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT;
    RETURN;
  END IF;

  SELECT p.slug, COALESCE(p.token_limit_input,0) + COALESCE(p.token_limit_output,0)
    INTO v_slug, v_limit
  FROM public.plans p WHERE p.id = v_plan;

  v_used := CASE WHEN v_status IN ('trial','trialing') THEN v_trial_used ELSE v_period_used END;

  IF v_limit IS NULL OR v_limit <= 0 THEN
    RETURN QUERY SELECT false, 'plan_limit_missing', v_slug, v_limit, v_used, 0::BIGINT;
    RETURN;
  END IF;

  IF v_used >= v_limit THEN
    RETURN QUERY SELECT false, 'quota_exceeded', v_slug, v_limit, v_used, 0::BIGINT;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT, v_slug, v_limit, v_used, (v_limit - v_used);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_tenant_quota(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_tenant_quota(UUID) TO service_role;

COMMIT;
```

Notas de revisão: o limite de trial hoje é `1.000.000` hardcoded em `increment_tenant_token_usage`; alinhar com `plans` se aprovado (D2/D3). O gate deve permanecer `service_role` (o runtime usa admin client).

Testes: rodar a migration em branch/staging; verificar `check_tenant_quota` para tenant inexistente, trial dentro/fora do limite, plano sem limite, e status terminais. Verificar RLS/`EXECUTE` (nenhum `authenticated`/`anon`).

Aceite: função existe, nega `anon`/`authenticated`, retorna fail-closed.

Riscos: alterar metering que hoje já grava; reverter apenas por migration nova.

Commit: SQL + `docs/roadmap` se houver anotação; **a migration só é aplicada em produção após aprovação**.

### Etapa 4 — Runtime: consumo da chave global (Opção aprovada) [APROVAÇÃO] [STOP/REPORT]

**Objetivo:** fazer o runtime usar a chave cadastrada no admin (A) ou formalizar o fallback (B), conforme D1.

Passos (A1, sem tocar `packages/llm/`):
- Criar plugin no bundle do fork que, no boot e ao salvar provider no admin, resolve `get_runtime_llm_catalog()` e injeta a chave no seam `ctx.credentials` para o `api_key_env` da rota.
- Garantir precedência correta (BYOK de tenant > chave global do banco > ambiente) e nunca logar valor.
- Se o seam não permitir camadas sem alterar `packages/llm/`, parar e reportar antes de qualquer código em `packages/llm/`.

Testes:
- Unidade do resolvedor de provedor (chave presente/ausente, rota desconhecida, falha de rede).
- Teste de composição real bootando `cordis.yml` com o patch e verificando que uma chamada LLM resolve a credencial esperada (sem expor a chave).
- Snapshot de sessão conforme a política de testes do repositório.

Aceite: novo usuário envia mensagem sem configuração; a chave usada é a global; logs não contêm segredo.

Commit: feature isolada + testes.

### Etapa 5 — Gate de quota em `session.create` (Parte 3.4) [APROVAÇÃO]

**Objetivo:** bloquear criação de sessão quando a quota estourou, fail-closed.

Passos:
- Em `packages/api/session-controller/src/commands.ts`, antes de `ensureSession`, dentro do bloco de identidade, chamar `check_tenant_quota(identity.tenantId)`.
- Se `allowed = false`, lançar `RemoteError` com código próprio (`session/quota-exceeded`) e mensagem clara, mantendo também o gate de assinatura já existente.
- Config validada `quota_gate_mode` (`enforce` padrão / `observe`), sem constante hardcoded.
- Cobrir com testes de `subscription-gate`/`quota` no padrão dos `.host.spec.ts` existentes.

Testes: quota ok; quota estourada; tenant sem plano; RPC indisponível (definir política fail-closed e alertar); `observe` não bloqueia mas registra.

Aceite: usuário bloqueado com erro claro ao exceder; nenhum caminho alternativo de criação ignora o gate.

Commit: código + testes + snapshot.

### Etapa 6 — Free trial funcional (Parte 4) [APROVAÇÃO]

**Objetivo:** fechar o fluxo de inscrição conforme D2.

Decisão pendente D2. Se tenant-level:
- No primeiro acesso, garantir janela de trial ativa do tenant (se nunca usada) e `plan_id` de trial.
- Documentar que membros compartilham o trial do tenant.

Se per-user (pós-48h): reintroduzir tenant por usuário em `handle_new_user` + migração de dados — grande, fora da janela.

Testes: cadastro novo; login; criação de workspace; primeira mensagem; contagem de tokens; bloqueio ao expirar. Verificar cada passo 1–10 da solicitação e reportar onde quebra (já antecipamos: passo 3 cria user/member, não tenant próprio).

Aceite: fluxo completo reproduzível em staging, com dados de teste.

Commit: código/migrations + testes.

### Etapa 7 — Popular providers e models no admin (Parte 5) [SQL] [APROVAÇÃO]

**Objetivo:** preencher `llm_providers`/`llm_models` com chave e custos corretos, via UI do admin ou SQL aprovado.

Fluxo preferencial: usar a própria UI Admin → LLM Providers (que cifra a chave via `admin_save_llm_provider`), evitando manipular a chave em texto em qualquer terminal.

SQL proposto (sem valores de chave; a chave nunca entra em arquivo ou comando versionado):
```sql
-- DeepSeek (ajustar provider_route/api_key_env conforme D5)
UPDATE public.llm_providers
SET provider_type = 'openai-compatible',
    base_url = 'https://api.deepseek.com/v1',
    allowed_plans = ARRAY['starter','pro','legend'],
    provider_route = 'deepseek-official',
    api_key_env = 'DEEPSEEK_API_KEY',
    is_active = true, updated_at = now()
WHERE name = 'DeepSeek';

-- modelos reais (exemplo; validar ids com o catálogo nativo)
UPDATE public.llm_models SET model_id = 'deepseek-chat', display_name = 'DeepSeek V3',
       context_window = 64000, cost_input_1k = 0.00014, cost_output_1k = 0.00028,
       allowed_plans = ARRAY['starter','pro','legend'], is_active = true, updated_at = now()
WHERE model_id = 'deepseek-v3';
```
O mesmo para OpenRouter (`021`). A chave é cadastrada pela UI (cifrada).

Validação: `SELECT count(*) FROM get_runtime_llm_catalog();` (sem imprimir chaves) e conferir no browser que o catálogo exibe os nomes/custos.

Aceite: admin deixa de mostrar "Not configured"; catálogo do browser reflete os dados do banco.

Commit: SQL revisado + docs; chaves apenas no cofre/Supabase.

### Etapa 8 — Ocultar seletor de modelo para usuário comum (Parte 6) [APROVAÇÃO]

**Objetivo:** apenas `owner`/`admin` selecionam modelo; demais usam o padrão do plano.

Passos:
- Reusar o gating de `SettingsRoot.tsx` (`globalThis.__DSH_AUTH__.role`, fail-closed) em `packages/client/ui-model-selection`.
- Esconder as duas entradas (popup `/model` e assento do composer) quando o papel não for owner/admin, sem quebrar o default de sessão.
- Atualizar locales EN/ZH e testes.

Testes: client spec por papel (owner/admin veem; member/anônimo não); snapshot de UI.

Aceite: member não vê nem aciona troca de modelo; owner/admin inalterados.

Commit: código + locales + testes + snapshot.

### Etapa 9 — Limpeza de workspaces de teste (Parte 7) [APROVAÇÃO]

**Objetivo:** remover dados de teste antes da campanha.

Passos:
- Listar (somente leitura) `/var/copymonster/data/00000000-0000-0000-0000-000000000001/*/workspaces/*` e `~/.dsh/sessions/*`.
- Apresentar a lista e o plano de remoção (comando exato, escopo, backup).
- **Só apagar após aprovação explícita**, com backup antes e verificação pós-remoção.

Testes: contagem antes/depois; workspace funcional recém-criado permanece íntegro.

Aceite: dados de teste removidos; nenhum dado do operador afetado.

Commit: nenhum (operação de dados); registrar evidência.

### Etapa 10 — Auditoria pré-lançamento (Parte 8) [APROVAÇÃO]

**Objetivo:** produzir `docs/roadmap/pre-launch-audit-20261008.md` com fluxos testados, riscos, bloqueadores e ações prioritárias, refletindo o estado final das Etapas 1–9.

Testes: executar o checklist global (seção 7) em staging e registrar evidências.

Aceite: documento revisado e aprovado antes do go-live.

Commit: o documento.

---

## 4. Estratégia de testes e validações

- **Unidade:** RPCs (SQL), resolvedor de credencial, gate de quota.
- **Composição real:** bootar o perfil via Loader com o patch `cordis.patch.yml` (não montar ctx à mão), pois plugins visíveis ao produto exigem teste real.
- **Snapshots:** toda mudança visível ao usuário/modelo atualiza snapshot keyless, conforme `docs/testing.md`.
- **E2E manual em staging:** cadastro → login → workspace → mensagem → consumo → bloqueio.
- **Segurança:** verificar `REVOKE/GRANT` de toda RPC nova (nada para `anon`; gate só `service_role`); audit log para ações admin.
- **Gates do repositório:** `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run test:snapshot`, `pnpm run doc-sync` antes de PR.

## 5. Segurança e segredos

- Nunca imprimir/commitar valores de `DEEPSEEK_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LLM_ENCRYPTION_KEY`.
- Toda verificação de presença usa `[ -n "$VAR" ]`.
- A chave do provider entra no banco **pela UI** (cifrada) ou por SQL sem o valor literal.
- `.env*` permanece ignorado; confirmar com `git check-ignore`.
- Nenhum `--no-verify`.

## 6. Runbook de 48h (ordem e time-box)

1. Etapa 0 (15 min) e Etapa 1 (45 min) — descoberta e evidências.
2. Etapa 2 — decisão D1–D6 (parada).
3. Etapa 3 (SQL) e Etapa 5 (gate) — núcleo do billing/uso.
4. Etapa 4 — chave global (se A aprovada).
5. Etapa 6 — trial (conforme D2).
6. Etapa 7 — seed dos providers (via UI).
7. Etapa 8 — esconder seletor.
8. Etapa 9 — limpeza (janela de manutenção).
9. Etapa 10 — auditoria e go/no-go.

Regra de go/no-go: sem o gate de quota (Etapa 5) e sem o trial coerente (Etapa 6), **no-go**; a chave pode ficar na ponte nativa se a Etapa 4 não fechar a tempo.

## 7. Definição de pronto (checklist global)

- [ ] Admin → LLM Providers sem "Not configured" para os providers ativos.
- [ ] Admin → Models com custos e `allowed_plans` corretos.
- [ ] Modelo do usuário comum resolvido pela chave global, sem configuração.
- [ ] Gate de quota bloqueando de forma clara e fail-closed.
- [ ] Trial funcional coerente com D2.
- [ ] Billing (checkout/portal/webhook) validado em modo teste do Stripe.
- [ ] Seletor de modelo oculto para member/anônimo; visível para owner/admin.
- [ ] Workspaces de teste removidos; ambiente limpo.
- [ ] `docs/roadmap/pre-launch-audit-20261008.md` aprovado.
- [ ] Nenhum segredo em Git/logs; `.env*` ignorado.
- [ ] `typecheck`, `lint`, `test`, `test:snapshot`, `doc-sync` verdes.

## 8. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Modelo de tenant único contradizer o trial por usuário | Alto | Decisão D2 explícita; trial no nível do tenant para as 48h |
| Chave global persistida em disco indevidamente | Alto | Preferir consumo em memória/seam; nunca logar; revisar antes de aplicar |
| Gate de quota bloquear por erro de infra (fail-closed) | Alto | Modo `observe` controlado por Config durante a janela; alerta; aprovação |
| Alterar `packages/llm/` sem controle | Alto | [STOP/REPORT]; rota A1 prefere não tocar |
| Divergência `deepseek-v3` vs catálogo nativo | Médio | D5 (`provider_route`) e validar model ids |
| Migration sem rollback | Médio | Migrations aditivas e novas; reverter com migration seguinte |
| Vazamento de segredo em comando/log | Crítico | Regras da seção 5; revisão de cada comando antes de rodar |

## 9. Anexos

### A. Correções de nomes (solicitação → real)

- `cost_per_1k_input/output` → `llm_models.cost_input_1k` / `cost_output_1k`
- `max_tokens_monthly` → `plans.token_limit_input` + `token_limit_output`
- `tenant_tokens_used` → `tenants.current_period_tokens_used` (e `trial_tokens_used`)
- `tenant_tokens_limit` → derivado de `plans` (não existe coluna única)
- `encrypt_llm_key`/`decrypt_llm_key`/`set_llm_encryption_key` → inexistentes; cripto em `admin_save_llm_provider` e descripto em `get_runtime_llm_catalog`
- `plans` usa `slug` (`starter|pro|legend`), não `name`

### B. Arquivos que este plano toca

- `supabase/migrations/032_plan_quota_and_markup.sql` (novo, proposto)
- `packages/api/session-controller/src/commands.ts` (gate de quota)
- `packages/bundle/copymonster/**` (plugin de credencial, se A1)
- `packages/client/ui-model-selection/**` + locales (gating do seletor)
- `apps/web/src/pages/admin/tabs/**` (ajustes de exibição, se necessário)
- `docs/roadmap/pre-launch-audit-20261008.md` (novo)
- Este documento.

### C. Fora de escopo

- Rebranding (plano separado já existente).
- Migração de merge com upstream (plano separado `fork-preservation.md`).
- Reintroduzir multi-tenant por usuário (evolução pós-lançamento).

---

**Próximo passo:** aguardar aprovação deste plano e das decisões D1–D6. Após aprovação, executar Etapa 0 → Etapa 1 e reportar somente leitura. Nenhuma mutação será feita sem autorização.
