BEGIN;

-- ============================================================================
-- MIGRATION 027: Runtime LLM Catalog RPC (Bloco 8.1.1 - Single Source Postgres)
-- RPC: get_runtime_llm_catalog()
-- Restrita a service_role (host runtime do harness)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_runtime_llm_catalog()
RETURNS TABLE (
  id UUID,
  name TEXT,
  provider_type TEXT,
  base_url TEXT,
  is_active BOOLEAN,
  api_key_encrypted TEXT,
  allowed_plans TEXT[],
  models JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.provider_type,
    p.base_url,
    p.is_active,
    p.api_key_encrypted,
    p.allowed_plans,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'model_id', m.model_id,
            'display_name', m.display_name,
            'context_window', m.context_window,
            'cost_input_1k', m.cost_input_1k,
            'cost_output_1k', m.cost_output_1k,
            'capabilities', m.capabilities,
            'is_default_for_plans', m.is_default_for_plans,
            'allowed_plans', m.allowed_plans
          )
          ORDER BY m.display_name ASC
        )
        FROM public.llm_models m
        WHERE m.provider_id = p.id
          AND m.is_active = true
      ),
      '[]'::jsonb
    ) AS models
  FROM public.llm_providers p
  WHERE p.is_active = true
  ORDER BY p.name ASC;
END;
$$;

-- Permissões: exclusivamente service_role (não conceder a authenticated nem anon/public)
REVOKE EXECUTE ON FUNCTION public.get_runtime_llm_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_runtime_llm_catalog() TO service_role;

COMMIT;
