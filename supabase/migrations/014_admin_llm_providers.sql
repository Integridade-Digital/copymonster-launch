BEGIN;

-- ============================================================================
-- MIGRATION 014: Gestão de Provedores LLM com Criptografia (Bloco 7.3)
-- RPCs: get_admin_llm_providers, admin_save_llm_provider,
--       admin_toggle_llm_provider, admin_delete_llm_provider
-- Auxiliares: get_llm_encryption_key, safe_decrypt_masked
-- ============================================================================

-- 1. Habilitar pgcrypto para criptografia simétrica de chaves
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Seed da chave mestra (DECISÃO 1) — gerada automaticamente
INSERT INTO public.system_config (key, value, description, is_secret)
VALUES (
  'LLM_ENCRYPTION_KEY',
  to_jsonb(encode(gen_random_bytes(32), 'hex')),
  'Chave mestra para criptografia de API keys de provedores LLM',
  true
)
ON CONFLICT (key) DO NOTHING;

-- 3. Auxiliar: leitura da chave mestra (CORREÇÃO 5 — contorna RLS de
--    system_config de forma explícita; o dono da função é quem criou as
--    tabelas, então a leitura do segredo fica centralizada aqui)
CREATE OR REPLACE FUNCTION public.get_llm_encryption_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT value #>> '{}' INTO v_key
  FROM public.system_config
  WHERE key = 'LLM_ENCRYPTION_KEY';

  RETURN v_key;
END;
$$;

-- 4. Auxiliar de mascaramento (CORREÇÕES 3 e 4 — EXCEPTION isolado só
--    na descriptografia; cast explícito ::text pois pgp_sym_decrypt
--    retorna bytea e right(bytea, int) não existe)
CREATE OR REPLACE FUNCTION public.safe_decrypt_masked(p_encrypted TEXT, p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_encrypted IS NULL OR p_encrypted = '' THEN RETURN NULL; END IF;
  IF p_key IS NULL OR btrim(p_key) = '' THEN RETURN '••••••••••••'; END IF;
  RETURN '••••••••' || right((pgp_sym_decrypt(decode(p_encrypted, 'base64'), p_key))::text, 4);
EXCEPTION WHEN OTHERS THEN
  RETURN '••••••••••••';
END;
$$;

-- 5. RPC de leitura dos provedores (sem EXCEPTION WHEN OTHERS na função toda)
CREATE OR REPLACE FUNCTION public.get_admin_llm_providers()
RETURNS TABLE (
  id UUID,
  name TEXT,
  provider_type TEXT,
  base_url TEXT,
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

-- 6. RPC para Salvar / Atualizar Provedor LLM
CREATE OR REPLACE FUNCTION public.admin_save_llm_provider(
  p_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_provider_type TEXT DEFAULT NULL,
  p_base_url TEXT DEFAULT NULL,
  p_api_key TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_allowed_plans TEXT[] DEFAULT ARRAY['starter', 'pro', 'legend']
)
RETURNS UUID
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

  -- CORREÇÃO 2: nome duplicado tratado amigavelmente (INSERT e UPDATE,
  -- excluindo o próprio id na edição)
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

    -- CORREÇÃO 1: bloquear mudança de provider_type quando há modelos
    IF v_existing.provider_type <> p_provider_type THEN
      SELECT COUNT(*) INTO v_model_count
      FROM public.llm_models WHERE provider_id = p_id;
      IF v_model_count > 0 THEN
        RAISE EXCEPTION 'Não é possível alterar o tipo de um provedor que já possui % modelo(s) vinculado(s).', v_model_count;
      END IF;
    END IF;
  END IF;

  -- Se foi enviada nova API key, criptografa usando a chave mestra
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
      updated_at = NOW()
    WHERE id = p_id
    RETURNING id INTO v_target_id;

    INSERT INTO public.audit_logs (
      tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
    ) VALUES (
      NULL, auth.uid(), 'UPDATE_LLM_PROVIDER', 'LLM_PROVIDER', v_target_id,
      jsonb_build_object('name', v_existing.name, 'is_active', v_existing.is_active, 'allowed_plans', v_existing.allowed_plans),
      jsonb_build_object('name', p_name, 'is_active', p_is_active, 'allowed_plans', p_allowed_plans, 'key_updated', (v_encrypted_key IS NOT NULL)),
      NOW()
    );
  ELSE
    INSERT INTO public.llm_providers (
      name, provider_type, base_url, api_key_encrypted, is_active, allowed_plans, created_at, updated_at
    ) VALUES (
      p_name, p_provider_type, p_base_url, v_encrypted_key, p_is_active, p_allowed_plans, NOW(), NOW()
    )
    RETURNING id INTO v_target_id;

    INSERT INTO public.audit_logs (
      tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
    ) VALUES (
      NULL, auth.uid(), 'CREATE_LLM_PROVIDER', 'LLM_PROVIDER', v_target_id,
      NULL,
      jsonb_build_object('name', p_name, 'provider_type', p_provider_type, 'is_active', p_is_active, 'allowed_plans', p_allowed_plans),
      NOW()
    );
  END IF;

  RETURN v_target_id;
END;
$$;

-- 7. RPC para ativar/desativar provedor
CREATE OR REPLACE FUNCTION public.admin_toggle_llm_provider(
  p_id UUID,
  p_is_active BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_active BOOLEAN;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  SELECT is_active INTO v_old_active
  FROM public.llm_providers
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provedor não encontrado.';
  END IF;

  UPDATE public.llm_providers
  SET is_active = p_is_active, updated_at = NOW()
  WHERE id = p_id;

  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
  ) VALUES (
    NULL, auth.uid(), 'TOGGLE_LLM_PROVIDER', 'LLM_PROVIDER', p_id,
    jsonb_build_object('is_active', v_old_active),
    jsonb_build_object('is_active', p_is_active),
    NOW()
  );

  RETURN true;
END;
$$;

-- 8. RPC para exclusão de provedor (com validação de dependências)
CREATE OR REPLACE FUNCTION public.admin_delete_llm_provider(
  p_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model_count INTEGER;
  v_provider_name TEXT;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  SELECT name INTO v_provider_name
  FROM public.llm_providers
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provedor não encontrado.';
  END IF;

  -- Se houver modelos vinculados, bloqueia a exclusão
  SELECT COUNT(*) INTO v_model_count
  FROM public.llm_models
  WHERE provider_id = p_id;

  IF v_model_count > 0 THEN
    RAISE EXCEPTION 'Não é possível excluir o provedor "%": existem % modelo(s) vinculado(s) a ele.', v_provider_name, v_model_count;
  END IF;

  DELETE FROM public.llm_providers WHERE id = p_id;

  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
  ) VALUES (
    NULL, auth.uid(), 'DELETE_LLM_PROVIDER', 'LLM_PROVIDER', p_id,
    jsonb_build_object('name', v_provider_name),
    NULL,
    NOW()
  );

  RETURN true;
END;
$$;

-- 9. Permissões de Execução
REVOKE EXECUTE ON FUNCTION public.get_admin_llm_providers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_llm_providers() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_save_llm_provider(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_llm_provider(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_toggle_llm_provider(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_llm_provider(UUID, BOOLEAN) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_delete_llm_provider(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_llm_provider(UUID) TO authenticated;

COMMIT;
