-- ============================================================================
-- Migration: 049_revoke_positioning_mappings_writes.sql
-- Description: force Brand DNA writes through the quota-checked RPCs.
--
-- `authenticated` held INSERT/UPDATE/DELETE on `positioning_mappings`, so a
-- member could bypass `create_positioning_mapping` and its plan quota by
-- inserting rows directly through PostgREST, and could move a mapping to
-- `completed` without `finalize_positioning_mapping`. The table keeps SELECT
-- (row-scoped by the existing policy); every write now goes through a
-- SECURITY DEFINER RPC that validates quota and ownership.
-- ============================================================================

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.positioning_mappings
  FROM PUBLIC, anon, authenticated;

-- The write policies are unreachable once the grants are gone; removing them
-- prevents a later grant from silently restoring direct writes.
DROP POLICY IF EXISTS "positioning_mappings_insert_policy" ON public.positioning_mappings;
DROP POLICY IF EXISTS "positioning_mappings_update_policy" ON public.positioning_mappings;
DROP POLICY IF EXISTS "positioning_mappings_delete_policy" ON public.positioning_mappings;

COMMIT;
