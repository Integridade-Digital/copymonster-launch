# Plano de Preservação do Fork CopyMonster antes de qualquer merge com o upstream

**Documento:** `docs/roadmap/fork-preservation.md`
**Status:** Inventário executado — Aguardando aprovação do plano
**Alinhamento Institucional:** DeepSeek Harness (`deepseek-ai/deepseek-harness`) → Fork `Integridade-Digital/copymonster-launch`
**Escopo:** Análise e preservação. Este documento não altera código de produto.

---

## 0. Sumário executivo

O fork está **2.677 commits atrás** do upstream e **222 commits à frente** do ponto de divergência. O próximo merge com `upstream/master` é, portanto, uma operação de grande porte, não um merge trivial de rotina.

O risco real de perda de trabalho não está nos 153 arquivos criados pelo fork (esses, em regra, não conflitam). Está em três frentes:

1. **176 arquivos que existem no upstream e foram modificados pelo fork** — todo merge futuro vai produzir conflito neles.
2. **6 arquivos de `packages/preset/agent-presets/` que o upstream removeu** enquanto o fork os modificou (conflito *modify/delete*: o Git pergunta se apaga ou mantém; escolher o lado errado destrói trabalho).
3. **Trabalho ainda não commitado no working tree** (`packages/host/brand-assets/` e wiring de `package.json`/`tsconfig`/`cordis.patch.yml`) que **desaparece** em qualquer `git checkout`, `git reset --hard` ou `git stash drop`.

Regras de ouro antes do merge:

- Nada de `git reset --hard`, `git clean -fdx` ou `git checkout .` enquanto houver WIP.
- Fazer o merge **sempre em uma branch nova**, nunca direto na `master`.
- Fazer *tag* de segurança do estado atual antes de iniciar.
- Resolver conflitos por intenção, arquivo a arquivo, nunca com `-X ours` / `-X theirs` globais.

---

## 1. Inventário completo do fork (Tarefa 1)

### 1.1 Números

Comandos-base (adaptados: o upstream usa `master`, não `main`):

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git 2>/dev/null
git fetch upstream
MB=$(git merge-base HEAD upstream/master)
git diff --name-status $MB..HEAD
```

| Métrica | Valor |
|---|---|
| Merge-base (`MB`) | `ddefc45fbc` — 2026-09-17 — `release dsh 0.1.6-alpha.2` |
| Tip do fork (`HEAD`) | `master` (origin) |
| Tip do upstream (`upstream/master`) | `5badb15009` — 2026-10-03 — `release dsh 0.2.1-alpha.1` |
| Commits upstream à frente do MB | **2.677** |
| Commits do fork à frente do MB | **222** |
| Arquivos **ADICIONADOS (A)** | **153** |
| Arquivos **MODIFICADOS (M)** | **176** |
| Arquivos **DELETADOS (D)** | **2** |
| Arquivos **RENOMEADOS (R100)** | **1** |
| Total de arquivos tocados | **332** |
| Linhas inseridas / removidas | `31.094` / `998` |

Nota: o comando original do pedido usava `upstream/main`; neste repositório o branch default do upstream é `master`. Todos os cálculos usam `upstream/master`.

### 1.2 Categorias (A–J)

As categorias abaixo podem se sobrepor (um arquivo de migração de billing aparece em C e em D). Os totais são da busca por padrão; exemplos limitados a 5.

#### A) Rebranding — 20 arquivos

- `M apps/desktop/installer/assets/brand-2x.png`
- `M apps/desktop/installer/assets/brand-dark-2x.png`
- `M apps/desktop/installer/assets/brand-dark.png`
- `M apps/desktop/installer/assets/brand.png`
- `A apps/web/public/brand-text-black.png`

Inclui ainda: `apps/web/public/favicon.{png,svg}`, `apps/web/public/manifest.webmanifest`, `apps/web/index.html`, `website/public/{favicon,wordmark}.svg`, `packages/client/ui-primitives/src/{BrandWordmark,FishLogo}.tsx`, ícones do desktop (`apps/desktop/resources/icon*`), `packages/skill/skill-badge/assets/dsh-badge.png`, banners de `docs/user/guide/*.png` e os 4 roadmaps `plano-*-copymonster.md`.

#### B) Painel Admin — 24 arquivos

- `A apps/web/src/components/layout/AdminModal.tsx`
- `A apps/web/src/pages/admin/AdminAuditPage.tsx`
- `A apps/web/src/pages/admin/AdminTenantsPage.tsx`
- `A apps/web/src/pages/admin/tabs/AdminAuditTab.tsx`
- `A apps/web/src/pages/admin/tabs/AdminBillingTab.tsx`

Inclui as 9 abas (`AdminOverviewTab`, `AdminUsersTab`, `AdminTenantsTab`, `AdminSessionsTab`, `AdminModelsTab`, `AdminLLMProvidersTab`, `AdminSystemTab`, `AdminAuditTab`, `AdminBillingTab`), `docs/roadmap/plano-painel-admin-expandido.md`, `packages/api/settings-controller/tests/admin-metrics.spec.ts` e os 8 arquivos de migração `supabase/migrations/008` a `020` ligados ao admin.

#### C) Billing / Stripe — 10 arquivos

- `A apps/web/src/pages/billing/BillingCancelPage.tsx`
- `A apps/web/src/pages/billing/BillingSuccessPage.tsx`
- `A apps/web/src/pages/billing/PlansPage.tsx`
- `A apps/web/src/pages/billing/billing.css`
- `A packages/api/auth-http/src/billing.ts`

Inclui `packages/api/auth-http/tests/billing.spec.ts`, `packages/api/session-controller/tests/subscription-gate.host.spec.ts`, `supabase/migrations/007_billing_and_trial.sql` e `026_billing_price_ids.sql`, `020_admin_billing.sql`.

#### D) Migrations SQL (`supabase/`) — 31 arquivos

- `A supabase/migrations/001_initial_identity.sql`
- `A supabase/migrations/002_saas_complete_isolation.sql`
- `A supabase/migrations/003_security_and_profile_fixes.sql`
- `A supabase/migrations/004_tenant_jwt_claim.sql`
- `A supabase/migrations/005_workspaces_multi_tenant.sql`

Todas as 31 migrations (`001`–`031`) são **arquivos exclusivos do fork**; não existe `supabase/` no upstream. Substituição por migrations do upstream é impossível — a estratégia é apenas garantir que elas sejam preservadas e nunca sobrescritas.

#### E) API controllers (`packages/api/`) — 81 arquivos

- `A packages/api/auth-context/*` (pacote inteiro, 15 arquivos)
- `A packages/api/auth-http/*` (pacote inteiro, 7 arquivos)
- `M packages/api/session-controller/src/index.ts`
- `M packages/api/session-controller/src/commands.ts`
- `M packages/api/settings-controller/src/index.ts`

77 arquivos exclusivos/alterados do fork; 4 modificações de arquivos compartilhados de destaque. Inclui `auth-identity.ts`, `session-db-sync.ts`, `metering`, `session-scope`, `subscription-gate`, `rbac-isolation`, `isolation-sandboxing`.

#### F) Client packages (`ui-*`) — 56 arquivos

- `M packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx`
- `A packages/client/ui-agent-preset/src/client/PresetWizard.tsx`
- `M packages/client/ui-primitives/src/BrandWordmark.tsx`
- `M packages/client/ui-sidebar/src/client/SidebarRoot.tsx`
- `M packages/client/ui-theme/src/styles/design-platform.css`

Cobre 15 pacotes `ui-*`. A maior parte são rebranding (strings `DeepSeek` → `CopyMonster`) e o restante são features de UI (preset wizard, modais, footer actions).

#### G) Bundle do produto (`cordis.patch.yml` e `copymonster/`) — 4 arquivos

- `A packages/bundle/copymonster/cordis.patch.yml`
- `A packages/bundle/copymonster/package.json`
- `A packages/bundle/copymonster/src/index.ts`
- `A packages/bundle/copymonster/tsconfig.json`

O overlay do produto. Todos exclusivos do fork (add/add atual = 0). É a **camada de isolamento preferencial** para todo rebranding e composição futura.

#### H) Scripts / docs / roadmap / `.md` — 56 arquivos

- `A docs/roadmap/plano-auditoria-completa-copymonster.md`
- `A docs/roadmap/plano-painel-admin-expandido.md`
- `A docs/roadmap/saas-multi-tenant-phase-1.md`
- `A docs/subsystems/auth.md`
- `A scripts/validate-tenant-isolation-e2e.mjs`

Inclui 10 roadmaps, 2 docs de subsistema novos (`auth.md`, `auth.zh.md`), 3 relatórios (`AUDIT-REPORT-COMPLETE.md`, `PHASES-IMPLEMENTATION-SUMMARY.md`, `implementation-phases-2-to-5.md`), 2 scripts novos (`check-theme.sh`, `validate-tenant-isolation-e2e.mjs`) e modificações em docs de subsistema bilíngues (`session`, `settings`, `workspace`, `credentials`, `web-server`) que o upstream também mantém — **risco de conflito**.

#### I) Configurações (`package.json`, `tsconfig`, `.env`, vite) — 29 arquivos

- `A .env.example`
- `M .gitignore`
- `M apps/cli/package.json`
- `M apps/web/package.json`
- `M package.json`

Inclui `pnpm-lock.yaml`, `tsconfig.base.json`, `tsconfig.client.json`, `tsconfig.host.json` e os `package.json`/`tsconfig.json` dos novos pacotes. Quase todos são regerados pelo `pnpm install` + build, exceto os scripts de fork no `package.json` (que precisam ser reaplicados manualmente).

#### J) Outros (não classificados) — 62 arquivos

- `A apps/cli/src/seed-tenant.ts`
- `A apps/web/src/lib/auth/*` (auth provider, supabase client, host-boot, protected-route)
- `A apps/web/src/pages/{LoginPage,RegisterPage,ProfilePage,ResetPasswordPage,ForgotPasswordPage}.tsx`
- `A apps/web/src/locales/{en,zh}.ts` + `LocaleContext.tsx`
- `A packages/server/supabase-client/*`

Inclui a camada de autenticação do host web (`lib/auth/*`), as páginas de auth, o pacote Supabase server-only, `packages/util/constants`, `packages/workspace/workspace/src/sandbox.ts` (+ teste) e ajustes de `packages/preset/agent-presets`, `packages/client/web`, `packages/host/frontend-static`, `packages/extensions/tool-cordis`, `packages/test-support`.

### 1.3 Trabalho NÃO commitado (bloqueador de preservação)

O working tree atual contém trabalho do fork **fora do histórico**:

| Estado | Arquivo |
|---|---|
| `M` (não commitado) | `apps/cli/package.json` (dependência `dsh-host-brand-assets`) |
| `M` (não commitado) | `packages/bundle/copymonster/cordis.patch.yml` (insere `brand-assets`) |
| `M` (não commitado) | `packages/bundle/copymonster/package.json` (dependência `dsh-host-brand-assets`) |
| `M` (não commitado) | `tsconfig.host.json` (referência ao projeto `brand-assets`) |
| `M` (não commitado) | `pnpm-lock.yaml` |
| `??` (untracked) | `packages/host/brand-assets/` (README, `src/index.ts`, teste, `package.json`, `tsconfig.json`) |

**Ação obrigatória antes de qualquer merge:** commitar esse WIP em uma branch própria (ex.: `wip/brand-assets`) ou, no mínimo, criar uma tag/stash de segurança. Enquanto isso não acontecer, um `git checkout upstream/master -- .` destrói o pacote `brand-assets` inteiro. Os diretórios `lib/` e `node_modules/` dentro de `brand-assets` são artefatos e ficam fora do commit.

---

## 2. Arquivos compartilhados com o upstream (Tarefa 2)

### 2.1 Regra de classificação

Como o fork nasceu do upstream, **todo arquivo com status `M` existia no merge-base** — ou seja, é um arquivo do upstream que o fork tocou. Não há, entre os `M`, nenhum "arquivo nosso que o upstream coincidentemente também tem". A distinção útil é outra:

- **Rebranding dentro de arquivo core:** a mudança do fork é cosmética (nome, cor, string, logo) dentro de um arquivo que pertence ao upstream. Conflito de baixa semântica, mas alta frequência.
- **Feature dentro de arquivo core:** a mudança adiciona comportamento (auth, tenant, billing, RBAC) a um arquivo do upstream. Conflito de alta semântica.
- **Arquivo gerado/lock:** `pnpm-lock.yaml`, catálogos, tsconfigs — nunca resolver à mão; regerar.

### 2.2 Casos especiais confirmados

| Caso | Arquivos | Consequência |
|---|---|---|
| *modify/delete* (fork modifica, upstream removeu) | `packages/preset/agent-presets/{README.md, README.zh.md, README.i18n.yaml, src/index.ts, src/display.ts, tests/settings.spec.ts}` | O upstream substituiu por `packages/preset/agent-preset` + `agent-preset-registry`. Git não resolve sozinho: é preciso portar as mudanças do fork para o pacote novo e apagar o antigo. |
| *delete/modify* (fork apaga, upstream mantém) | `apps/desktop/resources/icon.png`, `snapshots/session/read-image-reencode/workspace/gradient.png` | Confirmar que a deleção do fork é intencional; decidir por intenção. |
| *rename divergent* | `snapshots/web/present-svg/.../von-neumann.svg` (fork renomeou); upstream mantém `workspace.expected/von-neumann.svg` e adicionou vários arquivos ao mesmo cenário | Tratar como arquivo gerado: regerar o snapshot após o merge. |
| *add/add* (mesmo caminho nos dois lados) | **0 no momento** | Nenhum arquivo criado pelo fork colide hoje com caminho criado pelo upstream. Pode surgir até o merge. |

### 2.3 Ranking de risco de conflito (arquivos `M` por nº de commits do upstream que os tocaram)

| Commits upstream | Arquivo |
|---:|---|
| 397 | `pnpm-lock.yaml` |
| 277 | `packages/extensions/tool-cordis/src/api-catalog.ts` |
| 190 | `tsconfig.host.json` |
| 146 | `scripts/gen-cordis-catalog.ts` |
| 106 | `tsconfig.base.json` |
| 87 | `packages/client/ui-chat/tests/chat-view.client.spec.tsx` |
| 65 | `apps/web/tests/document-preview.e2e.ts` |
| 59 | `packages/client/ui-workspace/README.i18n.yaml` |
| 54 | `package.json` |
| 48 | `packages/client/ui-plugin-manager/src/client/locales.ts` |
| 43 | `packages/api/session-controller/src/types.ts` |
| 34 | `packages/api/session-controller/src/index.ts` |
| 20 | `docs/subsystems/credentials.md` |

Distribuição dos 176 `M`:

- 16 arquivos que o upstream **não tocou** desde o fork (conflito improvável, merge limpo).
- 68 arquivos com 1–4 commits upstream.
- 54 arquivos com 5–19 commits upstream.
- 27 arquivos com 20–49 commits upstream.
- 11 arquivos com 50+ commits upstream (tratar como reescrita, não merge).

---

## 3. Estratégia de preservação em 3 camadas (Tarefa 3)

### Camada 1 — Arquivos SÓ do fork (153 `A`)

Não existem no upstream; não conflitam. Regra: **nunca aceitar versão do upstream** (não existe). A proteção aqui é apenas não deixá-los fora do Git. Grupos:

- 31 migrations `supabase/migrations/001`–`031`.
- Pacotes novos: `packages/api/auth-context`, `packages/api/auth-http`, `packages/server/supabase-client`, `packages/util/constants`, `packages/bundle/copymonster`, `packages/host/brand-assets` (WIP).
- App web: `apps/web/src/{main.tsx,lib/auth/*,pages/{LoginPage,RegisterPage,ProfilePage,ResetPasswordPage,ForgotPasswordPage}.tsx,locales/*,components/layout/*,hooks/useFocusTrap.ts,*auth*.css,cm-theme.css}`.
- Testes e scripts: `apps/web/tests/host-boot.spec.ts`, `scripts/check-theme.sh`, `scripts/validate-tenant-isolation-e2e.mjs`, testes `*.spec.ts`/`*.host.spec.ts` novos.
- Docs e assets de marca.

### Camada 2 — Arquivos CORE modificados (176 `M`) — risco de conflito

Recomendação: **híbrida**, por subgrupo.

**2a. Rebranding puro (assumir `ours` no merge).** Arquivos em que o fork detém o estado final e cuja evolução upstream não interessa semanticamente. Para esses, usar `.gitattributes` com `merge=ours`:

- `apps/web/index.html`, `apps/web/public/manifest.webmanifest`, `apps/web/public/favicon.svg`
- `apps/desktop/installer/assets/brand*.png`, `apps/desktop/installer/assets/uninstaller-sidebar.png`
- `apps/desktop/resources/icon*.{png,svg}`
- `website/public/favicon.svg`, `website/public/wordmark.svg`
- `packages/skill/skill-badge/assets/dsh-badge.png`
- `docs/user/guide/providers-*.png`
- `packages/client/ui-sidebar/tests/__snapshots__/sidebar-snapshot.client.spec.tsx.snap` (snapshot de marca do fork)

Atenção: `merge=ours` mantém **o arquivo inteiro** do fork e descarta **toda** mudança upstream naquele arquivo. Só vale para conteúdo 100% fork-owned. NÃO usar em `package.json`, `tsconfig*`, `pnpm-lock.yaml`, locales nem em controllers.

**2b. Feature dentro de core (merge 3 vias manual, obrigatório).** Portar por intenção:

- `packages/api/session-controller/src/{index,commands,catalog,types,list,history,client/*}.ts` (metering, tenant map, db sync)
- `packages/api/settings-controller/src/{index,credentials,types}.ts` (RBAC admin, audit log, protected namespaces)
- `packages/api/workspace-controller/src/{index,commands,feed,directory-picker,client/*}.ts` (isolamento por identidade)
- `packages/host/frontend-static/src/index.ts` (shell público anônimo) — o upstream reformulou muita coisa aqui; risco alto
- `packages/preset/agent-presets/src/{index,display}.ts` — **portar** para `packages/preset/agent-preset` + `agent-preset-registry` e deletar o antigo
- `.env.example`, `.gitignore`, `package.json` (reaplicar scripts `start:copymonster`, `dev:copymonster`, `test:isolation`, `check:theme`)

**2c. Rebranding em locale/strings (merge 3 vias manual, conflito pequeno).** São 1–4 linhas por arquivo; o upstream adiciona chaves novas. Fazer merge manual e preservar a marca:

- `packages/client/locale/src/locales/{en,zh}.ts`
- `packages/client/ui-chat/src/client/locale.ts`
- `packages/client/ui-conversation/src/client/locales.ts`
- `packages/client/ui-plugin-manager/src/client/locales.ts`
- `packages/client/ui-settings-models/src/client/locales.ts`
- `packages/client/ui-sidebar-documentpreview/src/client/office/locales.ts`
- `packages/client/ui-primitives/src/{BrandWordmark,FishLogo}.tsx`, `packages/client/ui-sidebar/src/client/SidebarRoot.tsx`

Meta de longo prazo: mover strings de marca para locais próprios do fork e parar de editar os locales do upstream.

**2d. Gerados / lock (regenerar, nunca resolver à mão).**

- `pnpm-lock.yaml` → aplicar versão upstream e rodar `pnpm install`.
- `tsconfig.host.json`, `tsconfig.client.json`, `tsconfig.base.json` → mesclar referências e revalidar com `pnpm run typecheck`.
- `scripts/gen-cordis-catalog.ts`, `packages/extensions/tool-cordis/src/api-catalog.ts` → aceitar upstream e **regenerar** o catálogo.
- `snapshots/...`, `.expected.md`, specs de UI → aceitar upstream quando o comportamento for upstream e regerar os snapshots do fork.

**Migrar para overlay vs `merge=ours`?** Para rebranding de assets/metadata, `merge=ours` é paliativo aceitável. O objetivo estratégico é **migrar tudo para a Camada 3** (overlay), de modo que a Camada 2 encolha a cada ciclo. Enquanto essa migração não estiver feita, `merge=ours` limitado ao grupo 2a + merge 3 vias para o resto é a postura segura.

**Configuração do `merge=ours`** (o driver `ours` não existe por padrão):

```sh
git config --global merge.ours.driver true
```

E no `.gitattributes` (ainda a criar, listado explicitamente):

```gitattributes
apps/web/index.html merge=ours
apps/web/public/manifest.webmanifest merge=ours
apps/web/public/favicon.svg merge=ours
apps/desktop/installer/assets/brand.png merge=ours
apps/desktop/installer/assets/brand-2x.png merge=ours
apps/desktop/installer/assets/brand-dark.png merge=ours
apps/desktop/installer/assets/brand-dark-2x.png merge=ours
apps/desktop/installer/assets/uninstaller-sidebar.png merge=ours
apps/desktop/resources/icon.png merge=ours
apps/desktop/resources/icon-macos.png merge=ours
apps/desktop/resources/icon-macos.svg merge=ours
apps/desktop/resources/icon-windows.png merge=ours
apps/desktop/resources/icon-windows.svg merge=ours
apps/desktop/resources/icon.svg merge=ours
apps/desktop/resources/Icon.png merge=ours
website/public/favicon.svg merge=ours
website/public/wordmark.svg merge=ours
packages/skill/skill-badge/assets/dsh-badge.png merge=ours
docs/user/guide/providers-custom-form.png merge=ours
docs/user/guide/providers-custom-form.zh.png merge=ours
docs/user/guide/providers-models-page.png merge=ours
docs/user/guide/providers-models-page.zh.png merge=ours
packages/client/ui-sidebar/tests/__snapshots__/sidebar-snapshot.client.spec.tsx.snap merge=ours
packages/bundle/copymonster/** merge=ours
```

### Camada 3 — Arquivos de OVERLAY (isolar tudo aqui)

Já existem e são a base do isolamento:

- `packages/bundle/copymonster/cordis.patch.yml` (insere `auth-context`, `auth-http`, `brand-assets`; sobrescreve `system-prompt`).
- `packages/bundle/copymonster/src/index.ts` + `package.json`.
- `packages/host/brand-assets/` (novo plugin de rotas de marca, WIP).

Recomendação: **toda nova customização de CopyMonster entra por aqui**, via `ctx.effect()`, slots, interceptors e `insert:` no patch — nunca editando diretamente arquivos do upstream. Migrar progressivamente o grupo 2b (auth, billing, RBAC, tenant) para plugins do bundle, deixando nos controllers core apenas o diff mínimo inevitável.

---

## 4. Runbook de merge futuro sem perder nada (Tarefa 4)

### 4.0 Antes de começar (preservação)

```sh
git status                       # confirmar WIP; NÃO prosseguir com WIP não salvo
git add packages/host/brand-assets apps/cli/package.json tsconfig.host.json \
  packages/bundle/copymonster/package.json packages/bundle/copymonster/cordis.patch.yml
git commit -m "chore(copymonster): preserve brand-assets plugin WIP"
git checkout master
git tag pre-upstream-merge-$(date +%Y%m%d)      # tag de segurança
git push origin master --tags
```

### 4.1 Preparar o merge

```sh
git fetch upstream
git checkout -b upstream-merge-$(date +%Y%m%d)
git merge upstream/master --no-commit --no-ff
git status                       # listar conflitos antes de resolver
```

### 4.2 Resolver conflitos por classe

| Classe | Arquivos | Ação |
|---|---|---|
| Assets/metadata de marca (Camada 2a) | `index.html`, `manifest.webmanifest`, `favicon.svg`, ícones, `BrandWordmark`/`FishLogo`, snapshots de marca | `git checkout --ours -- <arquivo>` (ou driver `merge=ours`) |
| Feature em controller (Camada 2b) | `session-controller`, `settings-controller`, `workspace-controller`, `frontend-static` | Resolver linha a linha; reaplicar o bloco de fork sobre o código upstream novo |
| `agent-presets` (modify/delete) | `packages/preset/agent-presets/*` | Portar o diff do fork para `packages/preset/agent-preset`/`agent-preset-registry`; `git rm -r packages/preset/agent-presets` |
| Locales/strings (Camada 2c) | `packages/client/**/locales*.ts`, `locale.ts` | Merge manual; manter marca CopyMonster; acceptar chaves novas do upstream |
| Gerados/lock (Camada 2d) | `pnpm-lock.yaml`, `tsconfig*.json`, `api-catalog.ts`, `snapshots/**` | `git checkout --theirs`, depois regenerar |
| Configs do fork | `package.json`, `.env.example` | Reaplicar scripts `start:copymonster`, `dev:copymonster`, `test:isolation`, `check:theme` |
| Migrations | `supabase/migrations/*` | Manter todas (fork-only); verificar se o upstream passou a ter `SCHEMA_VERSION`/migrations próprias e reconciliar numeração |

### 4.3 Regenerar e validar

```sh
pnpm install                 # lockfile
pnpm run typecheck
pnpm run build
pnpm run test                # unitários
pnpm run test:snapshot       # snapshots de sessão/perfil
pnpm run lint
pnpm run doc-sync            # docs bilíngues e links
```

### 4.4 Checklist de validação funcional (pós-merge)

- [ ] O painel Admin carrega e todas as 9 abas renderizam (`/admin`).
- [ ] Billing funciona: planos carregam, checkout Stripe redireciona, webhook e páginas de sucesso/cancelamento respondem.
- [ ] Session e workspace são criados; `session-db-sync` grava no Supabase; metering incrementa tokens.
- [ ] Isolamento multi-tenant: RLS e sandbox bloqueiam acesso cruzado entre tenants (`test:isolation`).
- [ ] Branding intacto: título `Copy, Funnels & Launches by CopyMonster`, favicons, manifest, wordmark, ícones do desktop e instalador.
- [ ] i18n EN/ZH funciona em 100% das telas (login, billing, admin, chat, settings).
- [ ] Migrations SQL: confirmar que `001`–`031` do fork estão presentes; se o upstream introduziu schema próprio, mapear conflito de numeração.
- [ ] Auth: login, registro, reset de senha e rotas protegidas operam; `authIdentity` não dispara erro de Proxy.
- [ ] `ctx.remote.settings`/`session`/`workspace` respondem sob `RemoteScope('auth')`.

### 4.5 Fechar

```sh
git commit                   # conflitos resolvidos
pnpm run test && pnpm run typecheck && pnpm run lint
git push origin upstream-merge-YYYYMMDD
gh pr create --base master --title "chore: merge upstream/main (YYYYMMDD)" --body "..."
# revisar, validar checklist, merge de volta na master
```

---

## 5. Arquivos que NUNCA devem ser aceitos do upstream (Tarefa 5)

Aceitar a versão do upstream nesses arquivos reintroduz a marca DeepSeek ou remove funcionalidade CopyMonster. Protegidos por `merge=ours` ou por resolução manual `--ours`:

1. `packages/bundle/copymonster/cordis.patch.yml` — overlay de composição do produto.
2. `packages/bundle/copymonster/package.json` e `src/index.ts` — pacote do produto.
3. `packages/host/brand-assets/**` — plugin de rotas de marca (WIP).
4. `apps/web/index.html` — título, metadata, OG/Twitter, ícones.
5. `apps/web/public/manifest.webmanifest` — nome, cores, ícones PWA.
6. `apps/web/public/favicon.svg` — favicon do fork.
7. `apps/desktop/installer/assets/brand*.png` e `uninstaller-sidebar.png`.
8. `apps/desktop/resources/icon*.{png,svg}` e `apps/desktop/resources/Icon.png`.
9. `website/public/favicon.svg` e `website/public/wordmark.svg`.
10. `packages/client/ui-primitives/src/{BrandWordmark,FishLogo}.tsx` — logo/nome na UI.
11. `packages/client/ui-sidebar/tests/__snapshots__/sidebar-snapshot.client.spec.tsx.snap` — snapshot de marca.
12. `packages/skill/skill-badge/assets/dsh-badge.png`.
13. `docs/user/guide/providers-*.png` — capturas com marca do fork.
14. `supabase/migrations/001`–`031` — schema do fork (upstream não tem `supabase/`).
15. Pacotes inteiramente fork-only: `packages/api/auth-context`, `packages/api/auth-http`, `packages/server/supabase-client`, `packages/util/constants`.
16. Scripts/entradas do fork: `apps/cli/src/seed-tenant.ts`, `apps/web/src/main.tsx`, `apps/web/src/lib/auth/**`, `apps/web/src/pages/**`, `apps/web/src/locales/**`, `scripts/check-theme.sh`, `scripts/validate-tenant-isolation-e2e.mjs`.
17. Scripts do `package.json`: `start:copymonster`, `dev:copymonster`, `test:isolation`, `check:theme`.

---

## 6. Apêndices — listas completas

### Apêndice A — Arquivos ADICIONADOS pelo fork (153)

```
.dsh-build/client-build-environment.json
.env.example
apps/cli/src/seed-tenant.ts
apps/desktop/resources/Icon.png
apps/web/public/brand-text-black.png
apps/web/public/brand-text.png
apps/web/public/brand.png
apps/web/public/favicon.png
apps/web/src/auth-gate.css
apps/web/src/auth.css
apps/web/src/cm-theme.css
apps/web/src/components/auth/RoleGate.tsx
apps/web/src/components/layout/AdminModal.tsx
apps/web/src/components/layout/AppFrame.css
apps/web/src/components/layout/AppFrame.tsx
apps/web/src/components/layout/FooterActionsRoot.module.css
apps/web/src/components/layout/FooterActionsRoot.tsx
apps/web/src/components/layout/PlansModal.tsx
apps/web/src/components/layout/ProfileModal.tsx
apps/web/src/hooks/useFocusTrap.ts
apps/web/src/lib/auth/app-wrapper.tsx
apps/web/src/lib/auth/auth-error-utils.ts
apps/web/src/lib/auth/auth.provider.tsx
apps/web/src/lib/auth/host-boot.ts
apps/web/src/lib/auth/index.ts
apps/web/src/lib/auth/protected-route.tsx
apps/web/src/lib/auth/supabase.client.ts
apps/web/src/lib/format.ts
apps/web/src/lib/supabase/client.ts
apps/web/src/locales/LocaleContext.tsx
apps/web/src/locales/en.ts
apps/web/src/locales/index.ts
apps/web/src/locales/zh.ts
apps/web/src/main.tsx
apps/web/src/pages/ForgotPasswordPage.tsx
apps/web/src/pages/LoginPage.tsx
apps/web/src/pages/ProfilePage.css
apps/web/src/pages/ProfilePage.tsx
apps/web/src/pages/RegisterPage.tsx
apps/web/src/pages/ResetPasswordPage.tsx
apps/web/src/pages/admin/AdminAuditPage.tsx
apps/web/src/pages/admin/AdminTenantsPage.tsx
apps/web/src/pages/admin/tabs/AdminAuditTab.tsx
apps/web/src/pages/admin/tabs/AdminBillingTab.tsx
apps/web/src/pages/admin/tabs/AdminLLMProvidersTab.tsx
apps/web/src/pages/admin/tabs/AdminModelsTab.tsx
apps/web/src/pages/admin/tabs/AdminOverviewTab.tsx
apps/web/src/pages/admin/tabs/AdminSessionsTab.tsx
apps/web/src/pages/admin/tabs/AdminSystemTab.tsx
apps/web/src/pages/admin/tabs/AdminTenantsTab.tsx
apps/web/src/pages/admin/tabs/AdminUsersTab.tsx
apps/web/src/pages/billing/BillingCancelPage.tsx
apps/web/src/pages/billing/BillingSuccessPage.tsx
apps/web/src/pages/billing/PlansPage.tsx
apps/web/src/pages/billing/billing.css
apps/web/tests/host-boot.spec.ts
docs/AUDIT-REPORT-COMPLETE.md
docs/PHASES-IMPLEMENTATION-SUMMARY.md
docs/implementation-phases-2-to-5.md
docs/roadmap/plano-auditoria-completa-copymonster.md
docs/roadmap/plano-auditoria-correcoes-copymonster.md
docs/roadmap/plano-correcao-prioridades.md
docs/roadmap/plano-isolamento-tenants-workspaces-copymonster.md
docs/roadmap/plano-modals-layout-i18n-openrouter.md
docs/roadmap/plano-painel-admin-expandido.md
docs/roadmap/plano-redesign-copymonster.md
docs/roadmap/saas-multi-tenant-phase-1.md
docs/roadmap/saas-multi-tenant-phase-4-5.md
docs/subsystems/auth.md
docs/subsystems/auth.zh.md
packages/api/auth-context/README.i18n.yaml
packages/api/auth-context/README.md
packages/api/auth-context/README.zh.md
packages/api/auth-context/package.json
packages/api/auth-context/src/client/index.ts
packages/api/auth-context/src/index.ts
packages/api/auth-context/src/types.d.ts
packages/api/auth-context/src/types.js
packages/api/auth-context/src/types.ts
packages/api/auth-context/tests/auth-context.client.spec.ts
packages/api/auth-context/tests/auth-context.spec.ts
packages/api/auth-context/tsconfig.client.json
packages/api/auth-context/tsconfig.host.json
packages/api/auth-context/tsconfig.json
packages/api/auth-context/tsdown.config.ts
packages/api/auth-http/package.json
packages/api/auth-http/src/billing.ts
packages/api/auth-http/src/index.ts
packages/api/auth-http/src/types.ts
packages/api/auth-http/tests/billing.spec.ts
packages/api/auth-http/tsconfig.json
packages/api/session-controller/src/auth-identity.ts
packages/api/session-controller/src/session-db-sync.ts
packages/api/session-controller/tests/catalog-merge.host.spec.ts
packages/api/session-controller/tests/metering.host.spec.ts
packages/api/session-controller/tests/session-db-sync.host.spec.ts
packages/api/session-controller/tests/session-scope.host.spec.ts
packages/api/session-controller/tests/subscription-gate.host.spec.ts
packages/api/settings-controller/tests/admin-metrics.spec.ts
packages/api/settings-controller/tests/rbac-isolation.spec.ts
packages/api/workspace-controller/src/auth-identity.ts
packages/api/workspace-controller/tests/isolation-sandboxing.spec.ts
packages/bundle/copymonster/cordis.patch.yml
packages/bundle/copymonster/package.json
packages/bundle/copymonster/src/index.ts
packages/bundle/copymonster/tsconfig.json
packages/client/ui-agent-preset/src/client/PresetWizard.tsx
packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx.bak2
packages/client/ui-settings-plugin-inventory/src/client/plugin-catalog.ts
packages/server/supabase-client/package.json
packages/server/supabase-client/src/index.ts
packages/server/supabase-client/src/supabase.client.ts
packages/server/supabase-client/src/supabase.types.ts
packages/server/supabase-client/tsconfig.json
packages/util/constants/package.json
packages/util/constants/src/index.ts
packages/util/constants/tsconfig.json
packages/workspace/workspace/src/sandbox.ts
packages/workspace/workspace/tests/sandbox.spec.ts
scripts/check-theme.sh
scripts/validate-tenant-isolation-e2e.mjs
snapshots/session/read-image-reencode/gradient.png
supabase/migrations/001_initial_identity.sql
supabase/migrations/002_saas_complete_isolation.sql
supabase/migrations/003_security_and_profile_fixes.sql
supabase/migrations/004_tenant_jwt_claim.sql
supabase/migrations/005_workspaces_multi_tenant.sql
supabase/migrations/006_deterministic_tenant_and_rls.sql
supabase/migrations/007_billing_and_trial.sql
supabase/migrations/008_admin_expanded_backend.sql
supabase/migrations/009_metrics_refresh.sql
supabase/migrations/010_sessions_index_sync.sql
supabase/migrations/011_model_distribution_rpc.sql
supabase/migrations/012_admin_users_management.sql
supabase/migrations/013_admin_user_actions.sql
supabase/migrations/014_admin_llm_providers.sql
supabase/migrations/015_admin_llm_models.sql
supabase/migrations/016_admin_system_config.sql
supabase/migrations/017_admin_storage_paths.sql
supabase/migrations/018_admin_sessions.sql
supabase/migrations/019_admin_sessions_trigger_fix.sql
supabase/migrations/020_admin_billing.sql
supabase/migrations/021_add_openrouter_provider.sql
supabase/migrations/022_repair_workspaces_meta_and_rpc.sql
supabase/migrations/023_fix_new_user_trigger.sql
supabase/migrations/024_fix_existing_user_roles.sql
supabase/migrations/025_security_and_role_hardening.sql
supabase/migrations/026_billing_price_ids.sql
supabase/migrations/027_runtime_llm_config.sql
supabase/migrations/028_runtime_llm_key_decrypt.sql
supabase/migrations/029_revoke_authenticated_token_increment.sql
supabase/migrations/030_runtime_session_index.sql
supabase/migrations/031_fix_ilike_escape.sql
```

### Apêndice B — Arquivos MODIFICADOS pelo fork (176)

```
.gitignore
THIRD_PARTY_NOTICES.md
apps/cli/package.json
apps/cli/tsconfig.json
apps/desktop/installer/assets/brand-2x.png
apps/desktop/installer/assets/brand-dark-2x.png
apps/desktop/installer/assets/brand-dark.png
apps/desktop/installer/assets/brand.png
apps/desktop/installer/assets/uninstaller-sidebar.png
apps/desktop/resources/icon-macos.png
apps/desktop/resources/icon-macos.svg
apps/desktop/resources/icon-windows.png
apps/desktop/resources/icon-windows.svg
apps/desktop/resources/icon.svg
apps/web/index.html
apps/web/package.json
apps/web/public/favicon.svg
apps/web/public/manifest.webmanifest
apps/web/tests/document-preview.e2e.ts
docs/subsystems/credentials.i18n.yaml
docs/subsystems/credentials.md
docs/subsystems/credentials.zh.md
docs/subsystems/session.i18n.yaml
docs/subsystems/session.md
docs/subsystems/session.zh.md
docs/subsystems/settings.i18n.yaml
docs/subsystems/settings.md
docs/subsystems/settings.zh.md
docs/subsystems/web-server.i18n.yaml
docs/subsystems/web-server.md
docs/subsystems/web-server.zh.md
docs/subsystems/workspace.i18n.yaml
docs/subsystems/workspace.md
docs/subsystems/workspace.zh.md
docs/user/guide/providers-custom-form.png
docs/user/guide/providers-custom-form.zh.png
docs/user/guide/providers-models-page.png
docs/user/guide/providers-models-page.zh.png
docs/web-styling.i18n.yaml
docs/web-styling.md
docs/web-styling.zh.md
package.json
packages/api/session-controller/package.json
packages/api/session-controller/src/agent.ts
packages/api/session-controller/src/catalog.ts
packages/api/session-controller/src/client/sessions/session.ts
packages/api/session-controller/src/client/transport.ts
packages/api/session-controller/src/commands.ts
packages/api/session-controller/src/history.ts
packages/api/session-controller/src/index.ts
packages/api/session-controller/src/list.ts
packages/api/session-controller/src/types.ts
packages/api/session-controller/tests/agent.host.spec.ts
packages/api/session-controller/tests/commands-create-fork.host.spec.ts
packages/api/session-controller/tests/commands-queue-attachment.host.spec.ts
packages/api/session-controller/tests/commands-upload-file.host.spec.ts
packages/api/session-controller/tests/session-cold.host.spec.ts
packages/api/session-controller/tests/session-fork.host.spec.ts
packages/api/session-controller/tests/session-history-journal.host.spec.ts
packages/api/session-controller/tests/session-list-blank.host.spec.ts
packages/api/session-controller/tests/session-presets.host.spec.ts
packages/api/session-controller/tests/session-projections.host.spec.ts
packages/api/session-controller/tests/session-rename.host.spec.ts
packages/api/session-controller/tests/session-search.host.spec.ts
packages/api/session-controller/tests/test-remote.ts
packages/api/session-controller/tsconfig.host.json
packages/api/settings-controller/package.json
packages/api/settings-controller/src/credentials.ts
packages/api/settings-controller/src/index.ts
packages/api/settings-controller/src/types.ts
packages/api/settings-controller/tests/settings-controller.host.spec.ts
packages/api/settings-controller/tsconfig.json
packages/api/workspace-controller/README.i18n.yaml
packages/api/workspace-controller/README.md
packages/api/workspace-controller/README.zh.md
packages/api/workspace-controller/package.json
packages/api/workspace-controller/src/client/index.ts
packages/api/workspace-controller/src/client/model.ts
packages/api/workspace-controller/src/client/service.ts
packages/api/workspace-controller/src/commands.ts
packages/api/workspace-controller/src/directory-picker.ts
packages/api/workspace-controller/src/feed.ts
packages/api/workspace-controller/src/index.ts
packages/api/workspace-controller/src/types.ts
packages/api/workspace-controller/tests/directory-picker.host.spec.ts
packages/api/workspace-controller/tests/model.client.spec.ts
packages/api/workspace-controller/tests/remote/workspace.client.ts
packages/api/workspace-controller/tests/transport.client.spec.ts
packages/api/workspace-controller/tests/workspace-controller.host.spec.ts
packages/api/workspace-controller/tsconfig.client.json
packages/api/workspace-controller/tsconfig.host.json
packages/client/locale/src/client/LanguageRow.module.css
packages/client/locale/src/locales/en.ts
packages/client/locale/src/locales/zh.ts
packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx
packages/client/ui-agent-preset/src/client/index.ts
packages/client/ui-agent-preset/src/client/locales.ts
packages/client/ui-agent-preset/src/client/section-store.ts
packages/client/ui-agent-preset/tests/locales.client.spec.ts
packages/client/ui-agent-preset/tests/section.client.spec.tsx
packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts
packages/client/ui-chat/src/client/locale.ts
packages/client/ui-chat/tests/chat-view.client.spec.tsx
packages/client/ui-conversation/src/client/locales.ts
packages/client/ui-conversation/src/client/service.ts
packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx
packages/client/ui-plugin-manager/src/client/locales.ts
packages/client/ui-primitives/src/BrandWordmark.tsx
packages/client/ui-primitives/src/FishLogo.tsx
packages/client/ui-primitives/src/index.ts
packages/client/ui-primitives/tests/icons.client.spec.tsx
packages/client/ui-settings-general/README.i18n.yaml
packages/client/ui-settings-general/README.md
packages/client/ui-settings-general/README.zh.md
packages/client/ui-settings-general/src/client/SettingsRoot.tsx
packages/client/ui-settings-general/tests/settings-root.client.spec.tsx
packages/client/ui-settings-models/README.i18n.yaml
packages/client/ui-settings-models/README.md
packages/client/ui-settings-models/README.zh.md
packages/client/ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx
packages/client/ui-settings-models/src/client/ModelsSection.tsx
packages/client/ui-settings-models/src/client/locales.ts
packages/client/ui-settings-models/tests/components.client.spec.tsx
packages/client/ui-settings-models/tests/onboarding-dialog.client.spec.tsx
packages/client/ui-settings-models/tests/provider-form.client.spec.tsx
packages/client/ui-settings-models/tests/welcome-notice.client.spec.tsx
packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx
packages/client/ui-settings-plugin-inventory/src/client/locales.ts
packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx
packages/client/ui-settings/src/client/index.ts
packages/client/ui-settings/tests/plugin.client.spec.ts
packages/client/ui-sidebar-documentpreview/src/client/office/locales.ts
packages/client/ui-sidebar/src/client/SidebarRoot.module.css
packages/client/ui-sidebar/src/client/SidebarRoot.tsx
packages/client/ui-sidebar/src/client/index.ts
packages/client/ui-sidebar/tests/__snapshots__/sidebar-snapshot.client.spec.tsx.snap
packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx
packages/client/ui-theme/src/client/AppearanceRow.module.css
packages/client/ui-theme/src/styles/design-platform.css
packages/client/ui-theme/src/styles/gradient-shadow-text.css
packages/client/ui-workspace/README.i18n.yaml
packages/client/ui-workspace/README.md
packages/client/ui-workspace/README.zh.md
packages/client/ui-workspace/src/client/index.ts
packages/client/ui-workspace/src/client/navigation.ts
packages/client/ui-workspace/tests/apply.client.spec.ts
packages/client/ui-workspace/tests/workspaces-service.client.spec.ts
packages/client/web/src/boot-page.ts
packages/client/web/src/boot.ts
packages/extensions/tool-cordis/src/api-catalog.ts
packages/host/frontend-static/README.i18n.yaml
packages/host/frontend-static/README.md
packages/host/frontend-static/README.zh.md
packages/host/frontend-static/src/index.ts
packages/host/frontend-static/tests/frontend-static.spec.ts
packages/preset/agent-presets/README.i18n.yaml
packages/preset/agent-presets/README.md
packages/preset/agent-presets/README.zh.md
packages/preset/agent-presets/src/display.ts
packages/preset/agent-presets/src/index.ts
packages/preset/agent-presets/tests/settings.spec.ts
packages/skill/skill-badge/assets/dsh-badge.png
packages/test-support/client-runtime/src/workspaces.ts
packages/test-support/client-runtime/tests/runtime.client.spec.tsx
packages/typert/generator/src/emitter.ts
packages/typert/protocol/src/types.ts
packages/workspace/workspace/src/index.ts
pnpm-lock.yaml
scripts/gen-cordis-catalog.ts
scripts/package-dependency-policy.ts
snapshots/web/document-preview/document.expected.md
tsconfig.base.json
tsconfig.client.json
tsconfig.host.json
website/public/favicon.svg
website/public/wordmark.svg
```

### Apêndice C — DELETADOS e RENOMEADOS

```
D apps/desktop/resources/icon.png
D snapshots/session/read-image-reencode/workspace/gradient.png
R snapshots/web/present-svg/workspace.expected/von-neumann.svg -> snapshots/web/present-svg/von-neumann.svg
```

---

## 7. Próximos passos recomendados (ordem)

1. Commitar o WIP de `brand-assets` (bloqueador da Tarefa 1.3).
2. Criar o `.gitattributes` com o grupo 2a e configurar `merge.ours.driver`.
3. Criar tag `pre-upstream-merge-YYYYMMDD` e push.
4. Só depois planejar o rebranding (fora do escopo deste documento).
5. Executar o runbook da seção 4 quando o merge for autorizado.

---

## 8. Itens adiados

### Etapa 8 — e2e/snapshot do gating do seletor de modelo (adiado 2026-10-09)

O gating por role do seletor de modelos (Etapa 8) foi implementado e coberto por teste unitário (`packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts`): `owner`/`admin` veem o `/model` e o seat do composer; `member` e sessão ausente escondem ambos (fail-closed). A atualização dos e2e/snapshot web correspondentes ficou **adiada**, por três motivos:

1. O lane web e2e não roda no CI do fork (`test:web` ausente em `.github/workflows` e `.gitlab-ci.yml`).
2. Neste host o baseline já falha antes das asserções: o Playwright pede `chromium_headless_shell-1228` e só há a build `1234` instalada (`pnpm exec playwright install` necessário).
3. `page.addInitScript(__DSH_AUTH__)` conflita com `publishClientAuthSession()` (`apps/web/src/main.tsx:435`, 49-65): sem sessão Supabase, o `onAuthStateChange` regrava `{ accessToken: undefined, role: undefined }` e o gate fail-closed esconde o seletor mesmo publicando `owner`.

Arquivos afetados, a atualizar quando o lane voltar a rodar: `apps/web/tests/plan-control-row.e2e.ts`, `apps/web/tests/file-upload-round.e2e.ts` e o golden `snapshots/web/plan-narrow-viewport/layout.expected.md`.

Ação futura: instalar o browser no CI e adotar uma abordagem que sobreviva ao boot — sessão Supabase válida plantada, ou um patch de boot de teste que publique a role depois do `onAuthStateChange`. Não é bloqueio para produção; é reversível em um commit separado.

### Etapa 9 — anti-abuso (itens adiados 2026-10-09)

Implementado na Etapa 9: blocklist de e-mails descartáveis via trigger `BEFORE INSERT` em `auth.users` (`supabase/migrations/038_block_disposable_emails.sql`) e documentação dos rate limits nativos do Supabase Auth. Visão operacional em [`etapa9-anti-abuso.md`](./etapa9-anti-abuso.md). Os itens abaixo ficam **adiados**:

- **P3 — higienização de workspaces/sessões órfãs.** Não bloqueia o lançamento. Ação futura: inventário read-only seguido de cleanup com backup documentado e aprovação explícita.
- **P4 — rate limit por IP em `session.create` no host.** Custo/benefício não justifica a 48h; só usuários autenticados e dentro da cota criam sessão (o gate `check_tenant_quota` já limita o dano por conta).
- **Mensagem de erro do bloqueio.** O trigger retorna "Database error saving new user" (genérico). Aceito: bloqueia e não vaza a regra. Melhoria futura: mapear para copy amigável no cliente, sem tocar em `packages/llm/`.

### Item adiado — test:web precisa fornecer Client Context "auth" (adiado 2026-10-10)

- **Causa:** o commit `bcfe43fedb` escopou `session.list` (e `page`, `follow`, `prompt`, `rename`, `fork`) com `@RemoteScope('auth')`. Os specs em `apps/web/tests/*.e2e.ts` chamam esses verbs via bridge sem fornecer o Client Context adapter para `auth`.
- **Erro:** `client api: 'session/list' has no Client Context adapter for 'auth'` (unhandled rejection no `assembled-boot.ts`).
- **Impacto:** `test:web` vermelho (117 arquivos na corrida de 2026-10-10). Não bloqueia deploy: o lane está fora do CI do fork.
- **Não corrigir revertendo:** reverter `@RemoteScope('auth')` reabriria o furo de segurança corrigido por `bcfe43fedb` (qualquer usuário autenticado lendo/forkando sessões de outro).
- **Correção futura:** cada spec de `apps/web/tests` deve fornecer o adapter de Client Context `auth` ao montar o bridge, ou o bridge de teste ganha um fallback controlado. Isolamento confirmado na Etapa 3 do DNA: o mesmo spec (`home-path-tilde.expected.e2e.ts`) falha identicamente com e sem o código do onboarding.
