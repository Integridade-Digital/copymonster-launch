-- ============================================================================
-- 057_fix_affiliate_profile_rls.sql — SEC-004
--
-- Remove a escrita direta do afiliado em affiliate.profiles.
--
-- A política "affiliate_profiles_update_own" (052:228-236) validava apenas a
-- propriedade do perfil e a imutabilidade de kyc_status. Um afiliado podia
-- portanto alterar com o próprio JWT colunas que decidem dinheiro, confiança e
-- estado da conta:
--
--   paypal_email / paypal_last_changed_at  → contorno da RPC
--                                            affiliate.update_paypal_email(),
--                                            que aplica validação de formato e
--                                            auditoria;
--   trust_score                            → pontuação antifraude;
--   active                                 → reativação de conta suspensa;
--   cpf_cnpj / full_name                   → titular do KYC.
--
-- Depois desta migração:
--
--   * affiliate.update_paypal_email(email)  continua a ser a única via para o
--     e-mail de pagamento (SECURITY DEFINER, valida e audita);
--   * affiliate.register_profile(...)       continua a ser a única via de
--     auto-registo (INSERT direto já era substituído por ela em 053);
--   * afiliado.update_own_profile(...)      passa a ser a única via para os
--     campos que o afiliado pode mesmo editar;
--   * UPDATE/DELETE diretos ficam indisponíveis para `authenticated`;
--   * SELECT próprio/operador e o INSERT inicial não mudam.
--
-- Dependências: 052_affiliate_and_finance_schemas.sql, 053_affiliate_eligibility_cron.sql.
-- Reversão: ver docs/plan/PRODUCTION_READINESS_PLAN.md (Fase 2, Passo 2.2);
-- nunca reverter com GRANT ALL de volta para authenticated.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. RPC dos campos que o afiliado pode editar.
--    Só as colunas abaixo são graváveis; o restante estado vem do servidor.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION affiliate.update_own_profile(
    p_full_name TEXT DEFAULT NULL,
    p_address_city TEXT DEFAULT NULL,
    p_address_state TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = affiliate, public, pg_temp
AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
    END IF;

    IF p_full_name IS NOT NULL
       AND (length(trim(p_full_name)) < 3 OR length(trim(p_full_name)) > 160) THEN
        RAISE EXCEPTION 'invalid_full_name' USING ERRCODE = '22023';
    END IF;
    IF p_address_city IS NOT NULL AND length(trim(p_address_city)) > 120 THEN
        RAISE EXCEPTION 'invalid_address_city' USING ERRCODE = '22023';
    END IF;
    IF p_address_state IS NOT NULL AND length(trim(p_address_state)) > 80 THEN
        RAISE EXCEPTION 'invalid_address_state' USING ERRCODE = '22023';
    END IF;
    IF p_full_name IS NULL AND p_address_city IS NULL AND p_address_state IS NULL THEN
        RAISE EXCEPTION 'nothing_to_update' USING ERRCODE = '22023';
    END IF;

    UPDATE affiliate.profiles
    SET full_name = COALESCE(trim(p_full_name), full_name),
        address_city = CASE
            WHEN p_address_city IS NULL THEN address_city
            ELSE NULLIF(trim(p_address_city), '')
        END,
        address_state = CASE
            WHEN p_address_state IS NULL THEN address_state
            ELSE NULLIF(upper(trim(p_address_state)), '')
        END,
        updated_at = now()
    WHERE user_id = auth.uid() AND active = true
    RETURNING id INTO v_profile_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'affiliate_profile_not_found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION affiliate.update_own_profile(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION affiliate.update_own_profile(TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Fim da escrita direta.
--    As RPC de administração (053) correm com SECURITY DEFINER e não dependem
--    deste grant. O servidor usa service_role, que mantém o acesso.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "affiliate_profiles_update_own" ON affiliate.profiles;

REVOKE UPDATE, DELETE ON affiliate.profiles FROM authenticated;

-- O INSERT direto também cai: affiliate.register_profile() é o único caminho de
-- auto-registo e aplica validação e auditoria que a política não aplicava.
DROP POLICY IF EXISTS "affiliate_profiles_insert_self" ON affiliate.profiles;

REVOKE INSERT ON affiliate.profiles FROM authenticated;

-- Leitura própria/operador mantém-se em "affiliate_profiles_select_own".

COMMIT;
