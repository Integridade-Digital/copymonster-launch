-- ============================================================================
-- Migration: 048_revoke_safe_decrypt_masked.sql
-- Description: remove the public decryption oracle.
--
-- `safe_decrypt_masked(TEXT, TEXT)` decrypts a caller-supplied ciphertext with
-- a caller-supplied key and returns the last four characters. It was created
-- without an explicit grant, so PostgreSQL left the default PUBLIC EXECUTE,
-- making it callable by anon and authenticated. It is only an internal helper
-- of the SECURITY DEFINER provider readers, which keep working because they
-- run as the function owner.
-- ============================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.safe_decrypt_masked(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

COMMIT;
