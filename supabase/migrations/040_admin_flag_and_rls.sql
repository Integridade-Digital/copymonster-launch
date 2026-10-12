-- ============================================================================
-- Migration: 040_admin_flag_and_rls.sql
-- Description: Flag de admin por usuário e fechamento do gate de plataforma (Problema 4)
-- Security: A3 amarra is_admin_or_owner() à plataforma (tenant 000...001) ou à
--           flag public.users.metadata.is_admin; remove a dependência de
--           get_current_tenant_id(), que tornava a função verdadeira para todo
--           owner do tenant ativo.
-- Ordem: A1 (flag em metadata) é pré-requisito aplicado pelo usuário; este
--        arquivo contém A2 e A3, aplicados em sequência.
-- NOTA: Sem DROP em ambas as funções — assinaturas inalteradas preservam as 19
--       policies dependentes de is_admin_or_owner() e os REVOKE/GRANT de 025.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- A2: get_my_profile() devolve is_admin
-- Assinatura atual de 025:224-268, com o campo 'is_admin' no jsonb_build_object.
-- O campo lê public.users.metadata (coluna u.metadata) e cai para false quando
-- ausente, para não quebrar usuários sem a flag.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
    'role', r.role,
    'is_admin', COALESCE(u.metadata ->> 'is_admin', 'false')::boolean
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

-- ----------------------------------------------------------------------------
-- A3: is_admin_or_owner() reescrito
-- Retorna verdadeiro SOMENTE se:
--   (a) o usuário tem owner/admin no tenant da plataforma
--       00000000-0000-0000-0000-000000000001 (mesma semântica de isPlatformAdmin), OU
--   (b) public.users.metadata ->> 'is_admin' = 'true' para auth.uid().
-- Falso em qualquer outro caso.
-- A remoção da chamada a get_current_tenant_id() fecha o escape cross-tenant:
-- antes, todo usuário era owner do próprio tenant ativo e passava no predicado.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_or_owner()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
      AND tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
      AND role IN ('owner', 'admin')
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND metadata ->> 'is_admin' = 'true'
  );
END;
$$;

COMMENT ON FUNCTION public.is_admin_or_owner() IS
  'Operador de plataforma: owner/admin no tenant 00000000-0000-0000-0000-000000000001, ou public.users.metadata.is_admin = true. Falso em qualquer outro caso.';

COMMIT;
