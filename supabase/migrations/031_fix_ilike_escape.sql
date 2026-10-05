-- Migration 031: SEC-16 — escape de metacaracteres em get_admin_workspaces
-- Pendência do Bloco 1: 025_security_and_role_hardening.sql:130-132 compõe padrões ILIKE com p_search cru.
-- Escapa '\', '%' e '_' (barra primeiro, para não duplicar as barras inseridas nas etapas seguintes)
-- e declara ESCAPE '\' explícito. Literais no padrão standard_conforming_strings=on do Postgres.
-- REVOKE/GRANT idênticos aos da migração 025 (idempotentes; CREATE OR REPLACE preserva privilégios).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_workspaces(
  p_search TEXT DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT FALSE,
  p_include_deleted BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  tenant_id UUID,
  tenant_name TEXT,
  title TEXT,
  relative_path TEXT,
  is_archived BOOLEAN,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_search TEXT;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores e proprietários podem listar workspaces.';
  END IF;

  v_search := CASE
    WHEN p_search IS NULL THEN NULL
    ELSE replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_')
  END;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      wm.id,
      COALESCE(wm.workspace_id, wm.id) AS workspace_id,
      wm.tenant_id,
      COALESCE(t.name, 'Sem Tenant')::TEXT AS tenant_name,
      COALESCE(NULLIF(wm.title, ''), wm.name, 'Workspace')::TEXT AS title,
      COALESCE(NULLIF(wm.relative_path, ''), wm.path, '')::TEXT AS relative_path,
      COALESCE(wm.is_archived, FALSE) AS is_archived,
      wm.deleted_at,
      wm.created_at,
      wm.updated_at
    FROM public.workspaces_meta wm
    LEFT JOIN public.tenants t ON t.id = wm.tenant_id
    WHERE
      (p_tenant_id IS NULL OR wm.tenant_id = p_tenant_id)
      AND (p_include_archived OR COALESCE(wm.is_archived, FALSE) = FALSE)
      AND (p_include_deleted OR wm.deleted_at IS NULL)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR COALESCE(wm.title, wm.name, '') ILIKE ('%' || v_search || '%') ESCAPE '\'
        OR COALESCE(wm.relative_path, wm.path, '') ILIKE ('%' || v_search || '%') ESCAPE '\'
        OR COALESCE(t.name, '') ILIKE ('%' || v_search || '%') ESCAPE '\'
      )
  ),
  counted AS (
    SELECT COUNT(*) AS total FROM filtered
  )
  SELECT
    f.id,
    f.workspace_id,
    f.tenant_id,
    f.tenant_name,
    f.title,
    f.relative_path,
    f.is_archived,
    f.deleted_at,
    f.created_at,
    f.updated_at,
    c.total AS total_count
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY f.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT) TO service_role;

COMMIT;
