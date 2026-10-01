BEGIN;

CREATE OR REPLACE FUNCTION public.get_model_distribution()
RETURNS TABLE (model TEXT, session_count BIGINT, tokens_sum BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(model_used, 'Desconhecido')::text AS model,
    COUNT(*)::bigint AS session_count,
    COALESCE(SUM(tokens_total), 0)::bigint AS tokens_sum
  FROM public.sessions_index
  GROUP BY model_used
  ORDER BY session_count DESC
  LIMIT 10;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_model_distribution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_model_distribution() TO authenticated;

COMMIT;
