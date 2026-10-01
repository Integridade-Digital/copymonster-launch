-- ============================================================
-- Migration: 020_admin_billing.sql
-- Description: Correção do CHECK de subscription_status e RPCs de Billing
-- Security: SECURITY DEFINER + is_admin_or_owner()
-- ============================================================

BEGIN;

-- 1. CORREÇÃO DA CONSTRAINT CHECK EM public.tenants
-- A migration 002 fixou valores limitados. Esta atualização adiciona
-- os status oficiais do Stripe e os estados de trial criados na migration 007.
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_subscription_status_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_subscription_status_check
  CHECK (subscription_status IN (
    'trial',
    'trialing',
    'trial_expired',
    'active',
    'past_due',
    'unpaid',
    'incomplete',
    'canceled',
    'deleted'
  ));

-- 2. RPC: get_admin_billing_kpis()
-- Agrega métricas financeiras globais e consumo de tokens do ciclo corrente.
CREATE OR REPLACE FUNCTION public.get_admin_billing_kpis()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin BOOLEAN;
  _mrr_estimated_cents BIGINT := 0;
  _active_count INTEGER := 0;
  _trialing_count INTEGER := 0;
  _past_due_count INTEGER := 0;
  _canceled_count INTEGER := 0;
  _total_cycle_tokens BIGINT := 0;
  _result JSONB;
BEGIN
  -- Verificação de autorização restrita a admin/owner
  _is_admin := public.is_admin_or_owner();
  IF NOT _is_admin THEN
    RAISE EXCEPTION 'Acesso negado: requer privilégios de administrador ou proprietário.';
  END IF;

  -- 1. Contagens de status
  SELECT
    COUNT(*) FILTER (WHERE subscription_status = 'active'),
    COUNT(*) FILTER (WHERE subscription_status IN ('trial', 'trialing')),
    COUNT(*) FILTER (WHERE subscription_status IN ('past_due', 'unpaid', 'incomplete')),
    COUNT(*) FILTER (WHERE subscription_status = 'canceled'),
    COALESCE(SUM(current_period_tokens_used), 0)
  INTO
    _active_count,
    _trialing_count,
    _past_due_count,
    _canceled_count,
    _total_cycle_tokens
  FROM public.tenants
  WHERE status != 'deleted' OR status IS NULL;

  -- 2. Cálculo estrito de MRR (somente assinaturas ativas)
  -- Mensal: monthly_price_cents
  -- Anual: annual_price_cents / 12
  SELECT
    COALESCE(SUM(
      CASE
        WHEN t.subscription_interval = 'year' AND p.annual_price_cents IS NOT NULL
          THEN ROUND(p.annual_price_cents::NUMERIC / 12.0)
        WHEN (t.subscription_interval = 'month' OR t.subscription_interval IS NULL) AND p.monthly_price_cents IS NOT NULL
          THEN p.monthly_price_cents::NUMERIC
        ELSE 0
      END
    ), 0)::BIGINT
  INTO _mrr_estimated_cents
  FROM public.tenants t
  LEFT JOIN public.plans p ON p.id = t.plan_id
  WHERE t.subscription_status = 'active'
    AND (t.status != 'deleted' OR t.status IS NULL);

  _result := jsonb_build_object(
    'mrr_estimated_cents', _mrr_estimated_cents,
    'active_subscriptions', _active_count,
    'trialing_tenants', _trialing_count,
    'past_due_subscriptions', _past_due_count,
    'canceled_subscriptions', _canceled_count,
    'total_cycle_tokens', _total_cycle_tokens
  );

  RETURN _result;
END;
$$;

-- 3. RPC: get_admin_billing_tenants(...)
-- Listagem paginada de tenants com metadados completos de assinatura e limites
CREATE OR REPLACE FUNCTION public.get_admin_billing_tenants(
  p_search TEXT DEFAULT NULL,
  p_plan_slug TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_interval TEXT DEFAULT NULL,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 25
)
RETURNS TABLE (
  tenant_id UUID,
  tenant_name TEXT,
  tenant_slug TEXT,
  plan_id UUID,
  plan_name TEXT,
  plan_slug TEXT,
  monthly_price_cents INTEGER,
  annual_price_cents INTEGER,
  token_limit_input BIGINT,
  token_limit_output BIGINT,
  max_workspaces INTEGER,
  max_sessions INTEGER,
  storage_gb INTEGER,
  ai_tier TEXT,
  subscription_status TEXT,
  subscription_interval TEXT,
  cancel_at_period_end BOOLEAN,
  current_period_end TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  trial_used BOOLEAN,
  trial_tokens_used BIGINT,
  current_period_tokens_used BIGINT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin BOOLEAN;
  _offset INT;
  _search_pattern TEXT;
BEGIN
  -- Verificação de autorização
  _is_admin := public.is_admin_or_owner();
  IF NOT _is_admin THEN
    RAISE EXCEPTION 'Acesso negado: requer privilégios de administrador ou proprietário.';
  END IF;

  _offset := GREATEST(0, (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 25));
  IF p_search IS NOT NULL AND TRIM(p_search) != '' THEN
    _search_pattern := '%' || TRIM(p_search) || '%';
  ELSE
    _search_pattern := NULL;
  END IF;

  RETURN QUERY
  WITH filtered_tenants AS (
    SELECT
      t.id AS f_tenant_id,
      t.name AS f_tenant_name,
      t.slug AS f_tenant_slug,
      t.plan_id AS f_plan_id,
      p.name AS f_plan_name,
      p.slug AS f_plan_slug,
      p.monthly_price_cents AS f_monthly_price_cents,
      p.annual_price_cents AS f_annual_price_cents,
      p.token_limit_input AS f_token_limit_input,
      p.token_limit_output AS f_token_limit_output,
      p.max_workspaces AS f_max_workspaces,
      p.max_sessions AS f_max_sessions,
      p.storage_gb AS f_storage_gb,
      p.ai_tier AS f_ai_tier,
      COALESCE(t.subscription_status, 'trial') AS f_subscription_status,
      COALESCE(t.subscription_interval, 'month') AS f_subscription_interval,
      COALESCE(t.cancel_at_period_end, false) AS f_cancel_at_period_end,
      t.current_period_end AS f_current_period_end,
      t.trial_ends_at AS f_trial_ends_at,
      t.trial_used AS f_trial_used,
      COALESCE(t.trial_tokens_used, 0) AS f_trial_tokens_used,
      COALESCE(t.current_period_tokens_used, 0) AS f_current_period_tokens_used,
      t.stripe_customer_id AS f_stripe_customer_id,
      t.stripe_subscription_id AS f_stripe_subscription_id,
      t.created_at AS f_created_at,
      t.updated_at AS f_updated_at
    FROM public.tenants t
    LEFT JOIN public.plans p ON p.id = t.plan_id
    WHERE (t.status != 'deleted' OR t.status IS NULL)
      AND (
        _search_pattern IS NULL OR
        t.name ILIKE _search_pattern OR
        t.slug ILIKE _search_pattern OR
        t.stripe_customer_id ILIKE _search_pattern OR
        t.stripe_subscription_id ILIKE _search_pattern
      )
      AND (p_plan_slug IS NULL OR p.slug = p_plan_slug)
      AND (
        p_status IS NULL OR
        (p_status = 'trial' AND t.subscription_status IN ('trial', 'trialing')) OR
        (p_status != 'trial' AND t.subscription_status = p_status)
      )
      AND (p_interval IS NULL OR t.subscription_interval = p_interval)
  ),
  counted AS (
    SELECT COUNT(*) AS cnt FROM filtered_tenants
  )
  SELECT
    ft.f_tenant_id,
    ft.f_tenant_name,
    ft.f_tenant_slug,
    ft.f_plan_id,
    COALESCE(ft.f_plan_name, 'No Plan'),
    COALESCE(ft.f_plan_slug, 'free'),
    ft.f_monthly_price_cents,
    ft.f_annual_price_cents,
    ft.f_token_limit_input,
    ft.f_token_limit_output,
    ft.f_max_workspaces,
    ft.f_max_sessions,
    ft.f_storage_gb,
    ft.f_ai_tier,
    ft.f_subscription_status,
    ft.f_subscription_interval,
    ft.f_cancel_at_period_end,
    ft.f_current_period_end,
    ft.f_trial_ends_at,
    ft.f_trial_used,
    ft.f_trial_tokens_used,
    ft.f_current_period_tokens_used,
    ft.f_stripe_customer_id,
    ft.f_stripe_subscription_id,
    ft.f_created_at,
    ft.f_updated_at,
    c.cnt AS total_count
  FROM filtered_tenants ft
  CROSS JOIN counted c
  ORDER BY ft.f_created_at DESC
  LIMIT p_page_size
  OFFSET _offset;
END;
$$;

-- 4. SEGURANÇA E PERMISSÕES
REVOKE ALL ON FUNCTION public.get_admin_billing_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_billing_kpis() TO authenticated;

REVOKE ALL ON FUNCTION public.get_admin_billing_tenants(TEXT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_billing_tenants(TEXT, TEXT, TEXT, TEXT, INT, INT) TO authenticated;

COMMIT;
