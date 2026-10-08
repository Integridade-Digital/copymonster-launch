# Auditoria Final Pré-Lançamento — CopyMonster (Go/No-Go)

**Documento:** `docs/roadmap/pre-launch-audit-final.md`
**Status:** AGUARDANDO REVISÃO — Go/No-Go condicional.
**Data:** 2026-10-09
**Base:** `master` @ `334552486b`
**Plano:** [`plano-producao-llm-providers-billing-trial.md`](./plano-producao-llm-providers-billing-trial.md)

## 1. Status por bloco (Etapas 0–11)

| Etapa | Escopo | Status | Evidência |
|---|---|---|---|
| 0 | Pré-flight / isolamento | **Parcial** | `.env` com `SUPABASE_*`, `STRIPE_*`; sem branch/tag de release (trabalho direto na `master`, conforme regra) |
| 1 | Auditoria read-only do banco | **Executada** | inventário de `llm_providers`/`plans`/RP `get_runtime_llm_catalog` |
| 2 | Migração 032 (quota gate, rotas, tenant pessoal) | **Feita** | `supabase/migrations/032_production_gates_and_tenants.sql` |
| 3 | Provider de credenciais em memória | **Feita** | `packages/host/llm-credentials-supabase` |
| 4 | Hard gate de quota (`session.create`/`prompt`) | **Feita** | `packages/api/session-controller/src/commands.ts` (assertTenantQuota) |
| 5 | `/api/healthz` | **Feita** | `packages/api/auth-http/src/health.ts` |
| 6 | Failover DeepSeek → OpenRouter | **Feita** | `packages/host/llm-fallback` + `bundle/copymonster/cordis.patch.yml` |
| 7 | Cadastro de provedores como controle de acesso | **Feita** | migrations `036` (metadados) e `037` (READ com `provider_route`/`api_key_env`) + Test Connection host |
| 8 | Gating do seletor de modelo por role | **Feita** | `packages/client/ui-model-selection` (owner/admin; fail-closed) |
| 9 | Anti-abuso / sanitização | **Feita (P1+P2); P3/P4 adiados** | migration `038` (blocklist) + `docs/roadmap/etapa9-anti-abuso.md` |
| 10 | Testes E2E + builds | **Parcial** | unit: 3/4 suítes verdes; builds 3/3 verdes; e2e web fora do CI |
| 11 | Auditoria final Go/No-Go | **Este documento** | — |

### Decisões de arquitetura registradas no ciclo

- Settings é o cofre de chaves; Admin é controle de acesso (`docs/roadmap/arquitetura-settings-cofre.md`).
- UX pós-signup com painel de confirmação e reenvio (`RegisterPage.tsx`).

## 2. Matriz de testes e builds

### Suítes críticas (unit)

| Suíte | Resultado | Exit |
|---|---|---|
| `packages/api/session-controller` | 796 pass / 0 fail | 0 |
| `packages/api/auth-http` | 33 pass / 0 fail | 0 |
| `packages/client/ui-model-selection` | 40 pass / 0 fail | 0 |
| `packages/host/llm-credentials-supabase` | 9 pass / 0 fail | 0 |

### Builds de produção

| Build | Exit |
|---|---|
| `pnpm run build:lib:host` | 0 |
| `pnpm run build:lib:client` | 0 |
| `pnpm run build:web` | 0 |

## 3. Bloqueadores e achados

### B1 — `session-controller`: cliente Supabase admin não stubbado (RESOLVIDO 2026-10-09)

As 17 falhas iniciais tinham **uma raiz comum**: o caminho `create` lê o Supabase admin sobre a rede e o host de teste não o stubbava — o *subscription gate* (`commands.ts:139`) e o gate de quota chamavam `placeholder.supabase.co` (DNS), pendurando os testes até o timeout de 5s. `commands-create-fork` construía o `SessionCommandController` direto, sem `checkTenantQuota`.

Correção **test-only** (baixo risco, sem tocar `src`):

- `vi.mock('@deepseek-ai/dsh-supabase-client')` em `commands-create-fork.host.spec.ts`, `session-presets.host.spec.ts` e `session-cold.host.spec.ts` (mesmo padrão de `auth-http/tests/healthz.spec.ts`).
- Stub `checkTenantQuota` always-allow na construção direta do controller em `commands-create-fork.host.spec.ts`.

Resultado: `packages/api/session-controller` **796/796 (45 arquivos)**, exit 0.

### B2 — Timeouts de ambiente no `session-controller` (RESOLVIDO)

As falhas antes classificadas como "timeout de ambiente" eram o **mesmo** cliente Supabase não stubbado (subscription gate + `session-db-sync`). Resolvidas pela correção B1: `session-presets` caiu de 91s para ~4s e `session-cold` para ~5s, ambos verdes no timeout padrão. Não havia lentidão de produto.

### R1 — e2e/snapshot web adiado (Etapa 8)

Fora do CI; baseline falha por browser (chromium 1228) e conflito `addInitScript`/`publishClientAuthSession`. Registrado em `fork-preservation.md §8`.

### R2 — Rate limit de cadastro depende do dashboard Supabase (Etapa 9 P2)

IP de cadastro só existe no Supabase Auth. Ação operacional obrigatória: configurar rate limits de signup + confirmação de e-mail no painel.

### R3 — Qualidade de dados no `settings.yaml`

`bai.baseURL` com sufixo `/chat/completions` e `tokenharbor.baseURL` com barra dupla. Não bloqueiam o teste (normalizado), mas convém corrigir.

## 4. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Abuso de free trial por contas descartáveis | Blocklist (migration 038) + rate limits nativos do Supabase + confirmação de e-mail |
| Indisponibilidade do Supabase | Gate de quota fail-closed + `/api/healthz` para chaveamento de tráfego |
| Falha transitória do DeepSeek | Failover DeepSeek → OpenRouter |
| Suíte `session-controller` vermelha | Corrigir B1 (test-only) antes do Go, para restaurar o sinal de CI |

## 5. Go/No-Go

- [x] Etapas 2–9 implementadas e verificadas em produção/browser.
- [x] 3 builds de produção verdes.
- [x] 4 de 4 suítes críticas verdes (`session-controller` 796/796).
- [x] B1 corrigido (test-only) — `session-controller` verde, sem rede nos testes.
- [ ] P2 configurado no dashboard Supabase (rate limits + confirmação de e-mail).

**Recomendação:** **GO.** B1 resolvido; resta apenas a ação operacional P2 (dashboard). R1/R3 ficam como pós-lançamento.

## 6. Rollback e contingência

- Reverter commits no `master` por SHA (cada etapa tem commit atômico) e reiniciar `copymonster.service`.
- Migrations `032`, `036`, `037`, `038` são idempotentes na direção de reaplicação; dados de `llm_providers`/`disposable_email_domains` são aditivos.
- Monitorar `/api/healthz` durante a campanha; fallback de inferência já ativo.
