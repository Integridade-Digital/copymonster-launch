-- ============================================================================
-- 058_revoke_anon_schema_usage.sql — SEC-019
--
-- Remove o acesso anónimo aos schemas de afiliados e financeiro.
--
-- 052:14-15 concedia USAGE em affiliate e finance a anon, autenticado e
-- service_role. O RLS protege as linhas lidas por um JWT de utilizador, mas um
-- chamador anónimo não tem identidade para o RLS avaliar: expõe a existência do
-- schema, a superfície da API e os erros de permissão, e amplia o impacto de
-- qualquer política futura que esqueça o papel.
--
-- Depois desta migração:
--
--   * anon perde USAGE: as consultas passam a falhar com 42501 em vez de
--     atravessarem o RLS com uma identidade vazia;
--   * authenticated mantém USAGE — as políticas por linha continuam a decidir;
--   * service_role mantém USAGE — o servidor escreve payouts e perfis.
--
-- Dependências: 052_affiliate_and_finance_schemas.sql.
-- Reversão: GRANT USAGE de volta a anon, nunca como parte de uma correção de
-- segurança; ver docs/plan/PRODUCTION_READINESS_PLAN.md (Fase 4, Passo 4.2).
-- ============================================================================

BEGIN;

REVOKE USAGE ON SCHEMA affiliate FROM anon;
REVOKE USAGE ON SCHEMA finance FROM anon;

-- Sem USAGE os privilégios de tabela tornam-se inalcançáveis; revogá-los também
-- impede que um GRANT USAGE futuro reative o acesso sem revisão.
REVOKE ALL ON ALL TABLES IN SCHEMA affiliate FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM anon;

COMMIT;
