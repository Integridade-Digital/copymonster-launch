BEGIN;

-- ============================================================================
-- 1. SEED DE CONFIGURAÇÕES DE ARMAZENAMENTO EM system_config
-- ============================================================================
INSERT INTO public.system_config (key, value, description, is_secret, updated_at)
VALUES
  ('storage.workspaces_root', '"/var/dsh/workspaces"'::jsonb, 'Diretório raiz no host para workspaces dos tenants', false, NOW()),
  ('storage.uploads_root', '"/var/dsh/uploads"'::jsonb, 'Diretório raiz no host para uploads de arquivos e mídias', false, NOW()),
  ('storage.logs_root', '"/var/dsh/logs"'::jsonb, 'Diretório raiz no host para logs operacionais e auditoria', false, NOW())
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. RPC get_admin_storage_paths (RETORNA AS 3 RAÍZES E WORKSPACES COM FULL PATH)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_storage_paths()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_workspaces_root TEXT;
  v_uploads_root TEXT;
  v_logs_root TEXT;
  v_paths JSONB;
  v_workspaces JSONB;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  -- Obter caminhos base configurados com fallbacks seguros
  SELECT trim(both '"' from value::text) INTO v_workspaces_root
  FROM public.system_config WHERE key = 'storage.workspaces_root';
  v_workspaces_root := COALESCE(v_workspaces_root, '/var/dsh/workspaces');

  SELECT trim(both '"' from value::text) INTO v_uploads_root
  FROM public.system_config WHERE key = 'storage.uploads_root';
  v_uploads_root := COALESCE(v_uploads_root, '/var/dsh/uploads');

  SELECT trim(both '"' from value::text) INTO v_logs_root
  FROM public.system_config WHERE key = 'storage.logs_root';
  v_logs_root := COALESCE(v_logs_root, '/var/dsh/logs');

  v_paths := jsonb_build_object(
    'workspaces_root', v_workspaces_root,
    'uploads_root', v_uploads_root,
    'logs_root', v_logs_root
  );

  -- Cruzar com workspaces ativos calculando full_path absoluto
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', wm.id,
      'workspace_id', wm.workspace_id,
      'title', wm.title,
      'relative_path', wm.relative_path,
      'full_path', rtrim(v_workspaces_root, '/') || '/' || ltrim(wm.relative_path, '/'),
      'tenant_id', wm.tenant_id,
      'tenant_name', t.name,
      'created_at', wm.created_at
    ) ORDER BY wm.created_at DESC
  ), '[]'::jsonb)
  INTO v_workspaces
  FROM public.workspaces_meta wm
  JOIN public.tenants t ON t.id = wm.tenant_id
  WHERE wm.deleted_at IS NULL;

  -- Auditoria de consulta administrativa de storage
  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
  ) VALUES (
    NULL,
    auth.uid(),
    'VIEW_STORAGE_PATHS',
    'SYSTEM_CONFIG',
    NULL,
    NULL,
    jsonb_build_object('retrieved_at', NOW()),
    NOW()
  );

  RETURN jsonb_build_object(
    'paths', v_paths,
    'workspaces', v_workspaces
  );
END;
$$;

-- ============================================================================
-- 3. PERMISSÕES DE EXECUÇÃO
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.get_admin_storage_paths() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_storage_paths() TO authenticated;

COMMIT;
