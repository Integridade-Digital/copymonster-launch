-- Migration 026: Sincronização de Price IDs com Stripe Live
-- Atualiza os IDs de preço mensais dos planos Starter e Pro conforme os produtos em produção

BEGIN;

UPDATE public.plans
SET stripe_price_id_monthly = 'price_1UMC67RiKNxooUH0MrL1dIoD'
WHERE slug = 'starter';

UPDATE public.plans
SET stripe_price_id_monthly = 'price_1UMC4lRiKNxooUH0ltHJ1pOf'
WHERE slug = 'pro';

COMMIT;
