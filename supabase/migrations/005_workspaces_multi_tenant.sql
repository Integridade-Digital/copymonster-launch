-- =============================================================
-- CopyMonster — Fase 1: Isolamento de Workspaces Multi-Tenant e Provisionamento Determinístico
-- Migration: 005_workspaces_multi_tenant.sql
-- Data: 2026-09-26
-- =============================================================

-- 1. TABELA DE METADADOS DE WORKSPACES ISOLADOS POR TENANT E USUÁRIO
CREATE TABLE IF NOT EXISTS public.workspaces_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_tenant_workspace UNIQUE (tenant_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_meta_tenant_user 
  ON public.workspaces_meta (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_workspaces_meta_workspace_id 
  ON public.workspaces_meta (workspace_id);

-- 2. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.workspaces_meta ENABLE ROW LEVEL SECURITY;

-- Remover políticas prévias se houver
DROP POLICY IF EXISTS "Users can view workspaces of their tenant" ON public.workspaces_meta;
DROP POLICY IF EXISTS "Users can insert workspaces in their tenant" ON public.workspaces_meta;
DROP POLICY IF EXISTS "Users can update workspaces of their tenant" ON public.workspaces_meta;
DROP POLICY IF EXISTS "Users can delete workspaces of their tenant" ON public.workspaces_meta;

-- SELECT: Usuário comum vê apenas seus workspaces; Admin/Owner vê todos do seu tenant
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

-- INSERT: Usuário autenticado só insere com seu tenant e seu user_id
CREATE POLICY "Users can insert workspaces in their tenant"
  ON public.workspaces_meta FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND user_id = auth.uid()
  );

-- UPDATE: Dono do workspace ou admin do tenant pode atualizar
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

-- DELETE: Dono do workspace ou admin do tenant pode deletar
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

-- 3. PROVISIONAMENTO DETERMINÍSTICO DE NOVO USUÁRIO
-- Quando um novo usuário se cadastra via auth.users:
-- a) Insere na tabela public.users
-- b) Cria um tenant individual se não foi convidado para um tenant existente
-- c) Associa em user_tenant_roles como 'owner' do seu próprio tenant
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
  _slug TEXT;
  _full_name TEXT;
  _whatsapp TEXT;
  _avatar_url TEXT;
  _invited_tenant_id TEXT;
BEGIN
  _full_name := NEW.raw_user_meta_data->>'full_name';
  _avatar_url := NEW.raw_user_meta_data->>'avatar_url';
  _whatsapp := NEW.raw_user_meta_data->>'whatsapp';
  _invited_tenant_id := NEW.raw_user_meta_data->>'invited_tenant_id';

  -- 1. Cria ou atualiza o perfil em public.users
  INSERT INTO public.users (id, email, full_name, avatar_url, whatsapp, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(_full_name, split_part(NEW.email, '@', 1)),
    _avatar_url,
    _whatsapp,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
    whatsapp = COALESCE(EXCLUDED.whatsapp, public.users.whatsapp),
    updated_at = NOW();

  -- 2. Se já existe associação para este usuário, encerra
  IF EXISTS (SELECT 1 FROM public.user_tenant_roles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- 3. Se foi convidado para um tenant específico válido
  IF _invited_tenant_id IS NOT NULL AND _invited_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO _tenant_id FROM public.tenants WHERE id = _invited_tenant_id::uuid;
    IF _tenant_id IS NOT NULL THEN
      INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
      VALUES (NEW.id, _tenant_id, 'member')
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END IF;
  END IF;

  -- 4. Criar tenant individual próprio para auto-cadastro
  _slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(md5(NEW.id::text), 1, 6);

  INSERT INTO public.tenants (name, slug, status, metadata)
  VALUES (
    COALESCE(_full_name, split_part(NEW.email, '@', 1)) || ' Workspace',
    _slug,
    'active',
    jsonb_build_object('created_by_trigger', true, 'owner_email', NEW.email)
  )
  RETURNING id INTO _tenant_id;

  -- 5. Vincular usuário como 'owner' do seu tenant recém-criado
  INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
  VALUES (NEW.id, _tenant_id, 'owner')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Garantir que a trigger está ativa em auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON TABLE public.workspaces_meta IS 'Metadados de workspaces com isolamento multi-tenant estrito por RLS';
