-- ============================================================================
-- 056_fix_payout_security.sql — SEC-002
--
-- Remove a escrita direta do cliente autenticado em finance.payout_requests.
--
-- A política "payouts_insert_own" (052:288-298) validava apenas a propriedade do
-- perfil de afiliado e o estado KYC. Não validava saldo do ledger, mínimo da
-- regra de comissão, pedido concorrente em aberto, correspondência do
-- paypal_email_snapshot nem teto de valor. O GRANT ALL de 052:190 deixava esse
-- INSERT ao alcance do JWT do utilizador.
--
-- O pedido de payout passa a ter um único caminho de escrita: a função
-- server-side requestAffiliatePayout() (packages/api/auth-http/src/payout-executor.ts),
-- executada com service_role e dona dessas validações.
--
-- O service_role mantém INSERT/UPDATE/DELETE porque o servidor executa o pedido
-- e a execução do payout (executePayout) sobre a mesma tabela.
--
-- Dependência: 052_affiliate_and_finance_schemas.sql.
-- Reversão: ver docs/plan/PRODUCTION_READINESS_PLAN.md (Fase 1, Passo 1.4);
-- nunca reverter com GRANT ALL de volta para authenticated.
-- ============================================================================

BEGIN;

-- SEC-002: nenhum utilizador final cria pedidos de payout diretamente.
DROP POLICY IF EXISTS "payouts_insert_own" ON finance.payout_requests;

REVOKE INSERT, UPDATE, DELETE ON finance.payout_requests FROM authenticated;

-- Leitura própria/operador permanece: "payouts_select_own".
-- "payouts_admin_manage" (052:300) continua a permitir ao operador de plataforma
-- gerir pedidos por UPDATE/DELETE; o REVOKE acima retira apenas a escrita direta
-- do afiliado. O INSERT do operador passa pelo mesmo caminho server-side.

COMMIT;
