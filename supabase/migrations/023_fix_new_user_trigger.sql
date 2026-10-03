-- ============================================================
-- Migration: 023_fix_new_user_trigger.sql
-- CopyMonster - Integridade Digital
--
-- CopyMonster e um SaaS de administracao unica: existe um tenant
-- oficial ("Integridade Digital") e apenas o operador e owner.
-- Este migration cria o tenant padrao (id fixo) e substitui o
-- trigger handle_new_user() para que novos usuarios nunca criem
-- tenant proprio nem recebam role 'owner'.
-- ============================================================

-- 1. Tenant padrao unico. Precisa existir antes do trigger: sem esta
-- linha, handle_new_user() cairia no ramo _tenant_id IS NULL e o novo
-- usuario ficaria sem nenhuma linha em user_tenant_roles.
INSERT INTO public.tenants (id, name, slug, status, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Integridade Digital',
  'integridade-digital',
  'active',
  jsonb_build_object('created_by_trigger', false)
)
ON CONFLICT (id) DO NOTHING;

-- 2. Trigger de novo usuario: vincula 'member' no tenant convidado
-- ou, na ausencia de convite valido, no tenant padrao. Nunca cria
-- tenant e nunca atribui 'owner'. O convite so e aceito para um
-- tenant 'active': a migration 024 mantem os tenants criados pelo
-- trigger antigo como linhas soft-deleted, e um convite pendente
-- para um deles deve cair no tenant padrao.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$DECLARE
  _tenant_id UUID;
  _full_name TEXT;
  _whatsapp TEXT;
  _avatar_url TEXT;
  _invited_tenant_id TEXT;
  _default_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  _full_name := NEW.raw_user_meta_data->>'full_name';
  _avatar_url := NEW.raw_user_meta_data->>'avatar_url';
  _whatsapp := NEW.raw_user_meta_data->>'whatsapp';
  _invited_tenant_id := NEW.raw_user_meta_data->>'invited_tenant_id';

  INSERT INTO public.users (id, email, full_name, avatar_url, whatsapp, created_at, updated_at)
  VALUES (NEW.id, NEW.email, COALESCE(_full_name, split_part(NEW.email, '@', 1)),
          _avatar_url, _whatsapp, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
    whatsapp = COALESCE(EXCLUDED.whatsapp, public.users.whatsapp),
    updated_at = NOW();

  IF EXISTS (SELECT 1 FROM public.user_tenant_roles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF _invited_tenant_id IS NOT NULL
    AND _invited_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO _tenant_id FROM public.tenants
    WHERE id = _invited_tenant_id::uuid AND status = 'active';
  END IF;

  IF _tenant_id IS NULL THEN
    SELECT id INTO _tenant_id FROM public.tenants WHERE id = _default_tenant_id;
  END IF;

  IF _tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
  VALUES (NEW.id, _tenant_id, 'member')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$function$;
