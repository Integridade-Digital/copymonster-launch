-- Migration 025: Blindagem de Segurança e RLS
-- 1. Hardening de is_admin_or_owner() amarrado exclusivamente ao tenant ativo em user_tenant_roles
-- 2. Revogação de privilégios públicos e concessão restrita (authenticated/service_role) em RPCs SECURITY DEFINER
-- 3. Habilitação de RLS em public.trial_rate_limits com deny default
-- 4. Correção e padronização de colunas em public.audit_logs e rewrite de get_system_secret()

BEGIN;

-- ==============================================================================
-- 1. REESCRITA DE is_admin_or_owner()
-- Autoridade SÓ via public.user_tenant_roles no tenant ativo.
-- NUNCA confiar em app_metadata.role ou user_metadata.role do JWT.
-- ==============================================================================
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
-- 2. AJUSTE DE COLUNAS EM audit_logs E REESCRITA DE get_system_secret()
-- Substitui colunas obsoletas resource/metadata por resource_type/resource_id
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
    jsonb_build_object('key', secret_key, 'read_at', now()),
    NOW()
  );

  RETURN v_val;
END;
$$;

-- ==============================================================================
-- 3. HABILITAR ROW LEVEL SECURITY EM public.trial_rate_limits
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
-- 4. REVOKE EXECUTE FROM PUBLIC & GRANT TO authenticated NAS 5 RPCS
-- - get_admin_workspaces (022)
-- - get_system_secret (008)
-- - get_llm_encryption_key (014)
-- - get_my_profile (003)
-- - increment_tenant_token_usage (007)
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

-- Conceder também ao service_role para automações e jobs de backend
GRANT EXECUTE ON FUNCTION public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_system_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_llm_encryption_key() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_tenant_token_usage(UUID, BIGINT) TO service_role;

COMMIT;
