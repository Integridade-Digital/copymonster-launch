# Runbook de arranque — pré-requisitos de esquema

Curto e operacional: o que tem de estar verdadeiro no Supabase antes de o app principal servir tráfego, e como confirmar.

## Migração 040 — `is_admin_or_owner()` com âmbito de plataforma

**Porquê:** toda a superfície administrativa (`payouts`, afiliados, auditoria, KPIs) autoriza através de `public.is_admin_or_owner()`. A versão anterior a 040 aceitava qualquer `owner` do tenant *ativo* do chamador — e todos os signups recebem `owner` do tenant pessoal — pelo que uma base sem 040 **dá admin a qualquer utilizador autenticado**.

**Gate automático:** `GET /api/healthz` inclui a verificação `schema`. Ela chama `public.is_admin_or_owner()` sem JWT; a definição da 040 devolve `false` nesse caso. Qualquer outro resultado (ou a ausência da função) marca `schema: "fail"` e o endpoint responde **503**.

### Verificação manual (read-only)

```sql
-- 1. A função existe e o comentário descreve o âmbito de plataforma.
select pg_get_functiondef('public.is_admin_or_owner()'::regprocedure);

-- 2. Operadores de plataforma (esperado: pelo menos um se houver operação).
select user_id, role
from public.user_tenant_roles
where tenant_id = '00000000-0000-0000-0000-000000000001'
  and role in ('owner', 'admin');

-- 3. Flag de operador.
select id, email from public.users where metadata ->> 'is_admin' = 'true';

-- 4. RLS ativo nas tabelas de negócio.
select relname, relrowsecurity
from pg_class
where relnamespace in ('public'::regnamespace, 'affiliate'::regnamespace, 'finance'::regnamespace)
  and relkind = 'r'
  and not relrowsecurity;   -- esperado: zero linhas
```

### Pela API (sem JWT)

```bash
URL=$SUPABASE_URL
KEY=$ANON_KEY   # a chave anon chega: a função não expõe dados

curl -sS -X POST "$URL/rest/v1/rpc/is_admin_or_owner" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{}'
# esperado: false
```

### Se o gate falhar

1. **Não** colocar tráfego no app: `schema: fail` significa que qualquer utilizador é admin.
2. Confirmar que a migração 040 está aplicada na base correta (projecto, não branch).
3. Reaplicar `supabase/migrations/040_admin_flag_and_rls.sql` (idempotente: `CREATE OR REPLACE`, sem `DROP`).
4. Repetir a verificação manual e confirmar `GET /api/healthz` → `200`.

## Migrações 056 e 057 — escrita direta em payout e perfil

`056` revoga `INSERT/UPDATE/DELETE` do `authenticated` em `finance.payout_requests`; `057` revoga o mesmo em `affiliate.profiles` e passa os campos editáveis por `affiliate.update_own_profile()`.

Enquanto não forem aplicadas, o app continua a funcionar (o servidor escreve com `service_role`), mas um cliente com JWT de utilizador consegue ainda contornar as validações do servidor.

```sql
-- Esperado: zero linhas.
select tablename, policyname from pg_policies
where schemaname in ('finance','affiliate')
  and policyname in ('payouts_insert_own','affiliate_profiles_update_own','affiliate_profiles_insert_self');
```

## Ordem de aplicação

1. Backup (PITR ou `pg_dump`).
2. `040` (se o gate falhar).
3. `056` e `057` no mesmo ciclo.
4. `GET /api/healthz` → `200` com `schema: "ok"`.
