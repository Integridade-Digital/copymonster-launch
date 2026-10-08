BEGIN;

-- ============================================================================
-- MIGRATION 036: metadados de provedores LLM (controle de acesso, sem chave)
--
-- Plano: docs/roadmap/plano-producao-llm-providers-billing-trial.md (Etapa 7, reescopo)
-- Decisao: docs/roadmap/arquitetura-settings-cofre.md
--
-- Settings -> Models (.credentials.yaml) e o cofre de chaves. O Admin e painel
-- de controle de acesso: estas linhas carregam apenas metadados de roteamento,
-- ativacao e planos autorizados. Nenhuma chave e persistida.
--
-- api_key_env permanece NULL: o composite @deepseek-ai/dsh-host-llm-credentials-supabase
-- e fail-closed para referencia "gerenciada" sem chave, entao popular api_key_env
-- sem api_key sombrearia o cofre local e quebraria a resolucao das chaves.
--
-- DeepSeek ja existe e e atualizado via ON CONFLICT (name); TokenHarbor/Harbor
-- fica de fora por nao ter provider_route mapeado no cordis.patch.yml.
-- ============================================================================

INSERT INTO public.llm_providers
  (name, provider_type, base_url, provider_route, is_active, allowed_plans)
VALUES
  ('DeepSeek',    'deepseek',   'https://api.deepseek.com/v1',         'deepseek-official', true, ARRAY['starter','pro','legend']),
  ('OpenRouter',  'openrouter', 'https://openrouter.ai/api/v1',        'openrouter',        true, ARRAY['starter','pro','legend']),
  ('Nvidia',      'openai',     'https://integrate.api.nvidia.com/v1', 'nvidia',            true, ARRAY['starter','pro','legend']),
  ('Free-llm',    'openai',     'https://api.fortunadigital.me/v1',    'freellm',           true, ARRAY['starter','pro','legend']),
  ('AgentRouter', 'openai',     'https://agentrouter.org/v1',          'agentrouter',       true, ARRAY['starter','pro','legend']),
  ('B.AI',        'openai',     'https://api.b.ai/v1',                 'bai',               true, ARRAY['starter','pro','legend']),
  ('Apmix',       'openai',     'https://api.apmix.ai/v1',             'apx',               true, ARRAY['starter','pro','legend'])
ON CONFLICT (name) DO UPDATE SET
  provider_type  = EXCLUDED.provider_type,
  base_url       = EXCLUDED.base_url,
  provider_route = EXCLUDED.provider_route,
  is_active      = EXCLUDED.is_active,
  allowed_plans  = EXCLUDED.allowed_plans;

COMMIT;
