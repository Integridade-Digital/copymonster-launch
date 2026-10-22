-- ============================================================================
-- Migration: 042_dna_quota_statuses.sql
-- Description: Atualiza preços, cotas de tokens, Price IDs do Stripe e cotas de
--              DNA por plano, além de corrigir a resolução de cota de DNA por
--              status de assinatura em count_my_positioning_mappings.
-- Cotas de DNA: Free/Trial/Expirado/Cancelado/Past Due: 3 | Starter: 3 |
--               Pro: 10 | Legend: 50 | Admin/Owner: Ilimitado
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. SINCRONIZAÇÃO DO CATÁLOGO DE PLANOS
--    Preços em centavos, limites de tokens, cotas de DNA e Price IDs vigentes.
-- ----------------------------------------------------------------------------
UPDATE public.plans
SET
  stripe_price_id_monthly = 'price_1UTC71RiKNxooUH00Xd4MPwZ',
  stripe_price_id_annual = 'price_1UTCD7RiKNxooUH01oFkwQC6',
  monthly_price_cents = 3900,
  annual_price_cents = 34800,
  token_limit_input = 1400000,
  token_limit_output = 600000,
  max_positioning_mappings = 3
WHERE slug = 'starter';

UPDATE public.plans
SET
  stripe_price_id_monthly = 'price_1UTCEuRiKNxooUH05uZv8GY7',
  stripe_price_id_annual = 'price_1UTCGWRiKNxooUH0cJaaDUPy',
  monthly_price_cents = 9900,
  annual_price_cents = 94800,
  token_limit_input = 7000000,
  token_limit_output = 3000000,
  max_positioning_mappings = 10
WHERE slug = 'pro';

UPDATE public.plans
SET
  stripe_price_id_monthly = 'price_1UTCIDRiKNxooUH0ZOQhFsPa',
  stripe_price_id_annual = 'price_1UTCJmRiKNxooUH0EP1P1vpx',
  monthly_price_cents = 24900,
  annual_price_cents = 238800,
  token_limit_input = 25000000,
  token_limit_output = 10000000,
  max_positioning_mappings = 50
WHERE slug = 'legend';

UPDATE public.plans SET max_positioning_mappings = 3 WHERE slug IN ('free', 'trial');

-- ----------------------------------------------------------------------------
-- 2. RPC: count_my_positioning_mappings (VALIDAÇÃO DE COTA)
--    - trial/trialing: 3
--    - starter: 3
--    - pro: 10
--    - legend: 50
--    - trial_expired/canceled/past_due (e demais estados inativos): 3
--    - admin/owner da plataforma: ilimitado (-1)
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

  -- Resolução da cota conforme status da assinatura e plano vigente
  SELECT t.subscription_status, COALESCE(p.slug, 'free')
  INTO _sub_status, _plan_slug
  FROM public.tenants t
  LEFT JOIN public.plans p ON p.id = t.plan_id
  WHERE t.id = _tenant_id;

  IF _sub_status IN ('trial', 'trialing') THEN
    _max := 3;
    _plan_slug := 'trial';
  ELSIF _sub_status IS NULL OR _sub_status IN (
    'trial_expired', 'canceled', 'past_due', 'unpaid', 'incomplete', 'deleted'
  ) THEN
    _max := 3;
    _plan_slug := 'free';
  ELSE
    CASE _plan_slug
      WHEN 'starter' THEN
        _max := 3;
      WHEN 'pro' THEN
        _max := 10;
      WHEN 'legend' THEN
        _max := 50;
      WHEN 'enterprise' THEN
        _max := 50;
      ELSE
        _max := 3;
        _plan_slug := 'free';
    END CASE;
  END IF;

  RETURN jsonb_build_object(
    'count', _count,
    'max', _max,
    'can_create', (_max = -1 OR _count < _max),
    'plan_slug', _plan_slug,
    'is_unlimited', (_max = -1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.count_my_positioning_mappings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_my_positioning_mappings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_my_positioning_mappings() TO service_role;

COMMIT;
