BEGIN;

-- ============================================================================
-- MIGRATION 008: Backend Expandido do Painel Administrativo (Bloco 6)
-- Tabelas: llm_providers, llm_models, system_config, sessions_index, metrics_daily
-- RLS padronizado com helper is_admin_or_owner(), view mascarada e RPC de segredos
-- ============================================================================

-- 0. Helper function para checar permissão administrativa (owner/admin)
CREATE OR REPLACE FUNCTION public.is_admin_or_owner()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN (
    COALESCE(auth.jwt() ->> 'role', '') IN ('owner', 'admin')
    OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('owner', 'admin')
    OR
    COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('owner', 'admin')
    OR
    EXISTS (
      SELECT 1 FROM public.user_tenant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );
END;
$$;

-- 1. Tabela public.llm_providers
CREATE TABLE IF NOT EXISTS public.llm_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL, -- 'openai', 'anthropic', 'deepseek', 'google', etc.
  api_key_encrypted TEXT,
  base_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  allowed_plans TEXT[] NOT NULL DEFAULT ARRAY['starter', 'pro', 'legend'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full on llm_providers"
  ON public.llm_providers
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_owner())
  WITH CHECK (public.is_admin_or_owner());

CREATE TRIGGER update_llm_providers_updated_at
  BEFORE UPDATE ON public.llm_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Tabela public.llm_models
CREATE TABLE IF NOT EXISTS public.llm_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.llm_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL DEFAULT 8192,
  cost_input_1k NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
  cost_output_1k NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default_for_plans TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  allowed_plans TEXT[] NOT NULL DEFAULT ARRAY['starter', 'pro', 'legend'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_llm_models_provider ON public.llm_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_llm_models_model_id ON public.llm_models(model_id);

ALTER TABLE public.llm_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full on llm_models"
  ON public.llm_models
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_owner())
  WITH CHECK (public.is_admin_or_owner());

-- 3. Tabela public.system_config
CREATE TABLE IF NOT EXISTS public.system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Políticas refinadas do system_config (Ajuste 2)
CREATE POLICY "Admin select non-secret on system_config"
  ON public.system_config
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_owner() AND is_secret = false);

CREATE POLICY "Admin insert on system_config"
  ON public.system_config
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_owner());

CREATE POLICY "Admin update on system_config"
  ON public.system_config
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_owner())
  WITH CHECK (public.is_admin_or_owner());

CREATE POLICY "Admin delete on system_config"
  ON public.system_config
  FOR DELETE
  TO authenticated
  USING (public.is_admin_or_owner());

CREATE TRIGGER update_system_config_updated_at
  BEFORE UPDATE ON public.system_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View segura com mascaramento e Ajuste 3: security_invoker = true
CREATE OR REPLACE VIEW public.system_config_safe AS
SELECT
  key,
  CASE
    WHEN is_secret THEN '"***SECRET***"'::jsonb
    ELSE value
  END AS value,
  description,
  is_secret,
  updated_at,
  updated_by
FROM public.system_config;

ALTER VIEW public.system_config_safe SET (security_invoker = true);

-- RPC auditável para leitura explícita de segredo por admins
CREATE OR REPLACE FUNCTION public.get_system_secret(secret_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_val JSONB;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem ler secrets.';
  END IF;

  SELECT value INTO v_val
  FROM public.system_config
  WHERE key = secret_key;

  INSERT INTO public.audit_logs (user_id, action, resource, metadata)
  VALUES (
    auth.uid(),
    'read_secret',
    'system_config',
    jsonb_build_object('key', secret_key, 'read_at', now())
  );

  RETURN v_val;
END;
$$;

-- 4. Tabela public.sessions_index
CREATE TABLE IF NOT EXISTS public.sessions_index (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT,
  model_used TEXT,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_sessions_index_tenant ON public.sessions_index(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_index_user ON public.sessions_index(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_index_status ON public.sessions_index(status);

ALTER TABLE public.sessions_index ENABLE ROW LEVEL SECURITY;

-- Políticas de sessions_index com Ajuste 1: apenas SELECT restrito para member; service_role bypassa RLS para escrita
CREATE POLICY "Admin full on sessions_index"
  ON public.sessions_index
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_owner())
  WITH CHECK (public.is_admin_or_owner());

CREATE POLICY "Member select own sessions_index"
  ON public.sessions_index
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_sessions_index_updated_at
  BEFORE UPDATE ON public.sessions_index
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Tabela public.metrics_daily
CREATE TABLE IF NOT EXISTS public.metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  active_users INTEGER NOT NULL DEFAULT 0,
  active_tenants INTEGER NOT NULL DEFAULT 0,
  tokens_consumed BIGINT NOT NULL DEFAULT 0,
  estimated_mrr NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  new_subscriptions INTEGER NOT NULL DEFAULT 0,
  canceled_subscriptions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_metrics_daily_date ON public.metrics_daily(date);

ALTER TABLE public.metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full on metrics_daily"
  ON public.metrics_daily
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_owner())
  WITH CHECK (public.is_admin_or_owner());

-- 6. Seeds iniciais (idempotentes via ON CONFLICT)
-- 6.1 Provedores LLM com UUIDs determinísticos
INSERT INTO public.llm_providers (id, name, provider_type, base_url, is_active, allowed_plans)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'OpenAI', 'openai', 'https://api.openai.com/v1', true, ARRAY['starter', 'pro', 'legend']),
  ('10000000-0000-0000-0000-000000000002', 'Anthropic', 'anthropic', 'https://api.anthropic.com/v1', true, ARRAY['starter', 'pro', 'legend']),
  ('10000000-0000-0000-0000-000000000003', 'DeepSeek', 'deepseek', 'https://api.deepseek.com/v1', true, ARRAY['starter', 'pro', 'legend']),
  ('10000000-0000-0000-0000-000000000004', 'Google', 'google', 'https://generativelanguage.googleapis.com/v1beta', true, ARRAY['starter', 'pro', 'legend'])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  provider_type = EXCLUDED.provider_type,
  base_url = EXCLUDED.base_url,
  is_active = EXCLUDED.is_active,
  allowed_plans = EXCLUDED.allowed_plans;

-- 6.2 Modelos LLM associados aos provedores
INSERT INTO public.llm_models (id, provider_id, model_id, display_name, context_window, cost_input_1k, cost_output_1k, capabilities, is_default_for_plans, allowed_plans)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'gpt-4o',
    'GPT-4o (OpenAI)',
    128000,
    0.002500,
    0.010000,
    '{"chat": true, "vision": true, "function_calling": true}'::jsonb,
    ARRAY['pro', 'legend'],
    ARRAY['starter', 'pro', 'legend']
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'claude-3.5-sonnet',
    'Claude 3.5 Sonnet (Anthropic)',
    200000,
    0.003000,
    0.015000,
    '{"chat": true, "vision": true, "function_calling": true}'::jsonb,
    ARRAY['legend'],
    ARRAY['pro', 'legend']
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000003',
    'deepseek-v3',
    'DeepSeek V3 (DeepSeek)',
    64000,
    0.000140,
    0.000280,
    '{"chat": true, "reasoning": false}'::jsonb,
    ARRAY['starter'],
    ARRAY['starter', 'pro', 'legend']
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000004',
    'gemini-1.5-pro',
    'Gemini 1.5 Pro (Google)',
    1000000,
    0.001250,
    0.005000,
    '{"chat": true, "vision": true, "audio": true}'::jsonb,
    ARRAY[]::TEXT[],
    ARRAY['starter', 'pro', 'legend']
  )
ON CONFLICT (id) DO UPDATE SET
  model_id = EXCLUDED.model_id,
  display_name = EXCLUDED.display_name,
  context_window = EXCLUDED.context_window,
  cost_input_1k = EXCLUDED.cost_input_1k,
  cost_output_1k = EXCLUDED.cost_output_1k,
  capabilities = EXCLUDED.capabilities,
  is_default_for_plans = EXCLUDED.is_default_for_plans,
  allowed_plans = EXCLUDED.allowed_plans;

COMMIT;
