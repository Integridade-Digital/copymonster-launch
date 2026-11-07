BEGIN;

-- ============================================================================
-- MIGRATION 054: Admin Audit KPIs RPC
-- Provides aggregated counts for the Admin Audit tab over the entire audit_logs table.
-- Fixes the issue where KPIs were computed only from the current page (25 rows).
-- ============================================================================

-- RPC: get_admin_audit_kpis
-- Returns total counts for the audit dashboard KPIs
CREATE OR REPLACE FUNCTION public.get_admin_audit_kpis()
RETURNS TABLE (
  total BIGINT,
  creations BIGINT,
  updates BIGINT,
  deletions BIGINT,
  security BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (
      WHERE action ILIKE '%create%' 
         OR action ILIKE '%insert%'
         OR action ILIKE '%add%'
    )::BIGINT AS creations,
    COUNT(*) FILTER (
      WHERE action ILIKE '%update%' 
         OR action ILIKE '%edit%'
         OR action ILIKE '%modify%'
         OR action ILIKE '%change%'
    )::BIGINT AS updates,
    COUNT(*) FILTER (
      WHERE action ILIKE '%delete%' 
         OR action ILIKE '%remove%'
         OR action ILIKE '%archive%'
         OR action ILIKE '%purge%'
    )::BIGINT AS deletions,
    COUNT(*) FILTER (
      WHERE action ILIKE '%login%' 
         OR action ILIKE '%auth%'
         OR action ILIKE '%signin%'
         OR action ILIKE '%signout%'
         OR action ILIKE '%password%'
         OR action ILIKE '%session%'
    )::BIGINT AS security
  FROM public.audit_logs;
END;
$$;

COMMENT ON FUNCTION public.get_admin_audit_kpis() IS
  'Retorna KPIs agregados de auditoria para o painel de admin (total, criações, atualizações, deleções, segurança).';

-- RPC: get_admin_audit_count
-- Returns total count of audit logs matching optional filters
-- Used for pagination total pages calculation
CREATE OR REPLACE FUNCTION public.get_admin_audit_count(
  p_action TEXT DEFAULT NULL,
  p_resource_type TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  SELECT COUNT(*)::BIGINT
  INTO v_count
  FROM public.audit_logs
  WHERE (p_action IS NULL OR action = p_action)
    AND (p_resource_type IS NULL OR resource_type = p_resource_type);

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.get_admin_audit_count(TEXT, TEXT) IS
  'Retorna contagem total de logs de auditoria para paginação (com filtros opcionais).';

-- Grants
REVOKE EXECUTE ON FUNCTION public.get_admin_audit_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_kpis() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_audit_count(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_count(TEXT, TEXT) TO authenticated;

COMMIT;