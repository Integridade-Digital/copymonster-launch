-- ============================================================================
-- 050_harden_get_current_tenant_id.test.sql
--
-- Run against a Supabase-shaped database after applying the migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/050_harden_get_current_tenant_id.test.sql
--
-- Asserts that `app.current_tenant_id` no longer selects the active tenant and
-- that an unowned JWT claim is rejected. Runs inside one transaction and rolls
-- back, so it writes no rows.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  _uid uuid := gen_random_uuid();
  _probe uuid := gen_random_uuid();
  _actual uuid;
BEGIN
  IF pg_get_functiondef('public.get_current_tenant_id()'::regprocedure)
       ILIKE '%app.current_tenant_id%' THEN
    RAISE EXCEPTION 'FAIL: get_current_tenant_id still reads app.current_tenant_id';
  END IF;

  -- 1. A session GUC must not select a tenant, even for an authenticated caller.
  PERFORM set_config('app.current_tenant_id', _probe::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _uid)::text, true);
  _actual := public.get_current_tenant_id();
  IF _actual = _probe THEN
    RAISE EXCEPTION 'FAIL: app.current_tenant_id still selects the active tenant';
  END IF;

  -- 2. A JWT claim is accepted only when the caller holds a role in that tenant.
  PERFORM set_config('app.current_tenant_id', '', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', _uid, 'tenant_id', _probe)::text,
    true
  );
  _actual := public.get_current_tenant_id();
  IF _actual = _probe THEN
    RAISE EXCEPTION 'FAIL: an unowned JWT tenant claim selected the active tenant';
  END IF;
END
$$;

ROLLBACK;
