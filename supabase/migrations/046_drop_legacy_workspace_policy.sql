-- ============================================================================
-- Migration: 046_drop_legacy_workspace_policy.sql
-- Description: remove the tenant-wide `workspaces_meta` SELECT policy left by
--              002 and superseded by the per-user policy in 005/006.
--
-- `"Users can view tenant workspaces"` let any member of a tenant read every
-- workspace row in it, including `relative_path`. 006 created the stricter
-- `"Users can view workspaces of their tenant"` policy (own rows, or every row
-- for an owner/admin), but never dropped the 002 policy, so Postgres OR-ed
-- both permissive policies and the tenant-wide read stayed open.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Users can view tenant workspaces" ON public.workspaces_meta;

COMMIT;
