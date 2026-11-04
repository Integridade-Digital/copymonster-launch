-- ============================================================================
-- Migration: 047_revoke_audit_log_rpc.sql
-- Description: stop trusting the client to write its own audit entries.
--
-- `record_my_audit_log` accepted an arbitrary action, resource, and
-- before/after payload from any authenticated caller, so a member could forge
-- audit rows for their tenant. The RPC is revoked from every client role and
-- the auditable positioning-mapping changes are recorded by a trigger instead,
-- inside the database and under SECURITY DEFINER.
-- ============================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.record_my_audit_log(TEXT, TEXT, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Server-side audit for positioning mapping changes. The trigger runs as the
-- table owner, so no client grant is involved and the payload cannot be chosen
-- by the caller.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_positioning_mapping_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value
  ) VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    auth.uid(),
    TG_OP,
    'positioning_mapping',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;

COMMENT ON FUNCTION public.audit_positioning_mapping_change() IS
  'Registra INSERT/UPDATE/DELETE de positioning_mappings em audit_logs sem depender do cliente';

DROP TRIGGER IF EXISTS audit_positioning_mapping ON public.positioning_mappings;
CREATE TRIGGER audit_positioning_mapping
  AFTER INSERT OR UPDATE OR DELETE ON public.positioning_mappings
  FOR EACH ROW EXECUTE FUNCTION public.audit_positioning_mapping_change();

COMMIT;
