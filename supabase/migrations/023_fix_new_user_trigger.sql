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
    SELECT id INTO _tenant_id FROM public.tenants WHERE id = _invited_tenant_id::uuid;
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