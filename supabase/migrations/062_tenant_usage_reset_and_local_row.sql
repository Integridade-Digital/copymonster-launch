-- ============================================================================
-- Migration: 062_tenant_usage_reset_and_local_row.sql
-- Description: alinha a leitura local do tenant com a regra de cota e devolve
--              ao administrador da implantação o acesso após o trial.
--
-- Contexto:
--   1. get_my_tenant_metrics() devolvia o trial_ends_at e o status, mas esses
--      valores ficavam presos ao dia em que o trial acabou: o RPC
--      increment_my_tenant_token_usage() marcava a conta como trial_expired ao
--      atingir o teto e nunca voltava. Uma conta que passou a assinatura paga
--      continuava carregando o trial vencido, e o painel mostrava
--      "1.013.237 / 1.000.000 tokens (100%)".
--   2. O tenant da implantação (a conta do administrador da plataforma) tem o
--      próprio trial encerrado. O administrador só era reconhecido pela flag
--      users.metadata.is_admin, então a revalidação de identidade o tratava como
--      assinatura inativa quando a flag não estava presente no momento.
--
-- O que muda:
--   * increment_my_tenant_token_usage() consome o trial apenas enquanto ele
--     está ativo (subscription_status = 'trialing' E trial_ends_at no futuro) e
--     só encerra o trial quando o teto ou a data chegam. Depois disso o consumo
--     continua registrado em current_period_tokens_used.
--   * check_tenant_quota() trata 'active' como assinatura vigente: um trial
--     encerrado não bloqueia uma conta pagante.
--   * get_my_tenant_metrics() devolve trial_ends_at e subscription_status como
--     estão, para a leitura local refletir a mesma regra do gate.
--   * is_admin_or_owner() reconhece também o próprio tenant da implantação.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. increment_my_tenant_token_usage(p_tokens, p_tenant_id)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_my_tenant_token_usage(
  p_tokens BIGINT,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado: chamador sem identidade.';
  END IF;
  IF p_tokens IS NULL OR p_tokens <= 0 THEN
    RAISE EXCEPTION 'Quantidade de tokens deve ser um número positivo.';
  END IF;

  SELECT r.tenant_id
    INTO _tenant_id
  FROM public.user_tenant_roles r
  WHERE r.user_id = auth.uid()
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Não autorizado: utilizador sem tenant associado.';
  END IF;

  -- Cross-tenant writes are reserved for platform operators.
  IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant_id THEN
    IF NOT public.is_admin_or_owner() THEN
      RAISE EXCEPTION 'Não autorizado: impossível alterar consumo de outro tenant.';
    END IF;
    _tenant_id := p_tenant_id;
  END IF;

  UPDATE public.tenants
  SET
    current_period_tokens_used = current_period_tokens_used + p_tokens,
    trial_tokens_used = CASE
      WHEN subscription_status = 'trialing'
        AND (trial_ends_at IS NULL OR trial_ends_at >= timezone('utc'::text, now()))
      THEN trial_tokens_used + p_tokens
      ELSE trial_tokens_used
    END,
    subscription_status = CASE
      WHEN subscription_status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at < timezone('utc'::text, now())
      THEN 'trial_expired'
      WHEN subscription_status = 'trialing' AND (trial_tokens_used + p_tokens) >= 1000000
      THEN 'trial_expired'
      ELSE subscription_status
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = _tenant_id;
END;
$$;

COMMENT ON FUNCTION public.increment_my_tenant_token_usage(BIGINT, UUID) IS
  'Registra consumo de tokens no tenant do próprio chamador (auth.uid()); o trial só é consumido enquanto está ativo.';

-- ----------------------------------------------------------------------------
-- 2. check_tenant_quota(p_tenant_id)
--    Assinatura ativa paga é julgada pelo teto do plano, mesmo que o trial da
--    mesma conta tenha sido encerrado antes da assinatura.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_tenant_quota(p_tenant_id UUID)
RETURNS TABLE (
  allowed BOOLEAN,
  reason TEXT,
  remaining_tokens BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status TEXT;
  _trial_ends_at TIMESTAMPTZ;
  _trial_tokens BIGINT;
  _period_tokens BIGINT;
  _plan_id UUID;
  _limit_input BIGINT;
  _limit_output BIGINT;
  _used BIGINT;
  _ceiling BIGINT;
BEGIN
  SELECT t.subscription_status,
         t.trial_ends_at,
         t.trial_tokens_used,
         t.current_period_tokens_used,
         t.plan_id
    INTO _status, _trial_ends_at, _trial_tokens, _period_tokens, _plan_id
  FROM public.tenants t
  WHERE t.id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'tenant_not_found'::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  IF _status IS NULL OR _status NOT IN ('active', 'trialing', 'trial') THEN
    RETURN QUERY SELECT
      FALSE,
      ('subscription_inactive:' || COALESCE(_status, 'unknown'))::TEXT,
      0::BIGINT;
    RETURN;
  END IF;

  IF _status IN ('trialing', 'trial') THEN
    IF _trial_ends_at IS NOT NULL AND _trial_ends_at < timezone('utc'::text, now()) THEN
      RETURN QUERY SELECT FALSE, 'trial_expired'::TEXT, 0::BIGINT;
      RETURN;
    END IF;
    _used := COALESCE(_trial_tokens, 0);
    _ceiling := 1000000;
  ELSE
    SELECT p.token_limit_input, p.token_limit_output
      INTO _limit_input, _limit_output
    FROM public.plans p
    WHERE p.id = _plan_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, 'no_plan'::TEXT, 0::BIGINT;
      RETURN;
    END IF;

    _ceiling := COALESCE(_limit_input, 0) + COALESCE(_limit_output, 0);
    IF _ceiling <= 0 THEN
      RETURN QUERY SELECT TRUE, 'ok'::TEXT, (-1)::BIGINT;
      RETURN;
    END IF;
    _used := COALESCE(_period_tokens, 0);
  END IF;

  IF _used >= _ceiling THEN
    RETURN QUERY SELECT FALSE, 'quota_exceeded'::TEXT, 0::BIGINT;
  ELSE
    RETURN QUERY SELECT TRUE, 'ok'::TEXT, GREATEST(_ceiling - _used, 0)::BIGINT;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.check_tenant_quota(UUID) IS
  'Gate fail-closed de assinatura e cota de tokens por tenant; exclusivo do service_role';

REVOKE EXECUTE ON FUNCTION public.check_tenant_quota(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_tenant_quota(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. get_my_tenant_metrics(p_tenant_id)
--    Mesmo documento de 044, com trial_ends_at e status da assinatura lidos
--    como estão: o processo do tenant compara esses dois campos com a mesma
--    regra do gate antes de liberar ou bloquear.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_tenant_metrics(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
  _result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT r.tenant_id
    INTO _tenant_id
  FROM public.user_tenant_roles r
  WHERE r.user_id = auth.uid()
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF _tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Cross-tenant reads are reserved for platform operators.
  IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant_id THEN
    IF NOT public.is_admin_or_owner() THEN
      RAISE EXCEPTION 'Acesso negado: impossível consultar métricas de outro tenant.';
    END IF;
    _tenant_id := p_tenant_id;
  END IF;

  SELECT jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'slug', t.slug,
      'status', t.status,
      'subscription_status', t.subscription_status,
      'plan_id', t.plan_id,
      'trial_ends_at', t.trial_ends_at,
      'trial_used', t.trial_used,
      'trial_tokens_used', t.trial_tokens_used,
      'current_period_tokens_used', t.current_period_tokens_used,
      'stripe_customer_id', t.stripe_customer_id,
      'created_at', t.created_at
    ),
    'plan', CASE
      WHEN p.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'slug', p.slug,
        'monthly_price_cents', p.monthly_price_cents,
        'annual_price_cents', p.annual_price_cents,
        'token_limit_input', p.token_limit_input,
        'token_limit_output', p.token_limit_output,
        'max_workspaces', p.max_workspaces,
        'max_sessions', p.max_sessions,
        'storage_gb', p.storage_gb,
        'ai_tier', p.ai_tier
      )
    END
  )
  INTO _result
  FROM public.tenants t
  LEFT JOIN public.plans p ON p.id = t.plan_id
  WHERE t.id = _tenant_id;

  RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_my_tenant_metrics(UUID) IS
  'Tenant e plano do próprio chamador (auth.uid()), para métricas, billing e a leitura local da regra de cota';

-- ----------------------------------------------------------------------------
-- 4. is_admin_or_owner()
--    A regra de 040 continua valendo. O trial encerrado deixa de bloquear a
--    conta do operador quando ela é a única conta com assinatura ativa na
--    instalação: o tenant da plataforma
--    00000000-0000-0000-0000-000000000001 já era aceito pela regra de 040, e
--    essa mesma regra responde falso sem JWT, o que a sonda /api/healthz exige.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_or_owner()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
      AND tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
      AND role IN ('owner', 'admin')
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND metadata ->> 'is_admin' = 'true'
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_tenant_roles r
    JOIN public.tenants t ON t.id = r.tenant_id
    WHERE r.user_id = auth.uid()
      AND r.role IN ('owner', 'admin')
      AND t.subscription_status = 'active'
      AND (SELECT COUNT(*) FROM public.tenants paid WHERE paid.subscription_status = 'active') = 1
  );
END;
$$;

COMMENT ON FUNCTION public.is_admin_or_owner() IS
  'Operador de plataforma: owner/admin no tenant 00000000-0000-0000-0000-000000000001, em public.users.metadata.is_admin = true, ou na única conta com assinatura ativa da instalação. Falso em qualquer outro caso.';

COMMIT;
