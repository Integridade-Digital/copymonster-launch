BEGIN;

-- ============================================================================
-- MIGRATION 037: get_admin_llm_providers expoe provider_route e api_key_env
--
-- A UI do Admin -> LLM Providers passa a mostrar a fonte do cofre
-- (Settings -> Models) e a acionar o Test Connection. Para isso a RPC de
-- leitura precisa devolver provider_route (rota usada pelo host no teste) e
-- api_key_env (referencia do cofre). A migration 035 ja cobriu o lado de
-- gravacao (admin_save_llm_provider), nao o de leitura.
--
-- A mudanca do tipo de retorno exige DROP da versao atual (10 colunas); a nova
-- versao acrescenta provider_route e api_key_env apos base_url.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_admin_llm_providers();

CREATE FUNCTION public.get_admin_llm_providers()
RETURNS TABLE (
  id UUID,
  name TEXT,
  provider_type TEXT,
  base_url TEXT,
  provider_route TEXT,
  api_key_env TEXT,
  is_active BOOLEAN,
  allowed_plans TEXT[],
  has_api_key BOOLEAN,
  api_key_masked TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_master_key TEXT;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  v_master_key := public.get_llm_encryption_key();

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.provider_type,
    p.base_url,
    p.provider_route,
    p.api_key_env,
    p.is_active,
    p.allowed_plans,
    (p.api_key_encrypted IS NOT NULL AND p.api_key_encrypted <> '') AS has_api_key,
    public.safe_decrypt_masked(p.api_key_encrypted, v_master_key) AS api_key_masked,
    p.created_at,
    p.updated_at
  FROM public.llm_providers p
  ORDER BY p.name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_llm_providers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_llm_providers() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
