-- ============================================================================
-- Migration: 051_backfill_plan_stripe_prices.sql
-- Description: Preenche os `stripe_price_id` dos planos pagos e garante que
--              nenhum tenant fica sem plano.
--
-- Contexto: `handleCheckout` resolve o preço a partir de
--   `tenants.plan_id -> plans.stripe_price_id`. Os planos estavam com a coluna
--   vazia em produção, então todo checkout respondia `plan_not_billable` e a
--   aba Plans não conseguia abrir a Stripe Checkout Session.
--
--   Os IDs abaixo são os preços mensais e anuais vivos no dashboard Stripe
--   (mesmos valores de `monthly_price_cents`/`annual_price_cents` do plano).
--   `enterprise` e `free` ficam sem preço de propósito: são vendidos fora da
--   Checkout API.
--
--   O `UPDATE` só toca linhas ainda vazias, para não sobrescrever um ID
--   trocado depois no dashboard.
-- ============================================================================

BEGIN;

UPDATE public.plans SET
  stripe_price_id = 'price_1UTC71RiKNxooUH00Xd4MPwZ',
  stripe_price_id_monthly = 'price_1UTC71RiKNxooUH00Xd4MPwZ',
  stripe_price_id_annual = 'price_1UTCD7RiKNxooUH01oFkwQC6'
WHERE slug = 'starter' AND stripe_price_id IS NULL;

UPDATE public.plans SET
  stripe_price_id = 'price_1UTCEuRiKNxooUH05uZv8GY7',
  stripe_price_id_monthly = 'price_1UTCEuRiKNxooUH05uZv8GY7',
  stripe_price_id_annual = 'price_1UTCGWRiKNxooUH0cJaaDUPy'
WHERE slug = 'pro' AND stripe_price_id IS NULL;

UPDATE public.plans SET
  stripe_price_id = 'price_1UTCIDRiKNxooUH0ZOQhFsPa',
  stripe_price_id_monthly = 'price_1UTCIDRiKNxooUH0ZOQhFsPa',
  stripe_price_id_annual = 'price_1UTCJmRiKNxooUH0EP1P1vpx'
WHERE slug = 'legend' AND stripe_price_id IS NULL;

-- Um tenant sem plano não tem preço para cobrar. O Pro é o plano do período
-- de teste, então é também o destino da atribuição.
UPDATE public.tenants
SET
  plan_id = (SELECT id FROM public.plans WHERE slug = 'pro'),
  subscription_status = COALESCE(subscription_status, 'trialing'),
  trial_ends_at = COALESCE(trial_ends_at, now() + interval '7 days')
WHERE plan_id IS NULL;

COMMIT;
