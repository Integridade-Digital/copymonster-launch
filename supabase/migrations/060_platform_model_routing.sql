BEGIN;

CREATE TABLE public.platform_model_routing (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object')
);
ALTER TABLE public.platform_model_routing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_model_routing FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_model_routing TO service_role;

CREATE FUNCTION public.save_platform_model_routing(p_policy jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Platform administrator required' USING ERRCODE = '42501';
  END IF;
  IF p_policy IS NULL OR jsonb_typeof(p_policy) <> 'object'
    OR NOT (p_policy ?& ARRAY['primaryProvider', 'primaryModel', 'fallbackProvider', 'fallbackModel', 'fallbackPolicy'])
    OR (p_policy - ARRAY['primaryProvider', 'primaryModel', 'fallbackProvider', 'fallbackModel', 'fallbackPolicy']) <> '{}'::jsonb
    OR jsonb_typeof(p_policy->'primaryProvider') <> 'string'
    OR jsonb_typeof(p_policy->'primaryModel') <> 'string'
    OR jsonb_typeof(p_policy->'fallbackProvider') <> 'string'
    OR jsonb_typeof(p_policy->'fallbackModel') <> 'string'
    OR jsonb_typeof(p_policy->'fallbackPolicy') <> 'object' THEN
    RAISE EXCEPTION 'Invalid platform model routing' USING ERRCODE = '22023';
  END IF;
  IF NOT ((p_policy->'fallbackPolicy') ?& ARRAY['enabled', 'maxAttempts', 'timeoutMs'])
    OR ((p_policy->'fallbackPolicy') - ARRAY['enabled', 'maxAttempts', 'timeoutMs']) <> '{}'::jsonb
    OR jsonb_typeof(p_policy->'fallbackPolicy'->'enabled') <> 'boolean'
    OR COALESCE(p_policy->'fallbackPolicy'->>'maxAttempts', '') !~ '^[1-9][0-9]{0,8}$'
    OR COALESCE(p_policy->'fallbackPolicy'->>'timeoutMs', '') !~ '^[1-9][0-9]{0,8}$'
    OR char_length(p_policy->>'primaryProvider') > 256
    OR char_length(p_policy->>'primaryModel') > 256
    OR char_length(p_policy->>'fallbackProvider') > 256
    OR char_length(p_policy->>'fallbackModel') > 256
    OR ((p_policy->>'primaryProvider' = '') <> (p_policy->>'primaryModel' = ''))
    OR ((p_policy->>'fallbackProvider' = '') <> (p_policy->>'fallbackModel' = '')) THEN
    RAISE EXCEPTION 'Invalid platform model routing' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_model_routing (singleton, policy) VALUES (true, p_policy)
  ON CONFLICT (singleton) DO UPDATE SET policy = EXCLUDED.policy;
END;
$$;

REVOKE ALL ON FUNCTION public.save_platform_model_routing(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_platform_model_routing(jsonb) TO authenticated;

CREATE FUNCTION public.read_platform_model_routing()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT policy FROM public.platform_model_routing WHERE singleton;
$$;

REVOKE ALL ON FUNCTION public.read_platform_model_routing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_platform_model_routing() TO service_role;

COMMIT;
