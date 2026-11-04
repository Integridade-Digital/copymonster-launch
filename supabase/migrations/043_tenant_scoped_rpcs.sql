-- ============================================================================
-- Migration: 043_tenant_scoped_rpcs.sql
-- Description: RPCs com escopo de chamador para o DSH do tenant deixar de
--              precisar da SUPABASE_SERVICE_ROLE_KEY (P0-4 da auditoria).
--
-- Contexto: hoje o processo do tenant recebe a chave service_role para
--   (a) validar identidade, (b) ler quota e métricas, (c) gravar consumo de
--   tokens, (d) escrever o índice de sessões, (e) ler Brand DNA e (f) billing.
--   Qualquer tenant consegue ler essa chave do próprio ambiente e, com ela,
--   contornar toda a RLS.
--
-- Estas funções derivam o tenant e o utilizador de auth.uid() e nunca aceitam
-- um id de tenant vindo do cliente. As funções service_role existentes ficam
-- intactas: o app principal e o orquestrador continuam a usá-las.
--
-- Grants: EXECUTE apenas para authenticated; anon e PUBLIC ficam sem acesso.
-- Aplicar antes de retirar SUPABASE_SERVICE_ROLE_KEY do ambiente do tenant.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. check_my_tenant_quota()
-- Mesmas regras de check_tenant_quota, com o tenant derivado do chamador.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_my_tenant_quota()
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
  _tenant_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT FALSE, 'not_authenticated'::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  SELECT r.tenant_id
    INTO _tenant_id
  FROM public.user_tenant_roles r
  WHERE r.user_id = auth.uid()
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'tenant_not_found'::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  RETURN QUERY SELECT * FROM public.check_tenant_quota(_tenant_id);
END;
$$;

COMMENT ON FUNCTION public.check_my_tenant_quota() IS
  'Gate de cota do próprio chamador; deriva o tenant de auth.uid() e delega em check_tenant_quota';

-- ----------------------------------------------------------------------------
-- 2. increment_my_tenant_token_usage(p_tokens)
-- Mesma atualização de increment_tenant_token_usage, sem aceitar tenant id.
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
      WHEN subscription_status = 'trialing' THEN trial_tokens_used + p_tokens
      ELSE trial_tokens_used
    END,
    subscription_status = CASE
      WHEN subscription_status = 'trialing' AND (trial_tokens_used + p_tokens) >= 1000000
      THEN 'trial_expired'
      ELSE subscription_status
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = _tenant_id;
END;
$$;

COMMENT ON FUNCTION public.increment_my_tenant_token_usage(BIGINT, UUID) IS
  'Registra consumo de tokens no tenant do próprio chamador (auth.uid())';

-- ----------------------------------------------------------------------------
-- 3. get_my_tenant_metrics()
-- Devolve o tenant do chamador e o plano associado, para o painel de billing
-- e de métricas deixar de ler com service_role.
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
  'Tenant e plano do próprio chamador (auth.uid()), para métricas e billing';

-- ----------------------------------------------------------------------------
-- 4. admin_list_tenants()
-- Substitui a leitura cross-tenant do painel de admin, que hoje usa
-- service_role. O gate é is_admin_or_owner(), que já valida o tenant de
-- plataforma e a flag users.metadata.is_admin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS SETOF JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: operador de plataforma apenas.';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
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
    'created_at', t.created_at
  )
  FROM public.tenants t
  ORDER BY t.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.admin_list_tenants() IS
  'Lista de tenants para operadores de plataforma; substitui a leitura service_role do painel';

-- ----------------------------------------------------------------------------
-- 5. runtime_upsert_my_session_index(...)
-- Índice de sessões do próprio chamador. Verifica a posse antes de escrever.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.runtime_upsert_my_session_index(
  p_session_id TEXT,
  p_title TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'active'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
  _user_id UUID := auth.uid();
BEGIN
  IF _user_id IS NULL OR p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sessions_index
    WHERE id = p_session_id AND user_id IS DISTINCT FROM _user_id
  ) THEN
    RAISE EXCEPTION 'Não autorizado: sessão de outro utilizador.';
  END IF;

  SELECT r.tenant_id
    INTO _tenant_id
  FROM public.user_tenant_roles r
  WHERE r.user_id = _user_id
  ORDER BY r.created_at ASC
  LIMIT 1;

  PERFORM public.runtime_upsert_session_index(
    p_session_id, _tenant_id, _user_id, p_title, p_model, p_status
  );
END;
$$;

COMMENT ON FUNCTION public.runtime_upsert_my_session_index(TEXT, TEXT, TEXT, TEXT) IS
  'Índice de sessões do próprio chamador; valida a posse antes de escrever';

-- ----------------------------------------------------------------------------
-- 6. runtime_increment_my_session_tokens(p_session_id, p_tokens)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.runtime_increment_my_session_tokens(
  p_session_id TEXT,
  p_tokens BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_session_id IS NULL OR p_tokens IS NULL OR p_tokens <= 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sessions_index
    WHERE id = p_session_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Não autorizado: sessão de outro utilizador.';
  END IF;

  PERFORM public.runtime_increment_session_tokens(p_session_id, p_tokens);
END;
$$;

COMMENT ON FUNCTION public.runtime_increment_my_session_tokens(TEXT, BIGINT) IS
  'Soma tokens ao índice da sessão do próprio chamador';

-- ----------------------------------------------------------------------------
-- 7. runtime_mark_my_session_status(p_session_id, p_status)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.runtime_mark_my_session_status(
  p_session_id TEXT,
  p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sessions_index
    WHERE id = p_session_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Não autorizado: sessão de outro utilizador.';
  END IF;

  PERFORM public.runtime_mark_session_status(p_session_id, p_status);
END;
$$;

COMMENT ON FUNCTION public.runtime_mark_my_session_status(TEXT, TEXT) IS
  'Atualiza o estado da sessão do próprio chamador';

-- ----------------------------------------------------------------------------
-- 8. get_my_positioning_mapping(p_mapping_id)
-- Brand DNA do próprio chamador, sem aceitar user id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_positioning_mapping(p_mapping_id UUID)
RETURNS SETOF public.positioning_mappings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.positioning_mappings
  WHERE id = p_mapping_id
    AND user_id = auth.uid()
    AND status != 'archived'
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.get_my_positioning_mapping(UUID) IS
  'Brand DNA do próprio chamador; deriva o utilizador de auth.uid()';

-- ----------------------------------------------------------------------------
-- 9. record_my_audit_log(...)
-- Registo de auditoria do próprio chamador. `audit_logs` só tem política de
-- leitura para admin, por isso a escrita passa por aqui.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_my_audit_log(
  p_action TEXT,
  p_resource_type TEXT DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL,
  p_old_value JSONB DEFAULT NULL,
  p_new_value JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
  _log_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado: chamador sem identidade.';
  END IF;
  IF p_action IS NULL OR trim(p_action) = '' THEN
    RAISE EXCEPTION 'Ação de auditoria é obrigatória.';
  END IF;

  SELECT r.tenant_id
    INTO _tenant_id
  FROM public.user_tenant_roles r
  WHERE r.user_id = auth.uid()
  ORDER BY r.created_at ASC
  LIMIT 1;

  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value
  )
  VALUES (
    _tenant_id, auth.uid(), p_action, p_resource_type, p_resource_id, p_old_value, p_new_value
  )
  RETURNING id INTO _log_id;

  RETURN _log_id;
END;
$$;

COMMENT ON FUNCTION public.record_my_audit_log(TEXT, TEXT, UUID, JSONB, JSONB) IS
  'Grava uma entrada de auditoria para o próprio chamador (auth.uid())';

-- ----------------------------------------------------------------------------
-- 10. admin_list_audit_logs(...)
-- Leitura cross-tenant do painel de admin, substituindo o service_role.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_audit_logs(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_tenant_id UUID DEFAULT NULL,
  p_action TEXT DEFAULT NULL
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  _offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: operador de plataforma apenas.';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', a.id,
    'tenant_id', a.tenant_id,
    'user_id', a.user_id,
    'action', a.action,
    'resource_type', a.resource_type,
    'resource_id', a.resource_id,
    'old_value', a.old_value,
    'new_value', a.new_value,
    'ip_address', a.ip_address,
    'user_agent', a.user_agent,
    'created_at', a.created_at
  )
  FROM public.audit_logs a
  WHERE (p_tenant_id IS NULL OR a.tenant_id = p_tenant_id)
    AND (p_action IS NULL OR a.action = p_action)
  ORDER BY a.created_at DESC
  OFFSET _offset
  LIMIT _limit;
END;
$$;

COMMENT ON FUNCTION public.admin_list_audit_logs(INTEGER, INTEGER, UUID, TEXT) IS
  'Trilha de auditoria para operadores de plataforma; substitui a leitura service_role';

-- ----------------------------------------------------------------------------
-- Grants: apenas authenticated. anon e PUBLIC ficam sem acesso.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.check_my_tenant_quota() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.increment_my_tenant_token_usage(BIGINT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_tenant_metrics(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_tenants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.runtime_upsert_my_session_index(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.runtime_increment_my_session_tokens(TEXT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.runtime_mark_my_session_status(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_positioning_mapping(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_my_audit_log(TEXT, TEXT, UUID, JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_audit_logs(INTEGER, INTEGER, UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.check_my_tenant_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_my_tenant_token_usage(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_metrics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_upsert_my_session_index(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_increment_my_session_tokens(TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_mark_my_session_status(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_positioning_mapping(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_my_audit_log(TEXT, TEXT, UUID, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_logs(INTEGER, INTEGER, UUID, TEXT) TO authenticated;

COMMIT;
