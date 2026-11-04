# Resumo da remediação — CopyMonster Launch

**Relatório de origem:** [SECURITY-AUDIT-COPYMONSTER-LAUNCH.md](SECURITY-AUDIT-COPYMONSTER-LAUNCH.md) **Data do resumo:** 2026-11-04 **Âmbito:** findings confirmados C-01 a C-15 e factos de deploy NV-01 a NV-06.

## 1. Resumo executivo

O relatório de origem lista 15 findings confirmados. A contagem por severidade na tabela é **6 `high`, 7 `medium` e 2 `low`**; o parágrafo de abertura do relatório dizia 5 `high` e 8 `medium`, mas a tabela detalhada é a autoridade.

| Severidade | Total | Fechados | Mitigados | Pendentes |
|---|---:|---:|---:|---:|
| `high` | 6 | 5 | 1 (C-05) | 0 |
| `medium` | 7 | 7 | 0 | 0 |
| `low` | 2 | 2 | 0 | 0 |
| **Confirmados** | **15** | **14** | **1** | **0** |

Os seis `needs_validation` ficaram assim: NV-01, NV-02, NV-03 e NV-06 **mitigados** pelo deploy; NV-04 **fechado** pela migração `050`, que remove a única fonte de tenant não validada; NV-05 **validado no repositório**, sem política de escrita em `public.users`, e com a consulta de confirmação em produção indicada na secção 3.

## 2. Findings confirmados

| # | Severidade | Estado | Correção aplicada | Commit / migração |
|---|---|---|---|---|
| C-01 | `high` | Fechado | `/api/file` e `workspaceFiles` confinados ao sandbox/workspace; leitura fora devolve 403 ou `workspace-file/outside-workspace`. | commit `fix(api): confine browser file reads` |
| C-02 | `high` | Fechado | Identidade assinada Ed25519 no proxy, principal `user` verificado no tenant, política de membro no `remote-access`. | commit `feat(auth): verify a signed tenant identity` + orquestrador `feat(identity)`, `fix(proxy)` |
| C-03 | `high` | Fechado | `assertPlatformAdmin` em `installBundle`, `updateBundle` e `removeBundle`; política nega membros. | commit `fix(auth): fail closed on the settings, credential, and bundle guards` |
| C-04 | `high` | Fechado | `callerIsAdmin` fail-closed em `settings.update/replace/mutate` e `credentials.set/unset`; `describe` mascara para membros. | commits `fix(auth): fail closed on the settings, credential, and bundle guards`, `fix(settings): mask protected namespaces` |
| C-05 | `high` | Mitigado | O resolver de identidade tem precedência sobre o cookie do DSH, pelo que o launch token de `/enter` já não concede `owner`. A rota continua a devolver o token; remover a rota ou exigir fence próprio fica como hardening. | commit `feat(auth): verify a signed tenant identity` |
| C-06 | `medium` | Fechado | `SessionController.follow` recusa a chamada sem `authToken`, resolve a identidade com `auth.resolveIdentity` e confina sempre a leitura a `resolveUserSandboxRoot(tenantId, userId)`; uma sessão fora do sandbox devolve `session/unauthorized`. O tipo de wire mantém `authToken` opcional para chamadas em processo, mas o Host recusa a ausência. | commit `fix(api): require a bearer token on session follow` |
| C-07 | `high` | Fechado | `handle_new_user()` sem o ramo `invited_tenant_id`; convites de uso único em `tenant_invitations` com `create_tenant_invitation` e `accept_tenant_invitation`. | commit `fix(supabase): replace signup tenant metadata with single-use invitations`, migração `045` |
| C-08 | `medium` | Fechado | Removida a política `"Users can view tenant workspaces"` de 002; a política por utilizador de 006 continua ativa. | commit `fix(supabase): drop the legacy tenant-wide workspace SELECT policy`, migração `046` |
| C-09 | `medium` | Fechado | `clientKey` só confia em `cf-connecting-ip`/`x-forwarded-for` de proxies configurados; mapa limitado a 10 000 chaves. | commit `fix(auth-http): bound bodies, trust proxies, and pin checkout to the plan` |
| C-10 | `medium` | Fechado | Fence Host/Origin aplicado às rotas exatas do `auth-http`; corpo de billing limitado a 1 MiB com 413. | commit `fix(auth-http): bound bodies, trust proxies, and pin checkout to the plan` |
| C-11 | `medium` | Fechado | Rejeição de handler contida em `settle()`: regista e responde 500 em vez de unhandled rejection. | commit `fix(auth-http): bound bodies, trust proxies, and pin checkout to the plan` |
| C-12 | `medium` | Fechado | Preço resolvido em `tenants.plan_id → plans.stripe_price_id`; `success_url`, `cancel_url` e `return_url` fixos na origem da plataforma. | commit `fix(auth-http): bound bodies, trust proxies, and pin checkout to the plan` |
| C-13 | `medium` | Fechado | `INSERT/UPDATE/DELETE` revogados de `PUBLIC`, `anon` e `authenticated` em `positioning_mappings`; as três políticas de escrita foram removidas. `SELECT` mantém-se e todas as escritas passam pelos RPCs `SECURITY DEFINER` que validam quota e propriedade. | commit `fix(supabase): force Brand DNA writes through the quota-checked RPCs`, migração `049` |
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
| NV-04 | Fechado | A migração `050` remove o ramo `app.current_tenant_id` de `get_current_tenant_id()`; nenhuma migração, fonte Node ou ficheiro do orquestrador define esse GUC. |
| NV-05 | Validado (repositório) | `public.users` tem RLS ativa e apenas políticas de `SELECT`; a flag `metadata.is_admin` é lida por `is_admin_or_owner()` e não tem caminho de escrita para `authenticated`. |
| NV-06 | Mitigado | Nenhum slug contém `/`, `#` ou `?`; 5 slugs `temp-*` excedem o comprimento da regex (higiene, não injeção de host). |

### Validação de NV-04

`get_current_tenant_id()` aceitava `app.current_tenant_id` sem verificar `user_tenant_roles`, pelo que qualquer função ou ligação que definisse o GUC escolhia o tenant de todas as políticas RLS. O repositório mostra que o ramo não protegia nenhum chamador: as migrações `006` e `034` só o leem, e nenhuma migração, fonte Node ou ficheiro do orquestrador chama `set_config` com essa chave. A migração `050` reescreve a função com as duas fontes validadas — o claim do JWT, aceite apenas quando `auth.uid()` tem role nesse tenant, e o fallback determinístico — e deixa de ler o GUC.

A consulta seguinte continua a valer como inventário de funções externas que definam o GUC. Depois da `050` uma função dessas já não troca o tenant ativo, mas continua a ser uma dependência a remover.

```sql
SELECT n.nspname, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) ILIKE '%app.current_tenant_id%';
```

### Validação de NV-05

`is_admin_or_owner()` (migração `040`) devolve verdadeiro para `public.users.metadata ->> 'is_admin' = 'true'`, pelo que uma escrita de `authenticated` nessa coluna daria takeover de plataforma. O repositório não tem esse caminho: a migração `002` ativa RLS em `public.users` e define apenas `Users can view own profile` e `Admins can view all users in tenant`, ambas `FOR SELECT`; nenhuma migração posterior acrescenta política de `INSERT`, `UPDATE` ou `DELETE`. Sem política de escrita, a RLS nega a operação independentemente das grants de tabela. As leituras da aplicação a `users` são todas `SELECT`; as escritas passam pelo service role ou por `admin_toggle_user_status`, que exige `is_admin_or_owner()`.

A consulta seguinte confirma o estado em produção e deve devolver apenas políticas de `SELECT`:

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';
```

Uma política de escrita aí seria um finding novo e bloquearia o go-live.

## 4. Bloqueadores de go-live

**Fechados:** as duas cadeias críticas do relatório. C-01 + C-02 deixaram de permitir leitura arbitrária de ficheiros e escalada de membro para owner; a exposição Stripe foi removida do env do tenant; o signup já não entra em tenants existentes sem convite.

**Pendentes antes do go-live:** nenhum dos findings confirmados. Restam duas confirmações operacionais que não bloqueiam o arranque:

1. **NV-05** — executar a consulta de `pg_policies` acima na base de produção; o repositório não tem política de escrita em `public.users`, mas só a consulta prova o estado aplicado.
2. **NV-04** — a migração `050` já remove o ramo não validado; a consulta de `pg_proc` fica como inventário de funções externas que ainda definam o GUC.

## 5. Recomendação final

**Go-live aprovado.** Os 15 findings confirmados estão fechados ou mitigados: os `high` pela remediação já descrita, C-06 pelo token obrigatório e confinamento ao sandbox, C-13 pela revogação das escritas diretas. NV-04 deixou de ter uma fonte de tenant não validada e NV-05 não tem caminho de escrita para `authenticated` no repositório. As duas consultas da secção 3 confirmam o estado aplicado em produção e devem ser executadas antes de abrir o produto a tenants com mais de um utilizador.

## 6. Limitações deste resumo

- As migrações `045` a `050` foram validadas numa instância Postgres 16 local com schema mínimo; a aplicação à base de produção segue o processo normal de migrações Supabase.
- NV-04 e NV-05 não foram executados contra produção: este ambiente não tem credenciais de base de dados, apenas REST/service-role. A evidência é o repositório e os testes SQL locais.
- O typecheck do repositório mantém 172 erros pré-existentes em 11 ficheiros de teste, sem relação com esta remediação.
- O relatório de origem continua a ser a autoridade sobre o estado auditado; este documento regista apenas o que mudou depois dele.
