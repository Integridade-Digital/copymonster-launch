-- ============================================================================
-- Migration: 039_positioning_mappings_dna.sql
-- Description: Camada de persistência para Brand Positioning Monster (DNA CopyMonster)
-- Security: Multi-tenant, RLS estrito por user_id e tenant_id, RPCs SECURITY DEFINER
-- Cotas por Plano: Free/Trial: 3 | Starter: 30 | Pro: 100 | Legend: 500 | Admin: Ilimitado
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EXPANSÃO DA TABELA PLANS (COTAS DE DNA)
-- ----------------------------------------------------------------------------
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS max_positioning_mappings INTEGER NOT NULL DEFAULT 3;

-- Atualização das cotas canônicas por plano
UPDATE public.plans SET max_positioning_mappings = 3 WHERE slug IN ('free', 'trial');
UPDATE public.plans SET max_positioning_mappings = 30 WHERE slug = 'starter';
UPDATE public.plans SET max_positioning_mappings = 100 WHERE slug = 'pro';
UPDATE public.plans SET max_positioning_mappings = 500 WHERE slug IN ('legend', 'enterprise');


-- ----------------------------------------------------------------------------
-- 2. TABELA POSITIONING_MAPPINGS (O KERNEL DO DNA EM 12 BLOCOS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.positioning_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',

  -- Os 12 Blocos Estratégicos (Brand Positioning Monster)
  block_1_public TEXT,
  block_2_pains TEXT,
  block_3_solution TEXT,
  block_4_differentiators TEXT,
  block_5_awareness_stage TEXT,
  block_6_urgency TEXT,
  block_7_social_proof TEXT,
  block_8_objections TEXT,
  block_9_emotional TEXT,
  block_10_transformation TEXT,
  block_11_voice TEXT,
  block_12_promises TEXT,

  -- Controle de Estado e Progresso
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'archived')),
  current_block SMALLINT NOT NULL DEFAULT 1 CHECK (current_block BETWEEN 1 AND 12),
  is_default BOOLEAN NOT NULL DEFAULT false,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Índices de Alta Performance
CREATE INDEX IF NOT EXISTS idx_positioning_mappings_tenant_user
  ON public.positioning_mappings (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_positioning_mappings_user_status
  ON public.positioning_mappings (user_id, status);

-- Índice único parcial: garante no máximo 1 DNA padrão ativo por usuário
CREATE UNIQUE INDEX IF NOT EXISTS idx_positioning_mappings_user_default
  ON public.positioning_mappings (user_id)
  WHERE is_default = true AND status != 'archived';


-- ----------------------------------------------------------------------------
-- 3. POLÍTICAS RLS (ROW LEVEL SECURITY) ESTATUTÁRIAS
-- ----------------------------------------------------------------------------
ALTER TABLE public.positioning_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.positioning_mappings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.positioning_mappings TO authenticated;
GRANT ALL ON TABLE public.positioning_mappings TO service_role;

-- SELECT: Usuário autenticado lê apenas seus próprios registros no tenant ativo
CREATE POLICY "positioning_mappings_select_policy"
  ON public.positioning_mappings
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND tenant_id = public.get_current_tenant_id()
  );

-- INSERT: Usuário autenticado grava vinculado a si e ao tenant ativo
CREATE POLICY "positioning_mappings_insert_policy"
  ON public.positioning_mappings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND tenant_id = public.get_current_tenant_id()
  );

-- UPDATE: Usuário autenticado atualiza apenas seus próprios registros no tenant ativo
CREATE POLICY "positioning_mappings_update_policy"
  ON public.positioning_mappings
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND tenant_id = public.get_current_tenant_id()
  )
  WITH CHECK (
    auth.uid() = user_id
    AND tenant_id = public.get_current_tenant_id()
  );

-- DELETE: Usuário autenticado deleta apenas seus próprios registros no tenant ativo
CREATE POLICY "positioning_mappings_delete_policy"
  ON public.positioning_mappings
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND tenant_id = public.get_current_tenant_id()
  );


-- ----------------------------------------------------------------------------
-- 4. RPC: get_positioning_mapping (LEITURA EXCLUSIVA DO RUNTIME)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_positioning_mapping(
  p_mapping_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS SETOF public.positioning_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.positioning_mappings
  WHERE id = p_mapping_id
    AND (p_user_id IS NULL OR user_id = p_user_id)
    AND status != 'archived'
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_positioning_mapping(UUID, UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_positioning_mapping(UUID, UUID) TO service_role;


-- ----------------------------------------------------------------------------
-- 5. RPC: list_my_positioning_mappings (LISTAGEM DO CRIADOR)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_positioning_mappings()
RETURNS SETOF public.positioning_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  _user_id UUID;
  _tenant_id UUID;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.get_current_tenant_id();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: tenant não identificado.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.positioning_mappings
  WHERE user_id = _user_id
    AND tenant_id = _tenant_id
    AND status != 'archived'
  ORDER BY is_default DESC, updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_positioning_mappings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_positioning_mappings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_positioning_mappings() TO service_role;


-- ----------------------------------------------------------------------------
-- 6. RPC: count_my_positioning_mappings (VALIDAÇÃO DE COTA)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_my_positioning_mappings()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  _user_id UUID;
  _tenant_id UUID;
  _count INTEGER := 0;
  _max INTEGER := 3;
  _is_admin BOOLEAN := false;
  _plan_slug TEXT := 'free';
  _sub_status TEXT;
  _trial_ends_at TIMESTAMPTZ;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.get_current_tenant_id();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: tenant não identificado.' USING ERRCODE = '42501';
  END IF;

  -- Contagem de mapeamentos ativos do criador neste tenant
  SELECT COUNT(*) INTO _count
  FROM public.positioning_mappings
  WHERE user_id = _user_id
    AND tenant_id = _tenant_id
    AND status != 'archived';

  -- Admins e Owners têm cota ilimitada (-1)
  _is_admin := public.is_admin_or_owner();
  IF _is_admin THEN
    RETURN jsonb_build_object(
      'count', _count,
      'max', -1,
      'can_create', true,
      'plan_slug', 'admin',
      'is_unlimited', true
    );
  END IF;

  -- Resolução da cota conforme plano e status de trial
  SELECT t.subscription_status, t.trial_ends_at, p.slug, COALESCE(p.max_positioning_mappings, 3)
  INTO _sub_status, _trial_ends_at, _plan_slug, _max
  FROM public.tenants t
  LEFT JOIN public.plans p ON p.id = t.plan_id
  WHERE t.id = _tenant_id;

  IF _sub_status IN ('trial', 'trialing') THEN
    _max := 3;
    _plan_slug := 'trial';
  ELSIF _max IS NULL THEN
    _max := 3;
    _plan_slug := COALESCE(_plan_slug, 'free');
  END IF;

  RETURN jsonb_build_object(
    'count', _count,
    'max', _max,
    'can_create', (_max = -1 OR _count < _max),
    'plan_slug', COALESCE(_plan_slug, 'free'),
    'is_unlimited', (_max = -1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.count_my_positioning_mappings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_my_positioning_mappings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_my_positioning_mappings() TO service_role;


-- ----------------------------------------------------------------------------
-- 7. RPC: create_positioning_mapping (CRIAÇÃO COM TRAVA RÍGIDA DE COTA)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_positioning_mapping(
  p_name TEXT,
  p_product_name TEXT DEFAULT ''
)
RETURNS public.positioning_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID;
  _tenant_id UUID;
  _quota JSONB;
  _can_create BOOLEAN;
  _count INTEGER;
  _max INTEGER;
  _is_default BOOLEAN := false;
  _result public.positioning_mappings;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.get_current_tenant_id();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: tenant não identificado.' USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'O nome do DNA é obrigatório.' USING ERRCODE = '22000';
  END IF;

  -- Checagem estrita de cota
  _quota := public.count_my_positioning_mappings();
  _can_create := (_quota->>'can_create')::BOOLEAN;
  _count := (_quota->>'count')::INTEGER;
  _max := (_quota->>'max')::INTEGER;

  IF NOT _can_create THEN
    RAISE EXCEPTION 'Limite de DNAs do plano atingido (% de %). Faça upgrade para criar mais.', _count, _max USING ERRCODE = 'P0003';
  END IF;

  -- Primeiro DNA ativo do criador torna-se padrão automaticamente
  IF _count = 0 THEN
    _is_default := true;
  END IF;

  INSERT INTO public.positioning_mappings (
    tenant_id,
    user_id,
    name,
    product_name,
    status,
    current_block,
    is_default
  ) VALUES (
    _tenant_id,
    _user_id,
    trim(p_name),
    trim(COALESCE(p_product_name, '')),
    'in_progress',
    1,
    _is_default
  )
  RETURNING * INTO _result;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_positioning_mapping(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_positioning_mapping(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_positioning_mapping(TEXT, TEXT) TO service_role;


-- ----------------------------------------------------------------------------
-- 8. RPC: update_positioning_block (SALVAMENTO DINÂMICO DOS 12 BLOCOS)
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
  _user_id UUID;
  _tenant_id UUID;
  _updated public.positioning_mappings;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.get_current_tenant_id();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: tenant não identificado.' USING ERRCODE = '42501';
  END IF;

  IF p_block_number < 1 OR p_block_number > 12 THEN
    RAISE EXCEPTION 'Número de bloco inválido: %. Deve estar entre 1 e 12.', p_block_number USING ERRCODE = '22003';
  END IF;

  CASE p_block_number
    WHEN 1 THEN
      UPDATE public.positioning_mappings
      SET block_1_public = p_content,
          current_block = GREATEST(current_block, 2),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 2 THEN
      UPDATE public.positioning_mappings
      SET block_2_pains = p_content,
          current_block = GREATEST(current_block, 3),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 3 THEN
      UPDATE public.positioning_mappings
      SET block_3_solution = p_content,
          current_block = GREATEST(current_block, 4),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 4 THEN
      UPDATE public.positioning_mappings
      SET block_4_differentiators = p_content,
          current_block = GREATEST(current_block, 5),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 5 THEN
      UPDATE public.positioning_mappings
      SET block_5_awareness_stage = p_content,
          current_block = GREATEST(current_block, 6),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 6 THEN
      UPDATE public.positioning_mappings
      SET block_6_urgency = p_content,
          current_block = GREATEST(current_block, 7),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 7 THEN
      UPDATE public.positioning_mappings
      SET block_7_social_proof = p_content,
          current_block = GREATEST(current_block, 8),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 8 THEN
      UPDATE public.positioning_mappings
      SET block_8_objections = p_content,
          current_block = GREATEST(current_block, 9),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 9 THEN
      UPDATE public.positioning_mappings
      SET block_9_emotional = p_content,
          current_block = GREATEST(current_block, 10),
          updated_at = NOW()
      WHERE id = p_mapping_id AND user_id = _user_id AND tenant_id = _tenant_id AND status != 'archived'
      RETURNING * INTO _updated;
    WHEN 10 THEN
      UPDATE public.positioning_mappings
      SET block_10_transformation = p_content,
          current_block = GREATEST(current_block, 11),
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
          status = 'completed',
          completed_at = COALESCE(completed_at, NOW()),
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
GRANT EXECUTE ON FUNCTION public.update_positioning_block(UUID, INTEGER, TEXT) TO service_role;


-- ----------------------------------------------------------------------------
-- 9. RPC: set_default_positioning_mapping (DEFINIR DNA PADRÃO)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_default_positioning_mapping(
  p_mapping_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID;
  _tenant_id UUID;
  _exists BOOLEAN;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.get_current_tenant_id();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: tenant não identificado.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.positioning_mappings
    WHERE id = p_mapping_id
      AND user_id = _user_id
      AND tenant_id = _tenant_id
      AND status != 'archived'
  ) INTO _exists;

  IF NOT _exists THEN
    RAISE EXCEPTION 'Mapeamento de DNA não encontrado ou arquivado.' USING ERRCODE = 'P0002';
  END IF;

  -- Desmarca todos os demais DNAs do usuário
  UPDATE public.positioning_mappings
  SET is_default = false, updated_at = NOW()
  WHERE user_id = _user_id
    AND is_default = true
    AND id != p_mapping_id;

  -- Marca o escolhido como padrão
  UPDATE public.positioning_mappings
  SET is_default = true, updated_at = NOW()
  WHERE id = p_mapping_id
    AND user_id = _user_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_positioning_mapping(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_positioning_mapping(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_positioning_mapping(UUID) TO service_role;


-- ----------------------------------------------------------------------------
-- 10. RPC: delete_positioning_mapping (SOFT-DELETE / ARQUIVAMENTO)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_positioning_mapping(
  p_mapping_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID;
  _tenant_id UUID;
  _was_default BOOLEAN;
  _next_id UUID;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.get_current_tenant_id();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: tenant não identificado.' USING ERRCODE = '42501';
  END IF;

  SELECT is_default INTO _was_default
  FROM public.positioning_mappings
  WHERE id = p_mapping_id
    AND user_id = _user_id
    AND tenant_id = _tenant_id
    AND status != 'archived';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mapeamento de DNA não encontrado ou já arquivado.' USING ERRCODE = 'P0002';
  END IF;

  -- Arquivamento com desativação do status de default
  UPDATE public.positioning_mappings
  SET status = 'archived',
      is_default = false,
      updated_at = NOW()
  WHERE id = p_mapping_id
    AND user_id = _user_id;

  -- Se era o default, promove o DNA ativo mais recente a novo default
  IF _was_default THEN
    SELECT id INTO _next_id
    FROM public.positioning_mappings
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
      AND status != 'archived'
    ORDER BY updated_at DESC
    LIMIT 1;

    IF _next_id IS NOT NULL THEN
      UPDATE public.positioning_mappings
      SET is_default = true, updated_at = NOW()
      WHERE id = _next_id;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_positioning_mapping(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_positioning_mapping(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_positioning_mapping(UUID) TO service_role;


-- ----------------------------------------------------------------------------
-- 11. RPC: duplicate_positioning_mapping (CLONAGEM COM VALIDAÇÃO DE COTA)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.duplicate_positioning_mapping(
  p_mapping_id UUID,
  p_new_name TEXT
)
RETURNS public.positioning_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID;
  _tenant_id UUID;
  _source public.positioning_mappings;
  _quota JSONB;
  _can_create BOOLEAN;
  _count INTEGER;
  _max INTEGER;
  _result public.positioning_mappings;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.get_current_tenant_id();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: tenant não identificado.' USING ERRCODE = '42501';
  END IF;

  IF p_new_name IS NULL OR trim(p_new_name) = '' THEN
    RAISE EXCEPTION 'O novo nome do DNA é obrigatório.' USING ERRCODE = '22000';
  END IF;

  -- Validação de cota antes de duplicar
  _quota := public.count_my_positioning_mappings();
  _can_create := (_quota->>'can_create')::BOOLEAN;
  _count := (_quota->>'count')::INTEGER;
  _max := (_quota->>'max')::INTEGER;

  IF NOT _can_create THEN
    RAISE EXCEPTION 'Limite de DNAs do plano atingido (% de %). Faça upgrade para criar mais.', _count, _max USING ERRCODE = 'P0003';
  END IF;

  -- Carrega o registro de origem
  SELECT * INTO _source
  FROM public.positioning_mappings
  WHERE id = p_mapping_id
    AND user_id = _user_id
    AND tenant_id = _tenant_id
    AND status != 'archived';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mapeamento de DNA de origem não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Clona os 12 blocos com is_default = false
  INSERT INTO public.positioning_mappings (
    tenant_id,
    user_id,
    name,
    product_name,
    block_1_public,
    block_2_pains,
    block_3_solution,
    block_4_differentiators,
    block_5_awareness_stage,
    block_6_urgency,
    block_7_social_proof,
    block_8_objections,
    block_9_emotional,
    block_10_transformation,
    block_11_voice,
    block_12_promises,
    status,
    current_block,
    is_default,
    completed_at
  ) VALUES (
    _tenant_id,
    _user_id,
    trim(p_new_name),
    _source.product_name,
    _source.block_1_public,
    _source.block_2_pains,
    _source.block_3_solution,
    _source.block_4_differentiators,
    _source.block_5_awareness_stage,
    _source.block_6_urgency,
    _source.block_7_social_proof,
    _source.block_8_objections,
    _source.block_9_emotional,
    _source.block_10_transformation,
    _source.block_11_voice,
    _source.block_12_promises,
    _source.status,
    _source.current_block,
    false,
    _source.completed_at
  )
  RETURNING * INTO _result;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_positioning_mapping(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.duplicate_positioning_mapping(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_positioning_mapping(UUID, TEXT) TO service_role;

COMMIT;
