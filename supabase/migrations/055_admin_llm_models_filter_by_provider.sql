BEGIN;

-- ============================================================================
-- MIGRATION 055: get_admin_llm_models aceita provider_id opcional
-- Permite que o Admin > Configurações filtre modelos por provider selecionado,
-- igual ao comportamento do Settings > Models.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_admin_llm_models(UUID);

CREATE FUNCTION public.get_admin_llm_models(p_provider_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  provider_id UUID,
  provider_name TEXT,
  provider_type TEXT,
  provider_is_active BOOLEAN,
  model_id TEXT,
  display_name TEXT,
  context_window INTEGER,
  cost_input_1k NUMERIC(10,6),
  cost_output_1k NUMERIC(10,6),
  capabilities JSONB,
  is_default_for_plans TEXT[],
  allowed_plans TEXT[],
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  RETURN QUERY
  SELECT m.id, m.provider_id, p.name, p.provider_type, p.is_active,
         m.model_id, m.display_name, m.context_window,
         m.cost_input_1k, m.cost_output_1k, m.capabilities,
         m.is_default_for_plans, m.allowed_plans, m.is_active,
         m.created_at, m.updated_at
  FROM public.llm_models m
  JOIN public.llm_providers p ON p.id = m.provider_id
  WHERE (p_provider_id IS NULL OR m.provider_id = p_provider_id)
  ORDER BY p.name ASC, m.display_name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_llm_models(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_llm_models(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;