-- ============================================================================
-- 049_revoke_positioning_mappings_writes.test.sql
--
-- Run against a Supabase-shaped database after applying the migration:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/049_revoke_positioning_mappings_writes.test.sql
--
-- Asserts that client roles lost direct write access to positioning_mappings
-- while keeping SELECT and the quota-checked RPCs. Rolls back at the end.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.positioning_mappings', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: authenticated may INSERT positioning_mappings directly';
  END IF;
  IF has_table_privilege('authenticated', 'public.positioning_mappings', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: authenticated may UPDATE positioning_mappings directly';
  END IF;
  IF has_table_privilege('authenticated', 'public.positioning_mappings', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL: authenticated may DELETE positioning_mappings directly';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.positioning_mappings', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated lost SELECT on positioning_mappings';
  END IF;

  IF has_table_privilege('anon', 'public.positioning_mappings', 'INSERT')
     OR has_table_privilege('anon', 'public.positioning_mappings', 'UPDATE')
     OR has_table_privilege('anon', 'public.positioning_mappings', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL: anon may write positioning_mappings';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.create_positioning_mapping(TEXT,TEXT)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated lost the create_positioning_mapping RPC';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.finalize_positioning_mapping(UUID,TEXT,TEXT)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated lost the finalize_positioning_mapping RPC';
  END IF;
END
$$;

ROLLBACK;
