-- ============================================================================
-- 047_048_revoked_rpcs.test.sql
--
-- Run against a Supabase-shaped database after applying the migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/047_048_revoked_rpcs.test.sql
--
-- Asserts that the client roles lost EXECUTE on the audit-write RPC and the
-- masked-decryption helper. The script runs inside one transaction and rolls
-- back.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.record_my_audit_log(TEXT,TEXT,UUID,JSONB,JSONB)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated may execute record_my_audit_log';
  END IF;

  IF has_function_privilege('anon', 'public.safe_decrypt_masked(TEXT,TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon may execute safe_decrypt_masked';
  END IF;

  IF has_function_privilege('authenticated', 'public.safe_decrypt_masked(TEXT,TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated may execute safe_decrypt_masked';
  END IF;
END
$$;

ROLLBACK;
