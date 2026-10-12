# Plano de correções: Settings → Models (CRÍTICO), save de DNA, limites por plano e onboarding recorrente

Estado: investigação concluída; nenhum código aplicado; nenhum SQL executado por mim.

Fluxo: este documento é o plano único dos 4 problemas; commit + push deste plano, aguardando aprovação, e só então código (1 commit por problema, na ordem Problema 4 → 1 → 3 → 2).

## Resumo executivo

| # | Problema | Severidade | Causa raiz resumida |
|---|---|---|---|
| 4 | Settings → Models visível para usuário comum; app sem flag de admin | CRÍTICO | sem flag de admin no app + RLS `is_admin_or_owner()` verdadeiro para todo usuário + guardas do harness desligadas (`@Remote` sem identidade) + UI sem gate |
| 1 | DNA salvo sem nome ("My first DNA") e CompletionPanel nunca aparece | ALTO | replay do onboarding congela em `answeredBlock = 1`; só o bloco 1 é salvo; a flag `status='completed'` (migration 039) só nasce no save do bloco 12 |
| 3 | Onboarding de DNA reabre a cada login | ALTO | deriva do Problema 1: como `status` nunca vira `completed`, o gate de boot nunca satisfaz |
| 2 | Limites de DNA por plano errados; sem seletor de DNA ao iniciar campanha | MÉDIO | cota entrega 100 (pro) para `trial_expired`/`canceled`/`past_due`; auto-create do onboarding não checa cota; seletor não existe |

Regras em vigor para toda a aplicação: nunca tocar em `packages/core/` nem `packages/llm/`; nunca alterar `test:web`; nunca executar SQL (só o usuário aplica); nunca commitar chaves; uma migração nova por arquivo em `supabase/migrations/` aplicada apenas pelo usuário.

---

# Problema 4 (CRÍTICO) — Settings → Models exposto a usuário comum; app sem flag de admin

## Diagnóstico

O problema tem 4 camadas, todas confirmadas por investigação nesta sessão.

1. **Flag de admin inexistente no app (descoberta do usuário, confirmada no código).** `public.users` não tem `role`/`is_admin`/`account_type` — só `metadata JSONB DEFAULT '{}'` (`supabase/migrations/001*.sql:26-35`). `user_tenant_roles.role` só tem valor `owner` (todo usuário é owner do próprio tenant criado por `handle_new_user`, `supabase/migrations/032*:146-156`), então qualquer gate que só olhe `role` passa para todo mundo. Existe um predicado de operador de plataforma já usado pelo app — `isPlatformAdmin(role, tenantId)` = owner/admin do tenant da plataforma `00000000-0000-0000-0000-000000000001` (`apps/web/src/lib/auth/platform-admin.ts:18-20`, `packages/util/constants/src/index.ts:10`, claim `tenant_id`/`user_role` injetados por `custom_access_token_hook` em `supabase/migrations/004*:14-40`) — publicado como `__DSH_AUTH__.isPlatformAdmin` em `apps/web/src/main.tsx:68-73`, mas ele governa apenas AdminModal (`FooterActionsRoot.tsx:90`, `AdminModal.tsx:62`) e o seletor de modelo (`packages/client/ui-model-selection/src/client/index.ts:123-131`). Settings/Models não usa nenhum gate.
2. **RLS/DB aberto para todo autenticado.** `is_admin_or_owner()` (reescrita atual em `supabase/migrations/025_security_and_role_hardening.sql:16-45`) retorna verdadeiro quando o usuário tem `owner`/`admin` no **tenant ativo** — e todo usuário é owner do próprio tenant ativo, logo é verdadeiro para todos. Isso destrava a política das tabelas globais sem `tenant_id` (`llm_providers` e `llm_models` em `supabase/migrations/008_admin_expanded_backend.sql:49-54, 84-85`, `system_config`, `metrics_daily`) e as RPCs de admin (`get_admin_llm_providers` em `014:65`/`037:18`, `admin_save_llm_provider` em `035`, `admin_delete_llm_provider` em `014:298`). Nas policies de tabelas com tenant, o ramo `... OR is_admin_or_owner()` vira escape de cross-tenant para qualquer usuário (`005:43-83`, `006:120-219`).
3. **Guardas do harness desligadas (fail-open).** `settings.describe/update/replace/mutate` (`packages/api/settings-controller/src/index.ts:170/203/223/245`) e `credentials.describe/set/unset` (`.../credentials.ts:97/122/139`) são `@Remote` diretos; o gateway só cria o contexto filho com `authIdentity` para métodos marcados `@RemoteScope('auth', ...)` (`packages/api/gateway/src/index.ts:722-746`, `packages/api/auth-context/src/index.ts:244-248`). Sem identidade, `getAuthIdentity` devolve `undefined` e todos os ramos de guarda são ignorados (`index.ts:118-124`, `credentials.ts:100-110`) — os testes unitários mascaram porque injetam `authIdentity` à mão (`packages/api/settings-controller/tests/rbac-isolation.spec.ts:25, 51`) e o terceiro caso documenta o fail-open deliberado ("sem autenticação → acesso pleno", linha 91). Consequência: qualquer criador consegue, por chamada direta remota, reescrever namespaces `llm-*` do deployment inteiro (redirecionar rota de modelo) e gravar/remover credenciais (`credentials.set/unset`) — inclusive a chave de API do deployment.
4. **UI sem gate.** A seção Models é registrada incondicionalmente (`packages/client/ui-settings-models/src/client/index.ts:131-141`, diálogos de onboarding em 143 e 151); o gear Settings é ocupado por `ui-settings-general` (`packages/client/ui-settings-general/src/client/index.ts:158`, render em `packages/client/ui-sidebar/src/client/SidebarRoot.tsx:262`); o diretório de providers vem de `remote.llm` sem gate de papel (`packages/llm/llm/src/index.ts:471` `listAdapters`, `:543` `listDeclared`, `:631` `discoverModels`); Edit é renderizado sempre (`packages/client/ui-settings-models/src/client/ModelsSection.tsx:391-406`) e Delete quando `row.removable` (407-424, `removable` liga quando o namespace está no espelho de settings — com o fail-open do item 3, ligado para todos).

**Chave exposta no Edit? Não.** `CredentialInfo` carrega apenas `{configured, source, writable}` sem slot para valor (`packages/credentials/credentials/src/types.ts:67-76`, comentário "never the value"); os campos de chave são `type="password"` com rascunho vazio (`ProviderEditor.tsx:367`, `CustomProviderCard.tsx:263`); o plaintext só trafega cliente→servidor em `credentials.set`. Nenhum vazamento de valor — o plano segue.

## Evidências — os 5 greps solicitados

1. **Onde o user é carregado no frontend (para ler metadata):**

```ts
// apps/web/src/lib/auth/auth.provider.tsx:38 — bootstrap do perfil
const fullProfile = await getUserFullProfile(userId);
// apps/web/src/lib/auth/supabase.client.ts:369-390 — RPC get_my_profile NÃO retorna metadata
const { data, error } = await supabaseClient.rpc('get_my_profile');
const { id, email, full_name, whatsapp, avatar_url } = data.user;
// apps/web/src/main.tsx:68-73 — claims do JWT publicados para os plugins
clientAuth.__DSH_AUTH__ = { accessToken: current?.access_token, role, tenantId,
  isPlatformAdmin: isPlatformAdmin(role, tenantId) }
```

2. **Onde Settings aparece no menu:**

```ts
// packages/client/ui-settings-general/src/client/index.ts:158 — ocupante do gear
ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
  name: 'sidebar.settings', ... }, SettingsRoot))
// packages/client/ui-sidebar/src/client/SidebarRoot.tsx:262
{renderSlot('sidebar.settings', { wide })}
```

3. **Onde Settings → Models é renderizado:**

```ts
// packages/client/ui-settings-models/src/client/index.ts:131 — registro incondicional
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section', id: 'models', order: 10, ... }, ModelsSection))
// packages/client/ui-settings-models/src/client/ModelsSection.tsx:391-406 (Edit sempre)
// e 407-424 (Delete quando row.removable; state.writable vem do describe fail-open)
```

4. **Endpoint que lista providers (llm_providers):**

```ts
// apps/web/src/pages/admin/tabs/AdminLLMProvidersTab.tsx:103
const { data, error } = await adminRpc('get_admin_llm_providers')
// supabase/migrations/008_admin_expanded_backend.sql:53-54 — RLS da tabela
USING (public.is_admin_or_owner()) WITH CHECK (public.is_admin_or_owner());
// supabase/migrations/025_security_and_role_hardening.sql:34-44 — semântica atual (vale para todo owner do tenant ativo)
RETURN EXISTS (SELECT 1 FROM public.user_tenant_roles
  WHERE user_id = auth.uid() AND tenant_id = _active_tenant_id AND role IN ('owner','admin'));
// camada harness: packages/llm/llm/src/index.ts:471/543 (@Remote direto, sem gate de papel)
```

5. **Se a chave é exposta no Edit:**

```ts
// packages/client/ui-settings-models/src/client/ProviderEditor.tsx:367 e CustomProviderCard.tsx:263
<input ... type="password" />          // rascunho sempre vazio; valor nunca sai do servidor
// packages/credentials/credentials/src/types.ts:67-76
export interface CredentialInfo { configured: boolean; source?: string; writable: boolean }
```

## Solução proposta

### Parte A — SQL (só o usuário executa; eu nunca aplico)

- **A1** (exatamente como pedido): `UPDATE public.users SET metadata = metadata || '{"is_admin": true}'::jsonb WHERE email = 'integridade.digital@gmail.com';`
- **A2** (necessário para o item B.1): `CREATE OR REPLACE FUNCTION public.get_my_profile()` com a assinatura atual (`supabase/migrations/025:224-268`) acrescentando no `jsonb_build_object` o campo `'is_admin', COALESCE(u.metadata ->> 'is_admin', 'false')::boolean` — a RPC de hoje não devolve `metadata`, então o bootstrap não tem como ler a flag.
- **A3** (fecha o item 4 do pedido no backend de dados): `CREATE OR REPLACE FUNCTION public.is_admin_or_owner()` mantendo a assinatura sem DROP (19 policies dependentes) e passando a retornar verdadeiro apenas quando (a) o usuário tem `owner`/`admin` no tenant da plataforma `'00000000-0000-0000-0000-000000000001'` (mesma semântica de `isPlatformAdmin`) **ou** (b) `public.users.metadata ->> 'is_admin' = 'true'` para `auth.uid()`; falso em qualquer outro caso. Isso retira de todo usuário comum o acesso a `llm_providers`/`llm_models`/`system_config`/`metrics_daily` e às RPCs de admin, e fecha o escape cross-tenant das policies `005`/`006`.
- **Ordem obrigatória: A1 → A2 → A3** (a flag tem que existir antes do reforço; A3 preserva o admin atual pela via plataforma ou pela flag).

### Parte B — Gate no código (eu implemento após aprovação)

- **B1 (bootstrap lê `metadata.is_admin`):** estender `AuthUser` com `isAdmin: boolean` e preencher em `getUserFullProfile` (`apps/web/src/lib/auth/supabase.client.ts:369-397`, `data.is_admin === true`, fail-closed no fallback de perfil da linha 47-52 de `auth.provider.tsx`); publicar `__DSH_AUTH__.isAdmin` em `apps/web/src/main.tsx:40, 68-73`.
- **B2 (esconder o item Settings do menu):** antes de `ctx.slots.inject('sidebar.settings', ...)` em `packages/client/ui-settings-general/src/client/index.ts:158`, checar predicado fail-closed `isOperatorSession()` — sessão com `accessToken` E (`isPlatformAdmin === true` OU `isAdmin === true`), no padrão de `isPlatformAdminSession()` (`packages/client/ui-model-selection/src/client/index.ts:123-131`); sem sessão, não registrar o gear.
- **B3 (não renderizar Settings → Models):** mesmo predicado antes dos três `ctx.slots.inject` em `packages/client/ui-settings-models/src/client/index.ts:131, 143, 151` — some a seção Models e os diálogos de onboarding (BYOK/DeepSeek) para não-admin.
- **B4 (esconder Edit/Delete dos providers):** a seção fica inacessível para não-admin via B3; como defesa extra, injetar `canManage` (predicado) nas props de `ModelsSection` e ocultar os botões de Edit (`ModelsSection.tsx:391-406`) e Delete (`407-424`) quando falso.
- **B5 (proteger o backend de listagem/escrita de providers — camada harness):** sem isto o gate de UI é cosmético, porque qualquer criador continua conseguindo chamada direta remota. Marcar `describe`, `update`, `replace`, `mutate`, `openSettingsDocument`, `openAgentPresetDirectory`, `canOpenAgentPresetDirectory` (`packages/api/settings-controller/src/index.ts:170, 203, 223, 245, 263, 295, 190`) e `credentials.describe/set/unset` (`.../credentials.ts:97, 122, 139`) com `@RemoteScope('auth', '<verb>')`; endurecer as guardas para fail-closed: identidade ausente → `settings/unauthorized`; identidade fora de (`owner`/`admin` **com** `tenantId === DEFAULT_TENANT_ID`) → `settings/forbidden` (o predicado server-side espelha `isPlatformAdmin`; `UserIdentity` já carrega `tenantId` e `role` vindos dos claims, `packages/api/auth-context/src/index.ts:170-196`). A camada de dados (B/A3) cobre `llm_providers`; a camada harness cobre os namespaces `llm-*` e as credenciais.
- **Nota (fora do escopo, registrado):** `listAdapters`/`listDeclared`/`discoverModels` em `packages/llm/llm/src/index.ts` não podem ser alterados (proibição de tocar `packages/llm/`); o inventário residual de nomes de providers continua legível por autenticado — aceito como dívida, sem endpoints nem chaves.

## Plano de aplicação (commits)

1. **SQL (usuário):** A1, depois A2, depois A3 no editor SQL do Supabase (arquivos `supabase/migrations/040_admin_flag_and_rls.sql` são criados por mim como registro, mas a aplicação é do usuário).
2. **Commit `fix(auth): gate Settings and Models UI behind platform admin`** — B1 (apps/web), B2 (ui-settings-general), B3+B4 (ui-settings-models), predicado compartilhado, chaves de i18n novas (se houver) em `apps/web/src/locales/en.ts` e `zh.ts`, specs de cliente (padrão `packages/client/ui-settings-models/tests/apply.client.spec.ts`).
3. **Commit `fix(api): require auth context and platform admin on settings and credentials verbs`** — B5, specs em `packages/api/settings-controller/tests/` (casos fail-closed: identidade ausente → recusa; criador (owner de tenant pessoal) → recusa; admin de plataforma → permite; o caso "sem autenticação → acesso pleno" de `rbac-isolation.spec.ts:91` é substituído por recusa, com nota de que o host desktop-local é decisão aberta do usuário), regeneração dos remotes/cátalogos afetados pelo `pnpm run build`.
4. **Verificação (usuário, em produção):** com sessão de criador, Settings some da sidebar; `settings.update` em namespace `llm-*` e `credentials.set` passam a recusar; `get_admin_llm_providers` não retorna linhas; com sessão do admin, tudo segue funcionando (inclusive AdminModal).

## Riscos

- **Esconder o gear Settings tira dos criadores** idioma/tema (seção General), presets e plugins além de Models — alternativa se preferirem: manter o gear e aplicar apenas B3/B4 (gate da seção Models). Decisão do usuário; DNA não é afetado (o botão "My DNA" é próprio em `FooterActionsRoot.tsx:143`, não passa pelo gear).
- **A3 pode travar o admin atual** se ele não tiver membership no tenant plataforma e a A1 não rodar antes — por isso a ordem A1 → A3 e a verificação de que o AdminModal continua visível (hoje visível, o que já indica membership plataforma existente).
- **B5 muda a fio (wire)** dos verbos settings/credentials (novo parâmetro de contexto `authId`) — host e client precisam ser publicados juntos no mesmo deploy (o build do `apps/web` embute o remote client do mesmo commit).
- **Desktop local:** com identidade obrigatória, o host desktop sem login deixaria de configurar — decisão aberta: tratar por configuração do perfil de bundle (não hardcoded) ou manter a recusa e exigir login também no desktop. Nenhuma decisão tomada aqui.
- **Nota histórica:** `plano-auditoria-completa-copymonster.md` já previa a auto-elevação por `user_metadata` no `is_admin_or_owner()` antigo; a reescrita `025` trocou por tenant ativo e manteve o problema (todo usuário é owner). A3 resolve a direção.

## Checklist de aceitação (Problema 4)

- [ ] A1 aplicado pelo usuário: `metadata.is_admin = true` para `integridade.digital@gmail.com`.
- [ ] A2 aplicado: `get_my_profile()` devolve `is_admin`.
- [ ] A3 aplicado: usuário comum não passa mais em `is_admin_or_owner()`; admin continua passando.
- [ ] Criador logado: item Settings invisível na sidebar; `settings.section` sem a entrada `models`.
- [ ] Criador logado (chamada direta): `settings.update('llm-...', ...)` → `settings/forbidden`; `credentials.set` → recusa; `get_admin_llm_providers` → vazio.
- [ ] Admin logado: gear Settings, seção Models, Edit/Delete e painel admin seguem funcionando.
- [ ] Sessão sem token: nenhum dos verbos protegidos responde conteúdo (fail-closed).
- [ ] Nenhuma chave presente em diff, teste ou doc (verificação de padrão `apiKey|secret` no diff).

---

# Problema 1 — DNA salvo sem nome e CompletionPanel nunca aparece

## Diagnóstico

O replay do onboarding congela o cursor de progresso: `replayOnboarding` em `apps/web/src/components/dna/useDnaSessionTracker.ts:76` pula o bloco quando `if (answeredBlock !== null) continue`, e `answeredBlock` nasce como `1` (inicialização na linha 61) para um mapping recém-criado sem sessão — ou seja, `answeredBlock` nunca sobe acima de `1`, só o bloco 1 é considerado respondido, e a resposta do bloco 0 (nome do produto) é descartada (linha 77). O auto-save (`apps/web/src/components/dna/OnboardingChrome.tsx:108-131`) só grava o bloco corrente quando o usuário avança, então mappings abandonados ficam com `block_1` salvo e nada além. O `CompletionPanel` só renderiza quando `completedBlock === 12` (`OnboardingChrome.tsx:142, 169-174`), e a flag `status='completed'` é marcada pela migration 039 exclusivamente no save do bloco 12 (`supabase/migrations/039_positioning_mappings_dna.sql:460-468` via `update_positioning_block`) — como o save do bloco 12 raramente acontece pelo bug de replay, `status` fica `in_progress`, o mapping nasce com o nome default "My first DNA" (`apps/web/src/components/dna/useDnaOnboardingState.ts:153`, `apps/web/src/locales/en.ts:135`), `product_name` fica `''` e o CompletionPanel nunca aparece. Efeito colateral: o botão do painel `onStart` só chama `clearDnaClaim()` (`OnboardingChrome.tsx:172`), então mesmo um painel visível não criaria sessão — e o `claimListeners` de `installDnaOnboarding.ts:22` não tem inscritos (o chrome não reage à claim), defeito secundário confirmado.

## Solução proposta

- Corrigir `replayOnboarding` para rastrear a **última** resposta por bloco (mapa `bloco → última resposta`), considerar respondido quando a última resposta não é `null` (e não somente a primeira não-nula), e consumir a resposta do bloco 0 como `product_name`.
- Migration `supabase/migrations/041_dna_finalize.sql` (aplicada pelo usuário) com RPC `finalize_positioning_mapping(p_mapping_id, p_name, p_product_name DEFAULT NULL)` que exige `block_12_promises IS NOT NULL`, seta `name`, `product_name`, `status='completed'`, `completed_at`, `updated_at`; `update_positioning_block` deixa de auto-completar no bloco 12 (a auto-completagem atual é a razão de a flag existir só nesse caminho).
- `CompletionPanel` em 2 fases: (a) input "Nome do seu DNA" pré-preenchido com o nome do produto + botão "Salvar DNA" (chama `finalize_positioning_mapping`); (b) após salvar, "Ver Mapeamento" e "Iniciar Projeto".
- "Iniciar Projeto" = `remote.session.setDefaultPositioning` (ou seleção equivalente) + `clearDnaClaim()` + `uiWorkspace.startSession()` — a nova sessão herda o DNA default (`packages/api/session-controller/src/commands.ts:209-217`), em vez do `onStart` atual que só limpa a claim.
- Inscrever o chrome na claim via `onClaim`/`useSyncExternalStore` sobre `claimListeners` para sincronizar estado aberto/fechado.
- Chaves i18n novas em `apps/web/src/locales/en.ts` e `zh.ts` (namespace `onboarding.dna.*`).

## Plano de aplicação (commit)

1. Commit `fix(dna): finalize positioning name and surface completion panel` — `useDnaSessionTracker.ts`, `OnboardingChrome.tsx`, `CompletionPanel.tsx`, `installDnaOnboarding.ts`, `useDnaOnboardingState.ts`, locales, migration 041 (arquivo; usuário aplica).
2. Testes unitários novos em `apps/web/tests/dna-replay.spec.ts` (lane unitária do vitest) cobrindo: replay de 12 blocos com uma lacuna no meio, resposta nula vs. última resposta, `product_name` vindouro do bloco 0, gate `status='completed'` só via RPC final.
3. Verificação manual: encerrar a entrevista → painel aparece com campo de nome → "Salvar DNA" grava `status='completed'` → "Iniciar Projeto" abre sessão com o DNA default.

## Riscos

- Trocar a auto-completagem do bloco 12 por RPC final muda o caminho de gravabilidade: mappings em andamento com `block_12` salvo mas `status='in_progress'` continuam funcionando (o painel chamará a nova RPC); a migration 040/041 não reescreve dados existentes (migração nova, sem tocar gerações antigas).
- `selectPositioning`/setDefault continuam valendo o shape atual do mapeamento (`commands.ts:292-333`) — nenhum evento novo de sessão é necessário (o estado é legível do log de eventos existente).

## Checklist de aceitação (Problema 1)

- [ ] Replay determinístico de uma entrevista de 12 blocos com lacuna → progresso correto (spec).
- [ ] Nome preenchido no bloco 0 chega como `product_name`; nome escolhido no painel grava `name` (nada de "My first DNA").
- [ ] `status='completed'` nasce do "Salvar DNA", não do luck do save do bloco 12.
- [ ] CompletionPanel aparece na conclusão; "Iniciar Projeto" cria sessão com o DNA ativo.
- [ ] Chave nova existe em `en.ts` e `zh.ts` (gate `verify-client-ui-i18n`).

---

# Problema 2 — Limites de DNA por plano e seletor de DNA ao iniciar campanha

## Diagnóstico

As cotas estão declaradas na migration 039 (`supabase/migrations/039_positioning_mappings_dna.sql:17-20`: trial 3, starter 30, pro 100, legend 500, admin/owner ilimitado) e entregues por `count_my_positioning_mappings`, mas o override de trial (`039:248-254`) e a herança de `plan_id` dão a contadores de `trial_expired`/`canceled`/`past_due` a cota do plano original (o trial nasce com `plan_id = pro` em `supabase/migrations/007_billing_and_trial.sql:82-85`, logo usuário expirado tem cota 100 em vez de 3). O gate de cota + CTA de upgrade existe apenas em `apps/web/src/pages/settings/MyDnaPage.tsx:74-103`; o auto-create do onboarding (`useDnaOnboardingState.ts:143-160`) não checa cota nenhuma. Não existe seletor de DNA ao iniciar campanha: `sessions.create` herda o DNA default silenciosamente (`packages/api/session-controller/src/commands.ts:209-217`) e o chip `DnaComposerChip` só exibe o default, sem lista para escolher. A página `PlansPage` (`apps/web/src/pages/billing/PlansPage.tsx:30-92`) não anuncia cota de DNA em nenhum plano.

## Solução proposta

- Migration `supabase/migrations/042_dna_quota_statuses.sql` (usuário aplica): `count_my_positioning_mappings` passa a tratar `trial_expired`, `canceled`, `past_due` como cota `free` (3), preservando `trial`, `active` e `admin/owner` ilimitados.
- Gate de cota também no auto-create do onboarding (reaproveitar a checagem de `MyDnaPage` como função compartilhada); cota estourada → abrir upgrade em vez de criar mapping silenciosamente.
- `DnaChooserModal` novo (padrão de `onboardingModal.ts` + sinal em `FooterActionsRoot`): ao iniciar campanha, se o usuário tem mais de um DNA (ou cota > 0), perguntar "Qual DNA deseja usar para uma comunicação precisa?" com opção "Campanha Genérica (inicia do zero)"; aplicar via `remote.session.selectPositioning` (`commands.ts:292-333`) antes/depois de criar a sessão, e o modo genérico não seleciona DNA (sessão sem DNA, `defaultPositioningMappingId` permanece `commands.ts:342-358`).
- `PlansPage`: linhas de feature por plano com a cota de DNAs (3 / 30 / 100 / 500), alinhadas aos valores de 039.

## Plano de aplicação (commit)

1. Commit `feat(dna): plan quota statuses, quota gate on create, and campaign DNA chooser` — migration 042 (arquivo; usuário aplica), gate no auto-create, `DnaChooserModal` + sinal + ponte, chaves i18n (en/zh), linhas da PlansPage.
2. Testes: unitário do seletor (abrir com 0/1/N DNAs; modo genérico não chama `selectPositioning`), spec do gate de cota (criador `trial_expired` em 3 → CTA em vez de criar).
3. Verificação manual: usuário `trial_expired` vê cota 3 em My DNA; ao criar campanha aparece o seletor; plano na Pricing mostra as cotas.

## Riscos

- Mudança de cota para `trial_expired`/`canceled`/`past_due` é rebaixamento intencional (usuário com plano expirado mantém 100 até a data por causa de `plan_id`) — confirmar se prefere migração de dados para `trial_expired` manter os mappings existentes acima da nova cota (recomendado: não apagar nada; o gate vale para novos creates).
- Seletor de DNA pode atrasar a abertura de sessão — limitar a um `confirm` rápido em memória, sem bloqueio de rede além de `selectPositioning`.

## Checklist de aceitação (Problema 2)

- [ ] `trial_expired` com plano original `pro` recebe cota 3 (RPC após migration 042).
- [ ] Auto-create do onboarding respeita a cota e abre upgrade ao estourar.
- [ ] Iniciar campanha com ≥1 DNA abre o seletor com as duas opções pedidas.
- [ ] "Campanha Genérica" cria sessão sem DNA e sem `selectPositioning`.
- [ ] PlansPage exibe a cota de DNAs de cada plano.

---

# Problema 3 — Onboarding re-disparando a cada login

## Diagnóstico

É o mesmo bug raiz do Problema 1: a flag persistida por conta é `positioning_mappings.status = 'completed'` (migration 039, coluna existente — não há e não deve haver coluna nova), e ela só nasce no save do bloco 12 (`039:460-468`). O gate de boot em `apps/web/src/components/dna/installDnaOnboarding.ts:203-217` busca o mapping do claim em localStorage (`cm-dna-onboarding-session`) e só satisfaz quando acha `status='completed'`; como isso nunca acontece, `beginOnboarding` reabre a entrevista a cada sessão (login), recriando estado novo por cima do default "My first DNA". O claim em localStorage permite resume de entrevista interrompida (meio da campanha) — esse comportamento é desejável e permanece; o que não pode acontecer é reabrir depois de concluído.

## Solução proposta

- Corrigir a transição de status (Problema 1: RPC final + replay corrigido) — é a correção necessária e suficiente para o loop.
- Opcional (recomendado): cache fast-path `localStorage['cm-dna-onboarding-done']` escrito ao concluir, lido no gate de boot para pular a ida ao servidor quando já concluído — invalidar ao trocar de conta no mesmo navegador.
- Reaproveitar o mesmo predicado de "concluído" em um único helper exportado por `installDnaOnboarding.ts` para o gate de boot e o `CompletionPanel`.

## Plano de aplicação (commit)

1. Commit `fix(dna): persist onboarding completion across logins` — gate de boot, cache fast-path, specs (o spec unitário pode cobrir o gate sem rede).
2. Verificação manual: concluir a entrevista → logout → login → onboarding não reabre; entrevista interrompida → login → resume do ponto salvo.

## Riscos

- Cache localStorage pode ficar obsoleto se o mapping for apagado em outro dispositivo — ao abrir o gate sem cache (ou com claim), o servidor continua fonte da verdade; o cache só evita a ida, nunca decide sozinho (se a ida falhar, deixa a entrevista reabrir em vez de fingir conclusão? — decisão: falha de rede no gate mantém comportamento atual de reabrir, documentado no helper).

## Checklist de aceitação (Problema 3)

- [ ] Após concluir, logout/login não reabre o onboarding.
- [ ] Entrevista interrompida faz resume do ponto salvo (claim).
- [ ] Apagar o mapping faz o onboarding reabrir (comportamento correto).
- [ ] Nenhuma coluna nova em `positioning_mappings`.

---

# Sequência de aplicação e commits

| Ordem | Conteúdo | Commit |
|---|---|---|
| 0 | Este plano | `docs(roadmap): plan for Settings admin gate, DNA save, plan limits, onboarding recurrence fixes` |
| 1 (após aprovação) | Problema 4 — UI + flag | `fix(auth): gate Settings and Models UI behind platform admin` |
| 2 | Problema 4 — backend harness | `fix(api): require auth context and platform admin on settings and credentials verbs` |
| 3 | Problema 1 | `fix(dna): finalize positioning name and surface completion panel` |
| 4 | Problema 3 | `fix(dna): persist onboarding completion across logins` |
| 5 | Problema 2 | `feat(dna): plan quota statuses, quota gate on create, and campaign DNA chooser` |

## Ações que só o usuário executa

1. Aplicar A1, A2, A3 (Parte A) no editor SQL do Supabase, nessa ordem.
2. Aplicar as migrações novas dos Problemas 1 e 2 (arquivos criados por mim em `supabase/migrations/`, nunca executados por mim).
3. Verificar em produção, após cada commit de código: os itens dos checklists de cada problema.

## Fora do escopo

- Alterações em `packages/core/` e `packages/llm/` (proibição) — inclui o gate de papel de `listAdapters`/`listDeclared`/`discoverModels`, registrado como dívida.
- Alterações na lane `test:web`.
- Reescrita do `custom_access_token_hook` para claim `is_admin` (alternativa para o servidor ler a flag sem a via plataforma; hoje desnecessária porque a identidade já carrega `tenantId` plataforma).
- Tabelas `llm_models`/`tenant_llm_providers` do painel admin antigo além do que A3 já fecha via RLS.
