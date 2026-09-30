BEGIN;

-- ============================================================================
-- MIGRATION 009: Atualização de Métricas Diárias (refresh_metrics_daily)
-- Agrega métricas consolidadas em public.metrics_daily usando sessions_index,
-- tenants e plans.
-- Protegido com verificação is_admin_or_owner() e agendamento seguro via pg_cron.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_metrics_daily(p_date DATE DEFAULT CURRENT_DATE)
RETURNS public.metrics_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_users INT;
  v_active_tenants INT;
  v_tokens_consumed BIGINT;
  v_estimated_mrr NUMERIC(12, 2);
  v_new_subs INT;
  v_canceled_subs INT;
  v_record public.metrics_daily;
BEGIN
  -- Ajuste 2: Proteção estrita de permissão (apenas owner/admin ou service_role)
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem atualizar métricas.';
  END IF;

  -- 1. Usuários ativos na data (com base em sessions_index)
  SELECT COUNT(DISTINCT user_id)
  INTO v_active_users
  FROM public.sessions_index
  WHERE created_at::date = p_date;

  -- 2. Tenants ativos na data
  SELECT COUNT(DISTINCT tenant_id)
  INTO v_active_tenants
  FROM public.sessions_index
  WHERE created_at::date = p_date;

  -- 3. Tokens consumidos na data
  SELECT COALESCE(SUM(tokens_total), 0)
  INTO v_tokens_consumed
  FROM public.sessions_index
  WHERE created_at::date = p_date;

  -- 4. MRR estimado baseado nos tenants ativos e seus respectivos planos
  SELECT COALESCE(SUM(
    CASE 
      WHEN t.subscription_status = 'active' AND t.subscription_interval = 'year' AND p.annual_price_cents IS NOT NULL
        THEN (p.annual_price_cents::numeric / 1200.0)
      WHEN t.subscription_status = 'active' AND p.monthly_price_cents IS NOT NULL 
        THEN (p.monthly_price_cents::numeric / 100.0)
      ELSE 0.00
    END
  ), 0.00)
  INTO v_estimated_mrr
  FROM public.tenants t
  LEFT JOIN public.plans p ON t.plan_id = p.id;

  -- 5. Novas assinaturas ativas iniciadas na data
  SELECT COUNT(*)
  INTO v_new_subs
  FROM public.tenants
  WHERE subscription_status = 'active'
    AND updated_at::date = p_date;

  -- 6. Assinaturas canceladas na data
  SELECT COUNT(*)
  INTO v_canceled_subs
  FROM public.tenants
  WHERE (subscription_status = 'canceled' OR cancel_at_period_end = true)
    AND updated_at::date = p_date;

  -- 7. Upsert idempotente em public.metrics_daily
  INSERT INTO public.metrics_daily (
    date,
    active_users,
    active_tenants,
    tokens_consumed,
    estimated_mrr,
    new_subscriptions,
    canceled_subscriptions
  ) VALUES (
    p_date,
    COALESCE(v_active_users, 0),
    COALESCE(v_active_tenants, 0),
    COALESCE(v_tokens_consumed, 0),
    COALESCE(v_estimated_mrr, 0.00),
    COALESCE(v_new_subs, 0),
    COALESCE(v_canceled_subs, 0)
  )
  ON CONFLICT (date) DO UPDATE SET
    active_users = EXCLUDED.active_users,
    active_tenants = EXCLUDED.active_tenants,
    tokens_consumed = EXCLUDED.tokens_consumed,
    estimated_mrr = EXCLUDED.estimated_mrr,
    new_subscriptions = EXCLUDED.new_subscriptions,
    canceled_subscriptions = EXCLUDED.canceled_subscriptions
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

-- Permissões de execução
REVOKE EXECUTE ON FUNCTION public.refresh_metrics_daily(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_metrics_daily(DATE) TO authenticated;

-- Agendamento automático via pg_cron (Ajuste 1: sintaxe correta do unschedule)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-metrics-snapshot') THEN
      PERFORM cron.unschedule('daily-metrics-snapshot');
    END IF;

    PERFORM cron.schedule(
      'daily-metrics-snapshot',
      '5 0 * * *', -- 00:05 UTC todo dia
      'SELECT public.refresh_metrics_daily(CURRENT_DATE - INTERVAL ''1 day''); SELECT public.refresh_metrics_daily(CURRENT_DATE);'
    );
  END IF;
END;
$$;

COMMIT;
