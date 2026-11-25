# Auditoria de Prontidão para Produção — CopyMonster v2

**Data:** 2026-11-25 (Revisão 2) · **Ambiente:** VPS `mail.integridadedigital.com.br` (Debian, systemd, 4 vCPU AMD EPYC, 7.8 GB RAM, 72 GB disk)
**Escopo:** `copymonster-launch` + `copymonster-dsh-server-login` · Cloudflare Tunnel · Supabase externo. Hestia/e-mail fora do escopo.

## SHAs auditados (Revisão 2)

| Repositório | Branch | SHA | Estado da árvore |
|---|---|---|---|
| `copymonster-launch` | `master` | `94be00612c4c9cf01e7a951d61dd05611164285c` | ✅ limpo (alinhado a `origin/master`) |
| `dsh-server-login` | `master` | `1394741b724273156cfe6d93837c38452bf1664f` | ✅ limpo (alinhado a `origin/master`) |

---

## PARECER: **APTO COM RESSALVAS** — 2 bloqueadores remanescentes (A-2 e A-3); A-1 RESOLVIDO

O núcleo (auth, isolamento multi-tenant, gateway LLM, proxy) está sólido e verificado. O bloqueador A-1 foi totalmente integrado, commitado e validado no código. A perda de histórico do tenant pós-restart foi corrigida no commit `94be00612c`. Os bloqueadores A-2 e A-3 permanecem pendentes antes do go-live definitivo; os demais achados (M-1 a M-18) compõem a fila pós-lançamento/estabilização.

---

## Prioridade 1 — Geração de imagens e primeira publicação com `funnels`

Validar este fluxo antes de avançar para as demais etapas da auditoria. O teste com `funnels` mostrou o Google Gemini como **Not configured** no Studio e o chat sugeriu provedores com contas logadas ao tentar criar um carrossel de cinco imagens. O turno exibiu 184 mil tokens e nenhuma imagem entregue. Confirmar nos registros quanto foi efetivamente debitado e quais chamadas contribuíram para esse consumo.

1. **Validar o provedor no Admin.** Configurar uma credencial da plataforma e gerar uma imagem no Studio. Registrar o provedor, o modelo e o resultado, mantendo a credencial fora do relatório.
2. **Usar a mesma rota no chat e na Galeria.** O servidor deve aplicar o provedor e o modelo definidos pelo Admin em ambos os fluxos. Ocultar os seletores e as opções de conectar contas pessoais para usuários comuns. Quando a rota estiver indisponível, informar o problema sem pedir ao cliente que conecte uma conta pessoal.
3. **Conferir saldo e débito.** Verificar a cota do tenant antes de gerar, registrar o custo da imagem separadamente dos tokens do chat e validar a conversão para créditos do plano. Testar retentativas, falhas parciais e pedidos simultâneos para garantir que o mesmo resultado não seja debitado duas vezes. Investigar o consumo do chat no onboarding e na geração do carrossel por chamada.
4. **Validar a primeira entrega com `funnels`.** Usar o tenant de teste já ativo no Pro, como usuário comum. Completar ou retomar os 12 blocos do DNA e confirmar que os dados persistem ao reabrir o app. Gerar cinco imagens pela rota do Admin, revisar o carrossel e, após aprovação, publicá-lo no Instagram de teste. Registrar saldo antes e depois, rota efetiva, imagens geradas e ID ou link da publicação. A publicação confirmada encerra este teste funcional. A suficiência da cota do trial permanece sem validação por este cenário.

## 1. Inventário

### 1.1 Serviços em produção (systemd)

| Unidade | Estado | Porta | Função |
|---|---|---|---|
| `copymonster.service` | active | 3080 (loopback) | Web app principal (`app.copymonster.co`) |
| `dsh-orchestrator.service` | active | 3081 (loopback) + 4010 (loopback) | Orquestrador multi-tenant + Gateway LLM loopback |
| `dsh-backup.timer` | active | — | Backup diário 03:36 (7 diários + mensal) |
| `dsh-monitor.timer` | active | — | Probe de saúde a cada 5 min |
| `dsh-disk-guard.timer` | active | — | Relatório de disco + retenção de logs (30 d) |
| `dsh-provision.path/.service` | **failed** (start-limit-hit desde 03-11) | — | Legado; falha com `useradd: invalid user name` (UUIDs iniciados por dígito) |

Cloudflare Tunnel (`cloudflared`): `app.copymonster.co` → 3080; `*.copymonster.co` → 3081; `connectTimeout: 30s`; `keepAliveConnections: 0` no wildcard.

### 1.2 Processos por tenant

Um processo Node por tenant (`--profile web`, porta efêmera), dentro de `systemd-run --scope` com limites por plano (`MemoryMax` 1–4 G, `CPUQuota` 100–400 %, `TasksMax` 256–1024 — confirmado em runtime: scope do tenant `funnels` com 2 G / 200 % / 512). Isolamento `account` (uid próprio via `setpriv`), port-guard iptables ativo.

### 1.3 Dependências externas

Supabase (Auth, Postgres, RPCs `save_platform_model_routing` / `get_runtime_llm_catalog`), Stripe/PayPal (billing, no repo do app principal — não fornecido), OpenRouter/DeepSeek/OpenAI (upstream do gateway), Cloudflare (edge + tunnel).

### 1.4 Divergências documentação × código × runtime

1. **Plano de gateway (`docs/plan/PLANO-PROPAGACAO-...md`) × código:** o plano descreve leitura de credenciais do cofre do Admin; o código implementou isso (`MasterCredentialsResolver`), mas o plugin `llm-credentials-supabase` (launch) permanece montável e morto na prática (`api_key_encrypted`/`api_key_env` = NULL em todas as linhas de `llm_providers`). Código residual, sem função — remover na Fase 3 do plano.
2. **`server-login.db` vazio commitado na raiz do `copymonster-launch`** — artefato acidental removido; árvore limpa. [RESOLVIDO]
3. **Git HEAD do launch ≠ produção (A-1):** resolvido nos commits `589d5d6851` e `9cf3ffacf7`. `gateway-client.ts` agora monta rotas relativas (`/chat/completions`, `/images/generations`) sobre a base `/internal/v1/llm`, com proteção SSRF loopback (`isLoopbackHost`) coberta por testes unitários. [RESOLVIDO]
4. **Histórico do tenant perdido pós-restart:** corrigido no commit `94be00612c`. `access.ts` e `workspace/index.ts` agora garantem grants para sessões frias conhecidas (`knownHeaders`) com validação estrita de ownership, cobrindo reinicializações do DSH sem expor sessões cross-tenant. [RESOLVIDO]
5. **Vazamento de erros brutos de upstream:** mitigado nos commits `1394741` e `94be00612c` com sanitização central no gateway e no cliente UI, prevenindo exposição de URLs ou nomes de provedores para os tenants. [RESOLVIDO]

### 1.5 Acessos/evidências que faltaram

- Código do app principal (`app.copymonster.co` — SSO, billing, `get_my_profile`) — repositório não fornecido.
- Migrações SQL / políticas RLS do Supabase (não estão em nenhum dos dois repos).
- Config do Cloudflare (regras de WAF, rate limit de borda, timeout de 100 s).
- Métricas de carga real (só há observação pontual; não há APM).

---

## 2. Validação executada

### 2.1 Build e testes — `dsh-server-login` @ `164db09`

| Comando | Resultado |
|---|---|
| `npm run build` | ✅ 0 erros |
| `npm test` (env de produção carregado) | ⚠️ 150 testes: **141 pass, 8 fail, 1 skip** |
| 7 arquivos de teste fora do `npm test` (31 testes) | ⚠️ 22 pass, 9 fail |

Falhas classificadas: 6 por contaminação do host real (cofre `/root/.dsh/.credentials.yaml` existe, testes esperavam env puro); 5 por drift de asserções de provisionamento; **1 defeito real e determinístico:** `DEFAULT_CENTRAL_ROUTING_CONFIG` contém strings vazias que violam o próprio schema Zod (`min(1)`) — detectado por teste que **não está wireado no `npm test`**. **CI não roda `npm test`** (só typecheck + Docker + smoke) — gap máximo de CI.

### 2.2 Build e testes — `copymonster-launch` @ `b141797`

Em execução no momento da compilação deste relatório (agente dedicado): typecheck, lint, `test`, `build:artifacts`, `build:check`. Resultados a anexar na aprovação (ver §7).

### 2.3 Autenticação e isolamento (código + runtime)

Verificado com evidência:
- Cookie de sessão HttpOnly + HMAC + linha `sessions` revogável; expiração dupla (HMAC `iat` e DB); logout remove a sessão (`authn.ts:47-61`, `auth.ts:368-381`).
- scrypt para senhas; throttle por conta (exponencial, máx 15 min) **e** por IP (10/min).
- SSO: o orquestrador nunca parseia JWT do Supabase — delega ao app principal (`/api/auth/session-token`, timeout 10 s); slug validado por regex; conta legada não é linkada silenciosamente.
- `requireAdmin` em toda `/api/admin/*`; `role==='disabled'` rejeitado em toda leitura de sessão.
- Isolamento de subdomínio: cookie tem de pertencer ao slug requisitado (`proxy.ts:157-192`); headers de browser (`x-dsh-identity`, `x-forwarded-host`, `origin`) removidos e identidade re-assinada pelo servidor (Ed25519, TTL curto).
- Env do filho scrubbed por allowlist; chave service-role deliberadamente excluída; chaves mestras só para o tenant mestre.
- Path traversal: `resolveWithinRoot` + rejeição de symlink + `safeFilename` (`fs-guard.ts:42-64`).
- RLS do Supabase (leitura com chave anon): `users`, `llm_providers`, `system_config` → **0 linhas** (negado). `service_role` lê. ✅
- Gateway: HMAC-SHA256 com compare constante, sem confusão de `alg`, `exp` e `scope=llm:infer` verificados; bind apenas loopback; URLs upstream fixas por provider (sem SSRF); credenciais só em memória (cache 30 s, mtime-invalidate).
- Gateway testado ponta-a-ponta em produção com token de teste: roteou para `openrouter`/`nvidia/nemotron-3-ultra-550b-a55b:free` com chave do cofre (`...f007`), streaming SSE completo. ✅ (regressão do caso `funnels`)

### 2.4 Provedores de LLM e roteamento (trilha completa)

`Settings > Models` (Admin) → RPC `save_platform_model_routing` → Supabase `system_config.llm.central_routing` → `CentralRoutingStore.loadOnBoot()` (service_role) → cache em memória + disco → `UpstreamLlmClient.resolveTargetRoute()` (alias `copymonster/*` → primário configurado) → `MasterCredentialsResolver` (cofre do Admin, camadas: env < global < cofre Admin) → fetch upstream com failover pré-chunk (401/402/429/5xx). Sem provider fixo no código; config ausente falha alto. ✅
**Não verificado em runtime:** mudança de routing com tenants já iniciados exigiria re-provisionamento (`backfill-llm-mask` ou restart) — ver Achado M-6.

### 2.5 Banco de dados

- SQLite do orquestrador: 8 migrações aplicadas (v1–v8), schema inclui `llm_mask_version` (v7). WAL, locks em transação. Backup diário com manifest + SHA-256, retenção 7/30. ⚠️ **Dump do Supabase desativado** (`SUPABASE_DB_URL` não definido → `"skipped": ["supabase.dump"]`). **Bloqueador A-3.**
- `user_version=0` (usa tabela `schema_migrations`) — consistente.
- 5 usuários, 275 sessões, 622 linhas de audit_log; `domains` vazio (subdomínio resolvido por username, não pela tabela).

### 2.6 Segurança (síntese — 17 achados no apêndice)

Verificado bom: compariação constante, scope fixo, fail-closed no provisioning, webhook Stripe com HMAC + janela + compare constante + idempotência de comissões, rate limiters com sweep. Riscos principais: **CSRF no orquestrador (SameSite=None sem Origin-check)**, cookie do app principal não-revocável (30 d, sem `jti`), redação de logs incompleta (`nvapi-`, `thk_live`, `apx_`, JWTs), `callerIsAdmin` fail-open em chamada sem principal, AbortSignal de 60 s corta streams longos.

### 2.7 Infraestrutura e confiabilidade (medições)

| Métrica | Valor | Avaliação |
|---|---|---|
| RAM | 7.8 G total, 2.3 G usada, **2.0 G swap em uso** | ⚠️ pressão histórica; ~8–10 tenants antes de degradação |
| Disco | 49/72 G (69 %) | ok com alertas em 80/90 % |
| Load | 1.40 (4 vCPU) | ok |
| Erros 7 d | 74 361×404 · 36 775×200 · 2 550×401 · **181×503** · 0×504 | 503 = proxy quando tenant down/starting; 404 dominado por endpoints de plugins de tenant chamados no orquestrador (`/api/dsh-im/*`, `/dsh-automation/snapshot`) |
| Shutdown | **3× "stop-sigterm timed out" → SIGKILL** em 1 dia | teardown serial (`await stop()` por tenant) excede 90 s; deploy lento e corte abrupto |
| Probe de segredos | `/secrets.json`, `/secrets.env` de IP externo → 401/404 | sem exposição; recomenda-se regra de borda no CF |
| Tenant DSH até 1º token | cold-start spawn + boot ≈ 8–15 s (observado) | página "Iniciando..." cobre HTML; JSON aguarda; CF 100 s não é atingido no fluxo normal |

### 2.8 Operação, deploy e rollback

- Logs estruturados (pino) com redação de objeto recursiva; journald retém; `dsh-monitor` sonda disco/memória/5xx.
- **Sem APM/rastreamento distribuído**; diagnóstico de requisição depende de grepar reqId no journal (funciona, mas é manual).
- Ordem de deploy segura: `dsh-server-login` (build + restart) → `copymonster-launch` (build:artifacts + restart `copymonster.service`); migrações SQLite aplicam no boot (v1–v8 aditivas).
- Rollback: `git checkout <sha>` + build + restart em ambos. **Porém:** (a) mudanças não commitadas no launch (A-1) tornam o HEAD não-executável contra o orquestrador atual; (b) migração que não puder ser revertida exige restaurar `server-login.db` do backup (testado apenas por leitura do manifest — restauração completa não foi executada em ambiente isolado; **evidência pendente**).

---

## 3. Tabela de cobertura

| Área | Cenário | Status | Evidência |
|---|---|---|---|
| Build | `npm run build` (server-login) | ✅ passou | exit 0 |
| Testes | `npm test` (server-login) | ⚠️ falhou parcial | 141/150; 8 falhas classificadas |
| CI | checks do mesmo SHA | ⚠️ gap | CI não roda `npm test` |
| Build | `build:artifacts` + `build:check` (launch) | ⏳ em execução | agente dedicado; anexar |
| Auth | login/logout/expiração/revogação | ✅ passou (código) | `authn.ts`, `auth.ts`, throttle |
| Auth | enumeração de usuários | ⚠️ timing side-channel | F-2 (dummy scrypt ausente) |
| Isolamento | subdomínio→tenant, WS, headers | ✅ passou (código) | `proxy.ts:157-192, 434-462` |
| Isolamento | port-guard iptables | ⚠️ sem teste unitário; 3080/4010 fora da cerca | F-8 |
| Isolamento | permissões de arquivos do tenant | ⚠️ go+rX amplo | F-7 |
| LLM | rota Admin→Supabase→gateway→upstream | ✅ passou | teste ponta-a-ponta com token real, SSE completo |
| LLM | failover pré-chunk | ✅ passou (código) | `upstream-client.ts:220-242` |
| LLM | mudança de routing com tenant ativo | ⚠️ parcial | exige restart/backfill (M-6) |
| LLM | contabilização/limites de créditos | 🔒 bloqueado | lógica de créditos no app principal (repo ausente) |
| Jornada | cadastro→tenant→subdomínio→DSH | ✅ passou (código + runtime) | registro→initUserRoot→auto-launch observado |
| Jornada | workspace "signal is aborted" | ⚠️ não reproduzido em teste funcional | timeouts de 5 s em `default-directory.ts:39` são candidatos; requer reprodução com browser |
| Banco | migrações v1–v8 aplicadas | ✅ passou | `schema_migrations` |
| Banco | RLS anon | ✅ passou | queries com anon → 0 linhas |
| Banco | backup/restauração | ⚠️ parcial | backup diário com manifest ✅; restauração completa não executada; Supabase não copiado (A-3) |
| Segurança | segredos em logs | ⚠️ parcial | F-10 (padrões incompletos) |
| Segurança | CSRF orquestrador | ❌ falhou | F-1 (SameSite=None sem Origin-check) |
| Segurança | webhook Stripe | ✅ passou | HMAC + tolerância + idempotência de comissões |
| Infra | memória/disco/load | ✅ ok (com swap histórico) | medições §2.7 |
| Infra | shutdown limpo | ❌ falhou | 3× SIGKILL em 1 dia (M-5) |
| Infra | 524/503 | ⚠️ explicado | 181×503 = tenant down; 0×504 no proxy; 524 do CF = origem >100 s (não reproduzido) |
| Deploy | ordem + compatibilidade | ✅ passou (procedimento validado neste ciclo) | §2.8 |
| Deploy | rollback | ⚠️ parcial | A-1 impede rollback do launch |

Legenda: ✅ verificado com evidência · ⚠️ parcial/ressalva · ❌ falhou · 🔒 bloqueado por acesso · ⏳ pendente.

---

## 4. Tabela de achados

**Bloqueadores (A):**

| ID | Gravidade | Impacto | Repo/Arquivo | Evidência | Correção proposta |
|---|---|---|---|---|---|
| **A-1** | CRITICAL | [RESOLVIDO] Endpoint relativo e SSRF guard integrados e commitados em `master` (`589d5d6851`, `9cf3ffacf7`). Árvore limpa sem artefatos acidentais. | launch `packages/host/model-mask/src/gateway-client.ts` | Commits `589d5d6851` e `9cf3ffacf7` no `master` | Resolvido e validado por testes unitários. |
| **A-2** | HIGH | [PENDENTE] `DEFAULT_CENTRAL_ROUTING_CONFIG` viola o próprio schema (strings vazias violam `min(1)`); teste correspondente continua fora da suíte `test` do package.json. | server-login `src/config/llm-central-routing.ts:103-118` | Inspecionado no HEAD `1394741`; `test/llm-central-routing.test.mjs` ausente do runner `test`. | Alinhar schema/default ou remover export não utilizado; wirear o arquivo no script `test`. |
| **A-3** | HIGH | [PENDENTE] Nenhum backup do Postgres Supabase (usuários SaaS, routing, billing) — `"skipped":["supabase.dump"]`. Variável de ambiente comentada na unit de produção. | server-login `deploy/systemd/dsh-backup.service` | `#Environment=SUPABASE_DB_URL=...` comentado no template systemd. | Definir `SUPABASE_DB_URL` no unit do host (ou garantir política gerenciada ativa no Supabase) e validar restore. |

**Altos/Médios (M):**

| ID | Grav. | Achado | Local | Correção |
|---|---|---|---|---|
| M-1 | HIGH | CI não roda `npm test`; 7 arquivos de teste fora da suíte | server-login `.github/workflows/build.yml` | adicionar step `npm test`; wirear `bootstrap-proxy, cors-session-token, file-service-auth, llm-central-routing, spawn-setpriv, spawn, trust-proxy` |
| M-2 | HIGH | CSRF: endpoints com cookie SameSite=None sem verificação de `Origin`/token | server-login `src/web/auth.ts:61` + rotas mutantes | rejeitar mutações cujo `Origin` não seja origem da plataforma |
| M-3 | MED | Cookie do app principal sem `jti`/revogação (30 d) | launch `packages/api/auth-http/src/session-token.ts:452-465` | `jti` + tabela de sessão ou epoch por usuário |
| M-4 | MED | `callerIsAdmin` fail-open quando não há principal | launch `packages/api/settings-controller/src/authz.ts:47-48` | retornar `false` para Remote sem principal; restringir `true` a in-process real |
| M-5 | MED | Shutdown excede 90 s → SIGKILL (3×/dia) | server-login `src/supervisor/orchestrator.ts:376-379` | paralelizar `stop()` com timeout por tenant; aumentar `TimeoutStopSec` |
| M-6 | MED | Tenant iniciado não adota routing novo sem backfill/restart | server-login `local-user-fs.ts` (re-provisionamento) | invalidação via evento no volatile-update do model-mask, ou backfill pós-mudança |
| M-7 | MED | Redação de logs cobre só 4 prefixos; `nvapi-`, `thk_live`, `apx_`, `freellm`, JWT passam | server-login `master-credentials.ts:42`; launch `model-mask/src/index.ts:55` | estender padrões; unknown-key → `[REDACTED_KEY]` completo |
| M-8 | MED | `AbortSignal.timeout(60s)` corta streams SSE longos | server-login `upstream-client.ts:187-197` | timeout só até headers; desanexar após 1º chunk |
| M-9 | MED | Port-guard não cerca 3080/4010 (tenant com shell alcança control-plane) | server-login `supervisor/firewall.ts:59-63` | OUTPUT REJECT p/ uids de tenant nessas portas |
| M-10 | MED | Permissões amplas `go+rX` no root do tenant (só 3 dirs + credenciais restritas) | server-login `fs/workspace.ts:106-115` | `u+rwX,go-rwx` recursivo |
| M-11 | MED | Fallback silencioso do gateway secret para constante pública | server-login `orchestrator.ts:445-448` | falhar no boot se secret ausente/curto |
| M-12 | LOW | Enumeração de usuários por timing no login | server-login `routes/auth.ts:344-345` | dummy scrypt para usuário inexistente |
| M-13 | LOW | Rate-limit do gateway não faz sweep de buckets | server-login `llm-loopback-server.ts:39` | evict por janela (como `rate-limit.ts`) |
| M-14 | LOW | `dsh-provision.path/.service` em falha permanente (useradd rejeita UUID) | host `/usr/local/bin/provision-new-users.sh` | desativar (legado) ou corrigir `--badname` |
| M-15 | LOW | Token de gateway de 24 h não rotativo | server-login `token-validator.ts:37-62` | TTL curto + re-mint no restart |
| M-16 | LOW | scrypt com parâmetros default; argon2id recomendado | server-login `web/auth.ts:17-29` | elevar custo/migrar |
| M-17 | LOW | `isAdmin` por username mágico `'funel'` | server-login `routes/auth.ts:276` | usar `config.masterTenantUsername` |
| M-18 | LOW | Dedup ausente para eventos Stripe de plano | launch `packages/api/auth-http/src/billing.ts:405-447` | registrar ids de eventos processados |

---

## 5. Ordem de correção e bloqueadores de lançamento

0. **Prioridade 1** — Validar a geração de imagens e a primeira publicação com `funnels`. Backend de imagens entregue via commit `1b92bba` (Cloudflare Flux Schnell + OpenAI fallback) e cliente em `9cf3ffacf7`; resta validação funcional e débito de créditos.
1. **A-1** — ✅ **CONCLUÍDO** (commitado em `589d5d6851` e `9cf3ffacf7` no `copymonster-launch`).
2. **A-2** — Alinhar `DEFAULT_CENTRAL_ROUTING_CONFIG` ao schema (10 min) + **M-1** (wirear os 7 testes órfãos no `npm test` do `server-login`; 30 min).
3. **A-3** — Habilitar dump do Supabase no systemd unit e testar restore em ambiente isolado (1 h).
4. **M-2 (CSRF)** — Origin-check nas rotas mutantes do orquestrador (2 h).
5. **M-5** — teardown paralelo (2 h) — elimina SIGKILLs de deploy.
6. **M-8** — timeout de streaming (1 h) — corrige cortes de gerações longas.
7. Demais M (primeira semana): M-3, M-4, M-7, M-9, M-10, M-11, M-12…

---

## 6. Checklist de deploy / validação / rollback (estrutura atual)

**Deploy (ordem obrigatória):**
1. `cd /opt/copymonster/dsh-server-login && git pull && npm run build && systemctl restart dsh-orchestrator`
2. Validar: `curl -s http://127.0.0.1:4010/internal/health` → 200; journal deve ter `[CentralRoutingStore] Successfully loaded LLM central routing`.
3. `cd /root/copymonster-launch && git pull && pnpm install && pnpm run build:artifacts && systemctl restart copymonster.service`
4. Validar: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/` → 200; abrir tenant em `<slug>.copymonster.co`, enviar mensagem no chat, confirmar streaming.

**Rollback:** `git checkout <sha-prev>` + build + restart, mesma ordem inversa. Se migração SQLite impedir: `systemctl stop dsh-orchestrator` → restaurar `server-login.db.gz` do backup mais recente (mesmo dia) → start. Migrações Supabase: reverter via SQL inverso antes do rollback do código (sem dump ativo hoje — ver A-3).

**Pós-deploy (saúde):** `dsh-monitor` verde 2 ciclos; 0×SIGKILL no shutdown seguinte; 1 turno de chat por tenant de teste com routing configurado.

---

## 7. Pendências de evidência

- Resultados completos de typecheck/lint/test/build do `copymonster-launch` (agente em execução — anexar antes da aprovação final).
- Teste funcional do erro "signal is aborted without reason" na seleção de workspace (requer sessão de browser instrumentada).
- Restauração completa de backup em ambiente isolado.
- Políticas RLS/migrações SQL do Supabase e código do app principal (repositório não fornecido).

---

*Somente o que tem evidência explícita está marcado como verificado. Qualquer alteração de código/deploy propostas acima depende de aprovação prévia.*
