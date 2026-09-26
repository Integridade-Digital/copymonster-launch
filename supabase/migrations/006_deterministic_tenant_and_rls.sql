-- ==============================================================================
-- CopyMonster — Migration 006: Determinismo de Tenant, Saneamento de Órfãos e RLS
-- Data: 2026-09-26
-- Objetivo:
-- 1. Resolver get_current_tenant_id() com ordem determinística estrita (JWT > Session > Owner fallback)
-- 2. Sanear registros órfãos legados (user_id IS NULL) em workspaces_meta e sessions
-- 3. Reforçar integridade NOT NULL em user_id
-- 4. Atualizar políticas de RLS em workspaces_meta e sessions com validação estrita de user_id
-- ==============================================================================

-- 1. FUNÇÃO get_current_tenant_id() DETERMINÍSTICA
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _jwt_tenant TEXT;
  _session_tenant TEXT;
  _resolved_tenant UUID;
BEGIN
  -- 1.1. Prioridade Máxima: Claim injetada no JWT pelo custom_access_token_hook
  _jwt_tenant := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id';
  IF _jwt_tenant IS NOT NULL AND _jwt_tenant ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN _jwt_tenant::uuid;
  END IF;

  -- 1.2. Segunda Prioridade: Configuração explícita de sessão (SET LOCAL app.current_tenant_id)
  _session_tenant := nullif(current_setting('app.current_tenant_id', true), '');
  IF _session_tenant IS NOT NULL AND _session_tenant ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN _session_tenant::uuid;
  END IF;

  -- 1.3. Fallback Determinístico: Tenant onde o usuário autenticado é owner, seguido por criação mais antiga
  IF auth.uid() IS NOT NULL THEN
    SELECT tenant_id INTO _resolved_tenant
    FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
    ORDER BY (role = 'owner') DESC, created_at ASC
    LIMIT 1;

    IF _resolved_tenant IS NOT NULL THEN
      RETURN _resolved_tenant;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- 2. SANEAMENTO DE REGISTROS ÓRFÃOS (user_id IS NULL)
-- Se existirem registros legados sem user_id, vincular ao primeiro owner do tenant ou remover se inconsistente
DO $$
DECLARE
  _r RECORD;
  _owner_id UUID;
BEGIN
  -- 2.1. Sanear workspaces_meta órfãos
  FOR _r IN SELECT id, tenant_id FROM public.workspaces_meta WHERE user_id IS NULL LOOP
    SELECT user_id INTO _owner_id 
    FROM public.user_tenant_roles 
    WHERE tenant_id = _r.tenant_id AND role = 'owner'
    ORDER BY created_at ASC 
    LIMIT 1;

    IF _owner_id IS NOT NULL THEN
      UPDATE public.workspaces_meta SET user_id = _owner_id WHERE id = _r.id;
    ELSE
      DELETE FROM public.workspaces_meta WHERE id = _r.id;
    END IF;
  END LOOP;

  -- 2.2. Sanear sessions órfãos
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions') THEN
    FOR _r IN SELECT id, tenant_id FROM public.sessions WHERE user_id IS NULL LOOP
      SELECT user_id INTO _owner_id 
      FROM public.user_tenant_roles 
      WHERE tenant_id = _r.tenant_id AND role = 'owner'
      ORDER BY created_at ASC 
      LIMIT 1;

      IF _owner_id IS NOT NULL THEN
        UPDATE public.sessions SET user_id = _owner_id WHERE id = _r.id;
      ELSE
        DELETE FROM public.sessions WHERE id = _r.id;
      END IF;
    END LOOP;
  END IF;
END $$;

-- 3. REFORÇAR CONSTRAINT NOT NULL EM workspaces_meta e sessions
ALTER TABLE public.workspaces_meta 
  ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions') THEN
    ALTER TABLE public.sessions ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

-- 4. ATUALIZAR POLÍTICAS RLS DE workspaces_meta COM VALIDAÇÃO ESTRITA
ALTER TABLE public.workspaces_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view workspaces of their tenant" ON public.workspaces_meta;
DROP POLICY IF EXISTS "Users can insert workspaces in their tenant" ON public.workspaces_meta;
DROP POLICY IF EXISTS "Users can update workspaces of their tenant" ON public.workspaces_meta;
DROP POLICY IF EXISTS "Users can delete workspaces of their tenant" ON public.workspaces_meta;

-- SELECT: Usuário comum visualiza estritamente os seus workspaces. Admin/Owner visualiza os do seu tenant.
CREATE POLICY "Users can view workspaces of their tenant"
  ON public.workspaces_meta FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND (
      user_id = auth.uid() 
      OR public.is_admin_or_owner()
    )
  );

-- INSERT: Usuário autenticado só insere workspaces vinculados ao seu tenant ativo e ao seu próprio user_id
CREATE POLICY "Users can insert workspaces in their tenant"
  ON public.workspaces_meta FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND user_id = auth.uid()
  );

-- UPDATE: Usuário atualiza apenas seus próprios workspaces (ou admin/owner do tenant)
CREATE POLICY "Users can update workspaces of their tenant"
  ON public.workspaces_meta FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND (
      user_id = auth.uid() 
      OR public.is_admin_or_owner()
    )
  )
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND (
      user_id = auth.uid() 
      OR public.is_admin_or_owner()
    )
  );

-- DELETE: Usuário remove apenas seus próprios workspaces (ou admin/owner do tenant)
CREATE POLICY "Users can delete workspaces of their tenant"
  ON public.workspaces_meta FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND (
      user_id = auth.uid() 
      OR public.is_admin_or_owner()
    )
  );

-- 5. ATUALIZAR POLÍTICAS RLS DE sessions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions') THEN
    ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view own sessions" ON public.sessions;
    DROP POLICY IF EXISTS "Users can create own sessions" ON public.sessions;
    DROP POLICY IF EXISTS "Users can update own sessions" ON public.sessions;
    DROP POLICY IF EXISTS "Users can delete own sessions" ON public.sessions;

    CREATE POLICY "Users can view own sessions"
      ON public.sessions FOR SELECT
      TO authenticated
      USING (
        tenant_id = public.get_current_tenant_id()
        AND (
          user_id = auth.uid()
          OR public.is_admin_or_owner()
        )
      );

    CREATE POLICY "Users can create own sessions"
      ON public.sessions FOR INSERT
      TO authenticated
      WITH CHECK (
        tenant_id = public.get_current_tenant_id()
        AND user_id = auth.uid()
      );

    CREATE POLICY "Users can update own sessions"
      ON public.sessions FOR UPDATE
      TO authenticated
      USING (
        tenant_id = public.get_current_tenant_id()
        AND (
          user_id = auth.uid()
          OR public.is_admin_or_owner()
        )
      )
      WITH CHECK (
        tenant_id = public.get_current_tenant_id()
        AND (
          user_id = auth.uid()
          OR public.is_admin_or_owner()
        )
      );

    CREATE POLICY "Users can delete own sessions"
      ON public.sessions FOR DELETE
      TO authenticated
      USING (
        tenant_id = public.get_current_tenant_id()
        AND (
          user_id = auth.uid()
          OR public.is_admin_or_owner()
        )
      );
  END IF;
END $$;

COMMENT ON FUNCTION public.get_current_tenant_id() IS 'Retorna o tenant_id determinístico respeitando JWT claim, app.current_tenant_id e fallback para owner';
