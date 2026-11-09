# Relatório de Auditoria de Segurança DevSecOps

**Projeto:** CopyMonster — aplicação principal + orquestrador DSH multi-tenant
**Data:** 10 de novembro de 2026
**Âmbito:** `/root/copymonster-launch` (app principal), `/opt/copymonster/dsh-server-login` (orquestrador), configuração viva do Supabase e da Stripe
**Tipo:** auditoria de leitura (*read-only*), sem alterações de código, dados ou infraestrutura
**Classificação global:** **CRÍTICO — go-live bloqueado** até correção de `SEC-001` e `SEC-002`

---

## 1. Sumário executivo

A plataforma tem uma base de segurança acima da média para um SaaS em pré-lançamento: a assinatura do webhook da Stripe é verificada com HMAC-SHA256 em tempo constante e falha fechada, a `STRIPE_SECRET_KEY` e a `SUPABASE_SERVICE_ROLE_KEY` estão confinadas ao servidor, o bundle do frontend só contém a chave `anon`, todas as tabelas dos schemas `public`, `affiliate` e `finance` têm RLS ativado nas migrações, o acesso anónimo a dados pessoais está bloqueado, o proxy do orquestrador valida cookie assinado + *slug* + propriedade antes de encaminhar, e o ambiente dos DSHs de tenant não recebe a chave `service_role`.

Ainda assim, existem **duas falhas críticas encadeáveis** na área de afiliados/pagamentos:

1. A rota administrativa de execução de payouts considera “operador” qualquer identidade com `role === 'owner'` ou `'admin'`. Como a migração 032 dá a **todos** os novos utilizadores o papel `owner` do seu tenant pessoal, **qualquer utilizador autenticado** consegue chamar `/api/admin/affiliate/payout/execute` e `/api/admin/admin-execute-payout`.
2. A política RLS `payouts_insert_own` permite a um afiliado aprovado inserir diretamente em `finance.payout_requests` com **valor e email PayPal arbitrários**, sem passar pelas validações do servidor (mínimo, saldo disponível, pedido concorrente) e sem amarrar o `paypal_email_snapshot` ao perfil.

Combinadas, as duas falhas permitem a um afiliado aprovado criar um pedido de saque de valor arbitrário para uma conta PayPal que controla e executá-lo sem intervenção de um operador. Hoje o impacto financeiro real está limitado porque o ambiente usa `PAYPAL_MODE=sandbox` e `PAYPAL_MOCK=true`; **ao ativar as credenciais live, a falha passa a ser perda financeira direta**.

Fora do circuito de pagamentos, os riscos mais relevantes são: vinculação automática de conta SSO por *slug* (potencial tomada de conta do workspace DSH), atualização direta de campos sensíveis do perfil de afiliado, atribuição de comissão controlada pelo cliente no checkout, SSRF no *fetch* HTTP do agente (sem validação de IP público), segredos Stripe desnecessários no ambiente do orquestrador e *defaults* perigosos de isolamento (`soft`, `portGuard=false`).

### 1.1 Distribuição dos achados

| Severidade | Quantidade |
|---|---|
| Crítico | 2 |
| Alto | 6 |
| Médio | 9 |
| Baixo | 4 |
| **Total** | **21** |

### 1.2 Top 3 ações antes do go-live

1. **Corrigir a autorização de payout** (`SEC-001`) e **revogar o INSERT direto** em `finance.payout_requests` (`SEC-002`), com testes de regressão que neguem um `owner` de tenant pessoal.
2. **Corrigir a vinculação SSO por *slug*** (`SEC-003`) antes de permitir login SSO em contas locais pré-existentes.
3. **Fechar a escrita direta em `affiliate.profiles`** (`SEC-004`) e validar a atribuição de afiliado no servidor (`SEC-005`).

> Nota: o relatório é *read-only*. Nenhuma correção foi aplicada, nenhum `DELETE`/`DROP` foi executado e nenhum ficheiro de infraestrutura proibido (`/etc/nginx/`, `/etc/apache2/`, `/usr/local/hestia/`) foi lido ou alterado. Nenhum segredo foi impresso ou escrito neste documento.

---

## 2. Metodologia e limitações

### 2.1 O que foi feito

- Revisão estática dos pontos de entrada HTTP do app principal (`packages/api/auth-http/src/*`, `packages/api/auth-context/src/*`, `packages/api/settings-controller/src/*`), do frontend (`apps/web/src/**`) e do orquestrador (`src/web/**`, `src/supervisor/**`, `src/config.ts`, `src/isolation.ts`, `deploy/**`).
- Leitura integral das migrações Supabase 001–055, com foco em 002, 003, 006, 008, 025, 032, 040, 044, 047, 048, 049, 050, 052, 053, 054 e 055.
- Probes HTTP ao PostgREST vivo com a chave `anon` (verificação de exposição) e com a chave `service_role` (apenas contagens de linhas, sem ler PII).
- `pnpm audit --json` nos dois repositórios, incluindo `--prod` no app principal.
- Inspeção de permissões de ficheiros de ambiente (`stat`) e de chaves presentes (valores sempre redigidos).

### 2.2 Limitações (verificação residual)

| Limitação | Consequência |
|---|---|
| Sem JWT de utilizador final, password de Postgres ou `SUPABASE_ACCESS_TOKEN`, não foi possível ler `pg_policies`, `pg_proc.prosrc` nem `relrowsecurity` da instância viva. | As políticas e corpos de funções foram avaliados **estaticamente** pelas migrações. Confirmar no dashboard (checklist §7.1) que a migração 040 é a versão em vigor. |
| O CLI `supabase` está instalado mas não autenticado (`LegacyPlatformAuthError`). | Sem introspeção de esquema pela Management API. |
| O PostgREST só expõe os schemas `public`, `graphql_public`, `affiliate` e `finance`. | Sem acesso a `pg_catalog`/`information_schema` para auditoria de políticas. |
| Não foram executados testes de carga, *fuzzing* nem testes destrutivos. | Achados de DoS baseiam-se em advisories e revisão de código. |
| `PAYPAL_MODE=sandbox`, `PAYPAL_MOCK=true`. | O circuito de payout não movimenta dinheiro real hoje; a severidade foi atribuída ao cenário de produção. |

---

## 3. Tabela de achados

| ID | Severidade | Módulo | Arquivo/Linha | Descrição da Falha | Correção Sugerida |
|---|---|---|---|---|---|
| SEC-001 | **Crítico** | Afiliados / Admin API | `packages/api/auth-http/src/payout-executor.ts:443` | `handleAdminExecutePayout` autoriza `identity.isAdmin === true` **ou** `role === 'admin'` **ou** `role === 'owner'`. Todo o signup recebe `owner` do tenant pessoal (migração 032), logo qualquer utilizador autenticado executa payouts para qualquer `payoutId`. O gate correto (`PLATFORM_TENANT_ID`) existe apenas no cliente (`apps/web/src/lib/auth/platform-admin.ts`). | Autorizar exclusivamente `isAdmin === true` ou membership `owner/admin` no tenant `00000000-0000-0000-0000-000000000001`; repetir o gate na base de dados; teste de regressão negando `owner` de tenant pessoal. |
| SEC-002 | **Crítico** | RLS `finance` | `supabase/migrations/052_affiliate_and_finance_schemas.sql:288-298` (e `:141-155`, `:189-190`) | `payouts_insert_own` permite INSERT direto em `finance.payout_requests`. Não valida saldo, mínimo, pedido em curso, nem amarra `paypal_email_snapshot` ao perfil; a tabela só impõe `amount > 0`. `GRANT ALL ... TO authenticated` amplia a superfície. Encadeada com SEC-001, permite criar e executar um saque arbitrário. | Revogar INSERT direto e expor apenas uma RPC `SECURITY DEFINER` (`request_my_payout(amount)`) com todos os invariantes; `WITH CHECK` para o email *snapshot*; conceder apenas os privilégios necessários. |
| SEC-003 | **Alto** | SSO / Orquestrador | `/opt/copymonster/dsh-server-login/src/web/routes/auth.ts:235-245` | Se não existe utilizador com o `supabase_sub`, o orquestrador vincula a conta local cujo `username` é igual ao *slug* do tenant devolvido pelo app principal. Não há prova de que o utilizador SSO controla essa conta (que pode ser *password-only*, com `supabase_sub = null`). Uma colisão de *slug* permite tomada de conta e do workspace DSH. | Exigir prova de posse (token de vinculação enviado para o email da conta local) ou desativar a vinculação automática; nunca usar o *slug* como prova de identidade. |
| SEC-004 | **Alto** | RLS `affiliate` | `supabase/migrations/052_affiliate_and_finance_schemas.sql:228-236` | `affiliate_profiles_update_own` deixa o afiliado atualizar qualquer coluna não fixada: `paypal_email` (contorna `affiliate.update_paypal_email`, que audita e regista `paypal_last_changed_at`), `trust_score`, `full_name`, `cpf_cnpj` e `active`. Apenas `kyc_status` é fixado, por uma subconsulta auto-referente. | Revogar UPDATE direto e manter RPCs auditadas por campo; ou `WITH CHECK` que fixe todas as colunas sensíveis. |
| SEC-005 | **Alto** | Billing / Afiliados | `packages/api/auth-http/src/billing.ts:327-333` e `:406-409` | O checkout aceita `affiliateId` do corpo com validação apenas de formato UUID e grava-o na metadata assinada da sessão Stripe; o webhook credita a comissão sem verificar existência/aprovação do afiliado, auto-indicação ou elegibilidade da venda. Permite auto-referral e atribuição arbitrária de comissões. | Resolver a atribuição no servidor a partir de referência assinada; validar afiliado ativo/aprovado e `affiliate.user_id != identity.userId`; limitar à primeira compra; registar em auditoria. |
| SEC-006 | **Alto** | Web fetch / SSRF | `packages/web/web-fetch-http/src/provider.ts:101-112`; `packages/web/web-fetch-http/src/policy.ts:44-56` | `validateFetchUrl` valida apenas esquema e comprimento. O comentário promete “resolução de endereço público e *pinning*”, mas `requestOnce` chama `undici.fetch` diretamente. Com *prompt injection*, o agente alcança `169.254.169.254`, `localhost` e serviços internos. A NetworkPolicy k8s mitiga; em modo local não há filtro de egress. | Resolver DNS e rejeitar ranges privados, loopback, link-local e metadata, fixando o IP resolvido; validar também IPs literais e redirects. |
| SEC-007 | **Alto** | Orquestrador / Execução | `/opt/copymonster/dsh-server-login/src/web/routes/dsh.ts:115-118`; `src/config.ts:160` e `:381` | `/api/dsh/restart` aceita `command` (até 1024 caracteres) e o *watchdog* executa-o. É intencional para o fluxo do agente, mas os *defaults* `isolationMode='soft'` e `portGuard=false` significam que, sem overrides, qualquer utilizador autenticado corre comandos no mesmo UID do orquestrador. A produção atual define `account`/`true` (verificado), mas o *default* é perigoso para novos deploys. | Falhar o arranque quando `NODE_ENV=production` e `isolationMode !== 'account'` ou `portGuard !== true`; documentar a invariante; reduzir o handoff a operações permitidas. |
| SEC-008 | **Alto** | Segredos / Orquestrador | `/etc/dsh-server-login.env`; `/opt/copymonster/dsh-server-login/src/supervisor/spawn.ts:17-36` | O ambiente do orquestrador contém `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET`, que o código não usa. O processo corre como `root` e gere processos de tenants; um compromisso do orquestrador expõe credenciais de pagamento. O *allowlist* de spawn está correto (não passa a chave aos tenants), mas o segredo não devia existir no processo. | Remover as variáveis Stripe do ficheiro do orquestrador e rodar com utilizador dedicado quando possível; rotar as chaves após a remoção. |
| SEC-009 | Médio | Logs / PII | `packages/api/auth-http/src/session-token.ts:275`, `:302`, `:312`, `:342`, `:380` | `console.error` regista `sub`, `aud`, `exp`, corpos de erro do Supabase e o objeto de perfil (email, nome, tenant) em journald. Viola minimização de PII e expõe metadados de identidade. | Logar apenas códigos estáveis e IDs internos; nunca *claims*, tokens ou perfil; usar *redaction* no logger. |
| SEC-010 | Médio | Billing / API | `packages/api/auth-http/src/billing.ts:415`, `:473`, `:665`; `packages/api/auth-http/src/payout-executor.ts:199` | `err.message`, `insertError.message` e erros PayPal são devolvidos ao cliente, expondo detalhes de configuração/base de dados e facilitando reconhecimento. | Mapear para códigos públicos (`billing_error`, `payout_insert_failed`); guardar o detalhe apenas no servidor. |
| SEC-011 | Médio | Orquestrador / Auth | `/opt/copymonster/dsh-server-login/src/web/server.ts:79` | `trustProxy: true` sem *allowlist*: qualquer *peer* pode forjar `X-Forwarded-For`, escolhendo o *bucket* de rate limit (login 10/min, session-token 20/min) e o IP gravado em auditoria. | Restringir `trustProxy` ao proxy/edge conhecido; derivar o IP do socket; aceitar `cf-connecting-ip` apenas de IPs de confiança. |
| SEC-012 | Médio | File sidecar | `/opt/copymonster/dsh-server-login/src/web/file-service.ts:9-13`; `src/supervisor/k8s-spawner.ts:608-620` | O serviço de ficheiros na porta 8082 não tem autenticação; a única barreira é a NetworkPolicy (presente no manifesto gerado). Um erro de política ou uma rede partilhada expõe o *home* do utilizador. | Adicionar token HMAC partilhado com o *control plane* (defense in depth), bind restrito e teste negativo. |
| SEC-013 | Médio | Financeiro | `packages/api/auth-http/src/payout-executor.ts:278-330` | `executePayout` não revalida saldo/valor no momento da execução, não impõe teto máximo e não reconcilia PayPal vs base de dados quando o processo falha após obter `batchId` (payout fica `PROCESSING`, ledger inconsistente). | Revalidar invariantes na transação de execução; *idempotency key* PayPal; job de reconciliação; limite máximo configurável. |
| SEC-014 | Médio | Dependências | `package.json` / `pnpm-lock.yaml` (app principal) | 18 advisories *high* em dependências de produção e 26 *moderate*; 4 *critical* apenas em devDependencies. Detalhe em §6. | Atualizar para as versões corrigidas; `pnpm audit --prod` no CI; *overrides* para `undici` e `follow-redirects`. |
| SEC-015 | Médio | Billing webhook | `packages/api/auth-http/src/billing.ts:574` | Filtro PostgREST `.or(...)` construído por interpolação de `priceId`. Hoje o valor vem de um evento assinado pela Stripe, mas qualquer evolução que aceite input de utilizador transforma isto em injeção de filtro. | Validar `priceId` contra `^price_[A-Za-z0-9]+$` e usar `.eq()`/`.in()`, ou duas consultas separadas. |
| SEC-016 | Médio | RLS / Migrações | `supabase/migrations/040_admin_flag_and_rls.sql`; `052:189` | O comportamento seguro de `is_admin_or_owner()` depende de a migração 040 estar aplicada na instância viva. Não foi possível ler `pg_policies`/corpo das funções. Se 040 não estiver aplicada, **todo** o dono de tenant pessoal passa em todas as políticas administrativas (PII de afiliados, audit logs, workspaces). | Verificação SQL read-only no dashboard; *gate* de versão mínima de migração no arranque/healthcheck; nunca assumir a migração aplicada. |
| SEC-017 | Médio | Orquestrador / Auth | `src/web/middleware/rate-limit.ts:11-18`; `src/web/routes/auth.ts:306` | Limite global de 100/min por IP e login de 10/min por IP, sem *lockout* progressivo por conta; com SEC-011 o atacante escolhe o *bucket*. | Limitar por conta + IP, *backoff* exponencial, CAPTCHA após N falhas e alertas. |
| SEC-018 | Baixo | Orquestrador | `/opt/copymonster/dsh-server-login/src/web/server.ts` | Sem `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options` ou `X-Content-Type-Options` nas respostas (o edge pode adicionar alguns). | Adicionar `@fastify/helmet` com CSP compatível e HSTS no edge. |
| SEC-019 | Baixo | Permissões Supabase | `supabase/migrations/052_affiliate_and_finance_schemas.sql:14-15` | `GRANT USAGE` nos schemas `affiliate`/`finance` a `anon` (sem privilégios de tabela; *probe* devolve `42501`). | Revogar `USAGE` de `anon`; manter apenas `authenticated` e `service_role`. |
| SEC-020 | Baixo | Auditoria / PII | `packages/api/auth-http/src/payout-executor.ts:356` | O `metadata.email` grava o email PayPal em `affiliate.audit_logs`; é PII desnecessária para reconciliação. | Guardar *hash*/últimos 4 caracteres ou referência ao perfil. |
| SEC-021 | Baixo | Supply chain | `package.json` (app principal) | 4 advisories *critical* apenas em devDependencies (`vitest`, `tinypool`, `dompurify`). Não vão para produção, mas comprometem CI e máquinas de desenvolvimento. | Atualizar devDependencies; não expor a UI do Vitest; isolar o CI. |

---

## 4. Detalhamento dos achados

### 4.1 SEC-001 — Execução de payout sem autorização de operador (Crítico)

**Local:** `packages/api/auth-http/src/payout-executor.ts:443`

```ts
// Operator access check: isAdmin || role in ('admin', 'owner')
const isOperator = identity.isAdmin === true || identity.role === 'admin' || identity.role === 'owner'
if (!isOperator) {
  sendJson(res, 403, { error: 'forbidden' })
  return
}
```

`identity` é resolvido por `ctx.auth.resolveIdentity(token)` → RPC `get_my_profile()` → primeira membership do utilizador. A migração `032_production_gates_and_tenants.sql` cria, para cada novo signup, um tenant pessoal com papel `owner`. Portanto:

- `identity.role === 'owner'` é verdadeiro para **qualquer** utilizador registado, não apenas para operadores da plataforma.
- O teste correto já existe no cliente (`apps/web/src/lib/auth/platform-admin.ts`: `isPlatformAdmin` exige `tenantId === PLATFORM_TENANT_ID`), mas **não** é aplicado no servidor.
- As rotas `POST /api/admin/affiliate/payout/execute` e o alias `POST /api/admin/admin-execute-payout` estão registadas em `packages/api/auth-http/src/index.ts:354-364` e só exigem um *bearer token* válido.

**Impacto:** qualquer conta autenticada pode executar um payout existente, incluindo o seu próprio, sem aprovação de operador. Combinado com SEC-002, o valor e o destino são escolhidos pelo atacante. Em modo PayPal live, é perda financeira direta.

**Correção:** usar exclusivamente `identity.isAdmin === true` ou verificar membership `owner/admin` no tenant de plataforma. Idealmente, repetir o gate numa RPC `SECURITY DEFINER` que execute a transição e escreva o ledger, para que a regra não dependa do processo Node. Adicionar teste que autentica um `owner` de tenant pessoal e espera `403`.

### 4.2 SEC-002 — INSERT direto em `finance.payout_requests` (Crítico)

**Local:** `supabase/migrations/052_affiliate_and_finance_schemas.sql:288-298`

```sql
CREATE POLICY "payouts_insert_own" ON finance.payout_requests
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM affiliate.profiles p
            WHERE p.id = finance.payout_requests.affiliate_id
              AND p.user_id = auth.uid()
              AND p.kyc_status = 'APPROVED'
              AND p.active = true
        )
    );
```

A política valida apenas a propriedade do perfil e o KYC. Não valida:

- `amount` contra o saldo do ledger (`getAffiliateBalance`);
- o mínimo da regra de comissão;
- a inexistência de outro pedido `REQUESTED/APPROVED/PROCESSING`;
- que `paypal_email_snapshot` corresponde ao `paypal_email` do perfil;
- um teto máximo de valor.

O servidor (`requestAffiliatePayout`, linhas 113-211) implementa todas essas regras, mas a RLS permite ao cliente do browser escrever diretamente na tabela com o JWT do utilizador. Um afiliado aprovado pode inserir um pedido de valor arbitrário para qualquer email PayPal e, via SEC-001, executá-lo.

**Mitigação atual:** `PAYPAL_MOCK=true` e `PAYPAL_MODE=sandbox`. **Não reduz a severidade do código**, apenas o impacto imediato.

**Correção:** revogar `INSERT` direto de `authenticated` e expor uma RPC `SECURITY DEFINER` que execute todas as validações atomicamente (idealmente com `FOR UPDATE`/constraint de pedido único). Aplicar o mesmo princípio a `affiliate.profiles` (SEC-004).

### 4.3 SEC-003 — Vinculação SSO por *slug* (Alto)

**Local:** `/opt/copymonster/dsh-server-login/src/web/routes/auth.ts:235-245`

```ts
const byName = await app.db.findUserBySlug(username)
if (byName !== undefined) {
  if (byName.supabase_sub !== null) return reply.code(403)...
  if (byName.role === 'disabled') ...
  if (byName.role === 'pending') ...
  await app.db.setUserSupabaseSub(byName.id, sub)
  user = byName
```

O `username` vem do *slug* do tenant no app principal, controlado pelo nome escolhido no registo. Se existir uma conta local antiga (criada por password, sem `supabase_sub`) com o mesmo *slug*, a identidade SSO é vinculada sem qualquer prova de posse. O resultado é acesso ao *home*, ficheiros, chaves de API e sessões DSH da vítima.

**Correção:** vinculação explícita com confirmação no email da conta local (token de uso único), ou proibir a vinculação automática e exigir que o utilizador faça login local primeiro. Adicionar auditoria e notificação de vinculação.

### 4.4 SEC-004 — Escrita direta em campos sensíveis do afiliado (Alto)

**Local:** `supabase/migrations/052_affiliate_and_finance_schemas.sql:228-236`

A política `affiliate_profiles_update_own` permite `UPDATE` ao próprio, com `WITH CHECK` que só fixa `kyc_status` (via subconsulta auto-referente). Ficam mutáveis: `paypal_email`, `trust_score`, `full_name`, `cpf_cnpj`, `active` e `paypal_last_changed_at`.

- `paypal_email` deve mudar apenas via `affiliate.update_paypal_email` (053), que valida formato e regista auditoria; a escrita direta contorna esse controlo.
- `trust_score` é um sinal de risco; se alguma elegibilidade o consultar, o afiliado pode aumentá-lo.
- `active` controla a elegibilidade de comissões/payouts.

**Correção:** revogar `UPDATE` direto na tabela e expor RPCs por campo; se for inevitável manter a política, fixar todas as colunas sensíveis no `WITH CHECK` e testar cada tentativa de alteração.

### 4.5 SEC-005 — Atribuição de afiliado controlada pelo cliente (Alto)

**Local:** `packages/api/auth-http/src/billing.ts:327-333` e `:406-409`

O corpo do checkout fornece `affiliateId`; o servidor valida apenas `UUID_REGEX` e envia-o em `metadata[affiliate_id]` e `subscription_data[metadata][affiliate_id]`. O webhook (`affiliate-processor.ts:90-140`) verifica que o perfil existe, está ativo e com KYC aprovado, mas não verifica:

- que o afiliado não é o próprio comprador (auto-referral);
- que a venda é a primeira do comprador ou elegível para comissão;
- que o `affiliateId` foi capturado por um canal confiável (cookie assinado).

Qualquer utilizador pode indicar o UUID de um afiliado (ou o seu) e gerar comissão sobre a sua própria subscrição, ou desviar comissões.

**Correção:** assinar a referência no servidor, validar `affiliate.user_id != identity.userId`, aplicar regra de primeira compra/janela de atribuição e registar a decisão em auditoria.

### 4.6 SEC-006 — SSRF no *fetch* HTTP do agente (Alto)

**Local:** `packages/web/web-fetch-http/src/provider.ts:101-112`; `policy.ts:44-56`

`validateFetchUrl` só rejeita esquemas não HTTP(S), credenciais embutidas e URLs acima de 2048 caracteres. O comentário de `policy.ts` afirma que “a resolução de endereço público e o *pinning* da conexão correm depois”, mas `requestOnce` chama `undici.fetch` diretamente, sem `lookup`/`dispatcher` que bloqueie ranges privados.

**Impacto:** um agente sujeito a *prompt injection* pode pedir `http://169.254.169.254/latest/meta-data/...`, `http://127.0.0.1:3080/...` ou serviços internos. Em k8s, a NetworkPolicy de egress bloqueia `10/8`, `172.16/12`, `192.168/16` e `169.254.169.254`; em modo local (`deployMode=local`, o que corresponde ao serviço systemd atual) não existe esse filtro.

**Correção:** resolver o hostname e rejeitar IPs privados/loopback/link-local/metadata antes de conectar, fixar o IP resolvido para evitar *DNS rebinding*, e cobrir o caso em teste.

### 4.7 SEC-007 — Execução de comando e *defaults* de isolamento (Alto)

**Local:** `src/web/routes/dsh.ts:115-118`; `src/config.ts:160` e `:381`

```ts
app.post('/api/dsh/restart', { preHandler: requireAuth, schema: restartSchema }, async (request, reply) => {
  const { command } = request.body as { command: string }
  await app.userFs.writeHandoff(user.id, JSON.stringify({ command, createdAt: Date.now() }))
```

O *watchdog* lê o handoff e executa o comando após o respawn. O utilizador já controla o seu DSH (que tem shell por desenho), pelo que a execução em si não é uma escalada **quando** o isolamento é por conta. O risco está nos *defaults*: `DEFAULT_ISOLATION_MODE = 'soft'` e `portGuard` com fallback `false`. Se um deploy não definir `DSH_SERVER_LOGIN_ISOLATION_MODE=account` e `DSH_SERVER_LOGIN_PORT_GUARD=true`, todos os tenants partilham o UID e o comando do handoff corre no contexto do orquestrador.

**Verificado:** `/etc/dsh-server-login.env` define `account` e `true`, e tem modo `600 root:root`. O achado é sobre a segurança do *default*, não sobre o deploy atual.

**Correção:** recusar arrancar em produção com `soft`/`portGuard=false`; documentar a invariante e adicionar um teste de configuração.

### 4.8 SEC-008 — Segredos Stripe no orquestrador (Alto)

**Local:** `/etc/dsh-server-login.env` (chaves presentes, valores não impressos); `src/supervisor/spawn.ts:17-36` (allowlist correta)

O orquestrador não contém qualquer referência a `STRIPE_*` no código (`grep` sem resultados), mas o ficheiro de ambiente injeta `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` no processo, que corre como `root`. O *allowlist* de spawn impede que cheguem ao tenant, mas mantém-nos no processo de maior privilégio do host.

**Correção:** remover as duas variáveis do ficheiro do orquestrador, reiniciar o serviço e rotar as chaves (a rotação é obrigatória porque estiveram expostas a um processo que não as devia ter).

### 4.9 SEC-009 a SEC-021 (Médio/Baixo)

- **SEC-009 (logs):** `session-token.ts` regista `sub`, `aud`, `exp`, corpos de erro e o objeto `profile` (email, nome, tenant). Reduzir a códigos estáveis; nunca logar tokens/claims.
- **SEC-010 (erros):** `billing.ts` devolve `err.message` da Stripe/Supabase e `payout-executor.ts` devolve `insertError.message`. Mapear para códigos públicos.
- **SEC-011 (proxy):** `trustProxy: true` permite forjar `X-Forwarded-For`, escolhendo o *bucket* de rate limit e o IP de auditoria.
- **SEC-012 (file sidecar):** porta 8082 sem autenticação; a NetworkPolicy gerada por `k8s-spawner.ts:608-620` é a única barreira.
- **SEC-013 (financeiro):** `executePayout` não revalida saldo/valor, não tem teto e não reconcilia o estado PayPal vs BD em falha parcial.
- **SEC-014 (dependências):** ver §6.
- **SEC-015 (filtro):** `.or()` interpolado com `priceId`; baixa exploração hoje (evento assinado), mas é um padrão a eliminar.
- **SEC-016 (migração):** se 040 não estiver aplicada, `is_admin_or_owner()` volta à versão 025, que usa o “tenant ativo” e devolve `true` para qualquer `owner` — abrindo todas as políticas administrativas. Verificação obrigatória no checklist.
- **SEC-017 (auth):** login 10/min por IP sem *lockout* por conta; combinado com SEC-011, o limite é contornável.
- **SEC-018 (headers):** orquestrador sem CSP/HSTS/X-Frame-Options; o edge pode compensar.
- **SEC-019 (grants):** `USAGE` em `affiliate`/`finance` para `anon`; sem privilégios de tabela, mas desnecessário.
- **SEC-020 (PII):** email PayPal em `audit_logs.metadata`.
- **SEC-021 (dev):** advisories *critical* apenas em ferramentas de desenvolvimento.

---

## 5. Controles positivos verificados

| Controlo | Evidência |
|---|---|
| Assinatura do webhook Stripe | `billing.ts:257-292`: HMAC-SHA256, `timingSafeEqual`, tolerância de 300 s, falha fechada sem `STRIPE_WEBHOOK_SECRET` (`:510-516`) e rejeição de assinatura inválida antes de processar. |
| `STRIPE_SECRET_KEY` apenas no servidor | Nenhuma referência em `apps/web/src`; o bundle compilado contém apenas a chave `anon` (JWT descodificado: `role=anon`, `ref` do projeto). `sk_live`/`sk_test` ausentes de `apps/web/dist`. |
| Chave `service_role` fora do tenant | `src/supervisor/spawn.ts:26-36`: allowlist explícita sem `SUPABASE_SERVICE_ROLE_KEY`; `supabase-url`/`anon` apenas. |
| RLS ativado | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` para todas as tabelas de `public`, `affiliate` e `finance` nas migrações; `anon` bloqueado em tabelas de PII (`42501`) e sem linhas nas restantes. |
| RPCs `SECURITY DEFINER` | `admin_review_kyc`, `admin_review_commission`, `admin_publish_commission_rule`, `admin_list_tenants`, `admin_list_audit_logs`, `get_admin_audit_kpis` exigem `is_admin_or_owner()`; `search_path` fixo; `REVOKE ... FROM PUBLIC, anon`. |
| Proxy multi-tenant | `proxy.ts:146-173`: cookie assinado + utilizador ativo + `username === slug` + `x-dsh-identity` assinado (Ed25519) e remoção do header vindo do cliente (`:44`, `:68`). |
| Cookies | Sessão do orquestrador com HMAC-SHA256 + `timingSafeEqual`, `HttpOnly`, `Secure` e `SameSite` configuráveis; `jti` amarrado à linha de sessão (logout revoga). |
| `service_role` não exposta na UI | O cliente Supabase do browser usa `VITE_SUPABASE_ANON_KEY`; `get_my_profile()`/`get_my_tenant_metrics()` derivam o tenant de `auth.uid()`. |
| Rate limiting no app principal | Todas as rotas públicas (`/api/auth/me`, checkout, portal, webhook, payout, session-token, LLM test) passam por `limited()`; `trustedProxyAddresses` limita a confiança em `X-Forwarded-For` a loopback por omissão. |
| Segredos em ficheiro | `.env` e `.env.systemd` com modo `600 root:root`, não *tracked* (`git ls-files` não os lista); `/etc/dsh-server-login.env` com `600 root:root`. |
| Isolamento de produção do orquestrador | `account` + `portGuard=true` + `secureCookies=true` em `/etc/dsh-server-login.env`; NetworkPolicy por utilizador com *egress* restrito e exclusão de metadata. |

---

## 6. Dependências vulneráveis

### 6.1 App principal — `pnpm audit`

| Âmbito | Crítico | Alto | Médio | Baixo | Total |
|---|---|---|---|---|---|
| Todas (dev + prod) | 4 | 35 | 43 | 9 | 91 |
| Apenas produção (`--prod`) | 0 | 18 | 26 | 4 | 48 |

**Advisories *high* em produção (agrupados):**

| Pacote | Versão vulnerável | Correção | Advisory |
|---|---|---|---|
| `undici` | `7.x < 7.30.1`, `8.x < 8.12.2` | `7.30.1` / `8.12.2` | DoS por *content-encoding*, *cache poisoning* em redirects, *bypass* de TLS, DoS TLS 1.2 |
| `follow-redirects` | `1.16.0–1.16.1` | `1.16.2` | Fuga de cabeçalhos credenciados em redirects cross-origin |
| `@modelcontextprotocol/sdk` | `1.3.0–1.31.x` | `1.32.0` | Tarefas não ligadas à sessão; DoS por memória na validação |
| `vite` | `8.2.0–8.2.3` | `8.2.4` | `launch-editor` no Windows |
| `zod` | `< 4.6.6` | `4.6.6` | DoS de memória em coleções limitadas |
| `body-parser` | `2.0.0–2.3.x` | `2.4.0` | DoS com *trailing bytes* após corpo comprimido |
| `happy-dom` | `17.0.0–21.0.3` | `21.0.4` | Execução de código via alias de import; SSRF em HTML não confiável |

**Advisories *critical* (apenas devDependencies):** `vitest < 3.2.6` (leitura/execução arbitrária de ficheiros com a UI aberta), `tinypool <= 2.1.0` e `< 2.1.2` (*prototype pollution* → RCE), `dompurify 3.4.4–3.4.16` (*bypass* de `SAFE_FOR_TEMPLATES`). Não afetam o runtime de produção, mas comprometem CI e estações de desenvolvimento.

### 6.2 Orquestrador — `pnpm audit`

| Severidade | Quantidade | Pacotes |
|---|---|---|
| Crítico / Alto | 0 | — |
| Médio | 2 | `glob 13.0.6` (bypass de `AbortSignal`), `minimatch 10.2.6` (DoS por amplificação) |
| Baixo | 0 | — |

Ambos vêm de `@fastify/static`; corrigir com `glob >= 14.0.2` e `minimatch >= 11.0.1` (ou atualizar `@fastify/static`).

---

## 7. Checklist de produção

### 7.1 Supabase (Dashboard + SQL read-only)

**Prioridade máxima — confirmar a migração 040**

- [ ] Executar no SQL Editor: `select pg_get_functiondef('public.is_admin_or_owner()'::regprocedure);` e confirmar que a definição exige o tenant `00000000-0000-0000-0000-000000000001` ou `users.metadata.is_admin = 'true'` (e **não** usa `get_current_tenant_id()`).
- [ ] Confirmar que `select count(*) from public.user_tenant_roles where tenant_id = '00000000-0000-0000-0000-000000000001';` corresponde apenas aos operadores reais.
- [ ] Confirmar que nenhum utilizador não-operador tem `metadata->>'is_admin' = 'true'`: `select id, email from public.users where metadata->>'is_admin' = 'true';`

**RLS e políticas**

- [ ] `select relname, relrowsecurity from pg_class where relnamespace in ('public'::regnamespace, 'affiliate'::regnamespace, 'finance'::regnamespace) and relkind = 'r';` — todas `true`.
- [ ] Listar políticas de `finance.payout_requests` e confirmar a ausência de `INSERT` para `authenticated` (SEC-002).
- [ ] Listar políticas de `affiliate.profiles` e confirmar que `UPDATE` não permite `paypal_email`/`trust_score`/`active` (SEC-004).
- [ ] `select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and prosecdef;` — `SECURITY DEFINER` com `search_path` fixo e `EXECUTE` apenas para `authenticated`/`service_role`.
- [ ] Confirmar `REVOKE` de `anon` em `record_my_audit_log`, `safe_decrypt_masked`, `positioning_mappings` (migrações 047–049).

**Auth**

- [ ] Confirmação de email obrigatória antes do primeiro login.
- [ ] Proteção contra palavras-passe comprometidas (HaveIBeenPwned) ativa.
- [ ] Expiração de JWT curta (≤ 1 h) e *refresh token* rotation.
- [ ] MFA obrigatório para contas de operador.
- [ ] Rate limit de signup/login e CAPTCHA no endpoint de auth.
- [ ] Desativar signups públicos se o lançamento for por convite.
- [ ] Confirmar que `SUPABASE_JWT_SECRET` **não** está configurado (o código usa `/auth/v1/user` como fonte autoritativa; um segredo HS256 partilhado aumentaria a superfície).

**Chaves e rede**

- [ ] Rotar `SUPABASE_SERVICE_ROLE_KEY` (esteve em `.env` de produção) e atualizar apenas o app principal; nunca o orquestrador/tenant.
- [ ] Restringir o acesso à base de dados por rede (IPv4/IPv6 allowlist) ao host do app.
- [ ] Ativar PITR/backups diários e testar a restauração.
- [ ] Ativar *leaked password protection* e alertas de anomalias.
- [ ] Rever `plans` públicos (5 linhas) — intencional; não contém segredos.
- [ ] Confirmar que o schema `graphql_public` não expõe tabelas sensíveis (não é usado pelo produto).

### 7.2 Stripe

- [ ] Confirmar que o endpoint de webhook é `https://app.copymonster.co/api/billing/webhook` e que subscreve exatamente os eventos tratados (`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.paid`, `charge.refunded`).
- [ ] Confirmar que o `STRIPE_WEBHOOK_SECRET` do dashboard corresponde ao endpoint de produção e **não** ao de teste.
- [ ] Rotar `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` após remover do orquestrador (SEC-008).
- [ ] Usar chave restrita (*restricted key*) com apenas `checkout`, `billing_portal`, `customers`, `subscriptions`, `invoices` de leitura/escrita.
- [ ] Ativar 2FA e revisar membros/roles da conta Stripe.
- [ ] Confirmar que está em modo **live** apenas quando SEC-001/SEC-002 estiverem corrigidos.
- [ ] Configurar Radar/alertas para picos de checkout e reembolsos.
- [ ] Confirmar que nenhum `price_id` de teste está nos `plans` de produção.
- [ ] Verificar que o portal do cliente não permite mudar para planos sem preço configurado.

### 7.3 PayPal

- [ ] Manter `PAYPAL_MOCK=true` até SEC-001/SEC-002 estarem corrigidos e testados.
- [ ] Ao ativar live: `PAYPAL_MODE=live`, `PAYPAL_MOCK=false`, credenciais live apenas no app principal.
- [ ] 2FA na conta business, IP allowlist e alertas de payout.
- [ ] Confirmar limites de payout, moeda (`USD`) e conta de origem.
- [ ] Configurar webhook de estado de payout e job de reconciliação (`SEC-013`).
- [ ] Testar em sandbox o fluxo completo: pedido → aprovação → execução → ledger → notificação.

### 7.4 Orquestrador e host

- [ ] Confirmar `DSH_SERVER_LOGIN_ISOLATION_MODE=account` e `DSH_SERVER_LOGIN_PORT_GUARD=true` em todos os deploys (SEC-007).
- [ ] `/etc/dsh-server-login.env` com `600 root:root` e **sem** `STRIPE_*` (SEC-008).
- [ ] Confirmar que o processo não corre como `root` se o setuid puder ser delegado a um *helper*; caso contrário, restringir SSH, `sudo`, `auditd` e *fail2ban*.
- [ ] Firewall de egress no host (metadata `169.254.169.254`, ranges privados) — compensa SEC-006 em modo local.
- [ ] Confirmar a NetworkPolicy do file sidecar (`8082` apenas do control plane) e testar a negação a partir de outro pod/host.
- [ ] Confirmar `trustProxy` restrito ao edge (SEC-011).
- [ ] Backups do SQLite/Postgres do orquestrador, com teste de restauração.
- [ ] Retenção e acesso aos logs (journald) com *redaction* de PII.

### 7.5 Aplicação e operação

- [ ] CSP, HSTS, `X-Frame-Options` e `X-Content-Type-Options` no edge (Cloudflare/ingress) para `app.copymonster.co`.
- [ ] Alertas para: execuções de payout, falhas de assinatura de webhook, `403` em série, erros 5xx no checkout.
- [ ] Corrigir SEC-003/SEC-004/SEC-005 antes de abrir registo público.
- [ ] Testes de regressão negativos para SEC-001/SEC-002 (owner de tenant pessoal → 403; INSERT direto → negado).
- [ ] `pnpm audit --prod` no CI com falha em `high`/`critical`.

---

## 8. Verificação residual (não foi possível confirmar)

| Item | Como confirmar |
|---|---|
| Migração 040 aplicada | SQL read-only em §7.1 |
| Corpo real das funções `SECURITY DEFINER` | `pg_get_functiondef` em §7.1 |
| Políticas RLS efetivas (não apenas as das migrações) | `pg_policies` em §7.1 |
| Histórico de rotação das chaves Stripe/Supabase | Dashboard/secret manager |
| Modo live da Stripe/PayPal | Dashboards |
| Configuração de email confirmado/MFA | Supabase Auth settings |
| Headers no edge (Cloudflare/ingress) | Resposta HTTP de produção |

---

## 9. Anexos

### 9.1 Comandos e técnicas utilizados

- `pnpm audit --json` e `pnpm audit --prod --json` no app principal; `pnpm audit --json` no orquestrador.
- `curl` ao PostgREST (`/rest/v1/<tabela>?select=*&limit=1`) com `apikey` `anon` e `service_role`, incluindo `Prefer: count=exact` para contagens; nenhum corpo com PII foi persistido ou impresso.
- `grep`/`rg` estático por `console.log`, `child_process`, `exec`, `eval`, `$ {` em queries, `SECURITY DEFINER`, `GRANT`, `POLICY`, `ENABLE ROW LEVEL SECURITY`.
- `stat` de ficheiros de ambiente e inspeção de chaves com valores redigidos.

### 9.2 Contagens vivas observadas (service_role, sem ler PII)

| Schema | Tabela | Linhas |
|---|---|---|
| `public` | `users` | 3 |
| `public` | `user_tenant_roles` | 3 |
| `public` | `tenants` | 3 |
| `public` | `plans` | 5 |
| `public` | `audit_logs` | 86 |
| `public` | `sessions` | 0 |
| `public` | `workspaces_meta` | 0 |
| `affiliate` | `profiles` | 1 |
| `affiliate` | `commission_rules` | 1 |
| `affiliate` | `commissions` | 0 |
| `affiliate` | `notifications` | 0 |
| `affiliate` | `audit_logs` | 3 |
| `finance` | `ledger_entries` | 0 |
| `finance` | `payout_requests` | 0 |

`public.plans` é legível por `anon` (5 linhas, catálogo público). `public.tenant_invitations` devolve `42501` para `anon`. As restantes tabelas de PII devolvem `[]` ou `42501`.

### 9.3 Nota final

Este relatório documenta falhas e não aplica correções, conforme as regras da auditoria. As duas falhas críticas devem ser tratadas como bloqueadores de produção, mesmo com o ambiente PayPal atual em modo simulado.
