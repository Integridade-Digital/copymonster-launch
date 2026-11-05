-- ============================================================================
-- Migration: 052_affiliate_and_finance_schemas.sql
-- Description: Criação dos schemas affiliate e finance, tabelas, enums, índices,
--              políticas RLS (integradas com public.is_admin_or_owner()) e regra padrão.
-- ============================================================================

BEGIN;

-- 1. Schemas dedicados
CREATE SCHEMA IF NOT EXISTS affiliate;
CREATE SCHEMA IF NOT EXISTS finance;

-- Conceder uso aos papéis do Supabase
GRANT USAGE ON SCHEMA affiliate TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA finance TO authenticated, anon, service_role;

-- 2. Enums operacionais
DO $$ BEGIN
    CREATE TYPE affiliate.kyc_status AS ENUM (
        'PENDING',
        'APPROVED',
        'REJECTED',
        'SUSPENDED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE affiliate.commission_status AS ENUM (
        'HOLDING',
        'PENDING_VALIDATION',
        'ELIGIBLE',
        'PAID',
        'CANCELLED',
        'REFUNDED',
        'REJECTED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE finance.ledger_entry_type AS ENUM (
        'CREDIT',
        'DEBIT'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Tabela affiliate.profiles (Cadastro e KYC do Parceiro)
CREATE TABLE IF NOT EXISTS affiliate.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    cpf_cnpj TEXT NOT NULL,
    paypal_email TEXT NOT NULL,
    address_city TEXT,
    address_state TEXT,
    trust_score INT DEFAULT 100,
    kyc_status affiliate.kyc_status DEFAULT 'PENDING' NOT NULL,
    kyc_metadata JSONB DEFAULT '{}'::jsonb,
    terms_accepted_at TIMESTAMPTZ,
    terms_ip TEXT,
    terms_version TEXT DEFAULT '1.0',
    paypal_last_changed_at TIMESTAMPTZ,
    active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_affiliate_profiles_user_id ON affiliate.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_profiles_kyc_status ON affiliate.profiles(kyc_status);

-- 4. Tabela affiliate.commission_rules (Motor Dinâmico de Regras)
CREATE TABLE IF NOT EXISTS affiliate.commission_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_name TEXT NOT NULL,
    percentage NUMERIC(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
    retention_days INT NOT NULL DEFAULT 35 CHECK (retention_days >= 0),
    min_payout_amount NUMERIC(12,2) NOT NULL DEFAULT 50.00 CHECK (min_payout_amount >= 0),
    is_current BOOLEAN DEFAULT false NOT NULL,
    active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_rules_single_current 
ON affiliate.commission_rules(is_current) WHERE is_current = true;

-- 5. Tabela affiliate.commissions (Registro Operacional de Vendas)
CREATE TABLE IF NOT EXISTS affiliate.commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID REFERENCES affiliate.profiles(id) NOT NULL,
    stripe_event_id TEXT UNIQUE NOT NULL,
    stripe_invoice_id TEXT,
    amount_gross NUMERIC(12,2) NOT NULL,
    commission_amount NUMERIC(12,2) NOT NULL,
    status affiliate.commission_status DEFAULT 'HOLDING' NOT NULL,
    eligible_at TIMESTAMPTZ NOT NULL,
    risk_score INT DEFAULT 0,
    active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commissions_affiliate_id ON affiliate.commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON affiliate.commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_eligible_at ON affiliate.commissions(eligible_at);
CREATE INDEX IF NOT EXISTS idx_commissions_stripe_invoice_id ON affiliate.commissions(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;

-- 6. Tabela finance.ledger_entries (Livro-Razão Contábil Imutável)
CREATE TABLE IF NOT EXISTS finance.ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID REFERENCES affiliate.profiles(id) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    entry_type finance.ledger_entry_type NOT NULL,
    reference_type TEXT NOT NULL, -- 'COMMISSION', 'PAYOUT', 'REFUND', 'ADJUSTMENT'
    reference_id UUID NOT NULL,
    description TEXT,
    active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ledger_affiliate_id ON finance.ledger_entries(affiliate_id);
-- Proteções de unicidade contábil antifraude
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_commission_unique 
ON finance.ledger_entries (reference_id) WHERE reference_type = 'COMMISSION';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_payout_unique 
ON finance.ledger_entries (reference_id) WHERE reference_type = 'PAYOUT';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_refund_unique 
ON finance.ledger_entries (reference_id) WHERE reference_type = 'REFUND';

-- 7. Tabela finance.payout_requests (Solicitações e Execução de Saques)
CREATE TABLE IF NOT EXISTS finance.payout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID REFERENCES affiliate.profiles(id) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    paypal_email_snapshot TEXT NOT NULL,
    status TEXT DEFAULT 'REQUESTED' NOT NULL, -- 'REQUESTED', 'PROCESSING', 'EXECUTED', 'REJECTED', 'FAILED'
    risk_score INT DEFAULT 0,
    paypal_payout_batch_id TEXT,
    rejection_reason TEXT,
    active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payouts_affiliate_id ON finance.payout_requests(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON finance.payout_requests(status);

-- 8. Tabela affiliate.notifications (Notificações do Afiliado)
CREATE TABLE IF NOT EXISTS affiliate.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID REFERENCES affiliate.profiles(id) NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    read BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_affiliate_unread 
ON affiliate.notifications (affiliate_id, created_at DESC) WHERE NOT read;

-- 9. Tabela affiliate.audit_logs (Trilha de Auditoria Administrativa)
CREATE TABLE IF NOT EXISTS affiliate.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID,
    reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON affiliate.audit_logs(action);

-- 10. Concessões de permissões padrão nas tabelas
GRANT ALL ON ALL TABLES IN SCHEMA affiliate TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA finance TO authenticated, service_role;

-- 11. Semeando a Regra Vigente Padrão (30% / 35 dias / $50 min)
INSERT INTO affiliate.commission_rules (
    version_name,
    percentage,
    retention_days,
    min_payout_amount,
    is_current,
    active
)
SELECT 'v1 - Default 2026', 30.00, 35, 50.00, true, true
WHERE NOT EXISTS (
    SELECT 1 FROM affiliate.commission_rules WHERE is_current = true
);

-- ============================================================================
-- POLÍTICAS DE SEGURANÇA ROW LEVEL SECURITY (RLS)
-- Integradas com public.is_admin_or_owner() de copymonster-launch
-- ============================================================================

ALTER TABLE affiliate.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate.commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate.audit_logs ENABLE ROW LEVEL SECURITY;

-- Regras para affiliate.profiles
CREATE POLICY "affiliate_profiles_select_own" ON affiliate.profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR public.is_admin_or_owner());

CREATE POLICY "affiliate_profiles_insert_self" ON affiliate.profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id AND kyc_status = 'PENDING');

CREATE POLICY "affiliate_profiles_update_own" ON affiliate.profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id OR public.is_admin_or_owner())
    WITH CHECK (
        public.is_admin_or_owner() OR (
            auth.uid() = user_id AND 
            kyc_status = (SELECT p.kyc_status FROM affiliate.profiles p WHERE p.id = affiliate.profiles.id)
        )
    );

-- Regras para affiliate.commission_rules
CREATE POLICY "commission_rules_read_current" ON affiliate.commission_rules
    FOR SELECT TO authenticated
    USING (is_current = true OR public.is_admin_or_owner());

CREATE POLICY "commission_rules_admin_manage" ON affiliate.commission_rules
    FOR ALL TO authenticated
    USING (public.is_admin_or_owner());

-- Regras para affiliate.commissions
CREATE POLICY "commissions_select_own" ON affiliate.commissions
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM affiliate.profiles p 
            WHERE p.id = affiliate.commissions.affiliate_id AND p.user_id = auth.uid()
        )
        OR public.is_admin_or_owner()
    );

CREATE POLICY "commissions_admin_manage" ON affiliate.commissions
    FOR ALL TO authenticated
    USING (public.is_admin_or_owner());

-- Regras para finance.ledger_entries
CREATE POLICY "ledger_select_own" ON finance.ledger_entries
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM affiliate.profiles p 
            WHERE p.id = finance.ledger_entries.affiliate_id AND p.user_id = auth.uid()
        )
        OR public.is_admin_or_owner()
    );

CREATE POLICY "ledger_admin_manage" ON finance.ledger_entries
    FOR ALL TO authenticated
    USING (public.is_admin_or_owner());

-- Regras para finance.payout_requests
CREATE POLICY "payouts_select_own" ON finance.payout_requests
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM affiliate.profiles p 
            WHERE p.id = finance.payout_requests.affiliate_id AND p.user_id = auth.uid()
        )
        OR public.is_admin_or_owner()
    );

CREATE POLICY "payouts_insert_own" ON finance.payout_requests
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM affiliate.profiles p 
            WHERE p.id = finance.payout_requests.affiliate_id 
              AND p.user_id = auth.uid() 
              AND p.kyc_status = 'APPROVED'
              AND p.active = true
        )
    );

CREATE POLICY "payouts_admin_manage" ON finance.payout_requests
    FOR ALL TO authenticated
    USING (public.is_admin_or_owner());

-- Regras para affiliate.notifications
CREATE POLICY "notifications_select_own" ON affiliate.notifications
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM affiliate.profiles p 
            WHERE p.id = affiliate.notifications.affiliate_id AND p.user_id = auth.uid()
        )
        OR public.is_admin_or_owner()
    );

CREATE POLICY "notifications_update_own" ON affiliate.notifications
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM affiliate.profiles p 
            WHERE p.id = affiliate.notifications.affiliate_id AND p.user_id = auth.uid()
        )
    );

-- Regras para affiliate.audit_logs
CREATE POLICY "audit_logs_admin_only" ON affiliate.audit_logs
    FOR ALL TO authenticated
    USING (public.is_admin_or_owner());

COMMIT;
