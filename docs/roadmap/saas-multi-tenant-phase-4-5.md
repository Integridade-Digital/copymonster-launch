# Plano de Implementação: Fase 4 (Painel Admin) e Fase 5 (Stripe & Free Trial)

**Projeto:** CopyMonster Launch (Multi-Tenant SaaS)  
**Arquivo de Referência:** `docs/roadmap/saas-multi-tenant-phase-4-5.md`  
**Status:** Revisão 6 (Definitiva — Transação Atômica, auth.jwt() Moderno e Fallback de JWT Hook Confirmado)

---

## 1. Ajustes Finais Pré-Execução

### 1.1. Substituição de `auth.role()` por `COALESCE(auth.jwt() ->> 'role', '')`
- A função legada `auth.role()` foi descontinuada no Supabase.
- Na RPC `increment_tenant_token_usage`, utilizamos a extração direta do payload JWT moderno:
  ```sql
  IF COALESCE(auth.jwt() ->> 'role', '') != 'service_role' THEN
    _caller_tenant_id := public.get_current_tenant_id();
    IF p_tenant_id IS NULL OR p_tenant_id != _caller_tenant_id THEN
      RAISE EXCEPTION 'Não autorizado: impossível alterar consumo de outro tenant.';
    END IF;
  END IF;
  ```

### 1.2. Transação Atômica com `BEGIN;` e `COMMIT;`
Toda a `migration 007` é encapsulada em um bloco transacional explícito. Se qualquer instrução falhar (ex: erro de chave estrangeira ou duplicidade de índice), o PostgreSQL reverte 100% das alterações, mantendo o banco intacto.

### 1.3. Diagnóstico do `custom_access_token_hook` e Garantia de Fallback
- A função determinística `public.get_current_tenant_id()` (introduzida na **migration 006**) foi arquitetada com 3 camadas de resolução:
  1. **Camada 1 (Prioridade Máxima):** Lê o claim `'tenant_id'` injetado no token JWT pelo `custom_access_token_hook`.
  2. **Camada 2:** Lê a configuração explícita de sessão (`SET LOCAL app.current_tenant_id`).
  3. **Camada 3 (Fallback Determinístico à Prova de Falhas):** Se o hook estiver desativado no painel do Supabase, a função faz consulta imediata a `public.user_tenant_roles` para o `auth.uid()`, priorizando o tenant onde o usuário é `owner`.
- **Garantia Operacional:** Chamadas legítimas **nunca serão rejeitadas**, mesmo se o hook do Supabase estiver desligado ou em manutenção. Para máxima performance (evitar a consulta em `user_tenant_roles`), recomenda-se conferir no Supabase Dashboard em *Authentication > Hooks* se o `custom_access_token_hook` aponta para `public.custom_access_token_hook`.

---

## 2. IDs Oficiais do Stripe e Parâmetros dos Planos

| Plano | Preço Mensal | Price ID (Mensal) | Preço Anual | Price ID (Anual) | Tokens/mês | Workspaces | Sessões | Armazenamento | Modelos IA |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Starter** | $97 | `price_1SqRcbRiKNxooUH09cijDYsq` | $600 | `price_1UK6ToRiKNxooUH0cNSm1DLp` | 3M (2M in / 1M out) | 1 | 5 | 1GB | Padrão |
| **Pro** | $297 | `price_1SqRe4RiKNxooUH0tYyprM4P` | $1.800 | `price_1UK6UuRiKNxooUH0IomDOBgN` | 10M (7M in / 3M out) | 5 | 20 | 10GB | Avançados |
| **Legend** | $997 | `price_1UK6P1RiKNxooUH0uikg0x4f` | $5.600 | `price_1UK6VtRiKNxooUH0GjMUV9Wb` | 35M (25M in / 10M out) | Ilimitado | Ilimitado | 100GB | Premium |

---

## 3. SQL Homologado da Migration 007 (`supabase/migrations/007_billing_and_trial.sql`)

```sql
BEGIN;

-- 1. Expansão de colunas da tabela plans
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_monthly TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id_annual TEXT,
  ADD COLUMN IF NOT EXISTS monthly_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS annual_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS token_limit_input BIGINT,
  ADD COLUMN IF NOT EXISTS token_limit_output BIGINT,
  ADD COLUMN IF NOT EXISTS max_workspaces INTEGER,
  ADD COLUMN IF NOT EXISTS max_sessions INTEGER,
  ADD COLUMN IF NOT EXISTS storage_gb INTEGER,
  ADD COLUMN IF NOT EXISTS ai_tier TEXT;

-- 2. Upsert dos Planos com IDs oficiais do Stripe
INSERT INTO public.plans (slug, name, stripe_price_id_monthly, stripe_price_id_annual, monthly_price_cents, annual_price_cents, token_limit_input, token_limit_output, max_workspaces, max_sessions, storage_gb, ai_tier)
VALUES 
  ('starter', 'Starter', 'price_1SqRcbRiKNxooUH09cijDYsq', 'price_1UK6ToRiKNxooUH0cNSm1DLp', 9700, 60000, 2000000, 1000000, 1, 5, 1, 'standard'),
  ('pro', 'Pro', 'price_1SqRe4RiKNxooUH0tYyprM4P', 'price_1UK6UuRiKNxooUH0IomDOBgN', 29700, 180000, 7000000, 3000000, 5, 20, 10, 'advanced'),
  ('legend', 'Legend', 'price_1UK6P1RiKNxooUH0uikg0x4f', 'price_1UK6VtRiKNxooUH0GjMUV9Wb', 99700, 560000, 25000000, 10000000, -1, -1, 100, 'premium')
ON CONFLICT (slug) DO UPDATE SET
  stripe_price_id_monthly = EXCLUDED.stripe_price_id_monthly,
  stripe_price_id_annual = EXCLUDED.stripe_price_id_annual,
  monthly_price_cents = EXCLUDED.monthly_price_cents,
  annual_price_cents = EXCLUDED.annual_price_cents,
  token_limit_input = EXCLUDED.token_limit_input,
  token_limit_output = EXCLUDED.token_limit_output,
  max_workspaces = EXCLUDED.max_workspaces,
  max_sessions = EXCLUDED.max_sessions,
  storage_gb = EXCLUDED.storage_gb,
  ai_tier = EXCLUDED.ai_tier;

-- 3. Expansão da tabela tenants para acomodar Free Trial e faturamento
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_tokens_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_period_tokens_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_interval TEXT DEFAULT 'month',
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false;

-- Saneamento: Tenants pré-existentes não herdam trial retroativo
UPDATE public.tenants
SET trial_used = true, trial_ends_at = NULL
WHERE trial_ends_at IS NULL AND trial_used = false;

-- 4. Criação dos índices de alta performance
CREATE INDEX IF NOT EXISTS idx_tenants_subscription_status 
  ON public.tenants(subscription_status);

CREATE INDEX IF NOT EXISTS idx_tenants_trial_ends_at 
  ON public.tenants(trial_ends_at) 
  WHERE trial_ends_at IS NOT NULL;

-- 5. Tabela dedicada para Anti-Abuso de Trial por IP
CREATE TABLE IF NOT EXISTS public.trial_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip INET NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trial_rate_limits_ip_created 
  ON public.trial_rate_limits(ip, created_at DESC);

-- 6. Trigger Defensivo de Ativação Automática de Trial na criação de tenants
CREATE OR REPLACE FUNCTION public.trigger_initialize_tenant_trial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _pro_plan_id UUID;
BEGIN
  IF NEW.trial_used = false AND NEW.trial_ends_at IS NULL THEN
    SELECT id INTO _pro_plan_id FROM public.plans WHERE slug = 'pro' LIMIT 1;
    
    IF _pro_plan_id IS NULL THEN
      RAISE EXCEPTION 'Plano Pro não encontrado na tabela plans para inicialização do trial';
    END IF;

    NEW.subscription_status := 'trialing';
    NEW.trial_ends_at := timezone('utc'::text, now()) + interval '7 days';
    NEW.trial_tokens_used := 0;
    NEW.plan_id := COALESCE(NEW.plan_id, _pro_plan_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_initialize_tenant_trial ON public.tenants;
CREATE TRIGGER trg_initialize_tenant_trial
  BEFORE INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_initialize_tenant_trial();

-- 7. RPC Atômica com Validação de JWT Moderno (Anti-Spoofing de Consumo)
CREATE OR REPLACE FUNCTION public.increment_tenant_token_usage(
  p_tenant_id UUID,
  p_tokens BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _caller_tenant_id UUID;
BEGIN
  -- Validação estrita com extração moderna de JWT (evitando auth.role() depreciado)
  IF COALESCE(auth.jwt() ->> 'role', '') != 'service_role' THEN
    _caller_tenant_id := public.get_current_tenant_id();
    IF p_tenant_id IS NULL OR p_tenant_id != _caller_tenant_id THEN
      RAISE EXCEPTION 'Não autorizado: impossível alterar consumo de outro tenant.';
    END IF;
  END IF;

  UPDATE public.tenants
  SET 
    current_period_tokens_used = current_period_tokens_used + p_tokens,
    trial_tokens_used = CASE 
      WHEN subscription_status = 'trialing' THEN trial_tokens_used + p_tokens
      ELSE trial_tokens_used
    END,
    subscription_status = CASE 
      WHEN subscription_status = 'trialing' AND (trial_tokens_used + p_tokens) >= 1000000 
      THEN 'trial_expired' 
      ELSE subscription_status 
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_tenant_id;
END;
$$;

COMMIT;
```

---

## 4. Endpoints e Arquitetura no DSH (Sem Pacotes Novos)

- **`packages/api/auth-http`**:
  - `POST /api/billing/checkout`: Cria sessão de checkout no Stripe.
  - `POST /api/billing/portal`: Cria sessão no Stripe Customer Portal.
  - `POST /api/billing/webhook`: Lê stream raw de `node:http` e valida assinatura com `stripe.webhooks.constructEvent`.
- **`packages/api/settings-controller`**:
  - Adição de métodos de auditoria e listagem de tenants protegidos por `@RemoteScope('auth')` e `assertAdminRole`.
- **`apps/web/src/`**:
  - `main.tsx`: Registro das rotas `/billing/success`, `/billing/cancel` e `/admin/audit`.
  - `pages/billing/PlansPage.tsx`: Conexão ao checkout com toggle Mensal / Anual e barra de consumo do trial.

---

## 5. Sequência Imediata de Execução
1. Criação do arquivo de migração `supabase/migrations/007_billing_and_trial.sql`.
2. Implementação das rotas de billing e webhook no `packages/api/auth-http`.
3. Extensão do `packages/api/settings-controller` para métricas e auditoria.
4. Conexão do frontend em `apps/web/src/pages/billing/PlansPage.tsx`.
5. Validação E2E com testes locais de checkout e recepção de webhook.
