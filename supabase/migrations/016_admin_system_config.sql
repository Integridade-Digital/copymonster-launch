BEGIN;

-- ============================================================================
-- 1. ADICIONAR SUPORTE A SOFT DELETE EM workspaces_meta
-- ============================================================================
ALTER TABLE public.workspaces_meta
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_workspaces_meta_deleted_at 
  ON public.workspaces_meta (deleted_at);

-- ============================================================================
-- 2. RPC get_admin_system_config (LEITURA SEGURA COM FILTRO DE PREFIXO)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_system_config(p_prefix TEXT DEFAULT NULL)
RETURNS TABLE (
  key TEXT,
  value JSONB,
  description TEXT,
  is_secret BOOLEAN,
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  updated_by_email TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  RETURN QUERY
  SELECT 
    sc.key,
    CASE 
      WHEN sc.is_secret THEN '"***SECRET***"'::jsonb 
      ELSE sc.value 
    END AS value,
    sc.description,
    sc.is_secret,
    sc.updated_at,
    sc.updated_by,
    u.email AS updated_by_email
  FROM public.system_config sc
  LEFT JOIN public.users u ON u.id = sc.updated_by
  WHERE (p_prefix IS NULL OR sc.key LIKE (p_prefix || '%'))
  ORDER BY sc.key ASC;
END;
$$;

-- ============================================================================
-- 3. RPC admin_upsert_system_config (COM BLOQUEIOS DE SEGURANÇA E AUDITORIA)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_system_config(
  p_key TEXT,
  p_value JSONB,
  p_description TEXT DEFAULT NULL,
  p_is_secret BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'A chave de configuração é obrigatória.';
  END IF;

  -- Rejeitar p_is_secret = true via painel
  IF p_is_secret = true THEN
    RAISE EXCEPTION 'Chaves secretas não podem ser criadas ou editadas pelo painel. Use migration manual.';
  END IF;

  -- Bloquear chaves reservadas do sistema
  IF p_key = 'LLM_ENCRYPTION_KEY' OR p_key LIKE 'system.%' THEN
    RAISE EXCEPTION 'Chave reservada do sistema não pode ser alterada pelo painel.';
  END IF;

  -- Se a chave já existir, checar se é secreta no banco
  SELECT * INTO v_existing FROM public.system_config WHERE key = p_key;
  IF FOUND AND v_existing.is_secret = true THEN
    RAISE EXCEPTION 'Esta chave é protegida como secreta e não pode ser sobrescrita pelo painel.';
  END IF;

  -- Upsert
  INSERT INTO public.system_config (key, value, description, is_secret, updated_at, updated_by)
  VALUES (p_key, COALESCE(p_value, '{}'::jsonb), p_description, false, NOW(), auth.uid())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = COALESCE(EXCLUDED.description, public.system_config.description),
      updated_at = NOW(),
      updated_by = auth.uid();

  -- Auditoria
  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
  ) VALUES (
    NULL,
    auth.uid(),
    'UPSERT_SYSTEM_CONFIG',
    'SYSTEM_CONFIG',
    NULL,
    CASE WHEN v_existing.key IS NOT NULL THEN jsonb_build_object('key', v_existing.key, 'value', v_existing.value, 'description', v_existing.description) ELSE NULL END,
    jsonb_build_object('key', p_key, 'value', p_value, 'description', p_description),
    NOW()
  );
END;
$$;

-- ============================================================================
-- 4. RPC admin_delete_system_config (COM BLOQUEIOS DE SEGURANÇA E AUDITORIA)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_delete_system_config(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  -- Bloqueio de chaves reservadas
  IF p_key = 'LLM_ENCRYPTION_KEY' OR p_key LIKE 'system.%' THEN
    RAISE EXCEPTION 'Chave reservada do sistema não pode ser deletada pelo painel.';
  END IF;

  SELECT * INTO v_existing FROM public.system_config WHERE key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chave "%" não encontrada.', p_key;
  END IF;

  -- Bloquear deleção de segredo
  IF v_existing.is_secret THEN
    RAISE EXCEPTION 'Chaves secretas não podem ser deletadas pelo painel.';
  END IF;

  DELETE FROM public.system_config WHERE key = p_key;

  -- Auditoria
  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
  ) VALUES (
    NULL,
    auth.uid(),
    'DELETE_SYSTEM_CONFIG',
    'SYSTEM_CONFIG',
    NULL,
    jsonb_build_object('key', v_existing.key, 'value', v_existing.value, 'description', v_existing.description),
    NULL,
    NOW()
  );

  RETURN true;
END;
$$;

-- ============================================================================
-- 5. RPC get_admin_workspaces (FILTRO deleted_at IS NULL + JOINS)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_workspaces()
RETURNS TABLE (
  id UUID,
  workspace_id TEXT,
  title TEXT,
  relative_path TEXT,
  tenant_id UUID,
  tenant_name TEXT,
  user_id UUID,
  user_email TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  RETURN QUERY
  SELECT 
    wm.id,
    wm.workspace_id,
    wm.title,
    wm.relative_path,
    wm.tenant_id,
    t.name AS tenant_name,
    wm.user_id,
    u.email AS user_email,
    wm.created_at,
    wm.updated_at
  FROM public.workspaces_meta wm
  JOIN public.tenants t ON t.id = wm.tenant_id
  LEFT JOIN public.users u ON u.id = wm.user_id
  WHERE wm.deleted_at IS NULL
  ORDER BY wm.created_at DESC;
END;
$$;

-- ============================================================================
-- 6. RPC admin_delete_workspace (SOFT DELETE / ARQUIVAMENTO)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_delete_workspace(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  SELECT * INTO v_existing FROM public.workspaces_meta WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace não encontrado ou já arquivado.';
  END IF;

  -- Soft delete (arquivamento de metadados, sem deletar pasta física do host)
  UPDATE public.workspaces_meta
  SET deleted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_id;

  -- Auditoria
  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
  ) VALUES (
    v_existing.tenant_id,
    auth.uid(),
    'ARCHIVE_WORKSPACE',
    'WORKSPACE',
    p_id,
    jsonb_build_object('workspace_id', v_existing.workspace_id, 'title', v_existing.title, 'relative_path', v_existing.relative_path),
    jsonb_build_object('deleted_at', NOW()),
    NOW()
  );

  RETURN true;
END;
$$;

-- ============================================================================
-- 7. PERMISSÕES DE EXECUÇÃO
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.get_admin_system_config(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_system_config(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_upsert_system_config(TEXT, JSONB, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_system_config(TEXT, JSONB, TEXT, BOOLEAN) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_delete_system_config(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_system_config(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_workspaces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_workspaces() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_delete_workspace(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_workspace(UUID) TO authenticated;

COMMIT;
