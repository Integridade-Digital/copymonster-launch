# Etapa 9 — Anti-Abuso & Sanitização Pré-Campanha (Operação)

**Documento:** `docs/roadmap/etapa9-anti-abuso.md`
**Status:** P1 implementada; P2 operacional; P3/P4 adiados.
**Data:** 2026-10-09
**Plano:** [`plano-producao-llm-providers-billing-trial.md`](./plano-producao-llm-providers-billing-trial.md) (Etapa 9)

## Contexto

O cadastro do CopyMonster é 100% client → **Supabase Auth** (`supabase.auth.signUp` em `apps/web/src/lib/auth/auth.provider.tsx`); **não passa pelo host**. O trigger `on_auth_user_created` (`AFTER INSERT` em `auth.users`) é quem cria o tenant pessoal em trial (1M tokens / 7 dias). O vetor Sybil é criar muitas contas descartáveis e consumir trial por conta.

## P1 — Blocklist de e-mail descartável (implementado)

- Migration: [`supabase/migrations/038_block_disposable_emails.sql`](../../supabase/migrations/038_block_disposable_emails.sql).
- Componentes: tabela `public.disposable_email_domains`, função `public.block_disposable_signup()`, trigger `on_auth_user_before_insert_block_disposable` (`BEFORE INSERT` em `auth.users`).
- Efeito: um cadastro cujo domínio conste na lista é rejeitado **antes** de qualquer tenant/trial existir. Usuários existentes não são afetados.
- RLS deny default: somente a função `SECURITY DEFINER` lê a lista.

### Como adicionar/remover domínios (sem nova migration)

```sql
INSERT INTO public.disposable_email_domains (domain) VALUES ('exemplo.com')
  ON CONFLICT (domain) DO NOTHING;
DELETE FROM public.disposable_email_domains WHERE domain = 'exemplo.com';
```

O domínio é o sufixo exato após o `@`, em minúsculas. Lista vazia não bloqueia ninguém.

### Mensagem ao usuário

O Supabase Auth envolve o erro do trigger como **"Database error saving new user"** (genérico). É aceito por ora: bloqueia o cadastro e não revela a regra anti-abuso. Melhoria futura (opcional): interceptar no cliente e mapear para uma copy amigável, sem expor o motivo.

## P2 — Rate limits nativos do Supabase Auth (configuração, sem código)

O IP do cadastro só existe no Supabase Auth; portanto o controle de taxa é feito no painel (não há `config.toml` no repo). Passo a passo:

1. **Dashboard → Authentication → Rate Limits**: definir limites por IP/hora para **Sign ups** (ex.: 5/h), **Token verifications** e **Emails sent**. Isso limita criação massiva de contas por IP.
2. **Dashboard → Authentication → Providers → Email**: habilitar **Confirm email** para que contas não confirmadas não consumam trial/inferência.
3. **Dashboard → Authentication → Attack Protection**: habilitar **CAPTCHA** (hCaptcha/Turnstile) no signup e no login, se disponível.

Esses controles são operacionais (dashboard) e complementam a blocklist P1.

## P3 — Higienização de workspaces/sessões órfãs (ADIADO)

Não bloqueia o lançamento. Ação futura: inventário **read-only** de workspaces/sessões gerados em testes internos, seguido de cleanup com backup documentado e aprovação explícita.

## P4 — Rate limit por IP em `session.create` no host (ADIADO)

Custo/benefício não justifica a 48h: só usuários autenticados e dentro da cota criam sessão (o gate de cota `check_tenant_quota` já limita o dano por conta). Exigiria um contador por IP no host (`packages/api`, connection/webserver) e não é bloqueio de produção.

## Referências

- Blocklist (P1): `supabase/migrations/038_block_disposable_emails.sql`.
- P3/P4 registrados em [`fork-preservation.md §8`](./fork-preservation.md#8-itens-adiados).
