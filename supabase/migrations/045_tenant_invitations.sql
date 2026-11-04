-- ============================================================================
-- Migration: 045_tenant_invitations.sql
-- Description: remove the signup metadata shortcut into an existing tenant and
--              replace it with single-use, email-bound invitations.
--
-- Before this migration `handle_new_user()` read `invited_tenant_id` from
-- `raw_user_meta_data` and inserted a `member` role for that tenant. Because
-- signup metadata is caller-controlled, any signup could join any active
-- tenant, including the platform tenant 00000000-0000-0000-0000-000000000001.
--
-- After this migration:
--   * signup always creates the caller's personal tenant and nothing else;
--   * joining an existing tenant requires a row in `tenant_invitations`, whose
--     raw token is never stored (only its SHA-256 hash);
--   * `accept_tenant_invitation(token)` validates the hash, expiry, single use,
--     and the caller's email before inserting the role.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Invitation store. The raw token never reaches the database: only its
--    SHA-256 hash is stored, so a table read cannot replay an invitation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  expires_at  TIMESTAMPTZ NOT NULL,
  invited_by  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant
  ON public.tenant_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email
  ON public.tenant_invitations(lower(email));

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

-- Owners and admins of a tenant may list that tenant's invitations. Creation
-- and acceptance go through the SECURITY DEFINER functions below; there is no
-- direct write policy.
DROP POLICY IF EXISTS "Tenant admins view invitations" ON public.tenant_invitations;
CREATE POLICY "Tenant admins view invitations" ON public.tenant_invitations
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.user_tenant_roles r
      WHERE r.user_id = auth.uid()
        AND r.tenant_id = tenant_invitations.tenant_id
        AND r.role IN ('owner', 'admin')
    )
  );

REVOKE ALL ON TABLE public.tenant_invitations FROM anon, authenticated;
GRANT SELECT ON TABLE public.tenant_invitations TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. create_tenant_invitation(email, token, role, expires_in_hours, tenant_id)
--    The caller must be owner/admin of the target tenant. The tenant defaults
--    to the caller's current tenant; a supplied id is validated against the
--    caller's roles, never trusted.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tenant_invitation(
  p_email TEXT,
  p_token TEXT,
  p_role TEXT DEFAULT 'member',
  p_expires_in_hours INTEGER DEFAULT 168,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _tenant_id UUID;
  _email TEXT := lower(btrim(p_email));
  _role TEXT := COALESCE(p_role, 'member');
  _invitation public.tenant_invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF _email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;
  IF _role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
  IF p_expires_in_hours IS NULL OR p_expires_in_hours < 1 OR p_expires_in_hours > 720 THEN
    RAISE EXCEPTION 'invalid_expiry';
  END IF;

  _tenant_id := COALESCE(p_tenant_id, public.get_current_tenant_id());
  IF _tenant_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_tenant_roles r
    WHERE r.user_id = auth.uid()
      AND r.tenant_id = _tenant_id
      AND r.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.tenant_invitations (tenant_id, email, token_hash, role, expires_at, invited_by)
  VALUES (
    _tenant_id,
    _email,
    encode(digest(p_token, 'sha256'), 'hex'),
    _role,
    timezone('utc', now()) + make_interval(hours => p_expires_in_hours),
    auth.uid()
  )
  RETURNING * INTO _invitation;

  RETURN jsonb_build_object(
    'id', _invitation.id,
    'tenant_id', _invitation.tenant_id,
    'email', _invitation.email,
    'role', _invitation.role,
    'expires_at', _invitation.expires_at
  );
END;
$function$;

COMMENT ON FUNCTION public.create_tenant_invitation(TEXT, TEXT, TEXT, INTEGER, UUID) IS
  'Cria um convite de uso único para um tenant que o chamador administra; guarda apenas o hash SHA-256 do token';

REVOKE ALL ON FUNCTION public.create_tenant_invitation(TEXT, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tenant_invitation(TEXT, TEXT, TEXT, INTEGER, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. accept_tenant_invitation(token)
--    Validates hash, expiry, single use, and the caller's email, then inserts
--    the role. A missing or already-used invitation fails closed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_tenant_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _invitation public.tenant_invitations%ROWTYPE;
  _email TEXT;
  _tenant_slug TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT * INTO _invitation
  FROM public.tenant_invitations
  WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex')
  FOR UPDATE;

  IF _invitation.id IS NULL THEN
    RAISE EXCEPTION 'invitation_not_found';
  END IF;
  IF _invitation.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation_already_accepted';
  END IF;
  IF _invitation.expires_at <= timezone('utc', now()) THEN
    RAISE EXCEPTION 'invitation_expired';
  END IF;

  SELECT lower(u.email) INTO _email FROM public.users u WHERE u.id = auth.uid();
  IF _email IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
  IF _email <> lower(_invitation.email) THEN
    RAISE EXCEPTION 'invitation_email_mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = _invitation.tenant_id AND t.status = 'active'
  ) THEN
    RAISE EXCEPTION 'tenant_not_active';
  END IF;

  INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
  VALUES (auth.uid(), _invitation.tenant_id, _invitation.role)
  ON CONFLICT (user_id, tenant_id) DO NOTHING;

  UPDATE public.tenant_invitations
  SET accepted_at = timezone('utc', now()),
      accepted_by = auth.uid()
  WHERE id = _invitation.id;

  SELECT t.slug INTO _tenant_slug FROM public.tenants t WHERE t.id = _invitation.tenant_id;

  RETURN jsonb_build_object(
    'tenant_id', _invitation.tenant_id,
    'tenant_slug', _tenant_slug,
    'role', _invitation.role
  );
END;
$function$;

COMMENT ON FUNCTION public.accept_tenant_invitation(TEXT) IS
  'Aceita um convite válido do próprio email; uso único e falha fechada em expiração, reutilização ou email divergente';

REVOKE ALL ON FUNCTION public.accept_tenant_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_tenant_invitation(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Signup no longer reads caller-controlled tenant metadata. It always
--    creates the personal tenant; joining an existing tenant requires an
--    accepted invitation.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  _full_name TEXT;
  _whatsapp TEXT;
  _avatar_url TEXT;
  _personal_tenant_id UUID;
  _pro_plan_id UUID;
  _base_slug TEXT;
  _slug TEXT;
BEGIN
  _full_name := NEW.raw_user_meta_data->>'full_name';
  _avatar_url := NEW.raw_user_meta_data->>'avatar_url';
  _whatsapp := NEW.raw_user_meta_data->>'whatsapp';
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

COMMENT ON FUNCTION public.handle_new_user() IS
  'Cria o perfil e o tenant pessoal no signup; ignora metadata de convite e exige accept_tenant_invitation para entrar num tenant existente';

COMMIT;
