-- Migration 025: Blindagem de Segurança e RLS
-- 1. Hardening de is_admin_or_owner() amarrado exclusivamente ao tenant ativo em user_tenant_roles
-- 2. Recriação com DROP prévio e hardening (search_path = public) das 5 RPCs SECURITY DEFINER
-- 3. Revogação de privilégios públicos e concessão restrita (authenticated/service_role) nas 5 RPCs
-- 4. Habilitação de RLS em public.trial_rate_limits com deny default
-- 5. Correção e padronização de colunas em public.audit_logs

BEGIN;

-- ==============================================================================
-- 1. REESCRITA DE is_admin_or_owner() COM DROP PRÉVIO
-- Autoridade SÓ via public.user_tenant_roles no tenant ativo.
-- NUNCA confiar em app_metadata.role ou user_metadata.role do JWT.
-- ==============================================================================
DROP FUNCTION IF EXISTS public.is_admin_or_owner();

CREATE OR REPLACE FUNCTION public.is_admin_or_owner()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  _active_tenant_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  _active_tenant_id := public.get_current_tenant_id();
  IF _active_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
      AND tenant_id = _active_tenant_id
      AND role IN ('owner', 'admin')
  );
END;
$$;

COMMENT ON FUNCTION public.is_admin_or_owner() IS
  'Verifica se o usuário autenticado possui role admin ou owner no tenant ativo via user_tenant_roles (imune a forjamento de JWT metadata)';

-- ==============================================================================
-- 2. AJUSTE DE COLUNAS EM audit_logs
-- Garante colunas resource_type/resource_id
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'resource_type'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN resource_type TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'resource_id'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN resource_id UUID;
  END IF;
END $$;

-- ==============================================================================
-- 3. RECRIAÇÃO DAS 5 RPCS SECURITY DEFINER COM DROP ANTES DO CREATE OR REPLACE
-- ==============================================================================

-- 3.1 get_admin_workspaces (Drop de assinaturas legadas de 0 e 6 argumentos)
DROP FUNCTION IF EXISTS public.get_admin_workspaces();
DROP FUNCTION IF EXISTS public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT);

CREATE OR REPLACE FUNCTION public.get_admin_workspaces(
  p_search TEXT DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT FALSE,
  p_include_deleted BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  tenant_id UUID,
  tenant_name TEXT,
  title TEXT,
  relative_path TEXT,
  is_archived BOOLEAN,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores e proprietários podem listar workspaces.';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      wm.id,
      COALESCE(wm.workspace_id, wm.id) AS workspace_id,
      wm.tenant_id,
      COALESCE(t.name, 'Sem Tenant')::TEXT AS tenant_name,
      COALESCE(NULLIF(wm.title, ''), wm.name, 'Workspace')::TEXT AS title,
      COALESCE(NULLIF(wm.relative_path, ''), wm.path, '')::TEXT AS relative_path,
      COALESCE(wm.is_archived, FALSE) AS is_archived,
      wm.deleted_at,
      wm.created_at,
      wm.updated_at
    FROM public.workspaces_meta wm
    LEFT JOIN public.tenants t ON t.id = wm.tenant_id
    WHERE
      (p_tenant_id IS NULL OR wm.tenant_id = p_tenant_id)
      AND (p_include_archived OR COALESCE(wm.is_archived, FALSE) = FALSE)
      AND (p_include_deleted OR wm.deleted_at IS NULL)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR COALESCE(wm.title, wm.name, '') ILIKE '%' || p_search || '%'
        OR COALESCE(wm.relative_path, wm.path, '') ILIKE '%' || p_search || '%'
        OR COALESCE(t.name, '') ILIKE '%' || p_search || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*) AS total FROM filtered
  )
  SELECT
    f.id,
    f.workspace_id,
    f.tenant_id,
    f.tenant_name,
    f.title,
    f.relative_path,
    f.is_archived,
    f.deleted_at,
    f.created_at,
    f.updated_at,
    c.total AS total_count
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY f.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- 3.2 get_system_secret (Drop prévio para prevenir erro 42P13 ao renomear/recriar parâmetro)
DROP FUNCTION IF EXISTS public.get_system_secret(TEXT);

CREATE OR REPLACE FUNCTION public.get_system_secret(p_key TEXT)
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
  WHERE key = p_key;

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource_type,
    resource_id,
    old_value,
    new_value,
    created_at
  ) VALUES (
    public.get_current_tenant_id(),
    auth.uid(),
    'READ_SECRET',
    'SYSTEM_CONFIG',
    NULL,
    NULL,
    jsonb_build_object('key', p_key, 'read_at', now()),
    NOW()
  );

  RETURN v_val;
END;
$$;

-- 3.3 get_llm_encryption_key
DROP FUNCTION IF EXISTS public.get_llm_encryption_key();

CREATE OR REPLACE FUNCTION public.get_llm_encryption_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT value #>> '{}' INTO v_key
  FROM public.system_config
  WHERE key = 'LLM_ENCRYPTION_KEY';

  RETURN v_key;
END;
$$;

-- 3.4 get_my_profile
DROP FUNCTION IF EXISTS public.get_my_profile();

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _result JSONB;
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'full_name', u.full_name,
      'avatar_url', u.avatar_url,
      'whatsapp', u.whatsapp
    ),
    'tenant', CASE
      WHEN t.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'slug', t.slug,
        'status', t.status
      )
    END,
    'role', r.role
  )
  INTO _result
  FROM public.users u
  LEFT JOIN public.user_tenant_roles r ON r.user_id = u.id
  LEFT JOIN public.tenants t ON t.id = r.tenant_id
  WHERE u.id = _user_id
  ORDER BY r.created_at ASC
  LIMIT 1;

  RETURN _result;
END;
$$;

-- 3.5 increment_tenant_token_usage
DROP FUNCTION IF EXISTS public.increment_tenant_token_usage(UUID, BIGINT);

CREATE OR REPLACE FUNCTION public.increment_tenant_token_usage(
  p_tenant_id UUID,
  p_tokens BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_tenant_id UUID;
BEGIN
  -- Validação estrita com extração moderna de JWT
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

-- ==============================================================================
-- 4. HABILITAR ROW LEVEL SECURITY EM public.trial_rate_limits
-- Deny default: nenhum acesso direto do cliente (somente triggers/RPCs internas)
-- ==============================================================================
ALTER TABLE public.trial_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_trial_rate_limits" ON public.trial_rate_limits;
CREATE POLICY "deny_all_trial_rate_limits"
  ON public.trial_rate_limits
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- ==============================================================================
-- 5. REVOKE EXECUTE FROM PUBLIC & GRANT TO authenticated E service_role
-- ==============================================================================
REVOKE EXECUTE ON FUNCTION public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_system_secret(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_llm_encryption_key() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_tenant_token_usage(UUID, BIGINT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_secret(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_llm_encryption_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_tenant_token_usage(UUID, BIGINT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_system_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_llm_encryption_key() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_tenant_token_usage(UUID, BIGINT) TO service_role;

COMMIT;
