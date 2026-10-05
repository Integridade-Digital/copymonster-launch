-- Migration 029: Restringir execução de increment_tenant_token_usage apenas ao service_role
-- Impede que usuários authenticated manipulem quota de tokens de qualquer tenant

REVOKE EXECUTE ON FUNCTION public.increment_tenant_token_usage(UUID, BIGINT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_tenant_token_usage(UUID, BIGINT) TO service_role;
