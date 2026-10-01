BEGIN;

-- ============================================================================
-- MIGRATION 018: Gestão de Sessões Globais (Bloco 7.6)
-- 1. Suporte a soft delete (deleted_at) em public.sessions_index
-- 2. RPC get_admin_sessions (listagem com filtros, paginação e joins)
-- 3. RPC get_admin_sessions_kpis (KPIs de sessões agregadas)
-- 4. RPC admin_archive_session (soft status: 'archived' com auditoria)
-- 5. RPC admin_purge_session (soft delete: deleted_at = NOW() com auditoria)
-- ============================================================================

-- 1. Adicionar coluna deleted_at e índice de suporte
ALTER TABLE public.sessions_index
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_index_deleted_at
  ON public.sessions_index(deleted_at);

-- 2. RPC get_admin_sessions
CREATE OR REPLACE FUNCTION public.get_admin_sessions(
  p_search TEXT DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 25
)
RETURNS TABLE (
  session_id TEXT,
  tenant_id UUID,
  tenant_name TEXT,
  tenant_slug TEXT,
  user_id UUID,
  user_email TEXT,
  user_full_name TEXT,
  title TEXT,
  model_used TEXT,
  tokens_total INT,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset INT;
BEGIN
  -- Guarda de segurança: apenas owner e admin
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: requer role owner ou admin';
  END IF;

  v_offset := GREATEST(0, (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 25));

  RETURN QUERY
  WITH filtered AS (
    SELECT
      si.id AS session_id,
      si.tenant_id,
      COALESCE(t.name, 'Tenant Desconhecido') AS tenant_name,
      COALESCE(t.slug, 'unknown') AS tenant_slug,
      si.user_id,
      COALESCE(u.email, 'Usuário Desconhecido') AS user_email,
      COALESCE(u.full_name, u.metadata->>'full_name', u.email, '') AS user_full_name,
      COALESCE(si.title, 'Sem título') AS title,
      COALESCE(si.model_used, 'N/A') AS model_used,
      COALESCE(si.tokens_total, 0) AS tokens_total,
      si.status,
      si.created_at,
      si.updated_at
    FROM public.sessions_index si
    LEFT JOIN public.tenants t ON t.id = si.tenant_id
    LEFT JOIN public.users u ON u.id = si.user_id
    WHERE si.deleted_at IS NULL
      AND (p_tenant_id IS NULL OR si.tenant_id = p_tenant_id)
      AND (p_model IS NULL OR p_model = '' OR si.model_used = p_model)
      AND (p_status IS NULL OR p_status = '' OR si.status = p_status)
      AND (
        p_search IS NULL OR p_search = '' OR
        si.id ILIKE '%' || p_search || '%' OR
        si.title ILIKE '%' || p_search || '%' OR
        u.email ILIKE '%' || p_search || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*) AS total FROM filtered
  )
  SELECT
    f.session_id,
    f.tenant_id,
    f.tenant_name,
    f.tenant_slug,
    f.user_id,
    f.user_email,
    f.user_full_name,
    f.title,
    f.model_used,
    f.tokens_total,
    f.status,
    f.created_at,
    f.updated_at,
    c.total AS total_count
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY f.created_at DESC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$;

-- 3. RPC get_admin_sessions_kpis
CREATE OR REPLACE FUNCTION public.get_admin_sessions_kpis()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT := 0;
  v_active BIGINT := 0;
  v_completed BIGINT := 0;
  v_archived BIGINT := 0;
  v_tokens BIGINT := 0;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: requer role owner ou admin';
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'active'),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'archived'),
    COALESCE(SUM(tokens_total), 0)
  INTO
    v_total,
    v_active,
    v_completed,
    v_archived,
    v_tokens
  FROM public.sessions_index
  WHERE deleted_at IS NULL;

  RETURN jsonb_build_object(
    'total_sessions', v_total,
    'active_sessions', v_active,
    'completed_sessions', v_completed,
    'archived_sessions', v_archived,
    'total_tokens', v_tokens
  );
END;
$$;

-- 4. RPC admin_archive_session (Arquivamento com auditoria)
CREATE OR REPLACE FUNCTION public.admin_archive_session(
  p_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: requer role owner ou admin';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions_index
  WHERE id = p_session_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão não encontrada ou já purgada';
  END IF;

  UPDATE public.sessions_index
  SET status = 'archived',
      updated_at = NOW()
  WHERE id = p_session_id;

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource_type,
    resource_id,
    old_value,
    new_value,
    created_at
  ) VALUES (
    v_session.tenant_id,
    auth.uid(),
    'ARCHIVE_SESSION',
    'SESSION',
    p_session_id,
    jsonb_build_object('status', v_session.status),
    jsonb_build_object('status', 'archived'),
    NOW()
  );

  RETURN true;
END;
$$;

-- 5. RPC admin_purge_session (Soft delete com auditoria)
CREATE OR REPLACE FUNCTION public.admin_purge_session(
  p_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: requer role owner ou admin';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions_index
  WHERE id = p_session_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão não encontrada ou já purgada';
  END IF;

  UPDATE public.sessions_index
  SET deleted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_session_id;

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource_type,
    resource_id,
    old_value,
    new_value,
    created_at
  ) VALUES (
    v_session.tenant_id,
    auth.uid(),
    'PURGE_SESSION',
    'SESSION',
    p_session_id,
    jsonb_build_object('title', v_session.title, 'status', v_session.status),
    jsonb_build_object('deleted_at', NOW()),
    NOW()
  );

  RETURN true;
END;
$$;

-- 6. Concessões de permissão
REVOKE EXECUTE ON FUNCTION public.get_admin_sessions(TEXT, UUID, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_sessions(TEXT, UUID, TEXT, TEXT, INT, INT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_sessions_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_sessions_kpis() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_archive_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_archive_session(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_purge_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_session(TEXT) TO authenticated;

COMMIT;
