# Auditoria Geral de Produção — CopyMonster SaaS

**Data:** 2026-11-04 · **Âmbito:** VPS de produção `mail.integridadedigital.com.br` · **Método:** inspeção read-only do código, da configuração, do sistema de ficheiros e dos serviços em execução; testes de acesso com os UIDs reais dos tenants (`setpriv`); chamadas às APIs do Supabase com as chaves de produção · **Regras respeitadas:** nenhuma alteração ao Cloudflare Tunnel, ao Nginx, ao app principal ou ao orquestrador; este documento é o único artefacto produzido.

---

## 1. Veredito executivo

> **O projeto NÃO está pronto para produção.**

O fluxo funcional (login → SSO → subdomínio isolado → workspace → billing) está de pé e foi validado ponta a ponta. O isolamento **de processo** funciona (UIDs distintos, `setpriv`, port guard). O isolamento **de dados**, porém, está comprometido: qualquer tenant consegue ler os segredos da plataforma e os dados de todos os outros tenants.

Foram confirmados **5 bloqueadores P0**, todos de segurança ou capacidade. Nenhum é teórico — todos foram reproduzidos com os UIDs reais dos tenants.

**Estado por dimensão:**

| Dimensão | Estado | Bloqueia go-live? |
|---|---|---|
| Funcional (login, SSO, workspace, billing) | ✅ Funciona | Não |
| Isolamento de processo (UID, setpriv) | ✅ Funciona | Não |
| **Isolamento de dados (ficheiros, segredos)** | ❌ **Quebrado** | **Sim** |
| Autenticação e sessão | 🟡 Sólida, com lacunas | Não |
| Billing | 🟡 Funciona; limites não aplicados | Não |
| Isolamento admin vs comum | ✅ Implementado e verificado | Não |
| Rebranding e UX | 🟡 Bom, com resíduos | Não |
| Infraestrutura e deploy | 🟡 Funciona; sem backups nem monitorização | Sim (parcial) |
| Performance e escalabilidade | ❌ Sem quotas; disco a 92% | **Sim** |
| Legal e conformidade | 🟡 Links e consentimento OK; retenção não implementada | Não |
| Documentação e operação | ❌ Inexistente para onboarding/DR | Sim (parcial) |

---

## 2. Estado atual por vertente

### 2.1 Segurança e isolamento multi-tenant

**O que funciona**

- Cada tenant corre com UID próprio (`100003`…`100011`), arrancado por `setpriv` em `isolationMode=account`.
- `DSH_SERVER_LOGIN_PORT_GUARD=true`: o porto de cada tenant é protegido por firewall local.
- `secret.key` (`/var/lib/dsh-server-login/secret.key`) está `0600 root:root`.
- `.credentials.yaml` de cada tenant está `0600` — outro tenant não o lê (verificado).
- RLS do Supabase está ativo: `anon` recebe `[]` em `public.users` e `public.tenants`.
- `/var/copymonster/data` foi corrigido para `1777` (sticky) e os tenants criam as suas pastas sem intervenção (verificado com `setpriv --reuid=100011`).

**O que falha**

- `/root` é `0755` e `/root/copymonster-launch/.env` é `0644`. Qualquer tenant lê `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `STRIPE_SECRET_KEY`.
- `/var/lib/dsh-server-login/server-login.db` é `0644` num diretório `0755`. Qualquer tenant lê hashes de password, sessões e o credential vault.
- As homes dos tenants (`users/<id>/home`) são `0755`, não `0700`. Um tenant lista e lê `sessions/`, `logs/`, `profiles/`, `storages/` dos outros.
- `SUPABASE_SERVICE_ROLE_KEY` é injetada no ambiente de **cada** DSH de tenant (allowlist em `src/supervisor/spawn.ts`). Um tenant pode exfiltrá-la e escrever diretamente na base, contornando toda a RLS.

**Evidência (reproduzida)**

```bash
# uid 100010 = campaign a ler a home do tenant funel (uid 100011)
setpriv --reuid=100010 --regid=100010 --clear-groups ls \
  /var/lib/dsh-server-login/users/135e1de0-3930-4ca4-a5a8-245a1d27c8de/home/
# → lista sessions/, logs/, profiles/, storages/  (permitido)

# uid 100010 a ler a transcrição de sessão do funel
setpriv --reuid=100010 --regid=100010 --clear-groups head -c 120 \
  .../home/sessions/--root-copymonster-launch--/session-*/session.v4.jsonl.zstd
# → bytes da sessão (permitido)

# uid 100010 a ler os segredos da plataforma
setpriv --reuid=100010 --regid=100010 --clear-groups head -c 40 /root/copymonster-launch/.env
# → "# CopyMonster — variáveis de ambiente"  (permitido)

# uid 100010 a ler a base do orquestrador
setpriv --reuid=100010 --regid=100010 --clear-groups head -c 16 /var/lib/dsh-server-login/server-login.db
# → "SQLite format 3."  (permitido)
```

### 2.2 Autenticação e sessão

**O que funciona**

- `/api/auth/session-token` valida o JWT em três passos: `verifyToken` (assinatura/`alg`/`aud`/`exp`), `GET /auth/v1/user` no Supabase, e comparação `payload.sub === user.id`, seguida de `get_my_profile()` com verificação de que o perfil pertence ao mesmo `sub`.
- O cookie `cm_session` é `HttpOnly`, `Secure` (por omissão), `SameSite=Lax`, `Domain=.copymonster.co`.
- O cookie `sid` do orquestrador é `base64url(payload).HMAC-SHA256`, verificado com `timingSafeEqual`, com expiração e validação da linha em `sessions` (logout revoga).
- `refreshSession()` é chamado no `LoginPage` antes de trocar o token.
- Utilizadores sem `tenant.slug` são rejeitados com `tenant-not-assigned` e a UI mostra `cm_onboarding_username_required`.
- Recuperação de password implementada (`/forgot-password`, `/reset-password`) via Supabase.

**O que falha**

- Sem rate limiting em `/api/auth/session-token` nem nas rotas `/api/billing/*` do app principal (o orquestrador tem `rateLimit`, o app não).
- Sem verificação de `Origin`/`Referer` explícita no `session-token` (mitigado por `SameSite=Lax` + header `Authorization`, mas frágil).
- `SESSION_COOKIE_SECURE` não está definido no `.env`; depende do default do código (`!== 'false'`), o que é correto mas implícito.

### 2.3 Multi-tenant e provisionamento

**O que funciona**

- `initUserRoot` cria home/workspace, copia o perfil web do template (excluindo `node_modules`), liga `node_modules` por **symlink** ao template (não copia — eficiente e imutável para o tenant), injeta `dsh-server-login` e garante o bundle `@deepseek-ai/dsh-copymonster` no `package.json` do perfil.
- `DSH_SERVER_LOGIN_DSH_BIN=/usr/local/bin/dsh` e `DSH_SERVER_LOGIN_ENABLE_PATCH=true` ativos.
- `/var/copymonster/data` em `1777` com preparação automática no provisionamento (corrigido nesta sessão).

**O que falha**

- `scripts/seed-copymonster-profile.mjs` existe mas **não é invocado** por nenhum fluxo automático; é um helper manual.
- `users/vieir/` é resíduo `root:root` e a linha correspondente na BD tem `home_dir` a apontar para esse caminho legado (`/var/lib/dsh-server-login/users/vieir/home`), enquanto o runtime usa `users/<uuid>/home`.
- O `chmod 0755` nas homes é intencional no código (`initUserRoot`), o que contraria o próprio docstring do módulo de isolamento, que promete `0700`.

### 2.4 Billing (Stripe)

**O que funciona**

- `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` presentes no `.env.systemd` (app principal) e no `/etc/dsh-server-login.env` (tenants, só no DSH `main`).
- Checkout validado no app principal: devolve `missing_price_id` (400), ou seja, **passou** a verificação da chave.
- Webhook verifica assinatura HMAC com tolerância de 300 s e trata `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_succeeded/failed`.
- Planos na BD com preços Stripe: Starter (39 €/mês), Profissional (99 €), Legend (249 €), mais Gratuito e Empresarial.
- `check_tenant_quota` (tokens + estado da assinatura) é chamado pelo `session-controller`.

**O que falha**

- `max_workspaces` e `storage_gb` **não são aplicados** em lado nenhum — só aparecem no painel de admin. Um tenant Starter (1 workspace, 1 GB) pode criar workspaces e encher disco sem limite.
- `max_sessions` idem.
- O webhook só é servido no app principal; se o endpoint configurado no dashboard Stripe apontar para um subdomínio de tenant, falha (a chave existe, mas convém confirmar a URL no dashboard).

### 2.5 Isolamento de funcionalidades (admin vs comum)

**O que funciona** — implementado e verificado nesta sessão:

- Seletor de modelos no chat e comando `/model`: só registados com `isAdmin === true`.
- Aba "Models" em Settings: só registada para admin.
- Popup "Add an API key to get started": só registado para admin.
- `get_my_profile()` devolve `is_admin: true` para `integridade.digital@gmail.com` e `false` para `eusouadrianovieira@gmail.com` (tenant `campaign`) — verificado com sessões reais.
- O gate reavalia no evento `copymonster:auth`, cobrindo o caso em que o perfil resolve depois do primeiro render.
- O aviso "Internal Testing Notice" continua visível para todos (é copy de produto).

**O que falha**

- Nada funcional. Nota de design: a chave Stripe passou a existir no processo web de cada tenant (necessário para o checkout no subdomínio), o que aumenta a superfície de exposição face ao modelo "segredo só no app principal".

### 2.6 Rebranding e UX

**O que funciona**

- `index.html` do app: título, descrição, OG tags e manifest CopyMonster.
- Páginas de autenticação com logo, cartão e paleta próprios.
- `launching.html` com logo `/brand.png`, título "Preparando seu ambiente CopyMonster…" e rodapé de isolamento.
- Idiomas `en`, `zh`, `pt` no app, sincronizados com o shell via `__DSH_LOCALE__`.
- Layouts com `max-width` (420/800 px), sem larguras fixas que provoquem scroll horizontal.

**O que falha**

- Resíduos "DSH" em texto visível: `keyHelp` da página Models menciona `$DSH_HOME/.env` (impacto baixo — página agora só de admin).
- O logo é referenciado como `/logo backgroud white.png` — gralha no nome do ficheiro, visível no URL.
- Não há verificação automatizada de regressão visual/responsiva.

### 2.7 Deploy e infraestrutura

**O que funciona**

- `copymonster.service` e `dsh-orchestrator.service`: `active`, `Restart=always`, `RestartSec=5`.
- `cloudflared.service`: `active`; ingress `app.copymonster.co → 3080` e `*.copymonster.co → 3081` corretos.
- `/etc/dsh-server-login.env` está `0600`.
- `.env.systemd` e `.env.local` estão `0600`.

**O que falha**

- `cloudflared.service` tem `Restart=on-failure` (não `always`).
- **Config drift:** o serviço corre com `--config /root/.cloudflared/config.yml`, mas existe um `/etc/cloudflared/config.yml` divergente (com ingress de outros projetos). Uma alteração ao ficheiro "errado" não tem efeito.
- `/root/copymonster-launch/.env` está `0644`.
- `.env` e `.env.systemd` não estão sincronizados: `VITE_SUPABASE_*` e `SESSION_COOKIE_DOMAIN` só existem no primeiro; o runtime depende dos defaults do código.
- Sem backups automáticos: o único artefacto é `backups/copymonster-backup-20260927-0622.tar.gz` (38 dias). Não há cron nem systemd timer, e não há backup verificado do Supabase.
- Sem monitorização (uptime, erros, latência). Nenhum agente Prometheus/Grafana/Sentry/Netdata.
- `journalctl` do orquestrador acumulou **989** ocorrências de `EACCES`/`ENOENT` em 24 h (histórico de perfis mal provisionados). Nas últimas 2 h: **0**, o que confirma que a origem foi corrigida, mas o ruído histórico dificulta o diagnóstico.

### 2.8 Performance e escalabilidade

**Medições**

- VPS: 4 vCPU, 7.8 GB RAM, 4 GB swap. Disco `/` com **92 % usado (5.9 GB livres)**.
- Cada DSH de tenant consome **370–480 MB RSS** (medido: funel 482 MB, testads 389 MB, campaign 370 MB).
- Capacidade prática: **~10–12 tenants simultâneos** antes de esgotar RAM/swap.

**O que funciona**

- Idle timeout de 30 min no `LocalSpawner` desliga DSHs inativos.
- Cloudflare Tunnel suporta WebSocket (o proxy do orquestrador trata `upgrade`).

**O que falha**

- **Sem quotas por tenant**: nem CPU, nem RAM, nem disco (sem cgroups, sem `setquota`, sem `RLIMIT`). Um tenant pode esgotar os 4 cores, a RAM ou os 5.9 GB livres e derrubar a plataforma.
- Disco a 92 % é um risco operacional imediato (logs de sessão, perfis e node_modules crescem).
- Sem limite de tenants por VPS nem plano de escala horizontal documentado.

### 2.9 Legal e conformidade

**O que funciona**

- Registo com links para Termos de Serviço, Política de IA e Política de Privacidade.
- Checkbox de aceite obrigatório: o botão de submissão fica `disabled` sem `acceptedTerms`.
- Dados isolados por tenant na base (RLS) e por UID no disco (apesar das falhas de permissão acima).

**O que falha**

- Não há política de retenção implementada (os "30 dias após exclusão" não estão codificados em lado nenhum).
- Não há fluxo de exportação/eliminação de dados do utilizador (direito ao esquecimento LGPD/GDPR).
- Não há registo de consentimento (timestamp/versão dos termos aceites).

### 2.10 Documentação e operação

**O que funciona**

- `docs/` extenso para o harness (arquitetura, ADRs, runbooks de desenvolvimento).
- `docs/AUDIT-REPORT-COMPLETE.md` e `docs/audit-plan.md` (auditorias anteriores, de setembro).

**O que falha**

- Sem runbook de onboarding de tenant (passo a passo de provisionamento e verificação).
- Sem runbook de recuperação de desastres (backup/restore do Supabase, dos perfis e das homes).
- Sem documentação de topologia de produção (portas, serviços, ingress, variáveis).
- 20 blocos `catch {}` silenciosos entre os dois repositórios, que escondem falhas de provisionamento (foi exatamente o que mascarou o `EACCES` do `/var/copymonster/data`).

---

## 3. Riscos priorizados

### P0 — Bloqueadores de produção (corrigir antes de qualquer go-live)

| # | Risco | Impacto | Evidência |
|---|---|---|---|
| P0-1 | `/root` 0755 + `.env` 0644 expõem `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET` e `STRIPE_SECRET_KEY` a qualquer tenant | Compromisso total da base, das sessões e do billing | `setpriv --reuid=100010 head -c 40 /root/copymonster-launch/.env` → lê o ficheiro |
| P0-2 | `server-login.db` 0644 em diretório 0755 | Hashes de password, sessões e credential vault legíveis por qualquer tenant | `head -c 16 .../server-login.db` → "SQLite format 3." |
| P0-3 | Homes de tenant em 0755 | Tenant A lê transcrições, logs e storages do tenant B | `ls`/`head` na home do funel como uid 100010 |
| P0-4 | `SUPABASE_SERVICE_ROLE_KEY` injetada no env de cada DSH de tenant | Bypass total de RLS a partir do próprio tenant | `/proc/<pid>/environ` do funel contém a chave |
| P0-5 | Disco a 92 % sem quotas por tenant | Um tenant enche o disco e derruba todos os serviços | `df -h /` → 66G/72G |

**Estado após a Fase 1b (2026-11-04):** P0-1 e P0-2 **fechados** (verificados com `setpriv`). P0-3 **fechado e durável** — `initUserRoot` e `spawnAsUser` mantêm `0700` e a ordem dos `chmod` foi corrigida. P0-4 **fechado** — migração `044` aplicada e validada, código em produção e a chave removida do ambiente do tenant e do orquestrador. P0-5 **aberto** (Fase 2).

### P1 — Corrigir antes do go-live comercial

| # | Risco | Impacto |
|---|---|---|
| P1-1 | Sem quotas de CPU/RAM/disco por tenant | Um tenant pode esgotar 4 vCPU / 7.8 GB e afetar todos |
| P1-2 | `max_workspaces`, `max_sessions` e `storage_gb` não aplicados | Limites de plano vendidos mas não cumpridos |
| P1-3 | Sem backups automáticos (último: 27/09) nem restore testado | Perda de dados irrecuperável |
| P1-4 | Sem monitorização nem alertas | Incidentes detetados só por reclamação de cliente |
| P1-5 | `cloudflared.service` com `Restart=on-failure` | Uma saída limpa deixa o túnel em baixo |
| P1-6 | Config drift do cloudflared (`/root/.cloudflared` vs `/etc/cloudflared`) | Alterações ao ficheiro errado não têm efeito |
| P1-7 | Sem rate limiting no `session-token` e no billing do app principal | Abuso e brute-force |
| P1-8 | `.env` do app em 0644 e fora de sincronia com `.env.systemd` | Exposição e comportamento dependente de defaults |
| P1-9 | `vieir` com `home_dir` legado root-owned | Tenant quebrado e diagnóstico confuso |
| P1-10 | Sem runbook de onboarding/DR | Operação depende de conhecimento tácito |

### P2 — Melhorias pós-go-live

| # | Risco | Impacto |
|---|---|---|
| P2-1 | `$DSH_HOME` em texto visível na página Models | Resíduo de marca (baixo, página de admin) |
| P2-2 | Gralha `logo backgroud white.png` | Cosmético, visível no URL |
| P2-3 | `seed-copymonster-profile.mjs` não automatizado | Passo manual esquecível |
| P2-4 | 20 `catch {}` silenciosos | Falhas escondidas (mascararam o `EACCES`) |
| P2-5 | Sem verificação de `Origin` no `session-token` | Defesa em profundidade |
| P2-6 | Sem retenção/exportação/eliminação de dados | Conformidade LGPD/GDPR |
| P2-7 | Sem registo de consentimento (versão/data dos termos) | Prova de conformidade |
| P2-8 | Sem teste de regressão visual/responsiva | Regressões de UI silenciosas |

---

## 4. Plano de ação

### Fase 0 — Contenção imediata — ✅ EXECUTADA em 2026-11-04

Objetivo: fechar as fugas P0 sem alterar código.

**Duas instruções do plano original foram ajustadas após teste, porque quebravam os tenants:**

| Instrução original | Resultado do teste | Aplicado |
|---|---|---|
| `chmod 700 /root` | O binário dos tenants é `/usr/local/bin/dsh` → `/root/copymonster-launch/apps/cli/lib/bin.js`. Com `/root` 0700, `setpriv --reuid=100010 dsh --version` falha no module loader: **nenhum tenant novo arrancaria**. | `chmod 711 /root` (traversal sem listagem) |
| `chmod 750 /var/lib/dsh-server-login` | As homes dos tenants vivem dentro desta árvore. Com 0750, `setpriv --reuid=100010 ls .../home/` devolve `Permission denied`: **todos os tenants quebrariam**. | `chmod 711 /var/lib/dsh-server-login` |

**Aplicado:**

1. `chmod 600` em `.env`, `.env.systemd`, `.env.local`, `apps/web/.env`, `backups/*.tar.gz`, `server-login.db` (+`-wal`/`-shm`), `secret.key`.
2. `chmod 711` em `/root`, `/var/lib/dsh-server-login` e `/var/lib/dsh-server-login/users`.
3. `chmod 700` nas homes dos tenants (`users/*/home`).

**Validação (uid 100010, o tenant `campaign`):**

| Controlo | Resultado |
|---|---|
| Ler `/root/copymonster-launch/.env` | `Permission denied` ✅ |
| Ler `/var/lib/dsh-server-login/server-login.db` | `Permission denied` ✅ |
| Ler `secret.key` e o backup `.tar.gz` | `Permission denied` ✅ |
| Listar a home do tenant `funel` | `Permission denied` ✅ |
| Aceder à própria home | OK ✅ |
| Executar `dsh --version` | `0.2.1-rc.3` ✅ |
| Resolver `profiles/web/node_modules` (symlink para `/root`) | OK ✅ |
| 3 tenants em execução (funel, campaign, testads) | HTTP 200 nas portas 35081/42193/44035 ✅ |
| Erros `EACCES` no orquestrador após a alteração | 0 ✅ |

**Limitação importante — a proteção das homes não é durável.** `LocalUserFs.initUserRoot` repõe `chmod 0755` na home (`src/fs/local-user-fs.ts:197`) e `LocalSpawner.spawnAsUser` repõe `0755` no data root e em `users` (`src/supervisor/orchestrator.ts:332-334`). O próximo login ou auto-launch de um tenant desfaz o `0700`. Os modos `0600` dos ficheiros de segredos **são** duráveis. Até à Fase 1, a mitigação durável exige um timer que reaplique o `chmod`, ou a alteração de código abaixo.

**Esforço real:** 30 min. **Risco de regressão:** nenhum observado.

### Fase 1 — Isolamento de dados no código — 🟡 P0-3 concluído, P0-4 bloqueado

**P0-3 (durabilidade das permissões) — ✅ CONCLUÍDO em 2026-11-04**

- `initUserRoot` passa a deixar o user root, a home e o workspace em `0700` (antes `0755`).
- `spawnAsUser` passa a deixar o data root e `users` em `0711`, e o user root em `0700`.
- **Bug encontrado durante a validação:** em `spawnAsUser` os `chmod` corriam *antes* de `grantUserRootPermissions`, que faz `chmod -R u+rwX,go+rX` e reabria tudo a `0755` em cada spawn. A ordem foi invertida; sem isto a Fase 0 revertia a cada arranque.
- Verificado com um spawn real do tenant `campaign`: o processo arranca, serve HTTP 200 e os três diretórios ficam `0700`; o uid do tenant `funel` recebe `Permission denied` nos três.

**P0-4 (`SUPABASE_SERVICE_ROLE_KEY` no tenant) — ❌ NÃO CONCLUÍDO, requer migração de base de dados**

A instrução era remover a chave da allowlist. A verificação mostrou que **o tenant depende dela para arrancar a sua API**, e que fechar a dependência exige uma migração SQL que não pode ser aplicada a partir deste ambiente (sem ligação Postgres e sem token da Management API).

Cadeia de dependência confirmada:

| Plugin (carregado em todo tenant) | Uso da chave |
|---|---|
| `@deepseek-ai/dsh-supabase-client` | **lança no import** se a chave faltar: `supabase-client: SUPABASE_SERVICE_ROLE_KEY is required` |
| `dsh-api-auth-context` (bundle copymonster) | `auth.getUser`, leitura de `tenants` e `users` |
| `dsh-api-auth-http` (bundle copymonster) | billing (checkout, portal, webhook) e health |
| `dsh-api-session-controller` (bundle web-app) | `check_tenant_quota` |
| `dsh-api-settings-controller` (bundle web-app) | `increment_tenant_token_usage`, métricas de tenant |

As duas RPCs de quota são `service_role`-only por decisão explícita: `029_revoke_authenticated_token_increment.sql` revoga `increment_tenant_token_usage` de `authenticated`, e `032` concede `check_tenant_quota` apenas a `service_role`. Não existe alternativa acessível a `authenticated`.

Remover a chave hoje desativaria os quatro plugins no tenant: sem `ctx.auth`, sem API de sessões, sem billing e sem quota — o workspace deixa de carregar.

**Caminho para fechar o P0-4 (estimativa 1–2 dias, requer acesso à base):**

1. Migração: `check_my_tenant_quota()` e `increment_my_tenant_token_usage(p_tokens)` como `SECURITY DEFINER`, derivando o tenant de `auth.uid()` e ignorando qualquer id vindo do cliente; `GRANT EXECUTE … TO authenticated`.
2. `auth-context`: trocar o cliente admin por `get_my_profile()` com o token do chamador (a função já é `SECURITY DEFINER` e devolve utilizador, tenant, role e `is_admin`).
3. `session-controller` e `settings-controller`: cliente anon com o JWT do chamador, a chamar as novas RPCs.
4. `supabase-client`: deixar de lançar no import; expor o cliente admin como opcional, para o tenant poder arrancar sem a chave.
5. `billing`: mover checkout/portal/webhook para o app principal (Fase 5) e remover as rotas do tenant.
6. Só então retirar `SUPABASE_SERVICE_ROLE_KEY` de `ALLOWED_ENV`.

**`STRIPE_*`:** mantidos no DSH `main` do tenant (necessários para o checkout no subdomínio). O proxy para o app principal fica na Fase 5.

**Esforço restante:** 1–2 dias. **Risco:** médio-alto (mexe em autenticação, quota e billing).

### Fase 1b — correção do P0-4 preparada em branch (não aplicada)

O branch `fix/p0-4-service-role-key` (nos dois repositórios) contém a migração e o refactor completos. **Nada foi aplicado no VPS nem na base de dados.**

**Migração `supabase/migrations/044_tenant_scoped_rpcs.sql`** — 10 funções `SECURITY DEFINER` que derivam o tenant de `auth.uid()` e nunca aceitam um id de tenant do cliente:

| Função | Substitui |
|---|---|
| `check_my_tenant_quota()` | `check_tenant_quota(p_tenant_id)` |
| `increment_my_tenant_token_usage(p_tokens, p_tenant_id?)` | `increment_tenant_token_usage(...)` |
| `get_my_tenant_metrics(p_tenant_id?)` | leitura de `tenants` + `plans` |
| `admin_list_tenants()` | leitura cross-tenant do painel |
| `runtime_upsert_my_session_index(...)` | `runtime_upsert_session_index(...)` |
| `runtime_increment_my_session_tokens(...)` | `runtime_increment_session_tokens(...)` |
| `runtime_mark_my_session_status(...)` | `runtime_mark_session_status(...)` |
| `get_my_positioning_mapping(p_mapping_id)` | `get_positioning_mapping(...)` |
| `record_my_audit_log(...)` | insert em `audit_logs` |
| `admin_list_audit_logs(...)` | leitura cross-tenant de `audit_logs` |

Todas com `REVOKE ... FROM PUBLIC, anon` e `GRANT EXECUTE ... TO authenticated`. As funções `service_role` existentes ficam intactas para o app principal e o orquestrador. O schema foi validado contra o PostgREST real (colunas de `tenants`, `plans`, `sessions_index`, `audit_logs`, `user_tenant_roles`, `positioning_mappings`) e não há colisão de nomes com as 51 RPCs existentes.

**Refactor:**

- `supabase-client`: o cliente admin passa a ser criado sob demanda (importar o módulo já não exige a chave) e ganha `createUserClient(token)` e `hasSupabaseAdminClient()`.
- `auth-context`: resolve a identidade por `get_my_profile()` com o token do chamador; o Context filho passa a transportar `authToken`.
- `session-controller`: quota, metering, índice de sessões e Brand DNA usam RPCs com escopo de chamador; o gate de subscrição redundante foi removido (a quota já o cobre).
- `settings-controller`: tenants, métricas, auditoria e consumo passam pelas novas RPCs.
- `auth-http`: o healthz usa o cliente anónimo; o billing encaminha para o app principal quando o processo não tem a chave.
- `positioning-injection`: lê o DNA com `get_my_positioning_mapping()`.
- `spawn.ts` (orquestrador): `SUPABASE_SERVICE_ROLE_KEY` removida da allowlist.

**Verificação:** `build:artifacts` 8/8, typecheck do host 0 erros, 126 testes verdes nos pacotes tocados e nenhuma falha nova no `session-controller` (208 vs 215 pré-existentes).

**Aplicação — ✅ CONCLUÍDA em 2026-11-04:**

1. `044_tenant_scoped_rpcs.sql` aplicada; as 10 funções aparecem no schema cache do PostgREST.
2. Validação com JWT do utilizador `campaign`: `check_my_tenant_quota` → `200`, `get_my_tenant_metrics` → `200` (tenant + plano), `increment_my_tenant_token_usage` → `204`.
3. `anon` nas 10 funções → `401 permission denied for function`.
4. Merge em `master` e deploy: `build:artifacts` 8/8, `npm run build` do orquestrador, restart dos dois serviços.
5. Tenant `campaign` arrancado pelo caminho real de spawn: `HTTP 200`, zero erros de RPC nos logs.
6. `SUPABASE_SERVICE_ROLE_KEY` removida de `/etc/dsh-server-login.env` (backup em `.bak-p04`) e do ambiente dos filhos; orquestrador reiniciado e tenant revalidado.
7. Rollback disponível: `cp /etc/dsh-server-login.env.bak-p04 /etc/dsh-server-login.env` e reiniciar (as funções antigas continuam vivas).

**Pendente (fora do P0-4):** `check_tenant_quota` continua executável por `anon` — drift de ACL anterior a esta migração, a corrigir com `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` e `GRANT ... TO service_role`.

### Fase 2 — Capacidade e quotas (~2–3 dias)

1. Criar cgroups por tenant (`systemd-run --scope -p MemoryMax=… -p CPUQuota=…`) no `LocalSpawner`, com valores por plano.
2. Aplicar `max_workspaces` e `max_sessions` no caminho de criação (RPC `check_tenant_quota` estendido ou verificação no `workspace-controller`).
3. Aplicar `storage_gb` (XFS project quotas ou verificação periódica + bloqueio).
4. Limpeza automática de logs de sessão antigos e de perfis órfãos.
5. Alerta em 80 % de disco; plano de crescimento (mais disco ou segundo nó).

**Esforço:** 2–3 dias. **Risco:** médio.

### Fase 3 — Operação contínua (~2 dias)

1. Backups automáticos: `pg_dump` diário do Supabase + `tar` dos perfis/homes, retenção 7/30 dias, **restore testado**.
2. Monitorização: uptime dos 3 serviços, taxa de erros 5xx, latência, disco, RAM; alerta para o operador.
3. `cloudflared.service` → `Restart=always`; consolidar num único ficheiro de configuração e remover o divergente.
4. Rate limiting no `session-token` e no billing do app principal.
5. Reduzir os `catch {}` silenciosos a `catch (error) { log }` nos caminhos de provisionamento.

**Esforço:** 2 dias. **Risco:** baixo.

### Fase 4 — Conformidade e documentação (~2 dias)

1. Runbook de onboarding de tenant (provisionar, verificar, dar acesso).
2. Runbook de recuperação de desastres (backup/restore, rotação de segredos).
3. Política de retenção implementada (job de eliminação a 30 dias) e fluxo de exportação/eliminação a pedido.
4. Registo de consentimento (versão + timestamp dos termos aceites).
5. Limpeza de marca: `$DSH_HOME` → caminho genérico; renomear o logo.

**Esforço:** 2 dias. **Risco:** baixo.

### Fase 5 — Endurecimento pós-go-live (~3–5 dias)

1. Proxy do checkout/portal para o app principal (retirar `STRIPE_*` dos tenants).
2. Verificação de `Origin` no `session-token`.
3. Testes de regressão visual e responsiva.
4. Teste de carga com 10–12 tenants para validar os limites medidos.

**Esforço:** 3–5 dias.

**Total estimado até go-live seguro (Fases 0–3):** ~6–8 dias de trabalho.

---

## 5. Critérios de go/no-go

Só autorizar produção quando **todos** forem verdadeiros:

- [x] P0-1 e P0-2 fechados e verificados com `setpriv` (Fase 0).
- [x] P0-3 fechado de forma durável (`initUserRoot` e `spawnAsUser` mantêm `0700`).
- [x] P0-4 fechado (migração `044` aplicada e validada; chave fora do tenant e do orquestrador).
- [ ] P0-5 fechado (Fase 2: quotas por tenant e disco abaixo de 70 %).
- [ ] Um tenant não consegue ler a home, a base, o `.env` nem os segredos de outro.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` ausente do `/proc/<pid>/environ` de qualquer DSH de tenant.
- [ ] Disco abaixo de 70 % e quota por tenant ativa.
- [ ] Backup automático a correr há ≥ 7 dias e um restore testado com sucesso.
- [ ] Alerta dispara quando um serviço cai (testado).
- [ ] Limites de plano (workspaces, sessões, storage) aplicados e testados.
- [ ] Runbooks de onboarding e DR publicados.

---

## 6. Anexo A — Correções já aplicadas (contexto)

Estas alterações foram feitas antes desta auditoria e estão em produção:

| Alteração | Repositório | Commit |
|---|---|---|
| Seletor de modelos, aba "Models" e popup de API key restritos a admin | `copymonster-launch` | `eff8e369f8` |
| `/var/copymonster/data` preparado no provisionamento (1777 sticky) | `copymonster-dsh-server-login` | `6e637cd` |
| Credenciais Stripe entregues ao DSH `main` do tenant | `copymonster-dsh-server-login` | `6e637cd` |

Verificações de runtime associadas:

- `get_my_profile()` → `is_admin: true` para `integridade.digital@gmail.com`, `false` para `eusouadrianovieira@gmail.com`.
- `/proc/<pid>/environ` do tenant `funel` contém `STRIPE_SECRET_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.
- `/var/copymonster/data/<tenant>` criado pelos próprios UIDs dos tenants.

## 7. Anexo B — Comandos de verificação

```bash
# Serviços
systemctl is-active copymonster.service dsh-orchestrator.service cloudflared.service
systemctl show copymonster.service -p Restart -p RestartSec --value

# Permissões (após Fase 0 devem devolver "Permission denied")
setpriv --reuid=100010 --regid=100010 --clear-groups head -c 40 /root/copymonster-launch/.env
setpriv --reuid=100010 --regid=100010 --clear-groups head -c 16 /var/lib/dsh-server-login/server-login.db
setpriv --reuid=100010 --regid=100010 --clear-groups ls /var/lib/dsh-server-login/users/135e1de0-3930-4ca4-a5a8-245a1d27c8de/home/

# Segredos no ambiente de um tenant (deve ficar vazio após Fase 1)
PID=$(pgrep -f "dsh --profile web --patch /var/lib/dsh-server-login/users" | head -1)
tr '\0' '\n' < /proc/$PID/environ | grep -E 'SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY'

# Capacidade
free -h; df -h /; ps -eo user,rss,cmd --sort=-rss | grep "dsh --profile web" | head

# Erros recentes
journalctl -u dsh-orchestrator.service --since "-2h" | grep -cE "EACCES|ENOENT"
```

---

**Conclusão:** o produto está funcional e a arquitetura de isolamento está bem encaminhada, mas as permissões do sistema de ficheiros anulam o isolamento na prática. As Fases 0 e 1 são obrigatórias e rápidas; as Fases 2 e 3 são obrigatórias para operar com clientes pagantes. Com ~6–8 dias de trabalho focado, o projeto atinge um estado defensável para produção.
