# Plano Consolidado de Pendências — CopyMonster

**Data:** 2026-10-13
**Status:** CONSOLIDADO — Aguardando Aprovação para Execução
**Origem:** Fusão de 3 planos de roadmap existentes

---

## 1. Resumo Executivo

| Plano Original | Status | Itens Pendentes |
|---|---|---|
| `plano-dna-identidade-proprietaria-copymonster.md` | PLANEJADO (0/10 etapas) | 10 etapas de implementação do DNA |
| `fixes-dna-plans-onboarding.md` | INVESTIGADO (0/5 problemas) | 5 correções críticas/altas |
| `plano-redesign-copymonster.md` | APROVADO (0/8 fases) | 8 fases de redesign UI/UX |

**Total:** 23 unidades de trabalho pendentes (10 etapas + 5 problemas + 8 fases)

---

## 2. Pendências por Origem

### 2.1 Plano DNA — Identidade Proprietária (10 etapas)

| Etapa | Título | Status | Dependências |
|---|---|---|---|
| 1 | Migração 039: `positioning_mappings` (SQL) | Pendente | Usuário aplica no Supabase |
| 2 | Preset + Agente: Brand Positioning Monster | Pendente | Etapa 1 |
| 3 | Onboarding Guiado como Modal | Pendente | Etapa 2 |
| 4 | Abertura Automática do Onboarding | Pendente | Etapa 3 |
| 5 | Plugin Host: Injeção Universal (`packages/host/positioning-injection`) | Pendente | Etapa 1 |
| 6 | Suporte a DNA no `session-controller` | Pendente | Etapa 5 |
| 7 | Seleção de DNA no Frontend (Modal/Composer) | Pendente | Etapa 6 |
| 8 | Gestão Centralizada: Settings → My DNA | Pendente | Etapa 1 |
| 9 | Suíte de Testes + Builds | Pendente | Etapas 2-8 |
| 10 | Protocolo de Lançamento (Go/No-Go) | Pendente | Etapas 1-9 |

### 2.2 Plano Fixes — DNA/Plans/Onboarding (5 problemas)

| Ordem | Problema | Severidade | Causa Raiz |
|---|---|---|---|
| 4 | Settings → Models exposto a usuário comum; app sem flag de admin | CRÍTICO | Sem flag `metadata.is_admin` + RLS `is_admin_or_owner()` verdadeiro para todo owner + guardas harness desligadas (fail-open) + UI sem gate |
| 5 | Menu lateral poluído; Plans/Profile/My DNA soltos fora do Settings | MÉDIO | Itens vivem como botões de footer com modais próprios (`FooterActionsRoot`) |
| 1 | DNA salvo sem nome ("My first DNA"); CompletionPanel nunca aparece | ALTO | Replay congela em `answeredBlock = 1`; só bloco 1 salvo; `status='completed'` só no save do bloco 12 |
| 3 | Onboarding de DNA reabre a cada login | ALTO | Deriva do Problema 1: `status` nunca vira `completed` |
| 2 | Limites de DNA por plano errados; sem seletor ao iniciar campanha | MÉDIO | Cota errada para `trial_expired`/`canceled`/`past_due`; auto-create não checa cota; seletor inexistente |

**Ordem de execução definida:** 4 → 5 → 1 → 3 → 2

### 2.3 Plano Redesign — CopyMonster (8 fases)

| Fase | Título | Prioridade | Dependências |
|---|---|---|---|
| 1 | Models não carrega (persistência `memory` em deploy remoto) | CRÍTICA | — |
| 2 | Rota anônima: visitante vê login (frontend-static 401) | CRÍTICA | — |
| 3 | Plans dentro do painel (AppFrame + sidebar) | CRÍTICA | Decisão composição (a) |
| 4 | Profile + Logout no sidebar (WhatsApp E.164) | ALTA | Fase 3 (mesmo slot) |
| 5 | Nomes amigáveis de plugins (i18n en+zh lockstep) | MÉDIA | — |
| 6 | Presets renomeados padrão Monster (i18n en+zh lockstep) | MÉDIA | — |
| 7 | Auth pages com cores institucionais | MÉDIA | — |
| 8 | Wizard "Criar novo preset" | MÉDIA | Fase 6 |

---

## 3. Conflitos e Sobreposições Identificadas

| Área | Planos Envolvidos | Conflito |
|---|---|---|
| **Settings → Models** | Fixes (Prob 4) + Redesign (Fase 1) | Ambos tocam na visibilidade/carregamento da aba Models |
| **Sidebar/Footer** | Fixes (Prob 5) + Redesign (Fases 3,4) | Consolidar menu lateral e mover Plans/Profile/My DNA para Settings |
| **DNA/Onboarding** | DNA (Etapas 3,4,7,8) + Fixes (Prob 1,3) | Onboarding modal, CompletionPanel, seletor de DNA |
| **Admin Gate** | Fixes (Prob 4 B1-B5) + Regra Canônica B4/B5 | Regra canônica exige correção imediata do gate admin |

---

## 4. Regra Canônica — Correção B4/B5 (Prioridade Máxima)

> **Regra imutável (nunca violar)**
>
> ### ADMIN (`metadata.is_admin === true`)
> - Settings → Models: VÊ e USA (inserir/gerenciar chaves de API dos providers) — local OFICIAL de inserção
> - Admin → Providers Fornecedores de LLM → Modelos: VÊ e USA (APENAS GESTÃO — onde usar, plano, acesso)
> - Chat: VÊ o seletor de modelos
>
> ### USUÁRIO normal (qualquer plano)
> - VÊ apenas consumo de tokens
> - NÃO vê Settings → Models
> - NÃO vê Admin → Providers
> - NÃO vê seletor de modelos no chat
>
> **O que o B4 errou:** Bloqueou o ADMIN de adicionar provider nativo no Settings → Models. Admin DEVE poder inserir chave no componente nativo. A mensagem "As credenciais são gerenciadas no painel de administração" NÃO pode existir — o painel admin é SÓ GESTÃO, não inserção.
>
> **Ação — corrigir (1 commit por correção):**
> 1. Restaurar Settings → Models para o admin (botão "Criar provedor" HABILITADO, remover mensagem vermelha)
> 2. Manter Admin → Providers → Modelos só para admin (gestão SaaS)
> 3. Chat: seletor só admin vê; consumo tokens todos veem
> 4. Não-admin: Settings → Models invisível; Admin → Providers invisível; Chat sem seletor

**Investigação necessária ANTES de aplicar:**
1. Onde o gate `canManage` está bloqueando o admin? (`grep -rn "canManage\|isAdmin\|readIsAdmin" packages/client/ui-settings-models/src/`)
2. Onde a mensagem vermelha é renderizada? (`grep -rn "gerenciadas no painel\|managed in the admin" packages/client/ui-settings-models/`)
3. O seletor de modelos no chat tem gate? (`grep -rn "model.*selector\|ModelSelector\|isPlatformAdmin" packages/client/ui-chat/ packages/client/ui-model-selection/`)
4. O consumo de tokens está visível pra todos? (`grep -rn "token.*consumption\|consumo\|usage" packages/client/ui-chat/`)

---

## 5. Ordem de Execução Proposta (Unificada)

| Prioridade | Item | Tipo | Commit Estimado |
|---|---|---|---|
| **P0** | Regra Canônica B4/B5: Investigar + Corrigir Settings → Models admin gate | Fix Crítico | 1-2 |
| **P0** | Fixes Prob 4: Flag admin + UI gate + Backend harness (B1-B5) | Fix Crítico | 2-3 |
| **P0** | Redesign Fase 1: Models carrega (persistência host) | Fix Crítico | 1 |
| **P0** | Redesign Fase 2: Visitante vê login (shell público) | Fix Crítico | 1 |
| **P1** | Fixes Prob 5: Consolidar menu lateral (Plans/Profile/My DNA → Settings) | Refatoração | 1 |
| **P1** | Redesign Fase 3: Plans no painel (AppFrame + sidebar) | Feature | 1 |
| **P1** | Redesign Fase 4: Profile + Logout no sidebar | Feature | 1 |
| **P1** | Fixes Prob 1: DNA salvo com nome + CompletionPanel | Fix Alto | 1 |
| **P1** | Fixes Prob 3: Onboarding não reabre a cada login | Fix Alto | 1 |
| **P2** | DNA Etapa 1: Migração 039 (SQL) | Infra | Usuário aplica |
| **P2** | DNA Etapa 2: Preset Brand Positioning Monster | Feature | 1 |
| **P2** | DNA Etapa 3: Onboarding Modal | Feature | 1 |
| **P2** | DNA Etapa 4: Abertura automática onboarding | Feature | 1 |
| **P2** | DNA Etapa 5: Plugin Host positioning-injection | Feature | 1 |
| **P2** | DNA Etapa 6: session-controller suporte DNA | Feature | 1 |
| **P2** | DNA Etapa 7: Seleção DNA no Frontend | Feature | 1 |
| **P2** | DNA Etapa 8: Settings → My DNA | Feature | 1 |
| **P2** | Fixes Prob 2: Limites por plano + seletor campanha | Feature | 1 |
| **P3** | DNA Etapa 9: Testes + Builds | QA | 1 |
| **P3** | DNA Etapa 10: Go/No-Go | Release | 1 |
| **P3** | Redesign Fase 5: Nomes plugins i18n | Polish | 1 |
| **P3** | Redesign Fase 6: Presets Monster i18n | Polish | 1 |
| **P3** | Redesign Fase 7: Auth pages cores | Polish | 1 |
| **P3** | Redesign Fase 8: Wizard preset | Feature | 1 |

**Total estimado:** ~26 commits atômicos (1 por item)

---

## 6. Ações que Só o Usuário Executa

1. **SQL no Supabase Editor:**
   - Migração 039 (`positioning_mappings`)
   - Migração 040/041 (`dna_finalize` — RPC `finalize_positioning_mapping`)
   - Migração 042 (`dna_quota_statuses` — cotas por status de plano)
   - A0-A3 do Problema 4 (verificação membership, `metadata.is_admin`, `get_my_profile`, `is_admin_or_owner`)

2. **Validação em produção** após cada commit de código

3. **Aprovação formal** deste plano consolidado antes de qualquer execução

---

## 7. Próximos Passos Imediatos

1. **Aprovação deste plano** pelo usuário
2. **Investigação da Regra Canônica B4/B5** (4 greps listados na Seção 4)
3. **Relatório de achados** antes de qualquer aplicação de código
4. **Diff proposto** para cada correção
5. **Execução sequencial** (1 commit por correção, builds verdes obrigatórios)

---

## 8. Checklist de Aceitação Global

- [ ] Plano consolidado aprovado
- [ ] Investigação B4/B5 concluída e reportada
- [ ] SQL migrations aplicadas pelo usuário (039, 040/041, 042, A0-A3)
- [ ] Todos os 26 commits aplicados com builds verdes
- [ ] Validação E2E em produção para cada fase crítica
- [ ] Nenhuma violação da regra canônica B4/B5
- [ ] `pnpm run test:coverage` verde
- [ ] `pnpm run typecheck` verde
- [ ] `pnpm run lint` verde
- [ ] Protocolo de Boot validado antes de deploy

---

*Fim do plano consolidado. Aguardando aprovação formal para iniciar investigação B4/B5 e execução sequencial.*
