-- ============================================================================
-- Migration: 041_dna_finalize.sql
-- Description: RPC finalize_positioning_mapping e desacoplamento do status completed
--              do bloco 12 em update_positioning_block.
-- Nota: 039_positioning_mappings_dna.sql permanece inalterada; esta migration
--       ajusta update_positioning_block para não auto-completar no bloco 12 e
--       adiciona a RPC finalize_positioning_mapping com suporte a nome e produto.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Atualizar update_positioning_block:
--    - Suporte a p_block_number = 0 (product_name)
--    - Desacopla status = 'completed' do bloco 12 (finalização explícita via RPC)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_positioning_block(
  p_mapping_id UUID,
  p_block_number INTEGER,
  p_content TEXT
)
RETURNS public.positioning_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _tenant_id UUID;
  _updated public.positioning_mappings;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.get_current_tenant_id();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant ativo não encontrado.' USING ERRCODE = '42501';
  END IF;

  IF p_block_number < 0 OR p_block_number > 12 THEN
    RAISE EXCEPTION 'Número de bloco inválido: %. O Brand Positioning Monster aceita bloco 0 (produto) e blocos de 1 a 12.', p_block_number
      USING ERRCODE = '22023';
  END IF;

  CASE p_block_number
    WHEN 0 THEN
      UPDATE public.positioning_mappings
      SET product_name = COALESCE(TRIM(p_content), ''),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 1 THEN
      UPDATE public.positioning_mappings
      SET block_1_public = p_content,
          current_block = 2,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 2 THEN
      UPDATE public.positioning_mappings
      SET block_2_pains = p_content,
          current_block = 3,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 3 THEN
      UPDATE public.positioning_mappings
      SET block_3_solution = p_content,
          current_block = 4,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 4 THEN
      UPDATE public.positioning_mappings
      SET block_4_differentiators = p_content,
          current_block = 5,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 5 THEN
      UPDATE public.positioning_mappings
      SET block_5_awareness_stage = p_content,
          current_block = 6,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 6 THEN
      UPDATE public.positioning_mappings
      SET block_6_urgency = p_content,
          current_block = 7,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 7 THEN
      UPDATE public.positioning_mappings
      SET block_7_social_proof = p_content,
          current_block = 8,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 8 THEN
      UPDATE public.positioning_mappings
      SET block_8_objections = p_content,
          current_block = 9,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 9 THEN
      UPDATE public.positioning_mappings
      SET block_9_emotional = p_content,
          current_block = 10,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 10 THEN
      UPDATE public.positioning_mappings
      SET block_10_transformation = p_content,
          current_block = 11,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 11 THEN
      UPDATE public.positioning_mappings
      SET block_11_voice = p_content,
          current_block = 12,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 12 THEN
      UPDATE public.positioning_mappings
      SET block_12_promises = p_content,
          current_block = 12,
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
  END CASE;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'Mapeamento de DNA não encontrado ou arquivado.' USING ERRCODE = 'P0002';
  END IF;

  RETURN _updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_positioning_block(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_positioning_block(UUID, INTEGER, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Nova RPC: finalize_positioning_mapping
--    - Valida que block_12_promises está preenchido
--    - Seta name = TRIM(p_name)
--    - Seta product_name = COALESCE(TRIM(p_product_name), product_name)
--    - Seta status = 'completed', completed_at = NOW()
--    - Marca is_default = true se nenhum outro default ativo existir
--    - Retorna o registro completo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_positioning_mapping(
  p_mapping_id UUID,
  p_name TEXT,
  p_product_name TEXT DEFAULT NULL
)
RETURNS public.positioning_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _tenant_id UUID;
  _mapping public.positioning_mappings;
  _updated public.positioning_mappings;
  _clean_name TEXT;
  _set_default BOOLEAN := false;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.get_current_tenant_id();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant ativo não encontrado.' USING ERRCODE = '42501';
  END IF;

  _clean_name := TRIM(COALESCE(p_name, ''));
  IF _clean_name = '' THEN
    RAISE EXCEPTION 'O nome do DNA não pode ser vazio.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _mapping
  FROM public.positioning_mappings
  WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived';

  IF _mapping.id IS NULL THEN
    RAISE EXCEPTION 'Mapeamento de DNA não encontrado ou arquivado.' USING ERRCODE = 'P0002';
  END IF;

  IF _mapping.block_12_promises IS NULL OR TRIM(_mapping.block_12_promises) = '' THEN
    RAISE EXCEPTION 'O bloco 12 deve estar preenchido para finalizar o DNA.' USING ERRCODE = 'P0001';
  END IF;

  -- Se o usuário não tiver outro DNA ativo como padrão, define este como padrão
  IF NOT EXISTS (
    SELECT 1 FROM public.positioning_mappings
    WHERE user_id = _user_id AND is_default = true AND status != 'archived' AND id != p_mapping_id
  ) THEN
    _set_default := true;
  ELSE
    _set_default := _mapping.is_default;
  END IF;

  UPDATE public.positioning_mappings
  SET name = _clean_name,
      product_name = CASE
        WHEN p_product_name IS NOT NULL AND TRIM(p_product_name) != '' THEN TRIM(p_product_name)
        ELSE product_name
      END,
      status = 'completed',
      is_default = _set_default,
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
  WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id
  RETURNING * INTO _updated;

  RETURN _updated;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_positioning_mapping(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_positioning_mapping(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.finalize_positioning_mapping(UUID, TEXT, TEXT) IS
  'Finaliza o mapeamento de DNA após a conclusão dos 12 blocos, definindo nome, produto e status=completed.';

COMMIT;
