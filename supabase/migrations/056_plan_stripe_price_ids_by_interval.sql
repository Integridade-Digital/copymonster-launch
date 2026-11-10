-- ============================================================================
-- Migration: 056_plan_stripe_price_ids_by_interval.sql
-- Description: Alinha os price ids vivos do Stripe com os planos e preenche a
--              coluna anual, que o checkout usa quando o cliente pede
--              `interval: 'annual'`.
--
-- Contexto: `handleCheckout` resolve o preço a partir do plano e intervalo
-- pedidos (`plans.stripe_price_id_monthly` ou `plans.stripe_price_id_annual`).
-- A migração 051 preencheu apenas a coluna mensal, pelo que um pedido anual
-- respondia `plan_not_billable`. Os valores abaixo são os mesmos anunciados na
-- aba Plans ($29/$89/$189 mensais e $324/$924/$2.244 anuais).
--
-- `stripe_price_id` continua a receber o preço mensal: é a coluna legada que o
-- webhook e os relatórios leem.
-- ============================================================================

BEGIN;

UPDATE public.plans SET
  stripe_price_id = 'price_1UTC71RiKNxooUH00Xd4MPwZ',
  stripe_price_id_monthly = 'price_1UTC71RiKNxooUH00Xd4MPwZ',
  stripe_price_id_annual = 'price_1UaLbURiKNxooUH0zCS6Ot3Q',
  monthly_price_cents = 2900,
  annual_price_cents = 32400
WHERE slug = 'starter';

UPDATE public.plans SET
  stripe_price_id = 'price_1UaLTgRiKNxooUH0HoaNi0o3',
  stripe_price_id_monthly = 'price_1UaLTgRiKNxooUH0HoaNi0o3',
  stripe_price_id_annual = 'price_1UaLelRiKNxooUH0OssIvKeK',
  monthly_price_cents = 8900,
  annual_price_cents = 92400
WHERE slug = 'pro';

UPDATE public.plans SET
  stripe_price_id = 'price_1UTCIDRiKNxooUH0ZOQhFsPa',
  stripe_price_id_monthly = 'price_1UTCIDRiKNxooUH0ZOQhFsPa',
  stripe_price_id_annual = 'price_1UaLigRiKNxooUH0tNnc4OEQ',
  monthly_price_cents = 18900,
  annual_price_cents = 224400
WHERE slug = 'legend';

COMMIT;
