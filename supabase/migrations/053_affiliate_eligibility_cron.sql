-- ============================================================================
-- Migration: 053_affiliate_eligibility_cron.sql
-- Description: Função para maturação de comissões pós-carência (35 dias)
--              e agendamento diário via pg_cron.
-- ============================================================================

BEGIN;

-- 1. Função que move comissões HOLDING com eligible_at <= now() para PENDING_VALIDATION
CREATE OR REPLACE FUNCTION affiliate.process_matured_commissions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = affiliate, finance, public, pg_temp
AS $$
DECLARE
    v_moved_count INT := 0;
    v_rec RECORD;
BEGIN
    -- Seleciona comissões HOLDING com eligible_at alcançado
    FOR v_rec IN
        SELECT c.id, c.affiliate_id, c.commission_amount
        FROM affiliate.commissions c
        WHERE c.status = 'HOLDING'
          AND c.active = true
          AND c.eligible_at <= now()
        FOR UPDATE SKIP LOCKED
    LOOP
        -- Atualiza status da comissão para PENDING_VALIDATION
        UPDATE affiliate.commissions
        SET status = 'PENDING_VALIDATION',
            updated_at = now()
        WHERE id = v_rec.id;

        -- Gera notificação para o afiliado
        INSERT INTO affiliate.notifications (
            affiliate_id,
            type,
            title,
            message,
            metadata,
            read,
            created_at
        ) VALUES (
            v_rec.affiliate_id,
            'COMMISSION_PENDING_VALIDATION',
            'affiliate.commission.pendingValidation.title',
            'affiliate.commission.pendingValidation.message',
            jsonb_build_object(
                'commission_id', v_rec.id,
                'amount', v_rec.commission_amount,
                'status', 'PENDING_VALIDATION'
            ),
            false,
            now()
        );

        v_moved_count := v_moved_count + 1;
    END LOOP;

    RETURN v_moved_count;
END;
$$;

-- Permissões na função
REVOKE ALL ON FUNCTION affiliate.process_matured_commissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION affiliate.process_matured_commissions() TO service_role;


-- 2. Audited, admin-only workflow RPCs. Each state transition and its ledger/audit
-- records run in one database transaction so a partial financial state is impossible.
CREATE OR REPLACE FUNCTION affiliate.admin_review_kyc(
    p_profile_id UUID,
    p_approved BOOLEAN,
    p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = affiliate, finance, public, pg_temp
AS $$
DECLARE
    v_status affiliate.kyc_status;
BEGIN
    IF NOT public.is_admin_or_owner() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;
    IF NOT p_approved AND NULLIF(trim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'rejection_reason_required' USING ERRCODE = '22023';
    END IF;

    v_status := CASE WHEN p_approved THEN 'APPROVED'::affiliate.kyc_status ELSE 'REJECTED'::affiliate.kyc_status END;
    UPDATE affiliate.profiles
    SET kyc_status = v_status,
        kyc_metadata = coalesce(kyc_metadata, '{}'::jsonb) || jsonb_build_object(
            'reviewed_at', now(), 'reviewed_by', auth.uid(), 'rejection_reason', CASE WHEN p_approved THEN NULL ELSE trim(p_reason) END
        ),
        updated_at = now()
    WHERE id = p_profile_id AND kyc_status = 'PENDING' AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'kyc_profile_not_pending'; END IF;

    INSERT INTO affiliate.audit_logs(admin_user_id, action, target_type, target_id, reason, metadata)
    VALUES (auth.uid(), CASE WHEN p_approved THEN 'KYC_APPROVED' ELSE 'KYC_REJECTED' END,
            'AFFILIATE_PROFILE', p_profile_id, NULLIF(trim(p_reason), ''), jsonb_build_object('status', v_status));
END;
$$;

CREATE OR REPLACE FUNCTION affiliate.admin_review_commission(
    p_commission_id UUID,
    p_approved BOOLEAN,
    p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = affiliate, finance, public, pg_temp
AS $$
DECLARE
    v_commission affiliate.commissions%ROWTYPE;
BEGIN
    IF NOT public.is_admin_or_owner() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;
    IF NOT p_approved AND NULLIF(trim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'rejection_reason_required' USING ERRCODE = '22023';
    END IF;

    UPDATE affiliate.commissions
    SET status = CASE WHEN p_approved THEN 'ELIGIBLE'::affiliate.commission_status ELSE 'CANCELLED'::affiliate.commission_status END,
        updated_at = now()
    WHERE id = p_commission_id AND status = 'PENDING_VALIDATION' AND active = true
    RETURNING * INTO v_commission;
    IF NOT FOUND THEN RAISE EXCEPTION 'commission_not_pending_validation'; END IF;

    IF p_approved THEN
        INSERT INTO finance.ledger_entries(affiliate_id, amount, entry_type, reference_type, reference_id, description)
        VALUES (v_commission.affiliate_id, v_commission.commission_amount, 'CREDIT', 'COMMISSION', v_commission.id,
                'Affiliate commission approved');
    END IF;

    INSERT INTO affiliate.audit_logs(admin_user_id, action, target_type, target_id, reason, metadata)
    VALUES (auth.uid(), CASE WHEN p_approved THEN 'COMMISSION_APPROVED' ELSE 'COMMISSION_REJECTED' END,
            'AFFILIATE_COMMISSION', v_commission.id, NULLIF(trim(p_reason), ''),
            jsonb_build_object('affiliate_id', v_commission.affiliate_id, 'amount', v_commission.commission_amount));
END;
$$;

CREATE OR REPLACE FUNCTION affiliate.admin_publish_commission_rule(
    p_version_name TEXT,
    p_percentage NUMERIC,
    p_retention_days INT,
    p_min_payout_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = affiliate, finance, public, pg_temp
AS $$
DECLARE
    v_rule_id UUID;
BEGIN
    IF NOT public.is_admin_or_owner() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(trim(p_version_name), '') IS NULL OR p_percentage < 0 OR p_percentage > 100
       OR p_retention_days < 0 OR p_min_payout_amount < 0 THEN
        RAISE EXCEPTION 'invalid_commission_rule' USING ERRCODE = '22023';
    END IF;

    UPDATE affiliate.commission_rules SET is_current = false WHERE is_current = true;
    INSERT INTO affiliate.commission_rules(version_name, percentage, retention_days, min_payout_amount, is_current, active)
    VALUES (trim(p_version_name), p_percentage, p_retention_days, p_min_payout_amount, true, true)
    RETURNING id INTO v_rule_id;

    INSERT INTO affiliate.audit_logs(admin_user_id, action, target_type, target_id, metadata)
    VALUES (auth.uid(), 'COMMISSION_RULE_PUBLISHED', 'COMMISSION_RULE', v_rule_id,
            jsonb_build_object('percentage', p_percentage, 'retention_days', p_retention_days,
                               'min_payout_amount', p_min_payout_amount, 'version_name', trim(p_version_name)));
    RETURN v_rule_id;
END;
$$;

CREATE OR REPLACE FUNCTION affiliate.register_profile(
    p_full_name TEXT,
    p_cpf_cnpj TEXT,
    p_paypal_email TEXT,
    p_address_city TEXT DEFAULT NULL,
    p_address_state TEXT DEFAULT NULL,
    p_terms_version TEXT DEFAULT '1.0'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = affiliate, public, pg_temp
AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
    IF NULLIF(trim(p_full_name), '') IS NULL OR length(p_full_name) > 160
       OR NULLIF(trim(p_cpf_cnpj), '') IS NULL OR length(p_cpf_cnpj) > 32
       OR p_paypal_email IS NULL OR length(trim(p_paypal_email)) > 254
       OR trim(p_paypal_email) !~* '^[A-Z0-9._%+%-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
       OR coalesce(p_terms_version, '') = '' THEN
        RAISE EXCEPTION 'invalid_affiliate_profile' USING ERRCODE = '22023';
    END IF;
    INSERT INTO affiliate.profiles(user_id, full_name, cpf_cnpj, paypal_email, address_city, address_state, terms_accepted_at, terms_version)
    VALUES (auth.uid(), trim(p_full_name), trim(p_cpf_cnpj), lower(trim(p_paypal_email)),
            NULLIF(trim(p_address_city), ''), NULLIF(upper(trim(p_address_state)), ''), now(), p_terms_version)
    RETURNING id INTO v_profile_id;
    RETURN v_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION affiliate.update_paypal_email(p_paypal_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = affiliate, public, pg_temp
AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
    IF p_paypal_email IS NULL OR length(trim(p_paypal_email)) > 254
       OR trim(p_paypal_email) !~* '^[A-Z0-9._%+%-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
        RAISE EXCEPTION 'invalid_paypal_email' USING ERRCODE = '22023';
    END IF;

    UPDATE affiliate.profiles
    SET paypal_email = lower(trim(p_paypal_email)), paypal_last_changed_at = now(), updated_at = now()
    WHERE user_id = auth.uid() AND active = true
    RETURNING id INTO v_profile_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'affiliate_profile_not_found'; END IF;

    INSERT INTO affiliate.audit_logs(admin_user_id, action, target_type, target_id, metadata)
    VALUES (auth.uid(), 'PAYPAL_EMAIL_CHANGED', 'AFFILIATE_PROFILE', v_profile_id,
            jsonb_build_object('email_updated', true));
END;
$$;

REVOKE ALL ON FUNCTION affiliate.admin_review_kyc(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION affiliate.admin_review_commission(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION affiliate.admin_publish_commission_rule(TEXT, NUMERIC, INT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION affiliate.register_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION affiliate.update_paypal_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION affiliate.admin_review_kyc(UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION affiliate.admin_review_commission(UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION affiliate.admin_publish_commission_rule(TEXT, NUMERIC, INT, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION affiliate.register_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION affiliate.update_paypal_email(TEXT) TO authenticated, service_role;

-- 3. Agendamento via pg_cron (execução diária às 06:00 UTC)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'affiliate-eligibility-check') THEN
      PERFORM cron.unschedule('affiliate-eligibility-check');
    END IF;

    PERFORM cron.schedule(
      'affiliate-eligibility-check',
      '0 6 * * *',
      'SELECT affiliate.process_matured_commissions();'
    );
  END IF;
END;
$$;

COMMIT;
