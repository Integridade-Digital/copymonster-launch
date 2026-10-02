-- Migration 022: Correção idempotente de workspaces_meta e resolução de ambiguidade na RPC get_admin_workspaces

-- 1. Eliminar assinaturas anteriores para resolver ambiguidade no Postgres
DROP FUNCTION IF EXISTS public.get_admin_workspaces();
DROP FUNCTION IF EXISTS public.get_admin_workspaces(TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT);

-- 2. Garantir colunas na tabela workspaces_meta
ALTER TABLE public.workspaces_meta
  ADD COLUMN IF NOT EXISTS workspace_id TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS relative_path TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;

-- 3. Backfill idempotente
UPDATE public.workspaces_meta
SET workspace_id = id::text
WHERE workspace_id IS NULL;

UPDATE public.workspaces_meta
SET title = COALESCE(NULLIF(title, ''), name, 'Workspace sem título')
WHERE title IS NULL OR title = '';

UPDATE public.workspaces_meta
SET relative_path = COALESCE(NULLIF(relative_path, ''), path, id::text)
WHERE relative_path IS NULL OR relative_path = '';

-- 4. Constraint NOT NULL após backfill
ALTER TABLE public.workspaces_meta
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN relative_path SET NOT NULL;

-- 5. Trigger de updated_at
DROP TRIGGER IF EXISTS update_workspaces_meta_updated_at ON public.workspaces_meta;
CREATE TRIGGER update_workspaces_meta_updated_at
  BEFORE UPDATE ON public.workspaces_meta
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Índices
CREATE INDEX IF NOT EXISTS idx_workspaces_meta_tenant_workspace_id
  ON public.workspaces_meta (tenant_id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspaces_meta_deleted_at
  ON public.workspaces_meta (deleted_at);

-- 7. Criar a RPC definitiva de 6 argumentos com fallbacks
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
  workspace_id TEXT,
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
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores e proprietários podem listar workspaces.';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      wm.id,
      COALESCE(wm.workspace_id, wm.id::text)::TEXT AS workspace_id,
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
        OR COALESCE(wm.title, wm.name, '') ILIKE '%' || p_search || '%'
        OR COALESCE(wm.relative_path, wm.path, '') ILIKE '%' || p_search || '%'
        OR COALESCE(t.name, '') ILIKE '%' || p_search || '%'
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
