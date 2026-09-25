-- =============================================================
-- CopyMonster — Fase 1: Segurança no Banco de Dados
-- Migration: 003_security_and_profile_fixes.sql
-- Data: 2026-09-25
-- Baseada em: docs/roadmap/plano-auditoria-correcoes-copymonster.md
-- Aplicada em: projeto Supabase eyzurphuebvijvynatut
-- =============================================================

-- 1. Corrigir get_current_tenant_id() — ordenação determinística
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT tenant_id
    FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
    ORDER BY created_at ASC
    LIMIT 1
  );
END;
$$;

-- 2. Habilitar RLS em plans + política pública de SELECT
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active plans" ON public.plans;
DROP POLICY IF EXISTS "Admins can manage plans" ON public.plans;

CREATE POLICY "Anyone can view active plans" ON public.plans
  FOR SELECT
  USING (is_active = true);

-- 3. Blindar user_tenant_roles — WITH CHECK contra elevação
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_tenant_roles;

CREATE POLICY "Admins can manage roles in own tenant" ON public.user_tenant_roles
  FOR ALL
  USING (
    tenant_id = public.get_current_tenant_id()
    AND public.is_admin_or_owner()
  )
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND public.is_admin_or_owner()
  );

-- 4. Isolar sessions por user_id (não só tenant_id)
DROP POLICY IF EXISTS "Users can view own sessions" ON public.sessions;

CREATE POLICY "Users can view own sessions" ON public.sessions
  FOR SELECT
  USING (
    tenant_id = public.get_current_tenant_id()
    AND user_id = auth.uid()
  );

-- 5. Atualizar trigger handle_new_user para salvar whatsapp
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url, whatsapp, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'whatsapp',
    NOW()
  );
  RETURN NEW;
END;
$$;

-- 6. Criar RPC get_my_profile()
DROP FUNCTION IF EXISTS public.get_my_profile();

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _result JSONB;
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'full_name', u.full_name,
      'avatar_url', u.avatar_url,
      'whatsapp', u.whatsapp
    ),
    'tenant', CASE
      WHEN t.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'slug', t.slug,
        'status', t.status
      )
    END,
    'role', r.role
  )
  INTO _result
  FROM public.users u
  LEFT JOIN public.user_tenant_roles r ON r.user_id = u.id
  LEFT JOIN public.tenants t ON t.id = r.tenant_id
  WHERE u.id = _user_id
  ORDER BY r.created_at ASC
  LIMIT 1;

  RETURN _result;
END;
$$;
