-- ============================================================================
-- 045_tenant_invitations.test.sql
--
-- Run against a Supabase-shaped database after applying the migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/045_tenant_invitations.test.sql
--
-- The script runs inside one transaction and rolls back, so it leaves no rows.
-- It asserts:
--   1. signup metadata `invited_tenant_id` no longer joins an existing tenant;
--   2. a valid invitation inserts the invited role;
--   3. an expired invitation fails;
--   4. a reused invitation fails;
--   5. an invitation for another email fails.
-- ============================================================================

BEGIN;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.tenants (id, name, slug, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Platform', 'platform', 'active'),
       ('aaaaaaaa-0000-0000-0000-000000000001', 'Acme', 'acme', 'active');

-- ----------------------------------------------------------------------------
-- 1. Signup metadata cannot select an existing tenant.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('11111111-0000-0000-0000-000000000001', 'attacker@example.com',
        '{"username":"attacker","invited_tenant_id":"00000000-0000-0000-0000-000000000001"}'::jsonb);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = '11111111-0000-0000-0000-000000000001'
      AND tenant_id = '00000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: signup metadata joined the platform tenant';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = '11111111-0000-0000-0000-000000000001'
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'FAIL: signup did not create the personal tenant';
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. A valid invitation inserts the invited role.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('22222222-0000-0000-0000-000000000002', 'owner@acme.test', '{"username":"acme-owner"}'::jsonb);
INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
VALUES ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner');

SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', '22222222-0000-0000-0000-000000000002',
                     'tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001')::text, true);

SELECT public.create_tenant_invitation(
  'invited@example.com', repeat('a', 40), 'member', 24,
  'aaaaaaaa-0000-0000-0000-000000000001'
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('33333333-0000-0000-0000-000000000003', 'invited@example.com', '{"username":"invited-user"}'::jsonb);

SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', '33333333-0000-0000-0000-000000000003')::text, true);

SELECT public.accept_tenant_invitation(repeat('a', 40));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = '33333333-0000-0000-0000-000000000003'
      AND tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      AND role = 'member'
  ) THEN
    RAISE EXCEPTION 'FAIL: valid invitation did not insert the member role';
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 3. A reused invitation fails.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.accept_tenant_invitation(repeat('a', 40));
  RAISE EXCEPTION 'FAIL: reused invitation was accepted';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM <> 'invitation_already_accepted' THEN
      RAISE EXCEPTION 'FAIL: reused invitation raised %', SQLERRM;
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 4. An expired invitation fails.
-- ----------------------------------------------------------------------------
INSERT INTO public.tenant_invitations (tenant_id, email, token_hash, role, expires_at, invited_by)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'expired@example.com',
        encode(digest(repeat('b', 40), 'sha256'), 'hex'), 'member',
        timezone('utc', now()) - interval '1 hour',
        '22222222-0000-0000-0000-000000000002');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('44444444-0000-0000-0000-000000000004', 'expired@example.com', '{"username":"expired-user"}'::jsonb);

SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', '44444444-0000-0000-0000-000000000004')::text, true);

DO $$
BEGIN
  PERFORM public.accept_tenant_invitation(repeat('b', 40));
  RAISE EXCEPTION 'FAIL: expired invitation was accepted';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM <> 'invitation_expired' THEN
      RAISE EXCEPTION 'FAIL: expired invitation raised %', SQLERRM;
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 5. An invitation for another email fails.
-- ----------------------------------------------------------------------------
INSERT INTO public.tenant_invitations (tenant_id, email, token_hash, role, expires_at, invited_by)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'someone-else@example.com',
        encode(digest(repeat('c', 40), 'sha256'), 'hex'), 'member',
        timezone('utc', now()) + interval '1 hour',
        '22222222-0000-0000-0000-000000000002');

DO $$
BEGIN
  PERFORM public.accept_tenant_invitation(repeat('c', 40));
  RAISE EXCEPTION 'FAIL: invitation for another email was accepted';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM <> 'invitation_email_mismatch' THEN
      RAISE EXCEPTION 'FAIL: wrong-email invitation raised %', SQLERRM;
    END IF;
END
$$;

ROLLBACK;
