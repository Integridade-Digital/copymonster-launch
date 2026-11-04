# Resumo da remediação — CopyMonster Launch

**Relatório de origem:** [SECURITY-AUDIT-COPYMONSTER-LAUNCH.md](SECURITY-AUDIT-COPYMONSTER-LAUNCH.md) **Data do resumo:** 2026-11-04 **Âmbito:** findings confirmados C-01 a C-15 e factos de deploy NV-01 a NV-06.

## 1. Resumo executivo

O relatório de origem lista 15 findings confirmados. A contagem por severidade na tabela é **6 `high`, 7 `medium` e 2 `low`**; o parágrafo de abertura do relatório dizia 5 `high` e 8 `medium`, mas a tabela detalhada é a autoridade.

| Severidade | Total | Fechados | Mitigados | Pendentes |
|---|---:|---:|---:|---:|
| `high` | 6 | 5 | 1 (C-05) | 0 |
| `medium` | 7 | 5 | 0 | 2 (C-06, C-13) |
| `low` | 2 | 2 | 0 | 0 |
| **Confirmados** | **15** | **12** | **1** | **2** |

Os seis `needs_validation` ficaram assim: NV-01, NV-02, NV-03 e NV-06 **mitigados** pelo deploy; NV-04 e NV-05 continuam **pendentes** porque exigem consultas a `pg_proc`/`pg_policies` com credenciais de base de dados.

## 2. Findings confirmados

| # | Severidade | Estado | Correção aplicada | Commit / migração |
|---|---|---|---|---|
| C-01 | `high` | Fechado | `/api/file` e `workspaceFiles` confinados ao sandbox/workspace; leitura fora devolve 403 ou `workspace-file/outside-workspace`. | commit `fix(api): confine browser file reads` |
| C-02 | `high` | Fechado | Identidade assinada Ed25519 no proxy, principal `user` verificado no tenant, política de membro no `remote-access`. | commit `feat(auth): verify a signed tenant identity` + orquestrador `feat(identity)`, `fix(proxy)` |
| C-03 | `high` | Fechado | `assertPlatformAdmin` em `installBundle`, `updateBundle` e `removeBundle`; política nega membros. | commit `fix(auth): fail closed on the settings, credential, and bundle guards` |
| C-04 | `high` | Fechado | `callerIsAdmin` fail-closed em `settings.update/replace/mutate` e `credentials.set/unset`; `describe` mascara para membros. | commits `fix(auth): fail closed on the settings, credential, and bundle guards`, `fix(settings): mask protected namespaces` |
| C-05 | `high` | Mitigado | O resolver de identidade tem precedência sobre o cookie do DSH, pelo que o launch token de `/enter` já não concede `owner`. A rota continua a devolver o token; remover a rota ou exigir fence próprio fica como hardening. | commit `feat(auth): verify a signed tenant identity` |
| C-06 | `medium` | Pendente | `session.follow` continua a aceitar `authToken` ausente e nesse caso não confina o sandbox. Correção: tornar `authToken` obrigatório ou migrar para `@RemoteScope('auth', 'follow')`. | — |
| C-07 | `high` | Fechado | `handle_new_user()` sem o ramo `invited_tenant_id`; convites de uso único em `tenant_invitations` com `create_tenant_invitation` e `accept_tenant_invitation`. | commit `fix(supabase): replace signup tenant metadata with single-use invitations`, migração `045` |
| C-08 | `medium` | Fechado | Removida a política `"Users can view tenant workspaces"` de 002; a política por utilizador de 006 continua ativa. | commit `fix(supabase): drop the legacy tenant-wide workspace SELECT policy`, migração `046` |
| C-09 | `medium` | Fechado | `clientKey` só confia em `cf-connecting-ip`/`x-forwarded-for` de proxies configurados; mapa limitado a 10 000 chaves. | commit `fix(auth-http): bound bodies, trust proxies, and pin checkout to the plan` |
| C-10 | `medium` | Fechado | Fence Host/Origin aplicado às rotas exatas do `auth-http`; corpo de billing limitado a 1 MiB com 413. | commit `fix(auth-http): bound bodies, trust proxies, and pin checkout to the plan` |
| C-11 | `medium` | Fechado | Rejeição de handler contida em `settle()`: regista e responde 500 em vez de unhandled rejection. | commit `fix(auth-http): bound bodies, trust proxies, and pin checkout to the plan` |
| C-12 | `medium` | Fechado | Preço resolvido em `tenants.plan_id → plans.stripe_price_id`; `success_url`, `cancel_url` e `return_url` fixos na origem da plataforma. | commit `fix(auth-http): bound bodies, trust proxies, and pin checkout to the plan` |
| C-13 | `medium` | Pendente | `authenticated` mantém `INSERT/UPDATE/DELETE` em `positioning_mappings`, pelo que a quota e o state machine de finalização podem ser contornados por escrita direta. Correção: `REVOKE INSERT, UPDATE, DELETE ON public.positioning_mappings FROM authenticated;` e manter as escritas nos RPCs. | — |
| C-14 | `low` | Fechado | `record_my_audit_log` revogado de `PUBLIC`, `anon` e `authenticated`; auditoria de `positioning_mappings` passa a trigger `SECURITY DEFINER`. Método `settings.recordAuditLog` removido. | commit `fix(supabase): revoke the audit-write and masked-decrypt RPCs`, migração `047` |
| C-15 | `low` | Fechado | `safe_decrypt_masked` revogado de `PUBLIC`, `anon` e `authenticated`; leitores de providers continuam como owner. | commit `fix(supabase): revoke the audit-write and masked-decrypt RPCs`, migração `048` |

### Nota sobre C-10

O relatório pedia `connection.admit` em todas as rotas do webserver. Aplicá-lo literalmente devolveria 401 ao index público, ao `/api/healthz` e ao billing encaminhado do tenant, que não transporta cookie do DSH. A correção aplicada separa as duas responsabilidades: `trustRejection` aplica só o fence Host/Origin às rotas exatas do `auth-http`, e o limite de corpo é aplicado na leitura do billing. O bypass de host confiável e a exaustão de memória ficam fechados sem quebrar o login nem o encaminhamento de billing.

## 3. Factos de deploy (NV)

| # | Estado | Evidência |
|---|---|---|
| NV-01 | Mitigado | `SESSION_SECRET` ausente do env do tenant; allowlist do orquestrador exclui-o. |
| NV-02 | Mitigado | `/enter` sem `sid` devolve 401 no proxy; o tenant só escuta em loopback. |
| NV-03 | Mitigado | `SUPABASE_SERVICE_ROLE_KEY` ausente do env do tenant. |
| NV-04 | Pendente | Exige `pg_proc`; nenhuma migração define `app.current_tenant_id` e o PostgREST não aceita GUCs, mas um RPC externo pode defini-lo. |
| NV-05 | Pendente | Exige `pg_policies`; não existe política de UPDATE em `public.users` no repositório, mas pode existir out-of-band. |
| NV-06 | Mitigado | Nenhum slug contém `/`, `#` ou `?`; 5 slugs `temp-*` excedem o comprimento da regex (higiene, não injeção de host). |

### Validação de NV-04

```sql
SELECT proname FROM pg_proc WHERE proname LIKE '%current_tenant%';

SELECT n.nspname, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) ILIKE '%app.current_tenant_id%';
```

O primeiro confirma se existe uma função de tenant; o segundo mostra qualquer função que defina o GUC de sessão. Se nenhuma definir, o ramo 1.2 de `get_current_tenant_id()` é inalcançável a partir do browser.

### Validação de NV-05

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';

SELECT grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'metadata';
```

O esperado é nenhuma política de `UPDATE` para não-admin e nenhum `UPDATE` em `metadata` para `authenticated`. Se aparecer uma política permissiva, é takeover de plataforma e bloqueia o go-live.

## 4. Bloqueadores de go-live

**Fechados:** as duas cadeias críticas do relatório. C-01 + C-02 deixaram de permitir leitura arbitrária de ficheiros e escalada de membro para owner; a exposição Stripe foi removida do env do tenant; o signup já não entra em tenants existentes sem convite.

**Pendentes antes do go-live:**

1. **NV-04 e NV-05** — executar as consultas acima. São os únicos factos que ainda podem revelar uma escalada de plataforma.
2. **C-06** — leitura de transcrições de outras sessões do tenant quando `session.follow` não traz token. É `medium`, mas toca isolamento de dados.
3. **C-13** — contorno de quota de Brand DNA por escrita direta. É `medium` e afeta faturação, não confidencialidade; pode seguir depois do lançamento se a quota for monitorizada.

## 5. Recomendação final

**Go-live condicional.** Os findings `high` estão fechados ou mitigados e as cadeias de compromisso total descritas no relatório de origem já não se verificam. O projeto pode avançar assim que NV-04 e NV-05 forem validados com as consultas da secção 3 e, se qualquer um for positivo, corrigido. C-06 deve ser corrigido antes de expor o produto a tenants com mais de um utilizador; C-13 pode entrar no primeiro ciclo pós-lançamento.

## 6. Limitações deste resumo

- As migrações `045`, `046`, `047` e `048` foram validadas numa instância Postgres 16 local com schema mínimo; a aplicação à base de produção segue o processo normal de migrações Supabase.
- NV-04 e NV-05 não foram executados: este ambiente não tem credenciais de base de dados, apenas REST/service-role.
- O typecheck do repositório mantém 172 erros pré-existentes em 11 ficheiros de teste, sem relação com esta remediação.
- O relatório de origem continua a ser a autoridade sobre o estado auditado; este documento regista apenas o que mudou depois dele.
