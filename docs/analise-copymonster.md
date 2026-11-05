Análise completa — CopyMonster (copymonster-launch + copymonster-dsh-server-login)
Data da análise: 05/11/2026 · Clonados em /home/ubuntu/copymonster-launch e /home/ubuntu/copymonster-dsh-server-login.

Resumo
O CopyMonster é um SaaS multi-tenant ("Brand DNA Operating System") construído como fork MIT do DeepSeek Harness (DSH). São dois repositórios que trabalham juntos:

Repositório

Papel

Stack

Tamanho

copymonster-launch

App principal (SaaS, agentes, Brand DNA, billing, afiliados)

Monorepo pnpm, TypeScript, Cordis (plugins), React/Vite, Supabase

~19.500 arquivos, 381 pacotes, 24.418 commits (herdados do upstream)

copymonster-dsh-server-login

Orquestrador invisível: isola cada tenant num processo DSH próprio (UID Linux) e faz o proxy por subdomínio

Node 22+/24, Fastify 5, SQLite/Postgres, Supabase, K8s opcional

~6.600 linhas TS em src/, 170 commits

Último commit em ambos: 05/11/2026 (afiliados no app; provisionamento de sandbox no orquestrador).

Arquitetura de produção
Internet → Cloudflare (WAF, TLS, *.app.copymonster.co)
   → cloudflared tunnel (VPS Linux)
       ├─ app.copymonster.co    → 127.0.0.1:3080  copymonster.service (app principal)
       └─ *.app.copymonster.co  → 127.0.0.1:3081  dsh-orchestrator (dsh-server-login)
                                     └─ por tenant: processo `dsh` com UID 100000+ (setpriv / systemd-run scope),
                                        porta loopback dinâmica, home 0700, port guard via iptables
Fluxo do usuário: cadastro no app (Supabase Auth, com slug/subdomínio) → login → troca de sessão SSO (/api/auth/session-token, cookie cm_session + cookie sid HMAC compartilhado via SESSION_SECRET) → redirecionamento para <slug>.app.copymonster.co → o orquestrador autentica, assina a identidade do tenant (Ed25519) e faz o proxy HTTP/WebSocket para o DSH isolado do tenant.

1. copymonster-launch (app principal)
Estrutura
apps/ (cli, desktop, desktop-host, web, plugin-market-generator) · packages/ (~50 grupos herdados do DSH: core, llm, session, mcp, sandbox, subagent, workflow, client, host…) · vendor/ (Cordis) · supabase/migrations (001 → 053) · supabase/tests · docs/ · python/ · native/ · benchmarks/ · website/.

Camada específica do CopyMonster
Componente

Local

Função

Bundle CopyMonster

packages/bundle/copymonster (@deepseek-ai/dsh-copymonster)

Monta o serviço de auth e as rotas HTTP sobre o perfil web; preset brand-positioning-monster

Auth/billing HTTP

packages/api/auth-http/src

session-token, billing (Stripe), rate-limit, access, identity, affiliate-processor, payout-executor, paypal-payout

Contexto de auth

packages/api/auth-context

Resolução do principal/tenant

Identidade/marca

packages/host/copymonster-identity, packages/host/brand-assets

Rebranding Dark/Gold

Cliente Supabase

packages/server/supabase-client

Acesso a dados com RPCs escopadas ao chamador

Frontend web

apps/web/src

Login/Registro/Recuperação de senha, Perfil, Planos/Billing, Admin (tenants, auditoria, afiliados), Settings (Meu DNA, Afiliados), i18n en/pt/zh/es, tema cm-theme.css

Banco (Supabase/Postgres) — 53 migrations
Identidade e isolamento multi-tenant com RLS (001–006), billing e trial (007, 020, 026, 051), painel admin (008–019), providers/modelos LLM em runtime com chaves criptografadas (014–015, 021, 027–037), bloqueio de e-mails descartáveis (038), Brand DNA / positioning_mappings com quotas (039–042, 049), slug de tenant no cadastro (043), RPCs escopadas por tenant (044), convites de uso único (045), endurecimentos de segurança (046–050) e programa de afiliados com schemas affiliate e finance (ledger de partidas dobradas) + cron de elegibilidade (052–053).

Funcionalidades de produto
Brand DNA Engine (entrevista estratégica em 12 blocos, versionamento v1/v2/v3, injeção opcional de POSITIONING CONTEXT, múltiplos DNAs) · agentes especializados (copy, funil, pesquisa, planejamento/subagentes) · conectores MCP · ferramentas de arquivo/shell em sandbox com políticas de aprovação · billing Stripe (checkout, portal, webhook, limites por plano) · admin (usuários, tenants, providers LLM, modelos, config, storage, sessões, billing, auditoria) · afiliados (rastreamento ?ref=, comissão de 30%, carência de 35 dias, saque mínimo de US$ 50, payout PayPal em modo mock/sandbox, fila de KYC e validação no admin).

Comandos principais
pnpm install · pnpm run build · pnpm dsh web (porta 3080) · pnpm run test / typecheck / lint · Node ≥ 24.9.

Variáveis de ambiente (.env.example)
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, SESSION_SECRET (≥ 32 caracteres, igual ao do orquestrador), VITE_SUPABASE_*, PORT, CLOUDFLARE_*, STRIPE_*.

Branches remotas
master (HEAD), backup-pre-sync-20261027, sync-upstream-20261027, fix/p0-4-service-role-key, hello--how-are-you-65918; tag pre-prod-llm-billing-20261008.

2. copymonster-dsh-server-login (orquestrador)
Fork do pointer-a/dsh-server-login (documentação original em chinês), adaptado ao CopyMonster: aprovação de admin removida, páginas traduzidas para inglês, registro redirecionado ao app principal, tela de "launching" com a marca, SSO via Supabase.

Módulos (src/)
Área

Arquivos

Função

Entrada/config

cli.ts, config.ts, index.ts, runtime.ts

CLI, flags/env, bootstrap

Web

web/server.ts, routes/{auth,admin,desktop,dsh,domain,plugins}.ts, middleware/{authn,fs-guard,rate-limit}.ts, session-cookie.ts, file-service.ts

API Fastify, cookies sid, rate limit

Supervisor

supervisor/{orchestrator,spawn,spawner,k8s-spawner,proxy,reconcile,leader,firewall,patch}.ts

Spawn por tenant (setpriv/systemd-run), proxy por Host, port guard iptables, modo K8s com leader election

Identidade

identity.ts, supabase.ts, crypto.ts

Identidade Ed25519 assinada a cada requisição; cofre AES-256-GCM

Dados

db/{sqlite,pg,schema,repo,…}.ts

SQLite (modo local) ou Postgres (K8s)

FS

fs/{local-user-fs,k8s-user-fs,workspace,plugins}.ts

Raiz por usuário 0700, cerca contra symlinks

Operação
Unidades systemd em deploy/ (orquestrador, backup, disk-guard, monitor + timers, delegação de cgroup), exemplo de cloudflared, env.production.example, manifests K8s (00–10), scripts backup.mjs, monitor.mjs, disk-guard.mjs e uma bateria de smoke-*.mjs; testes node:test em test/.

Variáveis-chave
DSH_SERVER_LOGIN_PORT (produção: 3081), SESSION_SECRET, DSH_SERVER_LOGIN_SUPABASE_URL, DSH_SERVER_LOGIN_SUPABASE_ANON_KEY, DSH_SERVER_LOGIN_MAIN_APP_URL, DSH_SERVER_LOGIN_ISOLATION_MODE=account, DSH_SERVER_LOGIN_PORT_GUARD=true, DSH_SERVER_LOGIN_BASE_DOMAIN, DSH_SERVER_LOGIN_COOKIE_DOMAIN, DSH_SERVER_LOGIN_ENABLE_PATCH, DSH_SERVER_LOGIN_DSH_BIN, quotas opcionais DSH_SERVER_LOGIN_MEMORY_MAX / CPU_QUOTA / TASKS_MAX.

3. Estado de produção e segurança (segundo a documentação do próprio repositório)
A auditoria docs/plan/AUDITORIA-PRODUCAO-COPYMONSTER.md (04/11/2026) concluiu que o projeto ainda não estava pronto para produção; a remediação avançou bastante desde então.

Item

Estado registrado

P0-1 .env legível por tenants

✅ Fechado

P0-2 server-login.db legível

✅ Fechado

P0-3 Homes de tenant em 0755

✅ Fechado (0700 durável)

P0-4 SUPABASE_SERVICE_ROLE_KEY no tenant

✅ Fechado (migration 044)

P0-5 Disco / quotas por tenant

🟡 Aberto — quotas existem, mas desligadas por padrão; disco reduzido de 93% para 85% (meta < 70%)

Auditoria de segurança C-01 a C-15

14 fechados, 1 mitigado (C-05: rota /enter ainda devolve token)

Pendências apontadas na documentação
max_sessions e storage_gb ainda não aplicados; quotas de CPU/RAM por plano (o plano agora é enviado no SSO, falta ativar valores por plano); check_tenant_quota executável por anon; backups e restore testado, monitorização com alertas; cloudflared com Restart=always e configuração duplicada; runbooks de onboarding/DR; política de retenção e registro de consentimento; tirar STRIPE_* dos tenants por completo (proxy do checkout); testes de carga com 10–12 tenants. Nos afiliados, o payout PayPal ainda está em modo mock.

Observações técnicas minhas
O monorepo carrega todo o histórico e os pacotes do DSH upstream (muitos pacotes experimental e documentação .zh.md), o que deixa a base pesada (~5 GB de node_modules na VPS, segundo a auditoria). O orquestrador ainda tem README, comentários e a CI (push para registry Alibaba ACR) em chinês, voltados ao projeto original. A integração entre os dois repositórios depende de três contratos: o mesmo SESSION_SECRET, o endpoint /api/auth/session-token do app e a injeção do bundle @deepseek-ai/dsh-copymonster no perfil web de cada tenant.
