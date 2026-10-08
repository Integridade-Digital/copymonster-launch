BEGIN;

-- ============================================================================
-- MIGRATION 034: Hardening de get_current_tenant_id()
--
-- O passo 1.1 confiava cegamente no claim `tenant_id` do JWT, sem validar se o
-- usuario ainda possui role naquele tenant. Um token obsoleto apontando para um
-- tenant pessoal ja excluido fazia get_current_tenant_id() retornar o tenant
-- morto, e is_admin_or_owner() falhava ("Acesso negado") mesmo para o owner.
--
-- Esta migration reescreve APENAS get_current_tenant_id(): o claim so e aceito
-- se auth.uid() tiver linha em public.user_tenant_roles naquele tenant; caso
-- contrario cai no fallback deterministico (owner primeiro, depois created_at).
--
-- Nao altera is_admin_or_owner(), nem custom_access_token_hook(), nem o schema
-- de user_tenant_roles. Somente CREATE OR REPLACE de get_current_tenant_id().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _jwt_tenant TEXT;
  _session_tenant TEXT;
  _resolved_tenant UUID;
BEGIN
  -- 1.1. Claim do JWT: aceita somente se o usuario tiver role nesse tenant.
  _jwt_tenant := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id';
  IF _jwt_tenant IS NOT NULL
     AND _jwt_tenant ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND auth.uid() IS NOT NULL THEN
    SELECT tenant_id INTO _resolved_tenant
    FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
      AND tenant_id = _jwt_tenant::uuid
    ORDER BY (role = 'owner') DESC, created_at ASC
    LIMIT 1;

    IF _resolved_tenant IS NOT NULL THEN
      RETURN _resolved_tenant;
    END IF;
  END IF;

  -- 1.2. Configuracao explicita de sessao (SET LOCAL app.current_tenant_id)
  _session_tenant := nullif(current_setting('app.current_tenant_id', true), '');
  IF _session_tenant IS NOT NULL
     AND _session_tenant ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN _session_tenant::uuid;
  END IF;

  -- 1.3. Fallback deterministico: tenant onde o usuario e owner, senao o mais antigo
  IF auth.uid() IS NOT NULL THEN
    SELECT tenant_id INTO _resolved_tenant
    FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
    ORDER BY (role = 'owner') DESC, created_at ASC
    LIMIT 1;

    IF _resolved_tenant IS NOT NULL THEN
      RETURN _resolved_tenant;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

COMMIT;
