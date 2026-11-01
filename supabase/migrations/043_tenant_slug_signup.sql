-- Capture the requested workspace slug during Supabase Auth signup and make
-- availability checks safe for unauthenticated registration.
CREATE OR REPLACE FUNCTION public.is_tenant_slug_available(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_slug ~ '^[a-z0-9][a-z0-9-]{2,28}[a-z0-9]$'
    AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = p_slug);
$function$;

REVOKE ALL ON FUNCTION public.is_tenant_slug_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_tenant_slug_available(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _full_name TEXT;
  _whatsapp TEXT;
  _avatar_url TEXT;
  _invited_tenant_id TEXT;
  _tenant_id UUID;
  _personal_tenant_id UUID;
  _pro_plan_id UUID;
  _base_slug TEXT;
  _slug TEXT;
BEGIN
  _full_name := NEW.raw_user_meta_data->>'full_name';
  _avatar_url := NEW.raw_user_meta_data->>'avatar_url';
  _whatsapp := NEW.raw_user_meta_data->>'whatsapp';
  _invited_tenant_id := NEW.raw_user_meta_data->>'invited_tenant_id';
  _slug := NEW.raw_user_meta_data->>'username';

  IF _slug IS NOT NULL AND _slug !~ '^[a-z0-9][a-z0-9-]{2,28}[a-z0-9]$' THEN
    RAISE EXCEPTION 'Invalid workspace username';
  END IF;

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

  IF _tenant_id IS NOT NULL THEN
    INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
    VALUES (NEW.id, _tenant_id, 'member')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  SELECT id INTO _pro_plan_id FROM public.plans WHERE slug = 'pro' LIMIT 1;
  IF _pro_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plano Pro nao encontrado para inicializacao do tenant pessoal';
  END IF;

  -- Existing non-signup auth providers without a username retain the old
  -- generated fallback. Signup-created users preserve auth.users metadata.
  IF _slug IS NULL OR _slug = '' THEN
    _base_slug := lower(regexp_replace(
      COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'workspace'),
      '[^a-z0-9]+', '-', 'g'));
    _base_slug := trim(both '-' from _base_slug);
    IF _base_slug = '' THEN _base_slug := 'workspace'; END IF;
    _slug := left(_base_slug, 40) || '-' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;

  INSERT INTO public.tenants (
    name, slug, status, subscription_status, plan_id,
    trial_used, trial_ends_at, trial_tokens_used, current_period_tokens_used, metadata
  ) VALUES (
    format('%s Workspace', COALESCE(NULLIF(_full_name, ''), split_part(NEW.email, '@', 1), 'Novo')),
    _slug,
    'active',
    'trialing',
    _pro_plan_id,
    false,
    timezone('utc'::text, now()) + interval '7 days',
    0,
    0,
    jsonb_build_object('created_by_trigger', true, 'owner_user_id', NEW.id)
  )
  RETURNING id INTO _personal_tenant_id;

  INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
  VALUES (NEW.id, _personal_tenant_id, 'owner')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$function$;
