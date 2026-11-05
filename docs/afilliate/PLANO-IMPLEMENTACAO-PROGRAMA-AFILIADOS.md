# PLANO DE IMPLEMENTAÇÃO: PROGRAMA DE AFILIADOS E PARCEIROS COPYMONSTER
*Documento de Especificação Técnica, Arquitetural e Plano de Ação Passo a Passo para o repositório `copymonster-launch`.*

---

## 1. RESUMO EXECUTIVO E VISÃO GERAL DA ARQUITETURA

O **Programa de Afiliados e Parceiros CopyMonster** é um sistema financeiro e operacional de afiliados corporativo, desenvolvido sob os mais rigorosos padrões de confiabilidade contábil, rastreabilidade e prevenção contra fraudes.

Ele adota o conceito de **Double-Entry Ledger (Livro-Razão Contábil Imutável com Partidas Dobradas)**, distribuído em dois schemas isolados no PostgreSQL/Supabase:
- **`affiliate`**: Responsável pelo cadastro dos parceiros, dados de compliance e KYC (CPF/CNPJ, termos jurídicos), motor dinâmico de regras de comissões, rastreamento operacional de conversões, auditoria administrativa e notificações.
- **`finance`**: Livro contábil financeiro imutável (`ledger_entries`) e esteira de liquidação/execução de saques (`payout_requests`).

### 1.1 As 3 Integrações Vitais
1. **Stripe**: Captura transações via webhook (`invoice.paid` / `invoice.payment_succeeded`), vincula faturas ao parceiro com retenção programada de 35 dias e estorna/cancela créditos automaticamente em caso de chargeback ou reembolso (`charge.refunded`).
2. **PayPal Payouts REST API (v1)**: Liquidação automatizada e em lote de resgates para os parceiros, com suporte nativo a modo sandbox/mock para testes seguros sem movimentação financeira real.
3. **Agendador de Elegibilidade (pg_cron / Daemon de Conciliação)**: Rotina diária que identifica comissões cujo período de carência expirou e as move de `HOLDING` para `PENDING_VALIDATION`.

---

## 2. PONTOS CRÍTICOS DE ADAPTAÇÃO AO COPYMONSTER-LAUNCH

A análise comparativa entre o mapeamento do projeto legado e o código do `copymonster-launch` identificou **três pontos fundamentais de adaptação estrutural** que foram solucionados neste plano:

### 2.1 Identidade e Autorização de Administrador (Eliminação do Legado `public.user_roles`)
- **Problema no Legado**: O projeto antigo validava privilégios administrativos consultando a tabela `public.user_roles` (`WHERE role = 'admin'`). Essa tabela **não existe** no `copymonster-launch`.
- **Solução no CopyMonster**: O `copymonster-launch` implementa o controle de acesso de plataforma através da função canônica `public.is_admin_or_owner()`, introduzida e blindada nas migrations `025_security_and_role_hardening.sql` e `040_admin_flag_and_rls.sql`. Esta função valida:
  1. Se o usuário autenticado (`auth.uid()`) é `owner` ou `admin` no tenant de infraestrutura da plataforma (`00000000-0000-0000-0000-000000000001`); OU
  2. Se possui a flag booleana `public.users.metadata ->> 'is_admin' = 'true'`.
- **Implementação**: Todas as políticas RLS dos schemas `affiliate` e `finance` serão parametrizadas exclusivamente via `public.is_admin_or_owner()`.

### 2.2 Unificação de Stripe & Billing (Fusão com `packages/api/auth-http/src/billing.ts`)
- **Problema no Legado**: O projeto legado possuía um webhook separado (`stripe-to-affiliate`) e uma função isolada de checkout (`create-checkout-session`).
- **Solução no CopyMonster**: O `copymonster-launch` já possui um subsistema robusto de faturamento em `packages/api/auth-http/src/billing.ts` atendendo a rotas do Cordis WebServer (`/api/billing/checkout`, `/api/billing/portal`, `/api/billing/webhook`), com verificação de assinatura HMAC-SHA256, limites de payload (`readBoundedBody`) e manipulação de assinaturas de tenants.
- **Implementação**:
  1. O endpoint `/api/billing/checkout` recebe o parâmetro opcional `affiliateId` vindo do frontend e o grava em `metadata[affiliate_id]` e `subscription_data[metadata][affiliate_id]` da sessão do Stripe.
  2. O manipulador `handleWebhook` processa tanto a sincronização de planos dos tenants quanto os eventos de afiliados (`invoice.paid` / `invoice.payment_succeeded` e `charge.refunded`), garantindo um único endpoint de webhook no Stripe para todo o ecossistema.

### 2.3 Integração Visual no Shell do CopyMonster (Frontend DSH Web)
- **Problema no Legado**: Painel construído como páginas isoladas sob React/Tailwind padrão com rotas `/dashboard/partners` e `/admin/partners`.
- **Solução no CopyMonster**: O `copymonster-launch` é uma aplicação React moderna com temas unificados em `cm-theme.css`, modal de administração centralizado (`AdminModal.tsx`) e slots dinâmicos do Cordis Client (`settings.profile.item`, `settings.plans.item`, `sidebar.footer.action`).
- **Implementação**:
  1. **Painel do Afiliado**: Criado como componente overlay modal ou item de configurações (`AffiliateModal` / `AffiliateSettingsItem`), utilizando a paleta de variáveis CSS do CopyMonster (`--cm-card-bg`, `--cm-border-color`, `--cm-primary`).
  2. **Painel Administrativo**: Integrado como uma nova aba dedicada no `AdminModal.tsx` (`AdminAffiliateTab`), contendo as 5 esteiras operacionais em sub-abas (Afiliados, KYC, Validação, Saques e Motor de Regras).

---

## 3. REGRAS DE NEGÓCIO E POLÍTICAS FINANCEIRAS

### 3.1 Percentual de Comissão e Dinamismo de Regras
- **Regra Padrão (v1 - Default 2026)**:
  - **Percentual**: **30%** sobre o valor líquido faturado pelo Stripe (`invoice.amount_paid`).
  - **Carência**: **35 dias** de retenção para elegibilidade.
  - **Saque Mínimo**: **$50.00 USD**.
- **Gestão No-Code**: A regra ativa é lida dinamicamente da tabela `affiliate.commission_rules` (`is_current = true`). O administrador pode publicar novas versões pelo painel sem necessidade de deploy ou reinicialização de serviços.

### 3.2 Janela de Atribuição e Tracking
1. O visitante acessa qualquer página pública ou de login/cadastro com a query `?ref=<AFFILIATE_UUID>` (ex: `https://app.copymonster.co/register?ref=UUID`).
2. O identificador é armazenado defensivamente no `localStorage` sob a chave `affiliate_ref`.
3. Na contratação de qualquer plano em `PlansPage.tsx`, esse identificador é enviado ao backend e propagado aos metadados do Stripe.

### 3.3 Carência e Esteira em Duas Fases (Proteção Antifraude)
- **Período de Carência (35 dias)**: A garantia contratual ao consumidor final do CopyMonster é de 7 dias. A carência de 35 dias protege a empresa contra cancelamentos tardios, chargebacks bancários e disputas.
- **Ciclo de Vida das Comissões**:
  ```
  [Venda Stripe: invoice.paid]
               │
               ▼
       Status: HOLDING (eligible_at = now() + 35 dias)
               │ (35 dias decorridos)
               ▼
     [Cron Job Diário 06:00 UTC]
               │
               ▼
  Status: PENDING_VALIDATION (Fila de Auditoria Admin)
               │
      ┌────────┴────────┐
      ▼                 ▼
  [Aprovar]         [Rejeitar]
      │                 │
      ▼                 ▼
  Status: ELIGIBLE  Status: CANCELLED
  + CREDIT no       (Sem crédito)
    Ledger Contábil
  ```
- **Imutabilidade Financeira**: O valor vendido **NUNCA** ingressa como saldo disponível durante as fases `HOLDING` ou `PENDING_VALIDATION`. O saldo contábil só é incrementado no momento exato da aprovação manual pelo administrador, gerando uma entrada irremovível de `CREDIT` na tabela `finance.ledger_entries`.

### 3.4 Políticas de Resgate e Saque (Payout)
- **Pré-requisitos Mandatórios para Solicitar Saque**:
  1. Status KYC aprovado (`kyc_status = 'APPROVED'`).
  2. E-mail PayPal válido cadastrado e confirmado no perfil.
  3. Saldo disponível maior ou igual a `$50.00 USD`.
  4. Nenhuma outra solicitação de saque em andamento (`REQUESTED`, `APPROVED` ou `PROCESSING`).
- **Execução do Pagamento**:
  1. O administrador revisa o pedido na aba de saques.
  2. O sistema aplica trava atômica otimista atualizando o status para `PROCESSING`.
  3. Dispara a chamada para a API REST do PayPal Payouts (`POST /v1/payments/payouts`).
  4. Após a confirmação de recebimento do lote pelo PayPal, o status é alterado para `EXECUTED` gravando o `paypal_payout_batch_id`.
  5. Insere imediatamente uma linha de `DEBIT` com `reference_type = 'PAYOUT'` no ledger contábil, garantindo a baixa exata do saldo.

### 3.5 Política de Estornos e Reembolsos (`charge.refunded`)
Quando o cliente solicita estorno no cartão ou reembolso na Stripe:
- **Cenário A (Comissão em `HOLDING` ou `PENDING_VALIDATION`)**:
  - O status da comissão é atualizado para `REFUNDED`.
  - Como a comissão ainda não havia gerado crédito no ledger, nenhum ajuste financeiro adicional é necessário.
- **Cenário B (Comissão já aprovada em `ELIGIBLE`)**:
  - O status da comissão é alterado para `REFUNDED`.
  - O sistema insere automaticamente uma partida compensatória de `DEBIT` com `reference_type = 'REFUND'` no `finance.ledger_entries`, reduzindo o saldo do afiliado.
  - O índice único parcial `idx_ledger_refund_unique` garante que cada comissão só possa sofrer estorno uma única vez.
  - O afiliado recebe uma notificação explicativa em `affiliate.notifications`.

---

## 4. MODELO DE DADOS: MIGRATION 052 NO SUPABASE

A implementação no banco de dados será adicionada como `supabase/migrations/052_affiliate_and_finance_schemas.sql`, respeitando o padrão sequencial do repositório.

```sql
-- ============================================================================
-- Migration: 052_affiliate_and_finance_schemas.sql
-- Description: Sistema de Afiliados e Livro Contábil (Double-Entry Ledger)
-- Security: Integração direta com public.is_admin_or_owner() e RLS estrito.
-- ============================================================================

BEGIN;

-- 1. Criação dos Schemas Isolados
CREATE SCHEMA IF NOT EXISTS affiliate;
CREATE SCHEMA IF NOT EXISTS finance;

GRANT USAGE ON SCHEMA affiliate TO authenticated, service_role;
GRANT USAGE ON SCHEMA finance TO authenticated, service_role;

-- 2. Criação dos Tipos Enumerados
DO $$ BEGIN
    CREATE TYPE affiliate.commission_status AS ENUM (
        'HOLDING',
        'PENDING_VALIDATION',
        'ELIGIBLE',
        'CANCELLED',
        'REFUNDED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE affiliate.kyc_status AS ENUM (
        'PENDING',
        'APPROVED',
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

-- 10. Semeando a Regra Vigente Padrão (30% / 35 dias / $50 min)
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
```

---

## 5. INTEGRAÇÃO DE BACKEND E UNIFICAÇÃO DE BILLING NO COPYMONSTER

### 5.1 Propagação do Afiliado no Checkout (`packages/api/auth-http/src/billing.ts`)
No manipulador `handleCheckout`, o payload recebido passa a aceitar `affiliateId`. Quando presente e com formato válido de UUID, é injetado nos metadados da sessão Stripe:

```typescript
// Leitura do identificador do afiliado do corpo da requisição
const parsedBody = parseJsonObject(raw)
const affiliateId = optionalString(parsedBody ?? {}, 'affiliateId')

// Criação da Checkout Session com metadata de rastreamento
const sessionParams: Record<string, string | number | boolean | undefined> = {
  customer: customerId,
  mode: 'subscription',
  'payment_method_types[0]': 'card',
  'line_items[0][price]': priceId,
  'line_items[0][quantity]': 1,
  success_url: `${PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${PUBLIC_APP_URL}/billing/cancel`,
  'metadata[tenant_id]': identity.tenantId,
  'metadata[user_id]': identity.userId,
  'subscription_data[metadata][tenant_id]': identity.tenantId,
}

if (affiliateId !== undefined && /^[0-9a-f-]{36}$/i.test(affiliateId)) {
  sessionParams['metadata[affiliate_id]'] = affiliateId
  sessionParams['subscription_data[metadata][affiliate_id]'] = affiliateId
}

const session = await callStripe('/checkout/sessions', sessionParams, stripeKey)
```

### 5.2 Expansão do Webhook Stripe em `billing.ts` (`handleWebhook`)
O webhook do Stripe unificado trata eventos de assinaturas de tenants e, em paralelo, aciona o processador de afiliados:

```typescript
// Dentro do switch(eventType) em handleWebhook:

case 'invoice.payment_succeeded':
case 'invoice.paid': {
  // 1. Manutenção do ciclo de tokens do tenant existente
  const customerId = optionalString(object, 'customer')
  if (optionalString(object, 'billing_reason') === 'subscription_cycle' && customerId !== undefined) {
    await supabaseAdminClient
      .from('tenants')
      .update({
        current_period_tokens_used: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_customer_id', customerId)
  }

  // 2. Processamento do Comissionamento de Afiliados
  await processAffiliateCommissionFromInvoice(object, payload['id'] as string)
  break
}

case 'charge.refunded': {
  // Processamento de Reembolso e Estorno de Afiliados
  await processAffiliateRefundFromCharge(object)
  break
}
```

### 5.3 Lógica de Negócio do Processador de Comissões
Função modular executada com service-role no servidor do CopyMonster:

```typescript
async function processAffiliateCommissionFromInvoice(
  invoice: Record<string, unknown>,
  stripeEventId: string
): Promise<void> {
  const metadata = asObject(invoice['metadata'])
  const lines = arrayField(asObject(invoice['lines']), 'data')
  const subscriptionMetadata = lines.length > 0 
    ? asObject(asObject(lines[0])['metadata']) 
    : {}

  const affiliateId = optionalString(metadata, 'affiliate_id') 
    ?? optionalString(subscriptionMetadata, 'affiliate_id')

  if (!affiliateId) return // Venda orgânica ou sem afiliação

  // 1. Idempotência estrita pelo stripe_event_id
  const { data: existing } = await supabaseAdminClient
    .from('affiliate.commissions')
    .select('id')
    .eq('stripe_event_id', stripeEventId)
    .maybeSingle()

  if (existing) return

  // 2. Validação do Parceiro: ativo e KYC aprovado
  const { data: profile } = await supabaseAdminClient
    .from('affiliate.profiles')
    .select('id, active, kyc_status')
    .eq('id', affiliateId)
    .maybeSingle()

  if (!profile || !profile.active || profile.kyc_status !== 'APPROVED') {
    // Registra tentativa recusada para fins de auditoria
    await supabaseAdminClient.from('affiliate.audit_logs').insert({
      action: 'COMMISSION_REJECTED_UNAUTHORIZED',
      target_type: 'affiliate_profile',
      target_id: affiliateId,
      reason: !profile ? 'Profile not found' : `Profile status: active=${profile.active}, kyc=${profile.kyc_status}`,
      metadata: { invoiceId: invoice['id'], eventId: stripeEventId },
    })
    return
  }

  // 3. Busca da Regra de Comissão Vigente
  const { data: rule } = await supabaseAdminClient
    .from('affiliate.commission_rules')
    .select('percentage, retention_days')
    .eq('is_current', true)
    .eq('active', true)
    .single()

  const percentage = Number(rule?.percentage ?? 30.0)
  const retentionDays = Number(rule?.retention_days ?? 35)

  // 4. Cálculo da Comissão sobre valor líquido faturado
  const amountPaidCents = Number(invoice['amount_paid'] ?? 0)
  const grossAmount = amountPaidCents / 100
  const commissionAmount = Number(((grossAmount * percentage) / 100).toFixed(2))

  if (commissionAmount <= 0) return

  const eligibleAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString()

  // 5. Persistência Operacional em HOLDING
  await supabaseAdminClient.from('affiliate.commissions').insert({
    affiliate_id: profile.id,
    stripe_event_id: stripeEventId,
    stripe_invoice_id: optionalString(invoice, 'id') ?? null,
    amount_gross: grossAmount,
    commission_amount: commissionAmount,
    status: 'HOLDING',
    eligible_at: eligibleAt,
  })

  // 6. Notificação ao Afiliado
  await supabaseAdminClient.from('affiliate.notifications').insert({
    affiliate_id: profile.id,
    type: 'COMMISSION_EARNED',
    title: 'Nova comissão registrada!',
    message: `Você recebeu uma comissão de $${commissionAmount.toFixed(2)} USD em retenção de garantia.`,
    metadata: { gross: grossAmount, retentionDays },
  })
}
```

---

## 6. INTEGRAÇÃO COM PAYPAL: EXECUÇÃO DE SAQUES

A distribuição de resgates é processada diretamente pela API REST do PayPal (**PayPal Payouts REST API v1**), com suporte a modo de simulação (`PAYPAL_MOCK`).

### 6.1 Variáveis de Ambiente no Servidor
```env
PAYPAL_CLIENT_ID=seu_client_id_paypal
PAYPAL_CLIENT_SECRET=seu_client_secret_paypal
PAYPAL_MODE=live          # 'sandbox' ou 'live'
PAYPAL_MOCK=false         # se 'true', simula o lote sem debitar saldo real
```

### 6.2 Rotina de Execução de Saques (`payout-executor`)
Executada exclusivamente por requisições autenticadas de administradores:

1. **Trava Concorrente Atômica**:
   ```sql
   UPDATE finance.payout_requests
   SET status = 'PROCESSING', updated_at = now()
   WHERE id = _payout_id AND status IN ('REQUESTED', 'APPROVED')
   RETURNING id, amount, affiliate_id, paypal_email_snapshot;
   ```
2. **Autenticação OAuth2 no PayPal**:
   - Requisição `POST /v1/oauth2/token` com HTTP Basic Auth (`btoa(`${CLIENT_ID}:${SECRET}`)`).
   - `grant_type=client_credentials`.
3. **Disparo do Lote via API REST**:
   - `POST /v1/payments/payouts`
   - Payload:
     ```json
     {
       "sender_batch_header": {
         "sender_batch_id": "<PAYOUT_UUID>",
         "email_subject": "CopyMonster - Saque de Afiliado Processado",
         "email_message": "Seu pagamento de comissões do CopyMonster foi enviado com sucesso via PayPal."
       },
       "items": [
         {
           "recipient_type": "EMAIL",
           "amount": { "value": "50.00", "currency": "USD" },
           "receiver": "email_afiliado@paypal.com",
           "note": "CopyMonster Affiliate Payout"
         }
       ]
     }
     ```
4. **Baixa Contábil no Livro-Razão**:
   Ao receber status `SUCCESS` ou `PENDING` do lote com `payout_batch_id`:
   ```typescript
   // Atualiza o pedido de saque
   await supabaseAdminClient
     .from('finance.payout_requests')
     .update({
       status: 'EXECUTED',
       paypal_payout_batch_id: batchId,
       updated_at: new Date().toISOString(),
     })
     .eq('id', payoutId)

   // Registra débito compensatório imutável no ledger
   await supabaseAdminClient.from('finance.ledger_entries').insert({
     affiliate_id: payout.affiliate_id,
     amount: payout.amount,
     entry_type: 'DEBIT',
     reference_type: 'PAYOUT',
     reference_id: payout.id,
     description: `PayPal Payout to ${payout.paypal_email_snapshot} (batch: ${batchId})`,
   })
   ```

---

## 7. AGENDADOR DE ELEGIBILIDADE (CRON JOB DE CARÊNCIA)

Diariamente às **06:00 UTC**, o sistema identifica comissões que completaram o prazo de retenção e as promove para a fila de validação humana:

### 7.1 Procedimento Armazenado no PostgreSQL
```sql
CREATE OR REPLACE FUNCTION affiliate.process_matured_commissions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _count INT;
BEGIN
    -- Promove comissões que atingiram a maturidade temporal
    WITH updated AS (
        UPDATE affiliate.commissions
        SET status = 'PENDING_VALIDATION', updated_at = now()
        WHERE status = 'HOLDING'
          AND eligible_at <= now()
          AND active = true
        RETURNING id, affiliate_id, commission_amount
    )
    SELECT count(*) INTO _count FROM updated;

    -- Gera notificações automáticas
    INSERT INTO affiliate.notifications (affiliate_id, type, title, message)
    SELECT 
        affiliate_id,
        'COMMISSION_PENDING_VALIDATION',
        'Comissão em validação!',
        'Sua comissão de 35 dias cumpriu a carência e está em conferência final para liberação no saldo.'
    FROM affiliate.commissions
    WHERE status = 'PENDING_VALIDATION' AND updated_at >= now() - INTERVAL '1 minute';

    RETURN _count;
END;
$$;
```

### 7.2 Agendamento via `pg_cron`
```sql
SELECT cron.schedule(
    'affiliate-eligibility-check',
    '0 6 * * *',
    $$ SELECT affiliate.process_matured_commissions(); $$
);
```

---

## 8. ARQUITETURA DE FRONTEND NO COPYMONSTER

### 8.1 Captura Global de `?ref=` nas Páginas Públicas
No carregamento de rotas de entrada (`main.tsx` ou em hook global):
```typescript
export function captureAffiliateReferral(): void {
  if (typeof window === 'undefined') return
  try {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
      localStorage.setItem('affiliate_ref', ref)
    }
  } catch {}
}
```

### 8.2 Injeção de `affiliateId` no Checkout (`PlansPage.tsx`)
Na função `handleInitiateCheckout` de `apps/web/src/pages/billing/PlansPage.tsx`:
```typescript
const affiliateRef = typeof window !== 'undefined' ? localStorage.getItem('affiliate_ref') : null

const response = await fetch('/api/billing/checkout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    priceId,
    successUrl: `${host}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${host}/billing/cancel`,
    ...(affiliateRef ? { affiliateId: affiliateRef } : {}),
  }),
})
```

### 8.3 Painel do Parceiro (`AffiliateDashboard`)
Componente acessível pelo usuário no painel de configurações ou via rota `/affiliate`:
- **Modo 1 (Usuário Não Cadastrado)**:
  - Apresenta os termos de adesão e formulário de KYC: Nome Completo, CPF/CNPJ, E-mail PayPal, Cidade/UF e checkbox de aceite obrigatório de termos.
  - Ao submeter, cria o perfil em `affiliate.profiles` com status `PENDING`.
- **Modo 2 (Usuário Cadastrado)**:
  - Link de rastreamento exclusivo com botão de cópia de um clique (`https://app.copymonster.co/register?ref=UUID`).
  - Cards de Resumo Financeiro:
    - **Em Retenção**: Soma de comissões em `HOLDING` e `PENDING_VALIDATION`.
    - **Saldo Disponível**: Cálculo real do livro contábil: $\sum 	ext{CREDIT} - \sum 	ext{DEBIT}$.
    - **Total Já Pago**: Total histórico de resgates liquidados com sucesso.
  - Botão **"Solicitar Saque"**: Habilitado dinamicamente quando `Saldo >= $50.00`, `KYC === APPROVED` e não há saques pendentes.
  - Tabela de Transparência de Comissões com **barra de progresso temporal regressiva** indicando os dias restantes da retenção de 35 dias.

### 8.4 Painel Administrativo (`AdminAffiliateTab.tsx`)
Integrado no `AdminModal.tsx` como uma nova aba no menu lateral com o ícone `🤝` e 5 esteiras operacionais:
1. **Afiliados (`AffiliatesList`)**: Visão consolidada da base de parceiros, status KYC, e-mail PayPal e data de adesão.
2. **KYC (`KycApprovalQueue`)**: Fila de documentos com botões rápidos para Aprovar ou Rejeitar cadastros pendentes.
3. **Validação de Créditos (`ValidationQueue`)**: Fila de comissões maduras (`PENDING_VALIDATION`). Ação de "Aprovar" grava a entrada atômica de `CREDIT` no `finance.ledger_entries`.
4. **Fila de Saques (`PayoutQueue`)**: Pedidos de saque com botão "Processar via PayPal" disparando o `payout-executor`.
5. **Motor de Regras (`RuleEngine`)**: Ajuste sem código da % de comissão (30%), dias de retenção (35) e saque mínimo ($50).

---

## 9. PLANO DE AÇÃO PASSO A PASSO (ROADMAP DE EXECUÇÃO)

O plano de ação está estruturado em **6 fases sequenciais** prontas para execução:

```
┌─────────────────────────────────────────────────────────────┐
│ FASE 1: Banco de Dados & RLS (Migration 052)                │
│ - Criar schemas affiliate e finance                         │
│ - Criar tabelas, enums e índices de proteção contábil       │
│ - Aplicar RLS integrado com public.is_admin_or_owner()      │
│ - Semear regra padrão (30% / 35 dias / $50 min)             │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 2: Backend e Unificação de Webhook Stripe              │
│ - Atualizar handleCheckout em billing.ts com affiliateId    │
│ - Expandir handleWebhook para invoice.paid e charge.refunded│
│ - Implementar processamento com verificação de KYC e regras │
│ - Implementar estorno contábil no ledger em reembolsos      │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 3: Motor PayPal Payouts & Cron de Carência             │
│ - Configurar integração PayPal REST API v1 (OAuth2 + Mock)  │
│ - Criar rotina de execução de saques com trava otimista     │
│ - Configurar process_matured_commissions() via pg_cron      │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 4: Frontend do Afiliado & Rastreamento                 │
│ - Adicionar captura de ?ref= na entrada da aplicação        │
│ - Injetar affiliateId na chamada de PlansPage.tsx           │
│ - Desenvolver AffiliateDashboard.tsx com KYC e barra de 35d │
│ - Conectar botão "Solicitar Saque" ao backend               │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 5: Frontend Administrativo no AdminModal               │
│ - Criar AdminAffiliateTab.tsx com as 5 sub-abas             │
│ - Adicionar a aba 'affiliate' ao menu lateral de AdminModal │
│ - Conectar aprovações de KYC, Comissões e Saques            │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 6: Homologação, Testes e Auditoria Final               │
│ - Testar fluxo de ponta a ponta em Stripe Test Mode         │
│ - Testar execução de saques com PAYPAL_MOCK=true            │
│ - Validar concorrência, idempotência e saldo do ledger      │
│ - Realizar deploy em produção                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. MATRIZ DE TESTES E CRITÉRIOS DE ACEITE

| Requisito | Cenário de Teste | Critério de Aceite |
| :--- | :--- | :--- |
| **Atribuição** | Acessar com `?ref=<UUID>` e contratar plano | O ID do afiliado é gravado em `metadata[affiliate_id]` da fatura Stripe. |
| **Bloqueio KYC** | Venda atribuída a afiliado com `kyc_status = 'PENDING'` | Webhook não cria comissão e registra log de auditoria `COMMISSION_REJECTED_UNAUTHORIZED`. |
| **Cálculo de Comissão** | Fatura de $100.00 paga na Stripe | Cria comissão de $30.00 em status `HOLDING` com data de elegibilidade para +35 dias. |
| **Carência de 35 dias** | Comissão em `HOLDING` com `eligible_at <= now()` | Cron promove para `PENDING_VALIDATION` sem alterar saldo do parceiro. |
| **Aprovação de Crédito** | Admin aprova comissão na `ValidationQueue` | Comissão passa para `ELIGIBLE` e insere entrada única de `CREDIT` no `finance.ledger_entries`. Saldo disponível aumenta. |
| **Proteção de Duplicidade** | Tentativa de aprovar a mesma comissão duas vezes | O índice único `idx_ledger_commission_unique` bloqueia a operação, preservando a integridade do saldo. |
| **Reembolso em Retenção** | Recebimento de `charge.refunded` com comissão em `HOLDING` | Atualiza status para `REFUNDED`. Nenhum lançamento contábil é realizado. |
| **Reembolso após Aprovação** | Recebimento de `charge.refunded` com comissão em `ELIGIBLE` | Atualiza status para `REFUNDED` e lança automaticamente `DEBIT` no ledger contábil. |
| **Saque Mínimo** | Afiliado com saldo de $40.00 tenta solicitar saque | Interface desabilita o botão e API rejeita com erro de valor inferior a $50.00. |
| **Controle de Concorrência** | Afiliado com saque em `REQUESTED` tenta novo pedido | API bloqueia nova solicitação enquanto houver pedido aberto. |
| **Liquidação PayPal** | Admin clica em "Pagar" na fila de saques | Pedido assume `PROCESSING`, lote é enviado ao PayPal, muda para `EXECUTED` e lança `DEBIT` no ledger. |
| **Segurança RLS** | Afiliado tenta ler comissões ou perfis de outros usuários | Supabase RLS bloqueia e retorna apenas os registros onde `user_id = auth.uid()`. |

---
*Documento preparado com especificações completas para a arquitetura do CopyMonster.*
