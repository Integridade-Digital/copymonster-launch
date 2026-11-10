# Plano de Correção Passo a Passo — Produção Segura CopyMonster

> **Documento:** `docs/plan/PRODUCTION_READINESS_PLAN.md`
> **Status:** PROPOSTA — **AGUARDA APROVAÇÃO**. Nenhuma alteração de código, dados, DNS, Cloudflare, Nginx, Hestia, portas, `systemctl` ou deploy foi executada para produzir este plano.
> **Fonte:** `SECURITY_AUDIT_REPORT.md`, commit `1de36d54dd`.
> **Data:** 10 de novembro de 2026.
> **Âmbito:** aplicação principal `/root/copymonster-launch`, orquestrador `/opt/copymonster/dsh-server-login`, Supabase vivo, Stripe, PayPal e o caminho DNS/Cloudflare dos subdomínios `*.copymonster.co`.
> **Regra de execução:** cada passo abaixo é uma proposta. Só avança depois de aprovação explícita do responsável indicado. Este documento não autoriza deploy nem alteração de infraestrutura.

---

## 1. Resumo executivo

### 1.1 Contagem de achados (correção da premissa)

O pedido menciona “2 Críticos, 5 Altos, 9 Médios, 4 Baixos”. O relatório auditado tem **21 achados**, com a seguinte distribuição real:

| Severidade | Quantidade | IDs |
|---|---:|---|
| Crítico | 2 | SEC-001, SEC-002 |
| Alto | **6** | SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008 |
| Médio | 9 | SEC-009 a SEC-017 |
| Baixo | 4 | SEC-018 a SEC-021 |
| **Total** | **21** | — |

Este plano cobre os **6 Altos** e não os 5 indicados no pedido. A Fase 2 tem, por isso, seis passos (2.1 a 2.6), não cinco.

Além dos 21 achados, a investigação de subdomínios encontrou um problema operacional **não incluído no relatório**:

| ID adicional | Severidade | Área | Descrição curta |
|---|---|---|---|
| OPS-SUB-01 | **Crítico operacional** | Orquestrador / isolamento | Contas Linux com UID divergente do `users.uid`; colisão de UID entre `testads` e `teste-global`; arranque falhado deixa instância “zombie” e o subdomínio nunca carrega. |
| OPS-SUB-02 | Médio operacional | Host | `dsh-provision.service` legado falha com `useradd: invalid user name 'dsh-<uuid>'`; não é o caminho atual, mas é um processo periódico quebrado que deve ser retirado ou corrigido. |

### 1.2 Conclusão sobre DNS e Cloudflare

**O DNS wildcard e o túnel Cloudflare estão configurados e funcionam.** As evidências de leitura mostram:

- `*.copymonster.co` resolve para a Cloudflare (IPv4 e IPv6) e o proxy está ativo.
- O túnel ativo é `deskcomm` (`b8ed3a72-84d6-462b-be26-d8ae38a9745c`), com quatro conexões saudáveis.
- O systemd usa `/root/.cloudflared/config.yml`; o ficheiro `/etc/cloudflared/config.yml` é uma cópia antiga **não usada** pelo serviço.
- O ingress ativo encaminha `app.copymonster.co` para `127.0.0.1:3080` e `*.copymonster.co` para `127.0.0.1:3081`.
- `httpHostHeader` está comentado, portanto o `Host` original é preservado — que é o comportamento correto para o orquestrador resolver o tenant. **Não o definir para um tenant fixo.**
- `https://app.copymonster.co/` responde `200`; `https://campaign.copymonster.co/` e `https://funel.copymonster.co/` chegam ao orquestrador e respondem `401` sem cookie; `https://test.copymonster.co/` responde `404 unknown_user`, como esperado para um host sem utilizador local.

**A falha dos subdomínios novos não está no DNS nem no Cloudflare.** O problema confirmado está no orquestrador:

1. O utilizador local e a conta Linux são criados no primeiro *exchange* SSO. Uma visita direta ao subdomínio antes desse exchange devolve `404 unknown_user`.
2. O provisionamento Linux em modo `account` tem UIDs divergentes entre a base de dados e `/etc/passwd`. O `groupadd` falha em silêncio e o `useradd` termina com código 6; o processo nunca arranca.
3. O orquestrador regista a instância como `starting` **antes** de o spawn ter sucesso. Quando o spawn falha, a entrada não é removida; a página de arranque é servida para sempre e cada *reload* gera `AlreadyRunningError`. O utilizador vê “Iniciando CopyMonster…” indefinidamente.
4. Há uma colisão de UID: o diretório do tenant `testads` está possuído pelo UID 100012, que pertence à conta Linux `teste-global`. Isto é uma falha de isolamento entre tenants, não apenas um bug de carregamento.

### 1.3 Ordem recomendada de execução

A ordem documental pedida é Fase 0 → 1 → 2 → 3 → 4 → 5 → 6. Para o go-live, recomenda-se:

1. Fase 0 (pré-requisitos e backups).
2. Fase 1 (Críticos que bloqueiam pagamentos).
3. **Fase 5 em paralelo ou imediatamente após a Fase 1**, porque bloqueia o onboarding de novos tenants.
4. Fases 2, 3, 4 e 6 antes de abrir registo público e antes de `PAYPAL_MODE=live`.

Esta alteração de ordem é uma recomendação; não altera o conteúdo nem os gates de aprovação.

---

## 2. Linha de base verificada (apenas leitura)

| Área | Evidência observada | Implicação |
|---|---|---|
| DNS wildcard | `test.copymonster.co` resolve para IPs Cloudflare; `app` resolve e responde `200` | DNS wildcard existe e está proxied. |
| Túnel | `cloudflared tunnel info deskcomm`: 4 conexões, versão 2026.10.0 | Túnel saudável; versão desatualizada (2026.10.7), atualização não urgente. |
| Ingress ativo | `app → 3080`, `*.copymonster.co → 3081`, fallback `404` | Regra wildcard correta. |
| Ficheiro alternativo | `/etc/cloudflared/config.yml` existe mas não é o `--config` do systemd | Não editar por engano; o ativo é `/root/.cloudflared/config.yml`. |
| Orquestrador | `DSH_SERVER_LOGIN_ISOLATION_MODE=account`, `PORT_GUARD=true`, base UID `100000`, porta `3081`, host `127.0.0.1` | Configuração de isolamento correta; o problema é a consistência UID/conta. |
| Cookies | `SESSION_SECRET` igual no app principal e no orquestrador; `sid` em `.copymonster.co` | Consistente com o desenho; não foi identificada colisão funcional. |
| Base viva | 3 utilizadores, 3 tenants, 3 memberships, 5 planos, `audit_logs` 86, tabelas de payout/ledger/comissões vazias | Estado de pré-lançamento; afiliados ainda sem dados financeiros. |
| Operador | Um utilizador com `metadata.is_admin = true`; nenhuma membership no tenant de plataforma `00000000-0000-0000-0000-000000000001` | O gate de payout não pode depender apenas de `role === owner`. |
| PayPal | `PAYPAL_MODE=sandbox`, `PAYPAL_MOCK=true` no `.env` e `.env.systemd` | Impacto financeiro imediato limitado; o código continua vulnerável. |
| Migração 040 | Não foi possível ler `pg_proc`/`pg_policies` sem JWT de utilizador, password Postgres ou `SUPABASE_ACCESS_TOKEN` | Verificação obrigatória na Fase 0; não assumir que está aplicada. |
| Migração 055 | Já existe `055_admin_llm_models_filter_by_provider.sql` | A migração de payout deve ser **056**, não 055. |

### 2.1 Nota sobre `requestAffiliatePayout`

O pedido chama `requestAffiliatePayout()` de “RPC segura”. No código atual é uma **função TypeScript** em `packages/api/auth-http/src/payout-executor.ts`, executada no servidor com `supabaseAdminClient` (service_role); não é uma função SQL. O Passo 1.3 corrige essa premissa: ou se mantém um único caminho server-side, ou se cria uma RPC SQL atómica. As duas opções estão descritas abaixo.

---

## 3. Fase 0 — Pré-requisitos

**Objetivo:** garantir que qualquer correção é reversível e que o estado atual é conhecido antes de tocar em código, dados ou configuração.

| Passo | Ação | Verificação / critério | Requer alteração? |
|---|---|---|---|
| 0.1 | Aprovar formalmente este plano e congelar deploys, migrações e alterações de DNS/Cloudflare até ao fim da Fase 6. | Registo de aprovação com data, responsável e janela de manutenção. | Não (processo). |
| 0.2 | Backup do Supabase: snapshot/PITR e `pg_dump` lógico do schema `public`, `affiliate` e `finance`. | Restauro do dump numa instância de staging; contagens iguais às da linha de base. | Sim (backup). |
| 0.3 | Backup do SQLite do orquestrador e respetivos WAL/SHM. | `sqlite3 .backup`, `PRAGMA integrity_check` = `ok`, cópia dos três ficheiros; hash SHA-256 registado. | Sim (backup). |
| 0.4 | Confirmar `PAYPAL_MODE=sandbox` e `PAYPAL_MOCK=true` no app principal e no `.env.systemd`. | Leitura dos valores não secretos; nenhum deploy para “live”. | Não (verificação). |
| 0.5 | Confirmar a migração 040 no Supabase vivo. | Executar a SQL de §3.1 e confirmar que `is_admin_or_owner()` usa o tenant de plataforma ou `users.metadata.is_admin`, e **não** `get_current_tenant_id()`. | Não (SQL read-only). |
| 0.6 | Inventariar permissões de ficheiros e segredos sem imprimir valores. | `.env`, `.env.systemd`, `/etc/dsh-server-login.env` com `600 root:root`; `/root/.cloudflared/config.yml` `600 root:root`. | Não (verificação). |
| 0.7 | Capturar a linha de base de subdomínios. | `app` 200; `campaign`/`funel` 401 sem cookie; `test` 404 `unknown_user`; `journalctl` sem `connection refused`/502. | Não (leitura). |
| 0.8 | Criar branch/worktree de correção e confirmar o baseline de CI. | `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` no commit base; registar falhas pré-existentes (por exemplo, o teste de `workspace-browser.client.spec.tsx`). | Sim (branch). |
| 0.9 | Preparar um tenant de teste **em staging** para a Fase 5. | Nunca criar dados em produção sem aprovação; o tenant de staging deve usar um slug novo e um e-mail controlado. | Sim (staging). |
| 0.10 | Aprovar o início da Fase 1. | Gate formal: backups verificados, 040 confirmada, PayPal em mock. | Não (processo). |

### 3.1 SQL de verificação da migração 040

```sql
-- Executar no SQL Editor do Supabase, apenas leitura.
select pg_get_functiondef('public.is_admin_or_owner()'::regprocedure);

select count(*) as platform_operators
from public.user_tenant_roles
where tenant_id = '00000000-0000-0000-0000-000000000001'
  and role in ('owner', 'admin');

select id, email
from public.users
where metadata ->> 'is_admin' = 'true';

select relname, relrowsecurity
from pg_class
where relnamespace in ('public'::regnamespace, 'affiliate'::regnamespace, 'finance'::regnamespace)
  and relkind = 'r';
```

**Critério de bloqueio:** se a definição mostrar `get_current_tenant_id()` ou não mencionar o tenant de plataforma/`metadata.is_admin`, a migração 040 não está aplicada e todas as políticas administrativas ficam comprometidas. Nesse caso, a Fase 1 não começa antes de aplicar 040 (com aprovação e backup).

---

## 4. Fase 1 — Correções Críticas (SEC-001 e SEC-002)

**Objetivo:** fechar a cadeia que permite a qualquer `owner` de tenant pessoal criar e executar um payout arbitrário.

### Passo 1.1 — Corrigir a autorização de `handleAdminExecutePayout`

**Ficheiro:** `packages/api/auth-http/src/payout-executor.ts:443` (e as rotas em `packages/api/auth-http/src/index.ts:365` e `:371`).

**Problema:** o gate atual aceita `identity.isAdmin === true`, `role === 'admin'` ou `role === 'owner'`. Como todos os signups recebem `owner` do tenant pessoal, qualquer utilizador autenticado passa.

**Correção proposta:**

- Criar um predicado único `isPlatformOperator(identity)`:
  - `identity.isAdmin === true` → permite;
  - caso contrário, consultar no servidor a membership `owner`/`admin` no tenant `00000000-0000-0000-0000-000000000001` pelo `identity.userId`;
  - **não** usar `identity.tenantId === PLATFORM_TENANT_ID`, porque `get_my_profile()` devolve apenas a primeira membership e um operador legítimo pode ter o tenant pessoal como primeira linha.
- Substituir as três condições atuais por `if (!(await isPlatformOperator(identity))) return 403`.
- Adicionar auditoria estruturada de tentativas negadas, sem PII.
- Repetir o gate na base de dados para a transição de estado do payout (ver Passo 1.3).

**Teste obrigatório:**

- `owner` de tenant pessoal, `isAdmin=false`, sem membership de plataforma → `403 forbidden`.
- `admin` de tenant pessoal, `isAdmin=false` → `403`.
- `isAdmin=true` → `200` com `PAYPAL_MOCK=true`.
- membership `owner`/`admin` no tenant de plataforma, sem `isAdmin` → `200`.
- Utilizador sem identidade → `401`.

**Critério de aceitação:** nenhum caminho em `handleAdminExecutePayout` autoriza por role isolada de tenant.

### Passo 1.2 — Revogar a escrita direta em `finance.payout_requests`

**Ficheiros:** `supabase/migrations/052_affiliate_and_finance_schemas.sql:288-298` (política `payouts_insert_own`) e `:189-190` (`GRANT ALL ... TO authenticated`).

**Problema:** a política valida apenas propriedade do perfil e KYC. Não valida mínimo, saldo, pedido concorrente, `paypal_email_snapshot` nem teto. O `GRANT ALL` permite `INSERT`/`UPDATE`/`DELETE` diretos.

**Correção proposta:**

- `DROP POLICY "payouts_insert_own" ON finance.payout_requests;`
- `REVOKE INSERT, UPDATE, DELETE ON finance.payout_requests FROM authenticated;`
- Manter `SELECT` próprio e de operador.
- Não conceder `INSERT` a `anon`.
- O caminho server-side continua a usar o service_role; o cliente deixa de poder escrever diretamente.
- Adicionar uma verificação de regressão em SQL: `authenticated` a inserir → `42501`; `service_role` a inserir via função server-side → sucesso.

**Critério de aceitação:** nenhuma política RLS de `INSERT` para `authenticated` em `finance.payout_requests`; nenhuma escrita direta possível com JWT de utilizador.

### Passo 1.3 — Forçar um único caminho de escrita seguro

**Decisão de desenho (recomendada):** criar uma RPC SQL atómica `finance.request_affiliate_payout(p_amount numeric)` com `SECURITY DEFINER`, `search_path` fixo e `FOR UPDATE` no perfil, que:

1. Deriva o afiliado de `auth.uid()`.
2. Exige `active = true` e `kyc_status = 'APPROVED'`.
3. Lê a regra corrente e aplica o mínimo.
4. Bloqueia pedidos concorrentes com `FOR UPDATE` e/ou índice único parcial para estados abertos.
5. Lê o saldo do ledger e rejeita valor superior.
6. Insere com `paypal_email_snapshot` do perfil, nunca do corpo do pedido.
7. Devolve um resultado estável (`requested`, `below_minimum`, `insufficient_balance`, `already_in_progress`).

**Alternativa mínima para a janela de lançamento:** manter `requestAffiliatePayout()` como única função server-side e revogar a escrita direta. É mais simples, mas não dá a garantia atómica na base de dados; fica como dívida técnica registada.

**Regra:** o browser nunca envia `affiliate_id`, `paypal_email` ou `amount` para uma tabela; envia apenas a intenção, e o servidor/RPC resolve o resto.

**Teste:** owner de tenant pessoal com saldo insuficiente → rejeição; valor abaixo do mínimo → rejeição; dois pedidos concorrentes → apenas um; pedido com e-mail PayPal diferente do perfil → usa o do perfil; `INSERT` direto → negado.

### Passo 1.4 — Criar a migração `056_fix_payout_security.sql`

**Correção de numeração:** o pedido indica `055_fix_payout_security.sql`, mas o repositório já tem `055_admin_llm_models_filter_by_provider.sql`. A próxima migração livre é **056**. Criar `055_...` sobrescreveria ou colidiria com uma migração existente.

**Conteúdo mínimo proposto:**

```sql
-- 056_fix_payout_security.sql
begin;

-- SEC-002: nenhum utilizador final escreve diretamente em finance.payout_requests.
drop policy if exists "payouts_insert_own" on finance.payout_requests;
revoke insert, update, delete on finance.payout_requests from authenticated;

-- O service_role mantém a escrita usada pelo servidor.
-- Se for adotada a RPC atómica, criar aqui finance.request_affiliate_payout(...)
-- com SECURITY DEFINER, search_path fixo e validações de perfil/saldo/mínimo.

commit;
```

**Regras da migração:**

- Não remover dados nem políticas de `SELECT`.
- Não usar `GRANT ALL` em `authenticated`.
- Ser idempotente (`if exists`/`if not exists`).
- Ter um teste SQL negativo e um positivo no mesmo PR.
- Registar a migração no upgrade guide se alterar um contrato externo.

**Aprovação:** Passo 1.4 só é aplicado depois de backup (0.2), confirmação de 040 (0.5) e revisão do SQL por uma segunda pessoa.

### Passo 1.5 — Testar com `PAYPAL_MOCK=true`

**Sequência:**

1. `PAYPAL_MODE=sandbox`, `PAYPAL_MOCK=true`; nunca `live` nesta fase.
2. Executar os testes unitários de `packages/api/auth-http/tests/affiliate-payout.spec.ts`, com casos novos para owner de tenant pessoal.
3. Executar o teste de integração do endpoint com um JWT de utilizador normal e confirmar `403`.
4. Executar o fluxo server-side completo com mock: pedido → aprovação → execução → ledger → notificação.
5. Confirmar que o pedido direto pela API do Supabase com JWT de utilizador devolve `42501`.
6. Confirmar que o ledger não tem duplicados e que `idx_ledger_payout_unique` continua válido.

**Critério de saída da Fase 1:** SEC-001 e SEC-002 fechados, testes negativos a passar, `PAYPAL_MOCK=true` confirmado, zero alterações a dados reais de payout.

**Gate de aprovação:** responsável de segurança + responsável financeiro. Sem este gate, não se passa à Fase 2 nem se ativa PayPal live.

---

## 5. Fase 2 — Correções Altas (6 achados)

Cada passo tem ficheiro/linha, correção e teste. Todos exigem aprovação individual antes de alterar código.

### 5.1 SEC-003 — Vinculação SSO por slug

| Campo | Conteúdo |
|---|---|
| **Local** | `/opt/copymonster/dsh-server-login/src/web/routes/auth.ts:235-245` |
| **Problema** | Se não existe utilizador com o `supabase_sub`, o orquestrador vincula automaticamente a conta local cujo `username` é igual ao slug do tenant. Uma conta antiga só-password (`supabase_sub = null`) com o mesmo slug é tomada sem prova de posse. |
| **Correção** | Desativar a vinculação automática. Se existir conta local sem `supabase_sub` com o mesmo slug, responder `409 account_link_required` e exigir login local ou token de confirmação enviado para o e-mail da conta. Registar auditoria e notificar o proprietário. |
| **Teste** | Criar em staging uma conta local password-only com slug `colisao`; tentar SSO com um utilizador Supabase diferente e o mesmo slug → `409`, sem sessão emitida; login local correto + confirmação → vinculação explícita. |

### 5.2 SEC-004 — Escrita direta em campos sensíveis do afiliado

| Campo | Conteúdo |
|---|---|
| **Local** | `supabase/migrations/052_affiliate_and_finance_schemas.sql:228-236` |
| **Problema** | `affiliate_profiles_update_own` permite ao afiliado alterar `paypal_email`, `trust_score`, `active`, `full_name`, `cpf_cnpj` e `paypal_last_changed_at`, contornando a RPC `affiliate.update_paypal_email`. |
| **Correção** | Revogar `UPDATE` direto em `affiliate.profiles` para `authenticated`; conceder apenas colunas seguras por grant de coluna, se necessário; manter `update_paypal_email` como única via para o PayPal; criar RPC para os restantes campos editáveis; fixar colunas sensíveis no `WITH CHECK` se a política tiver de permanecer. |
| **Teste** | Com JWT de afiliado: `UPDATE ... SET paypal_email` → `42501`; `UPDATE ... SET trust_score` → `42501`; `SELECT affiliate.update_paypal_email(...)` → sucesso e auditoria; alteração de `active` → negada. |

### 5.3 SEC-005 — Atribuição de afiliado controlada pelo cliente

| Campo | Conteúdo |
|---|---|
| **Local** | `packages/api/auth-http/src/billing.ts:327-333` e `:406-409`; `packages/api/auth-http/src/affiliate-processor.ts:70-150`; `apps/web/src/pages/billing/PlansPage.tsx:310`; `apps/web/src/lib/affiliate.ts:10` |
| **Problema** | O checkout aceita `affiliateId` do corpo e apenas valida o formato UUID. Qualquer pessoa pode indicar o UUID de um afiliado, o seu próprio UUID, ou desviar comissões; o webhook valida perfil/KYC, mas não auto-referral, primeira compra ou janela de atribuição. |
| **Correção** | Ignorar `affiliateId` do corpo como fonte de verdade. Criar um endpoint server-side que valide o afiliado e emita um cookie `affiliate_ref` assinado (HMAC, `HttpOnly`, `Secure`, `SameSite=Lax`, expiração curta). No checkout, ler e verificar o cookie. Rejeitar auto-referral (`affiliate.user_id === identity.userId`). Exigir primeira subscrição paga do cliente ou janela de atribuição definida. Registar a decisão em auditoria. |
| **Teste** | Checkout sem cookie → sem comissão; cookie forjado/alterado → rejeitado; auto-referral → rejeitado; afiliado inativo/KYC pendente → rejeitado; compra recorrente fora da janela → sem comissão; compra válida → comissão `HOLDING`. |

### 5.4 SEC-006 — SSRF no fetch HTTP do agente

| Campo | Conteúdo |
|---|---|
| **Local** | `packages/web/web-fetch-http/src/provider.ts:101-112`; `packages/web/web-fetch-http/src/policy.ts:44-56` |
| **Problema** | `validateFetchUrl` valida apenas esquema, credenciais e comprimento. `requestOnce` usa `undici.fetch` diretamente, sem resolver DNS nem bloquear ranges privados/loopback/link-local/metadata. Em modo local não existe NetworkPolicy de egress. |
| **Correção** | Resolver o hostname antes de conectar; rejeitar IPv4/IPv6 privados, loopback, link-local, multicast e `169.254.169.254`; fixar o IP resolvido no dispatcher (`undici.Agent` com `connect.lookup`) para evitar DNS rebinding; validar também IPs literais, portas e cada redirect; manter timeout e limite de bytes. |
| **Teste** | `http://127.0.0.1:3080`, `http://[::1]`, `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1`, `http://192.168.0.1`, `http://172.16.0.1` → `WEB_BLOCKED_URL`; redirect para range privado → bloqueado; hostname público → permitido; DNS que muda para IP privado entre resolução e conexão → bloqueado. |

### 5.5 SEC-007 — Execução de comando e defaults de isolamento

| Campo | Conteúdo |
|---|---|
| **Local** | `/opt/copymonster/dsh-server-login/src/web/routes/dsh.ts:115-118`; `src/config.ts:160` e `:381` |
| **Problema** | `DEFAULT_ISOLATION_MODE = 'soft'` e `portGuard` com fallback `false`. Se um deploy não definir `account`/`true`, todos os tenants partilham UID e o comando do handoff corre no contexto do orquestrador. O deploy atual está correto, mas o default é perigoso. |
| **Correção** | Mudar o default para `account` e `portGuard=true`; recusar arrancar com `NODE_ENV=production` e `soft`/`portGuard=false`; exigir opt-in explícito e documentado para `soft`; adicionar validação de configuração no arranque; limitar o comando do handoff a um formato seguro e mantê-lo apenas para o próprio DSH. |
| **Teste** | Configuração de produção sem `ISOLATION_MODE` → arranque falha com erro claro; `soft` explícito em produção → falha; `account` + `true` → arranca; pedido `/api/dsh/restart` com comando inválido → `400`; teste de configuração no CI. |

### 5.6 SEC-008 — Segredos Stripe no orquestrador

| Campo | Conteúdo |
|---|---|
| **Local** | `/etc/dsh-server-login.env`; `/opt/copymonster/dsh-server-login/src/supervisor/spawn.ts:17-36` |
| **Problema** | `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` estão no ambiente do orquestrador, que corre como `root` e gere processos de tenants. O código não os usa; o allowlist de spawn impede que cheguem aos tenants, mas mantém-nos no processo de maior privilégio. |
| **Correção** | Remover as duas variáveis de `/etc/dsh-server-login.env`; reiniciar o serviço com aprovação; confirmar que o ambiente do processo e o dos filhos não as contêm; rotar as duas chaves na Stripe; atualizar apenas o app principal; registar a rotação. |
| **Teste** | `grep` no ambiente do processo e dos filhos não encontra `STRIPE_`; checkout/webhook continuam a funcionar com as novas chaves; `pnpm audit` sem regressão. |

**Gate de aprovação da Fase 2:** cada passo revisto e aprovado. SEC-003, SEC-004 e SEC-005 têm de estar fechados antes de abrir registo público; SEC-006/007/008 antes de produção.

---

## 6. Fase 3 — Correções Médias (9 achados)

| Passo | ID | Local | Correção | Teste |
|---|---|---|---|---|
| 3.1 | SEC-009 | `packages/api/auth-http/src/session-token.ts:275`, `:302`, `:312`, `:342`, `:380` | Remover `sub`, `aud`, `exp`, corpos de erro e o objeto `profile` dos logs; logar apenas códigos estáveis e IDs internos; ativar redaction. | Teste unitário que captura logs e garante ausência de e-mail, nome, tenant e token. |
| 3.2 | SEC-010 | `packages/api/auth-http/src/billing.ts:415`, `:473`, `:665`; `payout-executor.ts:199` | Mapear erros Stripe/Supabase/PayPal para códigos públicos estáveis; nunca devolver `err.message`; logar detalhe apenas interno. | Respostas 4xx/5xx sem mensagens internas; testes de erro simulados. |
| 3.3 | SEC-011 | `/opt/copymonster/dsh-server-login/src/web/server.ts:79` | `trustProxy: true` → allowlist restrita ao edge/loopback; validar `X-Forwarded-For` só de pares confiáveis; documentar a topologia. | Pedido direto com `X-Forwarded-For` forjado não altera o IP de rate limit/auditoria; via túnel continua correto. |
| 3.4 | SEC-012 | `/opt/copymonster/dsh-server-login/src/web/file-service.ts:9-13`; `src/supervisor/k8s-spawner.ts:608-620` | Serviço de ficheiros 8082: exigir token de autenticação do control plane ou mTLS; manter NetworkPolicy; bind loopback no modo local; testar negação de outro pod/host. | Acesso sem token → 401; do control plane → 200; de outro pod → timeout/negado. |
| 3.5 | SEC-013 | `packages/api/auth-http/src/payout-executor.ts:278-330` | Revalidar saldo, valor, mínimo, e-mail e inexistência de duplicado imediatamente antes do PayPal; impor teto máximo; reconciliar estado PayPal vs BD em falha parcial; idempotência por `batchId`; transição atómica. | Teste com saldo alterado entre pedido e execução → falha; falha PayPal após débito → estado reconciliado; duplicado → único ledger. |
| 3.6 | SEC-014 | `package.json` / `pnpm-lock.yaml` | Atualizar `undici` ≥ 7.30.1/8.12.2, `follow-redirects` ≥ 1.16.2, `@modelcontextprotocol/sdk` ≥ 1.32.0, `vite` ≥ 8.2.4, `zod` ≥ 4.6.6, `body-parser` ≥ 2.4.0, `happy-dom` ≥ 21.0.4; no orquestrador, `glob` ≥ 14.0.2 e `minimatch` ≥ 11.0.1. | `pnpm audit --prod` sem high/critical; testes e build verdes; smoke de fetch/redirect. |
| 3.7 | SEC-015 | `packages/api/auth-http/src/billing.ts:574` | Remover `.or()` interpolado; fazer duas consultas `.eq('stripe_price_id_monthly', priceId)` e `.eq('stripe_price_id_annual', priceId)` ou validar `priceId` contra uma allowlist carregada da BD. | `priceId` com vírgula/parenteses/`or` não altera a query; plano correto é encontrado; teste negativo. |
| 3.8 | SEC-016 | `supabase/migrations/040_admin_flag_and_rls.sql`; `052:189` | Gate de versão mínima de migração no arranque/healthcheck; verificação SQL read-only na Fase 0; falhar fechado se 040 não estiver aplicada; documentar o requisito no runbook. | Healthcheck falha com 040 ausente; com 040 aplicada, `is_admin_or_owner()` exige plataforma/flag. |
| 3.9 | SEC-017 | `src/web/middleware/rate-limit.ts:11-18`; `src/web/routes/auth.ts:306` | Lockout progressivo por conta além do limite por IP; atraso exponencial; CAPTCHA após N falhas; contadores partilhados; corrigir SEC-011 para o IP não ser forjável. | 10 falhas → bloqueio progressivo; IP forjado não contorna; utilizador legítimo recupera após janela. |

**Gate de aprovação:** SEC-009/010/011/014/016 antes de expor logs e admin a produção; SEC-012 apenas se o deploy k8s for usado; SEC-013 antes de PayPal live; SEC-015/017 antes de abrir registo.

---

## 7. Fase 4 — Correções Baixas (4 achados)

| Passo | ID | Local | Correção | Teste |
|---|---|---|---|---|
| 4.1 | SEC-018 | `/opt/copymonster/dsh-server-login/src/web/server.ts` | Adicionar `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy` no edge/orquestrador. | `curl -I` confirma headers; CSP não bloqueia assets legítimos; relatório de violações. |
| 4.2 | SEC-019 | `supabase/migrations/052_affiliate_and_finance_schemas.sql:14-15` | `REVOKE USAGE ON SCHEMA affiliate, finance FROM anon`; manter apenas `authenticated`/`service_role`. | `anon` recebe `42501`; app autenticada continua a ler o próprio perfil. |
| 4.3 | SEC-020 | `packages/api/auth-http/src/payout-executor.ts:356` | Remover `metadata.email`; guardar apenas `payoutId`, `batchId`, `affiliate_id` e valor; se reconciliação precisar de e-mail, usar referência ao perfil. | `audit_logs` sem e-mail; reconciliação por IDs funciona. |
| 4.4 | SEC-021 | `package.json` | Atualizar devDependencies `vitest` ≥ 3.2.6, `tinypool` ≥ 2.1.2, `dompurify` ≥ 3.4.17; manter CI sem advisories critical. | `pnpm audit` sem critical em dev; testes verdes. |

**Gate de aprovação:** podem entrar no mesmo ciclo que a Fase 3, mas não bloqueiam o go-live se as Fases 1, 2, 5 e 6 estiverem concluídas. SEC-018 é recomendado antes de exposição pública.

---

## 8. Fase 5 — Correção do Bug de Subdomínios (DNS/Cloudflare)

### Passo 5.1 — Diagnóstico do bug

#### 5.1.1 O que foi verificado e está correto

| Verificação | Resultado |
|---|---|
| Registo DNS wildcard `*.copymonster.co` | Existe, resolve para IPs Cloudflare e está proxied. |
| Registo do túnel | `deskcomm`, ID `b8ed3a72-84d6-462b-be26-d8ae38a9745c`, quatro conexões ativas. |
| Configuração usada pelo systemd | `/root/.cloudflared/config.yml`, `--config` explícito. |
| Ingress `app.copymonster.co` | `http://127.0.0.1:3080`; resposta pública `200`. |
| Ingress `*.copymonster.co` | `http://127.0.0.1:3081`; o `Host` original é preservado. |
| `httpHostHeader` | Comentado; **não** deve ser fixado a um tenant. |
| Orquestrador na 3081 | Escuta em `127.0.0.1:3081`; recebe tráfego de `campaign` e `funel`. |
| Fallback | `http_status:404`; `test.copymonster.co` devolve `404 unknown_user`, não erro de túnel. |
| Logs Cloudflare | Sem `connection refused`, `no such host` ou 502 para os hosts de tenant; apenas cancelamentos de streams longos. |

**Conclusão parcial:** não há evidência de falha de DNS, de proxy Cloudflare, de certificado ou de ingress. Alterar `httpHostHeader` ou o CNAME wildcard não corrige o problema e pode quebrar o isolamento.

#### 5.1.2 Causas confirmadas no orquestrador

**Causa A — primeira visita antes do SSO devolve 404.**
`resolveSubdomainAccess()` procura o utilizador local pelo slug; se ainda não existe, devolve `404 unknown_user` (`src/supervisor/proxy.ts:156-157`). O utilizador local só é criado no *exchange* `/api/auth/session-token` (`src/web/routes/auth.ts:233-255`). O fluxo normal passa pelo app principal, mas uma visita direta, um link de e-mail ou um marcador antes do exchange mostra 404.

**Causa B — provisionamento Linux com UID divergente.**
O UID é calculado como `baseUid + rowid` (`src/db/repo.ts:49-50`). O provisionamento verifica apenas `id -u <uid>`; se a conta com o mesmo nome já existe com outro UID/GID, o `groupadd` falha em silêncio e o `useradd` falha com código 6 (`src/supervisor/orchestrator.ts:108-143`). O log vivo confirma:

```text
2026-11-06T23:41:45Z  useradd -u 100013 -g 100013 ... teste-global
                       Command failed ... status: 6
2026-11-06T23:41:49Z  AlreadyRunningError: user 391c834e-... already has a running DSH
```

**Causa C — instância “zombie” após falha de spawn.**
`spawnInstance()` coloca a instância no mapa `mains` **antes** de `spawnAsUser()` (`orchestrator.ts:322-335`). Se o spawn falhar, a entrada não é removida. A página de arranque já foi enviada; cada *reload* chama `launch()`, que vê `mains.has(userId)` e lança `AlreadyRunningError` (`orchestrator.ts:146-148`). O proxy registra o erro e volta a servir a página de arranque (`proxy.ts:316-323`). O subdomínio responde `200` com HTML, mas nunca carrega a aplicação.

**Causa D — colisão de UID entre tenants.**
Estado observado:

| Utilizador na BD | `users.uid` | Conta Linux | UID real | Diretório |
|---|---:|---|---:|---|
| `testads` | 100012 | `testads` | 100008 | `41184e5a-...` possuído por 100012 (`teste-global`) |
| `teste-global` | 100013 | `teste-global` | 100012 | `391c834e-...` possuído por 100013 |
| `campaign` | 100010 | `campaign` | 100010 | consistente |
| `funel` | 100011 | `funel` | 100011 | consistente |

Consequência: o orquestrador resolve `testads` para o UID 100012 (da BD) e executa o processo como a conta `teste-global`; o diretório do `testads` está possuído por 100012. Isto permite que um tenant aceda aos ficheiros do outro. É uma falha de isolamento, não apenas de carregamento.

**Causa E — slugs longos em tenants antigos/gerados.**
O registo atual limita o slug a 4–30 caracteres, mas o fallback da migração 032/043 gera `left(base, 40) + '-' + 8 hex` (até 49). O exchange do orquestrador aceita no máximo 32 (`src/web/routes/auth.ts:132`). Um tenant criado por esse fallback falha o SSO com `502 sso_unavailable` ou fica sem subdomínio funcional. Os tenants vivos atuais têm 5–7 caracteres; os hosts `integridade-digital-a371977b` (27) e `teste-global` (12) mostram que o problema não é o comprimento nesses casos, mas o mecanismo continua a ser um risco para tenants gerados.

**Causa F — experiência de erro.**
Para pedidos HTML sem cookie, o proxy devolve JSON `401 unauthorized`/`404 unknown_user` em vez de redirecionar para o login do app. O utilizador não percebe que precisa de SSO; parece “subdomínio quebrado”.

### Passo 5.2 — Correção proposta

**Não alterar DNS nem Cloudflare.** A configuração atual está correta para o desenho. Em particular:

- Manter `*.copymonster.co → http://127.0.0.1:3081`.
- Manter `httpHostHeader` comentado; o orquestrador precisa do `Host` original.
- Manter o túnel `deskcomm` e o fallback 404.
- Se se quiser limpar, remover apenas a cópia morta `/etc/cloudflared/config.yml` numa janela separada, depois de confirmar que nenhum script a usa. Isso é infraestrutura e exige aprovação própria.

**Correções no orquestrador, por ordem:**

1. **Provisionamento idempotente e fail-closed.**
   - Resolver a conta por nome e por UID.
   - Se o nome existe com UID/GID diferente do esperado, devolver `ProvisioningConflict` estruturado; não continuar com `groupadd`/`useradd`.
   - Criar grupo só se o GID e o nome estiverem livres; criar utilizador com `-u <uid> -g <gid>`; verificar depois com `id -u <username>` e `id -g <username>`.
   - Nunca ignorar erros de `groupadd`/`useradd`; registar o stderr e o UID esperado/real.

2. **UID estável e único.**
   - Deixar de derivar o UID de `lastInsertRowid` (reutilizável após remoção).
   - Usar uma sequência monotónica persistida, ou `hashUid(userId, baseUid)` com deteção de colisão e persistência do valor.
   - Backfill com reconciliação: comparar `users.uid` com `/etc/passwd`, listar divergências e corrigir numa janela de manutenção; nunca alterar UIDs a quente sem backup.

3. **Máquina de estados de spawn.**
   - Só inserir em `mains` depois de `spawnAsUser()` ter sucesso; ou manter um mapa `starting` separado com promessa em curso.
   - Em erro, remover a entrada e libertar o estado; `launch()` deve poder ser repetido.
   - `endpointFor()` deve distinguir `starting`, `failed` e `running`.

4. **Página de erro e retry.**
   - Se o auto-launch falhar, devolver `503` com uma página que explique o estado e um botão “tentar novamente”; não servir a página de arranque para sempre.
   - Registar `tenant`, `uid esperado`, `uid real`, `motivo` e `requestId` no log, sem PII.
   - Expor `GET /api/dsh/status` com `state: provisioning|starting|running|failed` e `lastError` estável.

5. **Primeira visita e SSO.**
   - Para pedidos HTML sem sessão, redirecionar para `https://app.copymonster.co/login` em vez de devolver JSON.
   - No exchange SSO, criar o utilizador local e provisionar a conta Linux antes de responder; se o provisionamento falhar, devolver um erro explícito ao app e não redirecionar para o subdomínio.
   - O app deve mostrar “Workspace em preparação” e repetir o exchange com backoff.

6. **Limite de slug.**
   - Garantir no trigger/função de criação que o slug cumpre `^[a-z0-9][a-z0-9-]{2,28}[a-z0-9]$` (4–30).
   - Encurtar o fallback gerado para ≤30 caracteres com sufixo de colisão.
   - Adicionar pré-verificação: `select slug, length(slug) from public.tenants where length(slug) > 30;` → deve devolver zero.
   - Alinhar o regex do exchange do orquestrador com o do registo (ou aceitar 30 e rejeitar >30 com erro explícito).

7. **Recuperação dos tenants afetados.**
   - Fazer backup e inventariar UIDs/owners antes de qualquer alteração.
   - Reconciliar `testads` e `teste-global` numa janela de manutenção; manter um mapa canónico `userId → uid → username → home`.
   - Não apagar utilizadores, ficheiros ou sessões para “limpar” o problema.
   - `teste-global` já não tem utilizador Supabase correspondente; deve ser desativado após reconciliação, não eliminado sem aprovação.

8. **Serviço legado `dsh-provision` (OPS-SUB-02).**
   - Confirmar que não é o caminho atual (o orquestrador cria utilizadores no SSO).
   - Desativar o `.path`/serviço ou corrigir o script que gera `dsh-<uuid>` inválido; exige aprovação de infraestrutura.
   - Não confundir com o orquestrador: o erro `useradd: invalid user name 'dsh-...'` é de outro processo.

**O que não fazer:**

- Não definir `httpHostHeader: <um tenant>`; isso faria todos os hosts chegarem com o mesmo nome e quebraria a resolução por slug.
- Não alterar o CNAME wildcard nem o proxy Cloudflare para “resolver” o problema.
- Não executar `useradd`/`usermod`/`chown` a quente em produção sem backup e janela.
- Não apagar a base SQLite, WAL ou SHM para “resetar” instâncias; perde-se o mapeamento de utilizadores.

### Passo 5.3 — Plano de teste (menos de 30 segundos)

**Pré-condição:** executar apenas em staging, com um tenant novo e um e-mail controlado; em produção, apenas testes read-only depois do deploy.

#### Teste A — Rota DNS/Cloudflare (read-only, <5 s)

```bash
dig +short novo-tenant.copymonster.co
curl -sS -o /dev/null -w 'app=%{http_code} tempo=%{time_total}s\n' https://app.copymonster.co/
curl -sS -o /dev/null -w 'tenant=%{http_code} tempo=%{time_total}s\n' https://novo-tenant.copymonster.co/
```

Aceitação: `dig` devolve IPs Cloudflare; `app=200`; o subdomínio novo responde `200` (HTML) ou `302` para login, **nunca** `404 unknown_user` após o SSO. Tempo de resposta <5 s; orçamento total do fluxo <30 s.

#### Teste B — Fluxo completo de criação (staging, <30 s)

1. Registar um tenant novo (slug 4–30, sem caracteres inválidos).
2. Confirmar o e-mail e fazer login no app.
3. Medir o tempo desde o clique de login até o subdomínio mostrar o workspace:

```bash
inicio=$(date +%s%3N)
# executar o login/SSO no browser ou via script de staging
fim=$(date +%s%3N)
echo "duração_ms=$((fim - inicio))"
```

4. Verificar no orquestrador:

```bash
journalctl -u dsh-orchestrator --since "2 minutes ago" --no-pager \
  | grep -E "novo-tenant|useradd|ProvisioningConflict|AlreadyRunningError|auto-launch failed"
```

Aceitação: sem `useradd`, sem `AlreadyRunningError`, sem `auto-launch failed`; `duração_ms < 30000`.

#### Teste C — Consistência de UID e isolamento (staging, <10 s)

```bash
getent passwd novo-tenant
stat -c '%u:%g %a %n' /var/lib/dsh-server-login/users/<user-id>
ps -eo user,uid,gid,args | grep -E "novo-tenant|<user-id>" | grep -v grep

# Teste negativo: o tenant não pode ler a home de outro tenant.
sudo -u novo-tenant test -r /var/lib/dsh-server-login/users/<outro-user-id> && echo FALHA || echo OK
```

Aceitação: UID da BD = UID da conta Linux = UID do processo; home do tenant pertence ao UID correto; leitura cruzada negada.

#### Teste D — Regressão de primeira visita e slug

- Visitar `https://novo-tenant.copymonster.co/` sem cookie: deve redirecionar para login (HTML) ou devolver `401` JSON para API, não `404 unknown_user`.
- Criar um tenant de staging com slug de 30 caracteres: deve funcionar.
- Testar um slug de 31/49 caracteres: deve ser rejeitado na criação, não falhar no SSO.
- Repetir 3 *reloads*: deve existir um único processo; `/api/dsh/status` deve mostrar `running`.
- Simular falha de provisionamento (UID ocupado) em staging: deve devolver `503` com erro explícito e permitir retry, sem ficar preso na página de arranque.

#### Teste E — Produção (read-only, após deploy)

```bash
for h in app.copymonster.co campaign.copymonster.co funel.copymonster.co; do
  curl -sS -o /dev/null -w "$h %{http_code} %{time_total}s\n" "https://$h/"
done
journalctl -u dsh-orchestrator --since "10 minutes ago" --no-pager \
  | grep -E "unknown_user|ProvisioningConflict|auto-launch failed|useradd"
```

Aceitação: hosts existentes continuam a responder; nenhum novo `unknown_user` para tenants válidos; nenhum `useradd`/`AlreadyRunningError`.

### Passo 5.4 — Critérios de aceitação da Fase 5

- [ ] DNS/Cloudflare inalterados e documentados como corretos.
- [ ] Novo tenant carrega em <30 s após o login.
- [ ] Nenhum `404 unknown_user` para tenant que acabou de fazer SSO.
- [ ] Nenhuma instância “zombie”; falha de spawn devolve erro explícito e é repetível.
- [ ] UID da BD, conta Linux, home e processo coincidem para todos os tenants.
- [ ] Nenhuma leitura cruzada entre tenants.
- [ ] Slugs >30 rejeitados na criação com mensagem clara.
- [ ] `testads`/`teste-global` reconciliados ou formalmente isolados numa janela de manutenção.
- [ ] `dsh-provision` legado desativado/corrigido.

### Passo 5.5 — Rollback da Fase 5

- Código: reverter o commit da correção; manter a base de dados e o mapeamento de UIDs.
- UIDs: nunca reverter “às cegas”; restaurar o backup SQLite e o snapshot de `/etc/passwd`/`/etc/group` se a reconciliação falhar.
- Subdomínios: se um tenant ficar indisponível, manter o tráfego nos hosts existentes; não alterar Cloudflare para contornar.
- Critério de abortar: qualquer leitura cruzada, qualquer `useradd` repetido, qualquer tenant existente com 5xx sustentado.

**Gate de aprovação:** responsável de infraestrutura + segurança. A reconciliação de UIDs em produção é uma alteração de infraestrutura e **não** faz parte deste documento executável.

---

## 9. Fase 6 — Validação Final

### 9.1 Portões de código e testes

- [ ] `pnpm run typecheck` verde (ou falhas pré-existentes documentadas e não introduzidas).
- [ ] `pnpm run lint` verde.
- [ ] `pnpm run test` verde para os pacotes alterados; `test:coverage` no CI.
- [ ] `pnpm run build:artifacts` e `pnpm run build:check` verdes.
- [ ] `pnpm run test:docs` / `doc-sync` se houver alteração de documentação.
- [ ] Testes negativos de SEC-001/SEC-002/SEC-003/SEC-004/SEC-005.
- [ ] `pnpm audit --prod` sem `high`/`critical`; `pnpm audit` sem `critical` em dev.
- [ ] Nenhum segredo em logs, snapshots ou artefactos.

### 9.2 Supabase

- [ ] Migração 040 confirmada (§3.1), com `is_admin_or_owner()` a exigir plataforma/flag.
- [ ] `relrowsecurity = true` em todas as tabelas de `public`, `affiliate` e `finance`.
- [ ] `finance.payout_requests`: sem `INSERT/UPDATE/DELETE` para `authenticated`.
- [ ] `affiliate.profiles`: `UPDATE` direto restrito; `paypal_email` apenas via RPC.
- [ ] `REVOKE USAGE` de `anon` nos schemas `affiliate`/`finance`.
- [ ] `SECURITY DEFINER` com `search_path` fixo e `EXECUTE` mínimo.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` rotada; apenas no app principal.
- [ ] PITR/backups diários ativos e restauro testado.
- [ ] Confirmação de e-mail, proteção de passwords comprometidas, JWT curto, MFA para operadores.
- [ ] `SUPABASE_JWT_SECRET` não configurado (o código usa `/auth/v1/user`).
- [ ] Nenhum `price_id` de teste nos planos de produção.

### 9.3 Stripe

- [ ] Webhook em `https://app.copymonster.co/api/billing/webhook` com os eventos tratados.
- [ ] `STRIPE_WEBHOOK_SECRET` de produção, não de teste.
- [ ] Chaves rotadas após SEC-008; chave restrita com o mínimo de permissões.
- [ ] 2FA e revisão de membros/roles na conta Stripe.
- [ ] Radar/alertas para picos de checkout e reembolsos.
- [ ] `PAYPAL_MOCK=true` até SEC-001/SEC-002 estarem fechados e testados.

### 9.4 PayPal e financeiro

- [ ] Fluxo sandbox completo: pedido → aprovação → execução → ledger → notificação.
- [ ] Limites de payout, moeda `USD`, conta de origem e e-mail do perfil validados.
- [ ] Reconciliação de estado PayPal vs BD (SEC-013).
- [ ] `PAYPAL_MODE=live` e `PAYPAL_MOCK=false` só depois da aprovação financeira.
- [ ] Alertas de payout e 2FA na conta business.

### 9.5 Operação, edge e observabilidade

- [ ] Headers CSP/HSTS/X-Frame-Options/X-Content-Type-Options no edge.
- [ ] `trustProxy` restrito; rate limit por conta com lockout.
- [ ] File sidecar 8082 autenticado (se k8s) e NetworkPolicy testada.
- [ ] Firewall de egress no host (metadata e ranges privados).
- [ ] Backups SQLite/Postgres do orquestrador com restauro testado.
- [ ] Alertas: payout executado, falha de webhook, 403 em série, 5xx no checkout, `useradd`/`AlreadyRunningError`.
- [ ] Runbook atualizado com os novos erros `ProvisioningConflict` e `workspace_not_ready`.

### 9.6 Plano de rollback

| Camada | Rollback | Observações |
|---|---|---|
| Aplicação | `git revert` do commit de correção + deploy do commit anterior | Testar primeiro em staging; manter migrações restritivas. |
| Migração 056 | Não aplicar *down* destrutivo; manter as revogações | Se for indispensável reverter, criar uma migração compensatória com aprovação de segurança; nunca `GRANT ALL` de volta. |
| Orquestrador | Binário anterior + backup do SQLite | Não reverter UIDs sem restaurar o snapshot de `/etc/passwd`/`/etc/group`. |
| Subdomínios | Manter DNS/Cloudflare como estão | Não existe alteração de DNS para reverter. |
| PayPal | `PAYPAL_MOCK=true` e `PAYPAL_MODE=sandbox` | Kill switch imediato. |
| Stripe | Desativar endpoint de webhook e rotar chaves | Coordenar com o responsável financeiro. |

**Gatilhos de rollback:** payout indevido ou 403 em operador legítimo; tenant existente com 5xx sustentado; leitura cruzada entre tenants; webhook com falha de assinatura em série; perda de dados ou migração aplicada em duplicado.

### 9.7 Go/No-Go

**Go:** Fases 0, 1, 2, 5 e 6 concluídas; SEC-001/002/003/004/005 fechados; subdomínio novo carrega em <30 s; PayPal em mock; backups e rollback testados.

**No-Go:** qualquer crítico/alto aberto; 040 não confirmada; UID inconsistente; `useradd`/`AlreadyRunningError` nos logs; `PAYPAL_MODE=live` antes da aprovação financeira.

---

## 10. Passos que exigem aprovação explícita

| Passo | Alteração | Impacto | Aprovação |
|---|---|---|---|
| 0.2/0.3 | Backups Supabase/SQLite | Nenhum impacto em produção; cria cópias | Segurança + operações |
| 0.5 | SQL read-only no Supabase | Nenhum | Segurança |
| 0.8 | Branch/worktree e CI | Nenhum | Engenharia |
| 1.1/1.2/1.3 | Código de payout e RLS | Bloqueia escrita direta; exige testes | Segurança + financeiro |
| 1.4 | Migração `056` | Altera permissões na BD | Segurança + DBA |
| 2.1–2.6 | Código/orquestrador/segredos | Alterações de auth, billing e orquestrador | Segurança + engenharia |
| 3.1–3.9 | Código/orquestrador/dependências | Alterações médias | Engenharia + segurança |
| 4.1–4.4 | Headers/grants/devDeps | Baixo impacto | Engenharia |
| 5.2 | Código do orquestrador + reconciliação de UID | Janela de manutenção; risco de indisponibilidade | Infraestrutura + segurança |
| 5.5 | `useradd`/`usermod`/`chown` em produção | Alto risco; exige backup e janela | Infraestrutura + segurança |
| 6.4 | `PAYPAL_MODE=live` | Dinheiro real | Financeiro + segurança |

**Nenhum destes passos foi executado.** O único artefacto produzido é este documento.

---

## 11. Anexo A — Evidências de leitura (sem segredos)

Comandos usados para a linha de base; nenhum alterou estado:

```bash
# DNS e túnel
dig +short copymonster.co A
dig +short test.copymonster.co A
cloudflared tunnel info deskcomm

# Configuração efetiva
systemctl show cloudflared -p ExecStart -p FragmentPath -p DropInPaths
ss -ltnp | grep -E ':3080|:3081'

# Respostas públicas
curl -sS -o /dev/null -w '%{http_code}\n' https://app.copymonster.co/
curl -sS -o /dev/null -w '%{http_code}\n' https://campaign.copymonster.co/
curl -sS -o /dev/null -w '%{http_code}\n' https://funel.copymonster.co/
curl -sS -o /dev/null -w '%{http_code}\n' https://test.copymonster.co/

# Orquestrador
journalctl -u dsh-orchestrator --since "10 days ago" --no-pager \
  | grep -E "useradd|AlreadyRunningError|auto-launch failed|unknown_user"

# SQLite (read-only)
node -e 'const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync("/var/lib/dsh-server-login/server-login.db",{readOnly:true}); console.log(db.prepare("select username,uid,supabase_sub from users order by uid").all())'
```

**Resultados relevantes:** túnel saudável; `app` 200; `campaign`/`funel` 401 sem cookie; `test` 404 `unknown_user`; UID da BD e de `/etc/passwd` divergentes em `testads`/`teste-global`; log de `useradd` com `status: 6` e `AlreadyRunningError`.

---

## 12. Anexo B — Índice de ficheiros e linhas

| ID | Ficheiro | Linhas |
|---|---|---|
| SEC-001 | `packages/api/auth-http/src/payout-executor.ts` | 443 |
| SEC-002 | `supabase/migrations/052_affiliate_and_finance_schemas.sql` | 288-298, 141-155, 189-190 |
| SEC-003 | `/opt/copymonster/dsh-server-login/src/web/routes/auth.ts` | 235-245 |
| SEC-004 | `supabase/migrations/052_affiliate_and_finance_schemas.sql` | 228-236 |
| SEC-005 | `packages/api/auth-http/src/billing.ts`; `affiliate-processor.ts` | 327-333, 406-409; 70-150 |
| SEC-006 | `packages/web/web-fetch-http/src/provider.ts`; `policy.ts` | 101-112; 44-56 |
| SEC-007 | `/opt/copymonster/dsh-server-login/src/web/routes/dsh.ts`; `src/config.ts` | 115-118; 160, 381 |
| SEC-008 | `/etc/dsh-server-login.env`; `src/supervisor/spawn.ts` | —; 17-36 |
| SEC-009 | `packages/api/auth-http/src/session-token.ts` | 275, 302, 312, 342, 380 |
| SEC-010 | `packages/api/auth-http/src/billing.ts`; `payout-executor.ts` | 415, 473, 665; 199 |
| SEC-011 | `/opt/copymonster/dsh-server-login/src/web/server.ts` | 79 |
| SEC-012 | `src/web/file-service.ts`; `src/supervisor/k8s-spawner.ts` | 9-13; 608-620 |
| SEC-013 | `packages/api/auth-http/src/payout-executor.ts` | 278-330 |
| SEC-014 | `package.json`; `pnpm-lock.yaml` | — |
| SEC-015 | `packages/api/auth-http/src/billing.ts` | 574 |
| SEC-016 | `supabase/migrations/040_admin_flag_and_rls.sql`; `052` | —; 189 |
| SEC-017 | `src/web/middleware/rate-limit.ts`; `src/web/routes/auth.ts` | 11-18; 306 |
| SEC-018 | `/opt/copymonster/dsh-server-login/src/web/server.ts` | — |
| SEC-019 | `supabase/migrations/052_affiliate_and_finance_schemas.sql` | 14-15 |
| SEC-020 | `packages/api/auth-http/src/payout-executor.ts` | 356 |
| SEC-021 | `package.json` | — |
| OPS-SUB-01 | `src/supervisor/orchestrator.ts`; `src/supervisor/proxy.ts`; `src/db/repo.ts` | 108-143, 322-335, 146-148; 156-173, 308-323; 49-50 |
| OPS-SUB-02 | `dsh-provision.service` legado | — |

---

## 13. Anexo C — Riscos residuais e decisões pendentes

1. **Migração 040:** sem introspeção SQL, não é possível afirmar que está aplicada; a Fase 0 tem de confirmar. Se não estiver, todo o gate administrativo está comprometido.
2. **UIDs em produção:** a correção exige uma janela de manutenção e um mapa canónico; não deve ser feita em paralelo com o go-live.
3. **RPC SQL vs função TypeScript:** a opção mínima (revogar escrita direta) fecha SEC-002, mas a opção atómica em SQL é mais robusta. A decisão deve ser tomada antes de abrir o programa de afiliados.
4. **Atribuição de afiliados:** a correção de SEC-005 exige produto (cookie assinado, janela de atribuição, auto-referral); não é apenas código de servidor.
5. **Stripe/PayPal live:** continuam bloqueados até SEC-001/SEC-002 e reconciliação SEC-013 estarem testados.
6. **Versão do cloudflared:** 2026.10.0 está desatualizada; atualizar é recomendado numa janela separada, não é causa do bug.
7. **Cópia morta `/etc/cloudflared/config.yml`:** não editar; remover só depois de confirmar que nenhum script a usa.

---

**Fim do plano. Aguarda aprovação para executar qualquer passo.**
