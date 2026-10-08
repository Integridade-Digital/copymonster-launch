-- ============================================================
-- Migration: 032_production_gates_and_tenants.sql
-- CopyMonster - Integridade Digital
--
-- Plano: docs/roadmap/plano-producao-llm-providers-billing-trial.md
-- Etapa 2 - Hard gates de producao, mapeamento de rotas LLM e
-- isolamento por tenant pessoal.
--
-- 1. llm_providers: roteamento explicito (provider_route / api_key_env)
-- 2. plans: markup_multiplier informativo
-- 3. RPC check_tenant_quota(p_tenant_id): gate fail-closed de assinatura e cota
-- 4. handle_new_user(): tenant pessoal isolado por novo usuario
-- ============================================================

BEGIN;

-- ============================================================================
-- 1. MAPEAMENTO EXPLICITO DE ROTAS LLM
-- ----------------------------------------------------------------------------
-- Os campos eliminam o acoplamento por nome literal do provedor: o runtime
-- resolve a rota pela coluna provider_route e a variavel de ambiente da chave
-- pela coluna api_key_env. O preenchimento dos registros oficiais ocorre na
-- Etapa 7 do plano.
-- ============================================================================
ALTER TABLE public.llm_providers
  ADD COLUMN IF NOT EXISTS provider_route TEXT,
  ADD COLUMN IF NOT EXISTS api_key_env TEXT;

COMMENT ON COLUMN public.llm_providers.provider_route IS
  'Identificador de rota do provedor consumido pelo runtime (ex: deepseek-official, openrouter-official)';
COMMENT ON COLUMN public.llm_providers.api_key_env IS
  'Nome da variavel de ambiente associada a chave do provedor no credential seam do runtime';

-- ============================================================================
-- 2. MARKUP DE REVENDA INFORMATIVO
-- ----------------------------------------------------------------------------
-- Valor de referencia para a camada de negocio; nao participa de nenhuma
-- decisao de autorizacao ou cota.
-- ============================================================================
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS markup_multiplier NUMERIC(6,3) NOT NULL DEFAULT 3.000;

COMMENT ON COLUMN public.plans.markup_multiplier IS
  'Multiplicador informativo de markup sobre o custo de inferencia do plano';

-- ============================================================================
-- 3. RPC check_tenant_quota(p_tenant_id)
-- ----------------------------------------------------------------------------
-- Gate fail-closed consumido pelo backend (service_role) antes de criar sessao
-- ou despachar prompt. Regras:
--   - tenant inexistente                       -> bloqueia (tenant_not_found)
--   - status fora de active/trialing/trial     -> bloqueia (subscription_inactive:<status>)
--   - trial vencido (trial_ends_at < now)       -> bloqueia (trial_expired)
--   - plano ativo ausente                       -> bloqueia (no_plan)
--   - tokens consumidos >= teto do plano        -> bloqueia (quota_exceeded)
--   - teto do plano nulo/<=0 (sem limite)       -> libera com remaining -1
-- Teto do trial: 1.000.000 tokens (trial_tokens_used).
-- Teto do plano ativo: token_limit_input + token_limit_output
--   (current_period_tokens_used).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_tenant_quota(p_tenant_id UUID)
RETURNS TABLE (
  allowed BOOLEAN,
  reason TEXT,
  remaining_tokens BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status TEXT;
  _trial_ends_at TIMESTAMPTZ;
  _trial_tokens BIGINT;
  _period_tokens BIGINT;
  _plan_id UUID;
  _limit_input BIGINT;
  _limit_output BIGINT;
  _used BIGINT;
  _ceiling BIGINT;
BEGIN
  SELECT t.subscription_status,
         t.trial_ends_at,
         t.trial_tokens_used,
         t.current_period_tokens_used,
         t.plan_id
    INTO _status, _trial_ends_at, _trial_tokens, _period_tokens, _plan_id
  FROM public.tenants t
  WHERE t.id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'tenant_not_found'::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  IF _status IS NULL OR _status NOT IN ('active', 'trialing', 'trial') THEN
    RETURN QUERY SELECT
      FALSE,
      ('subscription_inactive:' || COALESCE(_status, 'unknown'))::TEXT,
      0::BIGINT;
    RETURN;
  END IF;

  IF _status IN ('trialing', 'trial') THEN
    IF _trial_ends_at IS NOT NULL AND _trial_ends_at < timezone('utc'::text, now()) THEN
      RETURN QUERY SELECT FALSE, 'trial_expired'::TEXT, 0::BIGINT;
      RETURN;
    END IF;
    _used := COALESCE(_trial_tokens, 0);
    _ceiling := 1000000;
  ELSE
    SELECT p.token_limit_input, p.token_limit_output
      INTO _limit_input, _limit_output
    FROM public.plans p
    WHERE p.id = _plan_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, 'no_plan'::TEXT, 0::BIGINT;
      RETURN;
    END IF;

    _ceiling := COALESCE(_limit_input, 0) + COALESCE(_limit_output, 0);
    IF _ceiling <= 0 THEN
      RETURN QUERY SELECT TRUE, 'ok'::TEXT, (-1)::BIGINT;
      RETURN;
    END IF;
    _used := COALESCE(_period_tokens, 0);
  END IF;

  IF _used >= _ceiling THEN
    RETURN QUERY SELECT FALSE, 'quota_exceeded'::TEXT, 0::BIGINT;
  ELSE
    RETURN QUERY SELECT TRUE, 'ok'::TEXT, GREATEST(_ceiling - _used, 0)::BIGINT;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.check_tenant_quota(UUID) IS
  'Gate fail-closed de assinatura e cota de tokens por tenant; exclusivo do service_role';

REVOKE EXECUTE ON FUNCTION public.check_tenant_quota(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_tenant_quota(UUID) TO service_role;

-- ============================================================================
-- 4. TENANT PESSOAL POR NOVO USUARIO (handle_new_user)
-- ----------------------------------------------------------------------------
-- Substitui o modelo mono-tenant da migration 023. Novo usuario:
--   - recebe tenant individual isolado (status trialing, plano pro,
--     trial de 7 dias, teto de 1.000.000 tokens) e role 'owner' nele; OU
--   - entra como 'member' no tenant convidado quando invited_tenant_id
--     aponta para um tenant existente e ativo.
-- O tenant master 00000000-0000-0000-0000-000000000001 permanece reservado
-- aos administradores/operadores e nao e alterado por este trigger.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _full_name TEXT;
  _whatsapp TEXT;
  _avatar_url TEXT;
  _invited_tenant_id TEXT;
  _tenant_id UUID;
  _personal_tenant_id UUID;
  _pro_plan_id UUID;
  _base_slug TEXT;
  _slug TEXT;
BEGIN
  _full_name := NEW.raw_user_meta_data->>'full_name';
  _avatar_url := NEW.raw_user_meta_data->>'avatar_url';
  _whatsapp := NEW.raw_user_meta_data->>'whatsapp';
  _invited_tenant_id := NEW.raw_user_meta_data->>'invited_tenant_id';

  INSERT INTO public.users (id, email, full_name, avatar_url, whatsapp, created_at, updated_at)
  VALUES (NEW.id, NEW.email, COALESCE(_full_name, split_part(NEW.email, '@', 1)),
          _avatar_url, _whatsapp, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
    whatsapp = COALESCE(EXCLUDED.whatsapp, public.users.whatsapp),
    updated_at = NOW();

  IF EXISTS (SELECT 1 FROM public.user_tenant_roles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Convite para tenant existente e ativo: entra como member.
  IF _invited_tenant_id IS NOT NULL
    AND _invited_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO _tenant_id FROM public.tenants
    WHERE id = _invited_tenant_id::uuid AND status = 'active';
  END IF;

  IF _tenant_id IS NOT NULL THEN
    INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
    VALUES (NEW.id, _tenant_id, 'member')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Sem convite: cria tenant pessoal isolado com trial de 7 dias / 1M tokens.
  SELECT id INTO _pro_plan_id FROM public.plans WHERE slug = 'pro' LIMIT 1;
  IF _pro_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plano Pro nao encontrado para inicializacao do tenant pessoal';
  END IF;

  _base_slug := lower(regexp_replace(
    COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'workspace'),
    '[^a-z0-9]+', '-', 'g'));
  _base_slug := trim(both '-' from _base_slug);
  IF _base_slug = '' THEN
    _base_slug := 'workspace';
  END IF;
  _slug := left(_base_slug, 40) || '-' || substr(replace(NEW.id::text, '-', ''), 1, 8);

  INSERT INTO public.tenants (
    name, slug, status, subscription_status, plan_id,
    trial_used, trial_ends_at, trial_tokens_used, current_period_tokens_used, metadata
  ) VALUES (
    format('%s Workspace', COALESCE(NULLIF(_full_name, ''), split_part(NEW.email, '@', 1), 'Novo')),
    _slug,
    'active',
    'trialing',
    _pro_plan_id,
    false,
    timezone('utc'::text, now()) + interval '7 days',
    0,
    0,
    jsonb_build_object('created_by_trigger', true, 'owner_user_id', NEW.id)
  )
  RETURNING id INTO _personal_tenant_id;

  INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
  VALUES (NEW.id, _personal_tenant_id, 'owner')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$function$;

COMMIT;
