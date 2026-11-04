-- ============================================================================
-- Migration: 050_harden_get_current_tenant_id.sql
-- Description: remove the unvalidated `app.current_tenant_id` tenant source.
--
-- The 034 definition of `get_current_tenant_id()` returns
-- `app.current_tenant_id` before consulting `user_tenant_roles`, so any
-- function or pooled connection that sets that GUC chooses the tenant every
-- RLS policy evaluates against. No repository caller sets it: no migration,
-- Node process, or orchestrator calls `set_config` with that key, so the
-- branch protects nothing and only leaves an unauthenticated tenant selector.
--
-- The two sources kept are validated: the JWT claim is accepted only while
-- `auth.uid()` holds a role in that tenant, and the fallback orders the
-- caller's memberships owner-first, then oldest.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _jwt_tenant TEXT;
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

  -- 1.2. Fallback deterministico: tenant onde o usuario e owner, senao o mais antigo
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

COMMENT ON FUNCTION public.get_current_tenant_id() IS
  'Active tenant for auth.uid(): the JWT claim validated against user_tenant_roles, else the owner-first, oldest membership. A session GUC never selects it.';

COMMIT;
