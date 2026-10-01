BEGIN;

-- 1. Adicionar colunas is_active e updated_at em llm_models
ALTER TABLE public.llm_models
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- 2. Trigger updated_at
DROP TRIGGER IF EXISTS update_llm_models_updated_at ON public.llm_models;
CREATE TRIGGER update_llm_models_updated_at
  BEFORE UPDATE ON public.llm_models
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. RPC get_admin_llm_models (com JOIN em llm_providers)
CREATE OR REPLACE FUNCTION public.get_admin_llm_models()
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  ORDER BY p.name ASC, m.display_name ASC;
END;
$$;

-- 4. RPC admin_save_llm_model
CREATE OR REPLACE FUNCTION public.admin_save_llm_model(
  p_id UUID DEFAULT NULL,
  p_provider_id UUID DEFAULT NULL,
  p_model_id TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL,
  p_context_window INTEGER DEFAULT 8192,
  p_cost_input_1k NUMERIC(10,6) DEFAULT 0,
  p_cost_output_1k NUMERIC(10,6) DEFAULT 0,
  p_capabilities JSONB DEFAULT '{}'::jsonb,
  p_is_default_for_plans TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_allowed_plans TEXT[] DEFAULT ARRAY['starter','pro','legend']::TEXT[],
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_target_id UUID;
  v_existing RECORD;
  v_plan TEXT;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  IF p_provider_id IS NULL THEN
    RAISE EXCEPTION 'O provedor é obrigatório.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.llm_providers WHERE id = p_provider_id) THEN
    RAISE EXCEPTION 'Provedor selecionado não existe.';
  END IF;

  IF p_model_id IS NULL OR btrim(p_model_id) = '' THEN
    RAISE EXCEPTION 'O model_id é obrigatório.';
  END IF;

  IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
    RAISE EXCEPTION 'O display_name é obrigatório.';
  END IF;

  -- duplicidade (model_id por provider)
  IF EXISTS (
    SELECT 1 FROM public.llm_models
    WHERE provider_id = p_provider_id
      AND model_id = p_model_id
      AND id <> COALESCE(p_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    RAISE EXCEPTION 'Já existe um modelo com o identificador "%" para este provedor.', p_model_id;
  END IF;

  -- modelo só pode ser default de plano em allowed_plans
  IF p_is_default_for_plans IS NOT NULL AND cardinality(p_is_default_for_plans) > 0 THEN
    FOREACH v_plan IN ARRAY p_is_default_for_plans LOOP
      IF NOT (v_plan = ANY(p_allowed_plans)) THEN
        RAISE EXCEPTION 'O modelo não pode ser padrão para o plano "%", pois esse plano não está em allowed_plans.', v_plan;
      END IF;
    END LOOP;
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.llm_models WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Modelo não encontrado.';
    END IF;

    -- não pode desativar se ainda é default
    IF p_is_active = false AND cardinality(v_existing.is_default_for_plans) > 0 THEN
      RAISE EXCEPTION 'Não é possível desativar um modelo que ainda é o padrão para: %.',
        array_to_string(v_existing.is_default_for_plans, ', ');
    END IF;

    UPDATE public.llm_models
    SET provider_id = p_provider_id,
        model_id = p_model_id,
        display_name = p_display_name,
        context_window = p_context_window,
        cost_input_1k = p_cost_input_1k,
        cost_output_1k = p_cost_output_1k,
        capabilities = COALESCE(p_capabilities, '{}'::jsonb),
        is_default_for_plans = COALESCE(p_is_default_for_plans, ARRAY[]::TEXT[]),
        allowed_plans = COALESCE(p_allowed_plans, ARRAY['starter','pro','legend']::TEXT[]),
        is_active = p_is_active,
        updated_at = NOW()
    WHERE id = p_id
    RETURNING id INTO v_target_id;

    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at)
    VALUES (NULL, auth.uid(), 'UPDATE_LLM_MODEL', 'LLM_MODEL', v_target_id,
      jsonb_build_object('model_id', v_existing.model_id, 'display_name', v_existing.display_name, 'is_active', v_existing.is_active, 'is_default_for_plans', v_existing.is_default_for_plans),
      jsonb_build_object('model_id', p_model_id, 'display_name', p_display_name, 'is_active', p_is_active, 'is_default_for_plans', p_is_default_for_plans),
      NOW());
  ELSE
    INSERT INTO public.llm_models (
      provider_id, model_id, display_name, context_window,
      cost_input_1k, cost_output_1k, capabilities,
      is_default_for_plans, allowed_plans, is_active, created_at, updated_at
    ) VALUES (
      p_provider_id, p_model_id, p_display_name, p_context_window,
      p_cost_input_1k, p_cost_output_1k, COALESCE(p_capabilities, '{}'::jsonb),
      COALESCE(p_is_default_for_plans, ARRAY[]::TEXT[]),
      COALESCE(p_allowed_plans, ARRAY['starter','pro','legend']::TEXT[]),
      p_is_active, NOW(), NOW()
    ) RETURNING id INTO v_target_id;

    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at)
    VALUES (NULL, auth.uid(), 'CREATE_LLM_MODEL', 'LLM_MODEL', v_target_id,
      NULL,
      jsonb_build_object('model_id', p_model_id, 'display_name', p_display_name, 'provider_id', p_provider_id, 'is_default_for_plans', p_is_default_for_plans),
      NOW());
  END IF;

  -- Exclusividade GLOBAL de default por plano
  IF p_is_default_for_plans IS NOT NULL AND cardinality(p_is_default_for_plans) > 0 THEN
    FOREACH v_plan IN ARRAY p_is_default_for_plans LOOP
      UPDATE public.llm_models
      SET is_default_for_plans = array_remove(is_default_for_plans, v_plan),
          updated_at = NOW()
      WHERE id <> v_target_id
        AND v_plan = ANY(is_default_for_plans);
    END LOOP;
  END IF;

  RETURN v_target_id;
END;
$$;

-- 5. RPC admin_toggle_llm_model
CREATE OR REPLACE FUNCTION public.admin_toggle_llm_model(
  p_id UUID, p_is_active BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_existing RECORD;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  SELECT * INTO v_existing FROM public.llm_models WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado.';
  END IF;

  IF p_is_active = false AND cardinality(v_existing.is_default_for_plans) > 0 THEN
    RAISE EXCEPTION 'Não é possível desativar "%": ainda é padrão de %.',
      v_existing.display_name, array_to_string(v_existing.is_default_for_plans, ', ');
  END IF;

  UPDATE public.llm_models SET is_active = p_is_active, updated_at = NOW() WHERE id = p_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at)
  VALUES (NULL, auth.uid(), 'TOGGLE_LLM_MODEL', 'LLM_MODEL', p_id,
    jsonb_build_object('is_active', v_existing.is_active),
    jsonb_build_object('is_active', p_is_active),
    NOW());

  RETURN true;
END;
$$;

-- 6. RPC admin_delete_llm_model (BLOQUEIO SECO)
CREATE OR REPLACE FUNCTION public.admin_delete_llm_model(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_existing RECORD;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  SELECT * INTO v_existing FROM public.llm_models WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado.';
  END IF;

  IF v_existing.is_default_for_plans IS NOT NULL AND cardinality(v_existing.is_default_for_plans) > 0 THEN
    RAISE EXCEPTION 'Não é possível excluir "%": ainda é padrão de %. Reatribua o padrão antes.',
      v_existing.display_name, array_to_string(v_existing.is_default_for_plans, ', ');
  END IF;

  DELETE FROM public.llm_models WHERE id = p_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at)
  VALUES (NULL, auth.uid(), 'DELETE_LLM_MODEL', 'LLM_MODEL', p_id,
    jsonb_build_object('model_id', v_existing.model_id, 'display_name', v_existing.display_name, 'provider_id', v_existing.provider_id),
    NULL, NOW());

  RETURN true;
END;
$$;

-- 7. Permissões
REVOKE EXECUTE ON FUNCTION public.get_admin_llm_models() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_llm_models() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_save_llm_model(UUID, UUID, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, JSONB, TEXT[], TEXT[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_llm_model(UUID, UUID, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, JSONB, TEXT[], TEXT[], BOOLEAN) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_toggle_llm_model(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_llm_model(UUID, BOOLEAN) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_delete_llm_model(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_llm_model(UUID) TO authenticated;

COMMIT;
