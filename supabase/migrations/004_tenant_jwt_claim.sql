-- =============================================================
-- CopyMonster — Fase 2.1: Custom Access Token Hook
-- Migration: 004_tenant_jwt_claim.sql
-- Data: 2026-09-25
-- Objetivo: injetar tenant_id e user_role no JWT do Supabase Auth
--
-- Como aplicar:
--   1. Rodar este SQL no SQL Editor do Supabase
--   2. No dashboard: Authentication → Hooks → Custom Access Token →
--      habilitar e selecionar a função public.custom_access_token_hook
--   3. Fazer logout/login para gerar JWT com as novas claims
-- =============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims jsonb;
  _tenant_id uuid;
  _role text;
BEGIN
  claims := event->'claims';

  SELECT tenant_id, role
  INTO _tenant_id, _role
  FROM public.user_tenant_roles
  WHERE user_id = (event->>'user_id')::uuid
  ORDER BY created_at ASC
  LIMIT 1;

  IF _tenant_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(_tenant_id::text));
  END IF;

  IF _role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(_role));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Permissões necessárias para o Supabase Auth chamar a função
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
GRANT SELECT ON public.user_tenant_roles TO supabase_auth_admin;
