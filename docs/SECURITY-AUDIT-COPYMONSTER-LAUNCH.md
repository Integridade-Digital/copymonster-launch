# Auditoria de segurança — CopyMonster Launch

**Repositório:** `Integridade-Digital/copymonster-launch` **Estado auditado:** `master` em 2026-11-04 (worktree sujo apenas em `pnpm-lock.yaml`) **Perfil:** `standard`, repositório completo, granularidade por subsistema **Método:** revisão de código-fonte, sem executar código do alvo e sem contactar serviços em produção **Artefactos completos:** `~/security-audit-skill/copymonster-launch/run-1/` (`REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`, `findings.json`, `coverage-ledger.json`, `architecture.md`)

---

## 1. Resumo executivo

| Veredicto | Quantidade |
|---|---:|
| `confirmed` | **15** |
| `needs_validation` | **6** |
| `rejected` | **6** |

**Distribuição dos 15 findings confirmados:** 5 `high`, 8 `medium`, 2 `low`.

**Conclusão:** o produto **não deve ser lançado** no estado atual. O isolamento de processo existe, mas o isolamento de dados e de autorização não: qualquer utilizador de um tenant é tratado como `owner` do processo DSH, pode ler ficheiros arbitrários do host, instalar pacotes e abrir terminais. Em paralelo, o registo público permite entrar no tenant de plataforma através de metadata controlada pelo atacante. As duas cadeias juntas permitem, no limite, comprometer todos os tenants — dependendo de factos de deploy listados na secção 3.

### Cadeias de risco mais graves

1. **Membro de tenant → owner do host.** O browser é sempre o principal `owner` (`rpc-host.ts:96`), pelo que papéis Supabase não chegam ao RPC. A partir daí: leitura arbitrária de ficheiros (`/api/file`), instalação de plugins e terminal sem sandbox.
2. **Segredos no processo do tenant.** Se `SESSION_SECRET` ou `STRIPE_SECRET_KEY` estiverem no ambiente do DSH do tenant, a leitura arbitrária de ficheiros entrega a assinatura de cookies de toda a plataforma ou a conta Stripe. É o único elo que falta validar para classificar a cadeia como crítica.
3. **Registo → tenant de plataforma.** `handle_new_user()` aceita `invited_tenant_id` da metadata do signup; o UUID do tenant de plataforma é uma constante pública (`00000000-0000-0000-0000-000000000001`).
4. **`/enter` sem autenticação.** Devolve o launch token que emite o cookie de owner do tenant.

---

## 2. Findings confirmados

| # | Severidade | Descrição | Impacto | Ficheiro/linha |
|---|---|---|---|---|
| C-01 | **high** | Leitura arbitrária de ficheiros do host por qualquer browser admitido | Lê `/proc/self/environ`, `.env`, vault de credenciais e sessões de outros utilizadores | `packages/api/session-controller/src/media-references.ts:28-54`; `packages/api/workspace-files/src/index.ts:226-247,416-434` |
| C-02 | **high** | Todo o browser é o principal `owner`; a autorização por papel nunca corre | Membro de tenant pode chamar terminal, plugins, settings, credenciais e sessões | `packages/client/connection/src/rpc-host.ts:96,136`; `packages/api/gateway/src/index.ts:793`; `packages/api/remote-access/src/index.ts:202` |
| C-03 | **high** | Instalação de plugins sem verificação de admin no servidor | Execução de código no processo Host (npm install + load) | `packages/boot/plugin-manager/src/index.ts:835`; gate só em `apps/web/src/cm-theme.css:111` |
| C-04 | **high** | Guardas de admin de settings/credenciais falham em aberto | Membro altera `baseURL` de provider e exfiltra a chave no pedido seguinte | `packages/api/settings-controller/src/index.ts:126-131,195-205`; `packages/api/settings-controller/src/credentials.ts:121-131` |
| C-05 | **high** | `/enter` devolve o launch token sem autenticação | Cookie de owner do tenant; token entregue a um host arbitrário via `Host` | `packages/api/auth-http/src/index.ts:159-180,198-202`; `packages/client/connection/src/browser-auth.ts:244-248` |
| C-06 | **medium** | `session.follow` sem `authToken` ignora o sandbox do chamador | Leitura de transcrições de sessões de outros utilizadores do tenant | `packages/api/session-controller/src/index.ts:649-671`; `.../history.ts:263` |
| C-07 | **high** | Signup entra em qualquer tenant via `invited_tenant_id` | Membro do tenant de plataforma; leitura das suas sessões, workspaces e membros | `supabase/migrations/043_tenant_slug_signup.sql:37,58-67`; `001_initial_identity.sql:137` |
| C-08 | **medium** | Política RLS antiga de `workspaces_meta` nunca foi removida | Membro lê todos os workspaces do tenant, incluindo `relative_path` | `002_saas_complete_isolation.sql:193-194`; `006_deterministic_tenant_and_rls.sql:107-122` |
| C-09 | **medium** | Rate limit confia em `cf-connecting-ip`/`x-forwarded-for` e tem mapa sem limite | Bypass total do limite e amplificação de memória/CPU | `packages/api/auth-http/src/rate-limit.ts:48-75,86-93` |
| C-10 | **medium** | Rotas exatas de auth-http saltam a fence Host/Origin e o limite de body | Bypass de host confiável e exaustão de memória em rotas públicas | `packages/host/webserver/src/index.ts:650-664`; `packages/client/connection/src/index.ts:148-162`; `packages/api/auth-http/src/billing.ts:81-90` |
| C-11 | **medium** | Rejeição de handler vira unhandled rejection e mata o processo | DoS por tenant com um pedido abortado | `packages/api/auth-http/src/index.ts:79-95`; `packages/boot/app-boot/src/index.ts:885-894,919-926` |
| C-12 | **medium** | Checkout aceita `priceId` e URLs de retorno arbitrários | Subscrição a qualquer preço e open redirect pós-pagamento | `packages/api/auth-http/src/billing.ts:257-261,303-314,372-375` |
| C-13 | **medium** | Quota de Brand DNA contornável por escrita direta na tabela | Ultrapassa o limite do plano e o state machine de finalização | `supabase/migrations/039_positioning_mappings_dna.sql:77,91-98,308` |
| C-14 | **low** | `record_my_audit_log` permite forjar entradas de auditoria | Integridade da trilha de auditoria e abuso de armazenamento | `supabase/migrations/044_tenant_scoped_rpcs.sql:391-431,508` |
| C-15 | **low** | `safe_decrypt_masked` executável por `PUBLIC` | Oráculo de desencriptação (exige ciphertext + chave) | `supabase/migrations/014_admin_llm_providers.sql:50-62` |

---

## 3. Findings que precisam de validação

Estes registos têm caminho de código confirmado, mas o facto decisivo está fora do repositório. **Não têm severidade atribuída** até serem validados.

| # | Descrição | Facto exato não resolvido |
|---|---|---|
| NV-01 | `SESSION_SECRET` no ambiente do DSH do tenant permitiria forjar `cm_session` para qualquer tenant | A allowlist de spawn do orquestrador está em `/opt/copymonster/dsh-server-login`, fora do repo; não se sabe se o proxy serve `/api/auth/session-token` no tenant ou no orquestrador |
| NV-02 | `/enter` inacessível sem sessão do orquestrador reduziria C-05 a membro→owner | O proxy pode exigir `sid` antes de encaminhar `/enter`; a tabela de rotas está fora do repo |
| NV-03 | `SUPABASE_SERVICE_ROLE_KEY` ainda no ambiente do tenant significaria bypass total de RLS | A documentação diz que foi removida em 2026-11-04, mas `supabase.client.ts:23` ainda a lê e o allowlist é externo |
| NV-04 | `app.current_tenant_id` aceite sem validação de pertença permitiria trocar de tenant | Nenhuma migração define o valor; um RPC ou pooler externo pode defini-lo |
| NV-05 | `users.metadata.is_admin` gravável por não-admin significaria takeover de plataforma | Não existe política de UPDATE em `public.users` no repo; pode existir out-of-band |
| NV-06 | Slug de tenant com `/`, `#` ou `?` enviaria o JWT Supabase para outro host no SSO | O formulário de admin não valida o slug e não foi encontrada constraint `CHECK`; depende do estado da BD |

**Como validar sem risco:** para NV-01/NV-03, ler apenas a presença da variável em `/proc/<pid>/environ` (nunca o valor). Para NV-02, pedir `/enter` sem cookie e inspecionar apenas o status e o host do `Location`. Para NV-04/NV-05, consultar `pg_proc`/`pg_policies` na BD. Para NV-06, procurar slugs que não cumpram `^[a-z0-9][a-z0-9-]{2,28}[a-z0-9]$`.

---

## 4. Plano de ação passo a passo

A ordem é por risco decrescente e por dependência. **Nenhuma alteração de código foi feita nesta auditoria.**

### Passo 1 — Fechar a leitura arbitrária de ficheiros (C-01) — bloqueador de lançamento

1. Em `packages/api/session-controller/src/media-references.ts`, depois de `fs.resolve`, calcular o sandbox do chamador (`resolveUserSandboxRoot(identity.tenantId, identity.userId)`) e chamar `assertPathInSandbox` antes de `fs.stat`/`fs.readBytes`. A rota passa a exigir identidade; sem identidade, responder 401.
2. Em `packages/api/workspace-files/src/index.ts`, fazer `locateFile` usar o `confine(root, workspaceRoot, path)` que já existe na classe, em vez de resolver o caminho diretamente.
3. Manter a leitura fora do workspace apenas para a ferramenta do agente, através de uma superfície separada e explicitamente privilegiada; não a partilhar com o browser.
4. Testes de regressão: `GET /api/file?path=/proc/self/environ` → 403; `workspaceFiles.readBytes(scope, '/etc/passwd')` → `workspace-file/outside-workspace`; leitura de um ficheiro dentro do workspace continua a funcionar.

### Passo 2 — Derivar o principal do utilizador (C-02) — bloqueador de lançamento

1. Em `packages/client/connection/src/rpc-host.ts`, substituir o principal fixo `{ kind: 'owner' }` por um principal construído a partir da identidade Supabase resolvida no handshake (role e `isAdmin`).
2. Registar esse principal em `PrincipalMap` (`packages/typert/protocol/src/types.ts`) e definir políticas em `remote-access` para cada método sensível.
3. Manter `owner` apenas para o arranque local (desktop/CLI), nunca para um browser autenticado por cookie.
4. Teste: um utilizador `member` recebe `remote-access/denied` em `pluginManager/installBundle`, `terminal/create`, `settings/update` e `credentials/set`.

### Passo 3 — Autorização de plugins e de configuração (C-03, C-04) — bloqueador de lançamento

1. Em `packages/boot/plugin-manager/src/index.ts`, adicionar `assertPlatformAdmin()` a `installBundle`, `updateBundle` e `removeBundle`, falhando fechado quando a identidade está ausente.
2. Em `packages/api/settings-controller/src/index.ts`, inverter a condição de `assertAdminRole` para `identity === undefined || (role não é owner/admin && isAdmin !== true)`.
3. Fazer o mesmo em `packages/api/settings-controller/src/credentials.ts` para `set` e `unset`.
4. Marcar os métodos com `@RemoteScope('auth')` para que `authIdentity` exista sempre.
5. Teste: chamada sem token → `forbidden`; chamada de membro → `forbidden`; chamada de admin → sucesso.

### Passo 4 — Proteger `/enter` (C-05) — bloqueador de lançamento

1. Em `packages/api/auth-http/src/index.ts`, exigir `ctx.connection.requestRejection(req) === undefined` antes de responder; sem sessão, 401.
2. Construir o `Location` a partir de uma autoridade configurada (`publicUrl`/`trustedHosts`), nunca de `req.headers.host`.
3. Se `/enter` não for necessário no tenant, remover a rota do bundle.
4. Teste: pedido sem cookie → 401; pedido com cookie → 303 para a autoridade configurada.

### Passo 5 — Remover a entrada por metadata no signup (C-07) — bloqueador de lançamento

1. Criar migração nova (`045_...`) que recria `handle_new_user()` sem o ramo `invited_tenant_id`.
2. Modelar convites numa tabela `tenant_invitations` (token de uso único, hash, expiração, email, `invited_by`).
3. O trigger (ou um RPC autenticado) valida o convite antes de inserir `user_tenant_roles`.
4. Auditar tenants existentes para linhas criadas por este caminho.
5. Teste: signup com `invited_tenant_id` da plataforma → sem role; convite válido → `member`.

### Passo 6 — Remover a política RLS antiga (C-08)

1. Migração nova: `DROP POLICY IF EXISTS "Users can view tenant workspaces" ON public.workspaces_meta;`.
2. Confirmar que a política por utilizador de `006:113-122` continua ativa.
3. Teste: membro A não lê o workspace do membro B; admin do tenant continua a ler.

### Passo 7 — Endurecer o rate limit e as rotas exatas (C-09, C-10)

1. Em `rate-limit.ts`, só aceitar cabeçalhos de encaminhamento quando `req.socket.remoteAddress` pertence a uma allowlist de proxies; caso contrário usar o socket.
2. Limitar o número de chaves do mapa (LRU ou TTL máximo) e remover a varredura O(n) por chave nova.
3. Aplicar `connection.admit` e `maxRequestBodyBytes` a todas as rotas, incluindo as exatas; ou registar as rotas de `auth-http` sob o prefixo `/api`.
4. Limitar o corpo em `readRawBody` (por exemplo 1 MiB) e devolver 413.

### Passo 8 — Tratar rejeições de handler (C-11)

1. Em `rateLimited`, trocar `void handler(req, res)` por `Promise.resolve(handler(req, res)).catch(...)`.
2. O `catch` responde 500 se os headers ainda não foram enviados e regista o erro.
3. Teste: abortar o corpo de `/api/billing/checkout` e confirmar que o processo continua vivo e responde 500.

### Passo 9 — Billing server-side (C-12)

1. Resolver `priceId` a partir do plano do tenant na BD; ignorar o valor do cliente.
2. Fixar `success_url`, `cancel_url` e `return_url` a URLs da plataforma.
3. Teste: `priceId` arbitrário → 400; `successUrl` externo → ignorado.

### Passo 10 — Quotas e auditoria na base de dados (C-13, C-14, C-15)

1. `REVOKE INSERT, UPDATE, DELETE ON public.positioning_mappings FROM authenticated;` e manter as escritas nos RPCs.
2. `REVOKE EXECUTE ON FUNCTION public.record_my_audit_log(...) FROM authenticated;` e emitir auditoria dentro das funções que executam a alteração.
3. `REVOKE ALL ON FUNCTION public.safe_decrypt_masked(TEXT, TEXT) FROM PUBLIC, anon, authenticated;`.
4. Teste: escrita direta na tabela → 401/permission denied; RPC de auditoria → permission denied.

### Passo 11 — Sessões (C-06)

1. Tornar `authToken` obrigatório em `session.follow` ou migrar para `@RemoteScope('auth', 'follow')`.
2. Rejeitar com `session/unauthorized` quando não há identidade.
3. Teste: follow sem token → erro; follow de sessão de outro utilizador → `session/unauthorized`.

### Passo 12 — Validar os factos de deploy (NV-01 a NV-06)

1. Verificar a presença (não o valor) de `SESSION_SECRET`, `STRIPE_SECRET_KEY` e `SUPABASE_SERVICE_ROLE_KEY` em `/proc/<pid>/environ` de um tenant.
2. Confirmar no proxy se `/enter` e `/api/auth/session-token` exigem `sid`.
3. Consultar `pg_policies` e `pg_proc` para NV-04/NV-05.
4. Procurar slugs inválidos para NV-06.
5. Só depois de fechar NV-01/NV-02 se pode afirmar que a cadeia C-01+C-02 não é crítica.

---

## 5. Notas de hardening (findings rejeitados)

Estes pontos foram investigados e **não** constituem violação de fronteira explorável no estado atual. Ficam como defesa em profundidade.

| # | Alegação | Porque foi rejeitada |
|---|---|---|
| R-01 | Fallback `decodeJwt` em `verifyToken` aceitaria JWT forjado | O token é sempre validado em `/auth/v1/user` e o `sub` é comparado; o decode é apenas pré-filtro (`session-token.ts:262,477`) |
| R-02 | SQL injection nos RPCs de pesquisa de admin | `p_search` é parâmetro ligado, não texto SQL; só há expansão de wildcards (`012_admin_users_management.sql:91`) |
| R-03 | Replay de webhooks Stripe | Tolerância de 300 s e atualizações idempotentes por estado absoluto (`billing.ts:197`) |
| R-04 | CSRF em `session-token`/billing | Rotas exigem bearer token; cookie é `HttpOnly` + `SameSite=Lax` (`session-token.ts:418`) |
| R-05 | `dangerouslySetInnerHTML` no boot | O HTML vem do próprio Host; quem o controla já controla a página (`ui-renderer/src/client/index.ts:67`) |
| R-06 | `get_system_secret` concedido a `authenticated` | A função exige `is_admin_or_owner()`; é higiene (preferir `service_role`), não bypass (`025:170,333`) |

**Recomendações adicionais de higiene:** restringir `get_system_secret`/`get_llm_encryption_key` a `service_role`; adicionar `CHECK` ao `tenants.slug`; remover `sourcemap: true` do build de produção e adicionar CSP; avaliar a migração do refresh token Supabase de `localStorage` para cookie `HttpOnly`.

---

## 6. Limitações

- Não foi executado código do alvo, nem testes contra a BD ou serviços em produção. Todos os `confirmed` assentam em caminhos de código incondicionais; os blocos de reprodução são receitas, não execuções registadas.
- O repositório do orquestrador, a configuração do Cloudflare Tunnel, o Nginx, as permissões do host e as definições do projeto Supabase estão fora do âmbito.
- A auditoria cobre 13 unidades de cobertura registadas em `coverage-ledger.json`; não é uma prova de ausência de outros problemas.
