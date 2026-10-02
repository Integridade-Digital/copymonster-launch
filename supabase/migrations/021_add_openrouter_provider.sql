BEGIN;

INSERT INTO public.llm_providers (
  id, name, provider_type, base_url, is_active, allowed_plans,
  created_at, updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000005',
  'OpenRouter',
  'openrouter',
  'https://openrouter.ai/api/v1',
  true,
  ARRAY['starter', 'pro', 'legend']::TEXT[],
  NOW(),
  NOW()
)
ON CONFLICT (name) DO UPDATE SET
  provider_type = EXCLUDED.provider_type,
  base_url = EXCLUDED.base_url,
  is_active = EXCLUDED.is_active,
  allowed_plans = EXCLUDED.allowed_plans;

COMMIT;
