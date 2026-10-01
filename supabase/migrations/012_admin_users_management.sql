BEGIN;

-- 1. Garantir coluna status em public.users
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended'));

-- 2. RPC get_admin_users_kpis
CREATE OR REPLACE FUNCTION public.get_admin_users_kpis()
RETURNS TABLE (
  total_users BIGINT,
  active_users BIGINT,
  suspended_users BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_users,
    COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'active')::BIGINT AS active_users,
    COUNT(*) FILTER (WHERE status = 'suspended')::BIGINT AS suspended_users
  FROM public.users;
END;
$$;

-- 3. RPC get_admin_users
CREATE OR REPLACE FUNCTION public.get_admin_users(
  p_search TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  membership_id UUID,
  user_id UUID,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  user_status TEXT,
  tenant_id UUID,
  tenant_name TEXT,
  tenant_slug TEXT,
  role TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      utr.id AS membership_id,
      u.id AS user_id,
      u.email,
      u.full_name,
      u.avatar_url,
      u.created_at,
      u.last_login_at,
      COALESCE(u.status, 'active') AS user_status,
      t.id AS tenant_id,
      COALESCE(t.name, 'Sem tenant') AS tenant_name,
      t.slug AS tenant_slug,
      utr.role
    FROM public.user_tenant_roles utr
    JOIN public.users u ON u.id = utr.user_id
    LEFT JOIN public.tenants t ON t.id = utr.tenant_id
    WHERE
      (p_role IS NULL OR utr.role = p_role)
      AND (p_tenant_id IS NULL OR utr.tenant_id = p_tenant_id)
      AND (p_status IS NULL OR COALESCE(u.status, 'active') = p_status)
      AND (
        p_search IS NULL
        OR u.email ILIKE '%' || p_search || '%'
        OR COALESCE(u.full_name, '') ILIKE '%' || p_search || '%'
        OR COALESCE(t.name, '') ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    f.membership_id,
    f.user_id,
    f.email,
    f.full_name,
    f.avatar_url,
    f.created_at,
    f.last_login_at,
    f.user_status,
    f.tenant_id,
    f.tenant_name,
    f.tenant_slug,
    f.role,
    COUNT(*) OVER()::BIGINT AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_users_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_users_kpis() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_users(TEXT, TEXT, UUID, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_users(TEXT, TEXT, UUID, TEXT, INT, INT) TO authenticated;

COMMIT;
