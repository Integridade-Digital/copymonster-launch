-- ============================================================================
-- Migration 030: Runtime Writer for sessions_index
-- RPCs para gravação direta pelo host do session-controller (service_role only)
-- ============================================================================

-- 1. RPC runtime_upsert_session_index
CREATE OR REPLACE FUNCTION public.runtime_upsert_session_index(
  p_session_id TEXT,
  p_tenant_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'active'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.sessions_index WHERE id = p_session_id) THEN
    UPDATE public.sessions_index
    SET
      tenant_id = COALESCE(p_tenant_id, public.sessions_index.tenant_id),
      user_id = COALESCE(p_user_id, public.sessions_index.user_id),
      title = COALESCE(p_title, public.sessions_index.title),
      model_used = COALESCE(p_model, public.sessions_index.model_used),
      status = COALESCE(p_status, public.sessions_index.status),
      updated_at = timezone('utc'::text, now()),
      deleted_at = NULL
    WHERE id = p_session_id;
  ELSE
    IF p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL THEN
      INSERT INTO public.sessions_index (
        id,
        tenant_id,
        user_id,
        title,
        model_used,
        tokens_total,
        status,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        p_session_id,
        p_tenant_id,
        p_user_id,
        p_title,
        p_model,
        0,
        COALESCE(p_status, 'active'),
        timezone('utc'::text, now()),
        timezone('utc'::text, now()),
        NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = COALESCE(EXCLUDED.tenant_id, public.sessions_index.tenant_id),
        user_id = COALESCE(EXCLUDED.user_id, public.sessions_index.user_id),
        title = COALESCE(EXCLUDED.title, public.sessions_index.title),
        model_used = COALESCE(EXCLUDED.model_used, public.sessions_index.model_used),
        status = COALESCE(EXCLUDED.status, public.sessions_index.status),
        updated_at = timezone('utc'::text, now()),
        deleted_at = NULL;
    END IF;
  END IF;
END;
$$;

-- 2. RPC runtime_increment_session_tokens
CREATE OR REPLACE FUNCTION public.runtime_increment_session_tokens(
  p_session_id TEXT,
  p_tokens BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session_id IS NULL OR p_tokens IS NULL OR p_tokens <= 0 THEN
    RETURN;
  END IF;

  UPDATE public.sessions_index
  SET tokens_total = tokens_total + GREATEST(p_tokens, 0),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_session_id;
END;
$$;

-- 3. RPC runtime_mark_session_status
CREATE OR REPLACE FUNCTION public.runtime_mark_session_status(
  p_session_id TEXT,
  p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN;
  END IF;

  IF p_status NOT IN ('active', 'completed', 'archived', 'error') THEN
    RAISE EXCEPTION 'Invalid session status: %', p_status;
  END IF;

  UPDATE public.sessions_index
  SET status = p_status,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_session_id;
END;
$$;

-- 4. Permissões estritas: apenas service_role
REVOKE EXECUTE ON FUNCTION public.runtime_upsert_session_index(TEXT, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.runtime_upsert_session_index(TEXT, UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.runtime_increment_session_tokens(TEXT, BIGINT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.runtime_increment_session_tokens(TEXT, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.runtime_mark_session_status(TEXT, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.runtime_mark_session_status(TEXT, TEXT) TO service_role;

-- 5. Garantia formal: revogação explícita de anon em increment_tenant_token_usage
REVOKE EXECUTE ON FUNCTION public.increment_tenant_token_usage(UUID, BIGINT) FROM anon;
