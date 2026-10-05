BEGIN;

-- ============================================================================
-- MIGRATION 028: Runtime LLM Catalog com Descriptografia de Chaves (Bloco 8.1.1 revisado)
-- RPC: get_runtime_llm_catalog()
-- Descriptografa chaves usando pgcrypto e LLM_ENCRYPTION_KEY de system_config
-- Restrita exclusivamente a service_role (host runtime do harness)
-- ============================================================================

-- Drop da versão anterior (migration 027) devido à alteração de tipo de retorno:
-- api_key_encrypted (TEXT) -> api_key (TEXT)
DROP FUNCTION IF EXISTS public.get_runtime_llm_catalog();

CREATE OR REPLACE FUNCTION public.get_runtime_llm_catalog()
RETURNS TABLE (
  id UUID,
  name TEXT,
  provider_type TEXT,
  base_url TEXT,
  is_active BOOLEAN,
  api_key TEXT,
  allowed_plans TEXT[],
  models JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_master_key TEXT;
BEGIN
  -- Leitura da chave mestra diretamente da tabela de configuração
  SELECT value #>> '{}' INTO v_master_key
  FROM public.system_config
  WHERE key = 'LLM_ENCRYPTION_KEY';

  IF v_master_key IS NULL OR btrim(v_master_key) = '' THEN
    RAISE EXCEPTION 'LLM_ENCRYPTION_KEY missing';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.provider_type,
    p.base_url,
    p.is_active,
    CASE
      WHEN p.api_key_encrypted IS NULL OR btrim(p.api_key_encrypted) = ''
        THEN NULL
      ELSE (
        pgp_sym_decrypt(
          decode(p.api_key_encrypted, 'base64'),
          v_master_key
        )
      )::text
    END AS api_key,
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
