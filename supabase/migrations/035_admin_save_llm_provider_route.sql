BEGIN;

-- ============================================================================
-- MIGRATION 035: admin_save_llm_provider passa a aceitar provider_route/api_key_env
--
-- Um cliente que envie tambem p_provider_route/p_api_key_env (bundle antigo em
-- cache) fazia o PostgREST responder 404/PGRST202, pois a funcao nao tinha esses
-- parametros. Esta migration adiciona os dois parametros OPCIONAIS e os persiste,
-- mantendo o cliente atual (7 campos) funcionando.
--
-- Mudanca de assinatura exige DROP da versao antiga (7 args) para NAO deixar dois
-- overloads ambiguos; a versao nova (9 args, 2 deles com DEFAULT) e criada na
-- sequencia. DROP apenas de public.admin_save_llm_provider(uuid,text,text,text,
-- text,boolean,text[]); nenhuma outra funcao e tocada. Nenhuma chave e logada.
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_save_llm_provider(uuid,text,text,text,text,boolean,text[]);

CREATE OR REPLACE FUNCTION public.admin_save_llm_provider(
  p_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_provider_type text DEFAULT NULL,
  p_base_url text DEFAULT NULL,
  p_api_key text DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_allowed_plans text[] DEFAULT ARRAY['starter','pro','legend'],
  p_provider_route text DEFAULT NULL,
  p_api_key_env text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_master_key TEXT;
  v_encrypted_key TEXT := NULL;
  v_target_id UUID;
  v_existing RECORD;
  v_model_count INTEGER;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'O nome do provedor é obrigatório.';
  END IF;

  IF p_provider_type IS NULL OR btrim(p_provider_type) = '' THEN
    RAISE EXCEPTION 'O tipo de provedor é obrigatório.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.llm_providers
    WHERE name = p_name
      AND id <> COALESCE(p_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    RAISE EXCEPTION 'Já existe um provedor com o nome "%".', p_name;
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.llm_providers WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Provedor não encontrado para atualização.';
    END IF;

    IF v_existing.provider_type <> p_provider_type THEN
      SELECT COUNT(*) INTO v_model_count
      FROM public.llm_models WHERE provider_id = p_id;
      IF v_model_count > 0 THEN
        RAISE EXCEPTION 'Não é possível alterar o tipo de um provedor que já possui % modelo(s) vinculado(s).', v_model_count;
      END IF;
    END IF;
  END IF;

  IF p_api_key IS NOT NULL AND btrim(p_api_key) <> '' THEN
    v_master_key := public.get_llm_encryption_key();
    IF v_master_key IS NULL OR btrim(v_master_key) = '' THEN
      RAISE EXCEPTION 'Chave mestra LLM_ENCRYPTION_KEY não configurada em system_config.';
    END IF;
    v_encrypted_key := encode(pgp_sym_encrypt(p_api_key, v_master_key), 'base64');
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.llm_providers
    SET
      name = p_name,
      provider_type = p_provider_type,
      base_url = p_base_url,
      api_key_encrypted = COALESCE(v_encrypted_key, api_key_encrypted),
      is_active = p_is_active,
      allowed_plans = p_allowed_plans,
      provider_route = COALESCE(p_provider_route, provider_route),
      api_key_env = COALESCE(p_api_key_env, api_key_env),
      updated_at = NOW()
    WHERE id = p_id
    RETURNING id INTO v_target_id;

    INSERT INTO public.audit_logs (
      tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
    ) VALUES (
      NULL, auth.uid(), 'UPDATE_LLM_PROVIDER', 'LLM_PROVIDER', v_target_id,
      jsonb_build_object('name', v_existing.name, 'is_active', v_existing.is_active, 'allowed_plans', v_existing.allowed_plans),
      jsonb_build_object(
        'name', p_name, 'is_active', p_is_active, 'allowed_plans', p_allowed_plans,
        'key_updated', (v_encrypted_key IS NOT NULL),
        'provider_route', p_provider_route, 'api_key_env', p_api_key_env
      ),
      NOW()
    );
  ELSE
    INSERT INTO public.llm_providers (
      name, provider_type, base_url, api_key_encrypted, is_active, allowed_plans,
      provider_route, api_key_env, created_at, updated_at
    ) VALUES (
      p_name, p_provider_type, p_base_url, v_encrypted_key, p_is_active, p_allowed_plans,
      p_provider_route, p_api_key_env, NOW(), NOW()
    )
    RETURNING id INTO v_target_id;

    INSERT INTO public.audit_logs (
      tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
    ) VALUES (
      NULL, auth.uid(), 'CREATE_LLM_PROVIDER', 'LLM_PROVIDER', v_target_id,
      NULL,
      jsonb_build_object(
        'name', p_name, 'provider_type', p_provider_type, 'is_active', p_is_active,
        'allowed_plans', p_allowed_plans,
        'provider_route', p_provider_route, 'api_key_env', p_api_key_env
      ),
      NOW()
    );
  END IF;

  RETURN v_target_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_save_llm_provider(uuid,text,text,text,text,boolean,text[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_llm_provider(uuid,text,text,text,text,boolean,text[],text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_llm_provider(uuid,text,text,text,text,boolean,text[],text,text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
