# Plano de correções: admin gate de Settings, consolidação do menu lateral, save de DNA, limites por plano e onboarding recorrente

Estado: investigação concluída; nenhum código aplicado; nenhum SQL executado por mim.

Fluxo: este documento é o plano único dos 5 problemas; commit + push deste plano, aguardando aprovação, e só então código (1 commit por problema, na ordem Problema 4 → 5 → 1 → 3 → 2 — o 5 vem logo após o 4 porque tocam no mesmo componente).

## Resumo executivo

| # | Problema | Severidade | Causa raiz resumida |
|---|---|---|---|
| 4 | Settings → Models visível para usuário comum; app sem flag de admin | CRÍTICO | sem flag de admin no app + RLS `is_admin_or_owner()` verdadeiro para todo usuário + guardas do harness desligadas (`@Remote` sem identidade) + UI sem gate |
| 5 | Menu lateral poluído; Plans/Profile/My DNA soltos fora do Settings | MÉDIO (cosmético) | itens de página vivem como botões de footer com modais próprios (`FooterActionsRoot`), fora da navegação de seções do shell Settings |
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

- **A0 (antes de A1 — membership no tenant plataforma):** rodar no editor SQL do Supabase `SELECT utr.user_id, utr.tenant_id, utr.role, utr.created_at FROM public.user_tenant_roles utr WHERE utr.user_id = 'a371977b-b414-4bd4-b51e-f2c16efc4425' AND utr.tenant_id = '00000000-0000-0000-0000-000000000001';` e ler o `role` retornado; não se pode assumir o resultado, porque a migration 024 gravou o membership do operador com o UUID `5302ad3a-f6a9-4fc3-890e-3e8af8b767c7` (`supabase/migrations/024_fix_existing_user_roles.sql:29-35`), não com `a371977b-b414-4bd4-b51e-f2c16efc4425`.
- **A0 — resultado esperado e o que fazer em cada caso:** linha com `role` `owner`/`admin` (SIM) → A3 preserva o admin pela via plataforma, ramo (a) de A3; `role = 'member'` ou nenhuma linha (NÃO) → A1 (flag `is_admin`) é a única via de A3, ramo (b), e a ordem A1 → A2 → A3 é obrigatória, sem exceção. Em ambos os casos A1 segue obrigatório para o cliente, porque B1/B3 leem `metadata.is_admin` publicado por `get_my_profile` e não enxergam membership de tenant.
- **A1** (exatamente como pedido): `UPDATE public.users SET metadata = metadata || '{"is_admin": true}'::jsonb WHERE email = 'integridade.digital@gmail.com';`
- **Inventário de callers de `get_my_profile` (antes de A2):** rodar `grep -rn "get_my_profile" apps/ packages/ supabase/` e registrar o resultado desta investigação — único caller em runtime é `getUserFullProfile` (`apps/web/src/lib/auth/supabase.client.ts:369-397`, chamada da RPC na linha 371), com consumidores indiretos em `apps/web/src/lib/auth/auth.provider.tsx:38, 207, 252` e reexport em `apps/web/src/lib/auth/index.ts:3`; fora isso só existem a declaração do tipo da RPC (`Functions.get_my_profile` com `Returns: MyProfileResult`, `supabase.client.ts:242`) e as definições SQL (`supabase/migrations/003_security_and_profile_fixes.sql:81-84` e `supabase/migrations/025_security_and_role_hardening.sql:224-268`, com REVOKE/GRANT em 329/335/341); nenhum caller em `packages/` nem em `python/`.
- **Compatibilidade do campo `is_admin` com os callers (confirmado na mesma verificação):** o destructuring de `getUserFullProfile` (`supabase.client.ts:376`, `const { id, email, full_name, whatsapp, avatar_url } = data.user`) só lê campos conhecidos, então acrescentar `is_admin` ao payload da RPC é aditivo e não quebra nenhum caller existente; a mudança obrigatória no mesmo commit de A2/B1 é estender `MyProfileResult` (`supabase.client.ts:4-21`) com `is_admin: boolean` e ler `data.is_admin === true`, senão o typecheck falha. Se um caller novo aparecer com destructuring estrito ou leitura indexada do payload, ajustar no mesmo commit de A2.
- **A2** (necessário para o item B.1): `CREATE OR REPLACE FUNCTION public.get_my_profile()` com a assinatura atual (`supabase/migrations/025:224-268`) acrescentando no `jsonb_build_object` o campo `'is_admin', COALESCE(u.metadata ->> 'is_admin', 'false')::boolean` — a RPC de hoje não devolve `metadata`, então o bootstrap não tem como ler a flag.
- **A3** (fecha o item 4 do pedido no backend de dados): `CREATE OR REPLACE FUNCTION public.is_admin_or_owner()` mantendo a assinatura sem DROP (19 policies dependentes) e passando a retornar verdadeiro apenas quando (a) o usuário tem `owner`/`admin` no tenant da plataforma `'00000000-0000-0000-0000-000000000001'` (mesma semântica de `isPlatformAdmin`) **ou** (b) `public.users.metadata ->> 'is_admin' = 'true'` para `auth.uid()`; falso em qualquer outro caso. Isso retira de todo usuário comum o acesso a `llm_providers`/`llm_models`/`system_config`/`metrics_daily` e às RPCs de admin, e fecha o escape cross-tenant das policies `005`/`006`.
- **Ordem obrigatória: A0 → A1 → A2 → A3** (o A0 decide qual via preserva o admin em A3; a flag tem que existir antes do reforço, e A3 preserva o admin atual pela via plataforma ou pela flag).

### Parte B — Gate no código (eu implemento após aprovação)

- **B1 (bootstrap lê `metadata.is_admin`):** estender `AuthUser` com `isAdmin: boolean` e preencher em `getUserFullProfile` (`apps/web/src/lib/auth/supabase.client.ts:369-397`, `data.is_admin === true`, fail-closed no fallback de perfil da linha 47-52 de `auth.provider.tsx`); publicar `__DSH_AUTH__.isAdmin` em `apps/web/src/main.tsx:40, 68-73`.
- **B2 (gear Settings continua visível para todos):** o gear de menu lateral **não** é escondido — `Profile` e `Plans` passam a viver dentro do Settings e são necessários a todo usuário (regra de visibilidade unificada com o Problema 5); nenhuma mudança no registro `sidebar.settings` (`packages/client/ui-settings-general/src/client/index.ts:158`).
- **B3 (aba Models só renderiza com `metadata.is_admin === true`):** a seção Models deixa de ser registrada incondicionalmente em `packages/client/ui-settings-models/src/client/index.ts:131, 143, 151` — registro e dispose dirigidos por `__DSH_AUTH__.isAdmin === true` (predicado estrito e fail-closed, vindo de B1), reavaliados quando o app publica a resolução do perfil (evento `copymonster:auth` em `apps/web/src`, porque a flag chega depois do boot); não-admin: a aba e os diálogos de onboarding (BYOK/DeepSeek) simplesmente não existem — sem estado "bloqueado com mensagem". O divisor acima da aba no rail de navegação é do Problema 5.
- **B4 (esconder Edit/Delete dos providers):** a seção fica inacessível para não-admin via B3; como defesa extra, injetar `canManage` (predicado) nas props de `ModelsSection` e ocultar os botões de Edit (`ModelsSection.tsx:391-406`) e Delete (`407-424`) quando falso.
- **B5 (proteger o backend de listagem/escrita de providers — camada harness):** sem isto o gate de UI é cosmético, porque qualquer criador continua conseguindo chamada direta remota. Marcar `describe`, `update`, `replace`, `mutate`, `openSettingsDocument`, `openAgentPresetDirectory`, `canOpenAgentPresetDirectory` (`packages/api/settings-controller/src/index.ts:170, 203, 223, 245, 263, 295, 190`) e `credentials.describe/set/unset` (`.../credentials.ts:97, 122, 139`) com `@RemoteScope('auth', '<verb>')`; endurecer as guardas para fail-closed: identidade ausente → `settings/unauthorized`; identidade fora de (`owner`/`admin` **com** `tenantId === DEFAULT_TENANT_ID`) → `settings/forbidden` (o predicado server-side espelha `isPlatformAdmin`; `UserIdentity` já carrega `tenantId` e `role` vindos dos claims, `packages/api/auth-context/src/index.ts:170-196`). A camada de dados (B/A3) cobre `llm_providers`; a camada harness cobre os namespaces `llm-*` e as credenciais.
- **Nota (fora do escopo, registrado):** `listAdapters`/`listDeclared`/`discoverModels` em `packages/llm/llm/src/index.ts` não podem ser alterados (proibição de tocar `packages/llm/`); o inventário residual de nomes de providers continua legível por autenticado — aceito como dívida, sem endpoints nem chaves.

## Plano de aplicação (commits)

1. **SQL (usuário):** A0 (verificação, sem escrita), depois A1, depois A2, depois A3 no editor SQL do Supabase (arquivos `supabase/migrations/040_admin_flag_and_rls.sql` são criados por mim como registro, mas a aplicação é do usuário).
2. **Commit `fix(auth): gate Settings and Models UI behind platform admin`** — B1 (apps/web, inclui o evento `copymonster:auth` que o Problema 5 também vai consumir), B3+B4 (ui-settings-models, registro condicional da aba Models), specs de cliente (padrão `packages/client/ui-settings-models/tests/apply.client.spec.ts`).
3. **Commit `fix(api): require auth context and platform admin on settings and credentials verbs`** — B5, specs em `packages/api/settings-controller/tests/` (casos fail-closed: identidade ausente → recusa; criador (owner de tenant pessoal) → recusa; admin de plataforma → permite; o caso "sem autenticação → acesso pleno" de `rbac-isolation.spec.ts:91` é substituído por recusa, com nota de que o host desktop-local é decisão aberta do usuário), regeneração dos remotes/cátalogos afetados pelo `pnpm run build`.
4. **Verificação (usuário, em produção):** com sessão de criador, o gear Settings continua visível mas a aba Models não existe (nem o divisor); `settings.update` em namespace `llm-*` e `credentials.set` passam a recusar; `get_admin_llm_providers` não retorna linhas; com sessão do admin (após A1), aba Models aparece e tudo segue funcionando (inclusive AdminModal).

## Riscos

- **Gate estrito em `metadata.is_admin`:** se A1 não rodar antes do deploy da UI, a aba Models desaparece inclusive para o admin (predicado fail-closed é proposital) — ordem obrigatória: A1 antes do primeiro deploy de B3.
- **A3 pode travar o admin atual** se o A0 resultar NÃO (sem membership `owner`/`admin` no tenant plataforma) e a A1 não rodar antes — por isso a ordem A0 → A1 → A3 e a verificação de que o AdminModal continua visível depois de A3.
- **Risco operacional — janela de deploy coordenado (B5):** B5 muda o wire dos verbos settings/credentials (novo parâmetro de contexto `authId`, `AUTH_CONTEXT_WIRE` em `packages/api/auth-context/src/index.ts:32`), então host e client DEVEM ser publicados juntos no mesmo deploy — o build do `apps/web` embute o remote client do mesmo commit e um par mismatchado deixa os verbos incompatíveis. Operação: janela de baixo tráfego, rollback preparado (commit anterior de host + client já publicado) e, se o deploy estiver atrás de proxy/CDN com cache (Cloudflare), purgar o cache após publicar. Este é um risco operacional de publicação, não apenas técnico: falha dele não aparece em teste unitário, aparece em produção como verbos de settings/credentials quebrados.
- **Desktop local:** com identidade obrigatória, o host desktop sem login deixaria de configurar — decisão aberta: tratar por configuração do perfil de bundle (não hardcoded) ou manter a recusa e exigir login também no desktop. Nenhuma decisão tomada aqui.
- **Nota histórica:** `plano-auditoria-completa-copymonster.md` já previa a auto-elevação por `user_metadata` no `is_admin_or_owner()` antigo; a reescrita `025` trocou por tenant ativo e manteve o problema (todo usuário é owner). A3 resolve a direção.

## Checklist de aceitação (Problema 4)

- [ ] A0 executado no editor SQL: membership de `a371977b-b414-4bd4-b51e-f2c16efc4425` no tenant plataforma lido e a ramificação (SIM/NÃO) registrada.
- [ ] Callers de `get_my_profile` revisados; `MyProfileResult` estendido com `is_admin` no mesmo commit de A2/B1.
- [ ] A1 aplicado pelo usuário: `metadata.is_admin = true` para `integridade.digital@gmail.com`.
- [ ] A2 aplicado: `get_my_profile()` devolve `is_admin`.
- [ ] A3 aplicado: usuário comum não passa mais em `is_admin_or_owner()`; admin continua passando.
- [ ] Criador logado: gear Settings continua visível na sidebar; `settings.section` sem a entrada `models` (aba e divisor ausentes).
- [ ] Criador logado (chamada direta): `settings.update('llm-...', ...)` → `settings/forbidden`; `credentials.set` → recusa; `get_admin_llm_providers` → vazio.
- [ ] Admin logado (após A1): aba Models, Edit/Delete e painel admin seguem funcionando.
- [ ] Sessão sem token: nenhum dos verbos protegidos responde conteúdo (fail-closed).
- [ ] Nenhuma chave presente em diff, teste ou doc (verificação de padrão `apiKey|secret` no diff).

---

# Problema 5 — Consolidação do menu lateral: Plans/Profile/My DNA viram abas do Settings

## Diagnóstico

O menu lateral do app entrega itens soltos no rodapé do sidebar: `FooterActionsRoot` renderiza cinco linhas (Plans, Profile, My DNA, Admin gated, Sign Out) com labels bilíngues hardcoded e monta três modais próprios (`PlansModal`, `ProfileModal`, `DnaModal`) — conteúdo de página poluindo a navegação e duplicando o shell do Settings. O Settings por outro lado já é um shell de abas: o rail de navegação do painel ordena entradas de `settings.section` por `order` (hoje General 0, Models 10, Built-in plugins 15, Agent presets 20, Archived sessions 25) e já expõe `openSection(id)` no contrato (`packages/client/ui-settings/src/client/contract/slots.ts:135`). Deep links e CTAs já conversam por evento (`copymonster:modal`), então a consolidação reaproveita o canal existente em vez de criar roteamento novo.

## Evidências — os 5 greps solicitados

1. **Menu lateral atual (linhas soltas + modais próprios):**

```ts
// apps/web/src/components/layout/FooterActionsRoot.tsx
const plansLabel = lang === 'zh' ? '计划 (Plans)' : 'Plans'        // :92 — label hardcoded
{/* Row 1: Plans */}  <button onClick={() => setActiveModal('plans')} ...>   // :100-116
{/* Row 2: Profile */} <button onClick={() => setActiveModal('profile')} /> // :118-135
{/* Row 3: My DNA */}  <button onClick={() => setActiveModal('dna')} />     // :137-157
{/* Row 5: Sign Out */} ...                                                // :182-199
<PlansModal ... /> <ProfileModal ... /> <DnaModal ... />                    // :203-227
```

2. **Componente Settings + abas (rail de seções do painel):**

```ts
// packages/client/ui-settings-general/src/client/SettingsRoot.tsx
const [activeId, setActiveId] = useState<string | undefined>(undefined)   // :123
// The Models section is creator BYOK, so every creator sees the row.     // :55 — comentário obsoleto
{visibleRows.map(row => ( <button ...> {navIcon(row.id)} <span>{row.label}</span> ... ))} // :86-97
// registro das seções: ui-settings-general:187 (general, 0), ui-settings-models:131 (models, 10),
// ui-settings-plugins:187 (plugins, 15), ui-agent-preset:220 (agent-presets, 20), ui-settings-unarchive-sessions:41 (archived-sessions, 25)
```

3. **Componentes existentes de Plans/Profile/My DNA:**

```ts
// apps/web/src/components/layout/FooterActionsRoot.tsx:3-7 — donos atuais dos modais
import { PlansModal } from './PlansModal'
import { ProfileModal } from './ProfileModal'
import { DnaModal } from './DnaModal'
// páginas reutilizáveis: pages/billing/PlansPage.tsx:169, pages/ProfilePage.tsx:51, pages/settings/MyDnaPage.tsx:22
```

4. **Estado das abas em Settings (como é roteado):**

```ts
// packages/client/ui-settings-general/src/client/SettingsRoot.tsx
const [open, setOpen] = useState(false)                  // :122 — estado local do painel
const openSection = useCallback((id: string) => { ... }, ...) // :139 — já existe canal "abrir em uma aba"
// senders hoje: bus window 'copymonster:modal' — FooterActionsRoot.tsx:77 (listener),
// main.tsx:281-293 (rotas /plans e /profile), MyDnaPage.tsx:76, 99 (CTA de upgrade)
```

5. **Gate admin (`metadata.is_admin`):**

```ts
// packages/client/ui-model-selection/src/client/index.ts:123-131 — único gate de admin hoje no cliente
function isPlatformAdminSession(): boolean {
  const session = (globalThis as { __DSH_AUTH__?: ... }).__DSH_AUTH__
  if (session?.accessToken === undefined) return false
  return session.isPlatformAdmin === true
}
// grep "is_admin" em packages/client: nenhuma ocorrência — o cliente ainda não conhece a flag; B1 (Problema 4) a publica
```

## Solução proposta

### Estrutura final

Menu lateral (fora de Settings): **Plugins** e **Workspaces (com sub-itens)** já existem como painéis do sidebar (`ui-plugin-manager` em `sidebar.panellist`, `ui-workspace` em `sidebar.workspaces`, `index.ts:176`) — nenhuma mudança neles; ficam **Sign Out** e **Settings** (gear, visível para todos). As linhas Plans, Profile e My DNA saem do footer; a linha Admin permanece como está (gated por `isPlatformAdmin`).

Abas do Settings, nesta ordem exata (valor do `order` de registro):

| # | Aba | id | order |
|---|---|---|---|
| 1 | General | `general` | 0 (inalterado) |
| 2 | Profile | `profile` | 10 (novo, registrado por `apps/web`) |
| 3 | Plans | `plans` | 11 (novo) |
| 4 | My DNA | `my-dna` | 12 (novo) |
| 5 | Built-in plugins | `plugins` | 15 (inalterado) |
| 6 | Agent presets | `agent-presets` | 20 (inalterado) |
| 7 | Archived sessions | `archived-sessions` | 25 (inalterado) |
| ─ | divisor visual | — | renderizado antes da linha `models` |
| 8 | Models | `models` | 30 (hoje 10; mudar em `packages/client/ui-settings-models/src/client/index.ts:134`; admin-only — Problema 4) |

### Regras de visibilidade

- Settings (gear): visível para todo usuário — Profile e Plans passam a ser necessários a todos dentro dele.
- Abas 1-7: visíveis para todo usuário.
- Aba 8 (Models): só renderiza se `__DSH_AUTH__.isAdmin === true` (o flag `metadata.is_admin` publicado por B1, predicado estrito e fail-closed); se não-admin, a aba **e** o divisor acima dela não renderizam — não é "bloqueado com mensagem", simplesmente não existem; o mesmo vale para os diálogos de onboarding BYOK/DeepSeek (B3).

### Componentes e navegação

- Reutilizar as páginas existentes dentro de três seções finas registradas por `apps/web` (no ponto em que ele já injeta `sidebar.footer.action`, `apps/web/src/main.tsx:197-199`): `ProfilePage`, `PlansPage` e `MyDnaPage` (que recebe o `close` do contexto da seção — ele já aceita `onClose`).
- Remover de `FooterActionsRoot`: linhas 1-3, os modais `PlansModal`/`ProfileModal`/`DnaModal` e o handler `'dna'`; `OnboardingDnaModal` permanece (é o fluxo de onboarding, não navegação); linha Admin e Sign Out permanecem.
- Navegação preservada: manter o bus `copymonster:modal`; `FooterActionsRoot` traduz `'plans'|'profile'|'dna'` → novo evento `copymonster:settings` com `{ section: 'plans'|'profile'|'my-dna' }`, consumido por um listener em `SettingsRoot` que chama `openSection` (já existente, `SettingsRoot.tsx:139`); senders atualizados no mesmo commit: rotas `/plans` e `/profile` (`main.tsx:281-293`), CTA de upgrade do `MyDnaPage` (`:76, :99`); `'admin'` continua abrindo o AdminModal.
- Divisor: elemento estático antes da linha `models` no `visibleRows.map` do `SettingsPanel`, renderizado somente quando essa linha existe; o comentário obsoleto "creator BYOK" (`SettingsRoot.tsx:55`) passa a documentar o gate admin-only.
- Faixa de `order` reservada: 0 = geral; 10-12 = seções de conta do usuário; 15-25 = seções de sistema; 30 = admin (Models).

### Interação com o Problema 4

Problemas 4 e 5 tocam no mesmo componente (rail de navegação do `SettingsRoot` + registro de `ui-settings-models`): a regra "aba 8 admin-only" do Problema 5 **é** o gate B3 do Problema 4, e o divisor é condicional à existência dessa linha. Aplicar o 4 primeiro (vazamento de providers) e o 5 em seguida (ordem/consolidação); as camadas de servidor do 4 (B5 + A3) seguem valendo por si, independentes desta UI.

## Plano de aplicação (commit)

1. **Commit `refactor(web): move Plans, Profile, My DNA into Settings sections`** (logo após os commits do Problema 4) — registro das 3 seções (orders 10/11/12), models 10 → 30, divisor + comentário do rail, remoção das 3 linhas e 3 modais do `FooterActionsRoot`, rewire do bus (`copymonster:settings` + listener em `SettingsRoot`), atualização dos senders, chaves i18n em `apps/web/src/locales/en.ts` e `zh.ts`, specs de cliente.
2. **Verificação manual** conforme o checklist (ordem exata das abas, divisor, deep links, footer enxuto).

## Riscos

- `PlansPage`/`ProfilePage`/`MyDnaPage` nasceram para modal — a adaptação a seção é fina mas remove cabeçalhos/fechamentos próprios em favor do chrome do shell (validar que não sobra header duplicado).
- O upgrade a partir de My DNA hoje abre modal por cima de outro modal; dentro do Settings vira navegação entre abas — validar foco e scroll ao trocar de aba via `openSection`.
- Acoplar `SettingsRoot` ao nome de evento do app é o menor custo compatível com o estado local das abas; alternativa se preferirem: expor `openSection` por um comando/slot público do contrato em vez de listener de evento.
- Ordem numérica por `order`: seções futuras com order entre 0 e 30 se inserem no meio — a faixa reservada (acima) documenta onde cada tipo de aba entra.

## Checklist de aceitação (Problema 5)

- [ ] Menu lateral enxuto: Plugins, Workspaces (com sub-itens), Sign Out, Settings (mais a row Admin, que continua gated).
- [ ] Settings com abas na ordem exata: General, Profile, Plans, My DNA, Built-in plugins, Agent presets, Archived sessions, ───, Models.
- [ ] Aba Models + divisor só visíveis para admin (`metadata.is_admin === true`); para não-admin não existem (sem estado bloqueado).
- [ ] Navegação preservada: rota `/plans` (e qualquer clique/CTA antigo) → Settings abre na aba Plans; idem `/profile` e My DNA.
- [ ] i18n atualizado (en + zh) para as chaves de menu/abas novas; labels hardcoded do footer removidos.

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
| 0 | Este plano (Problemas 4 e 5 juntos — tocam no mesmo componente) | `docs(roadmap): plan for admin gate + Settings consolidation (Problems 4-5)` |
| 1 (após aprovação) | Problema 4 — flag + UI (B1-B4) | `fix(auth): gate Settings and Models UI behind platform admin` |
| 2 | Problema 4 — backend harness (B5) | `fix(api): require auth context and platform admin on settings and credentials verbs` |
| 3 | Problema 5 — consolidação do menu | `refactor(web): move Plans, Profile, My DNA into Settings sections` |
| 4 | Problema 1 | `fix(dna): finalize positioning name and surface completion panel` |
| 5 | Problema 3 | `fix(dna): persist onboarding completion across logins` |
| 6 | Problema 2 | `feat(dna): plan quota statuses, quota gate on create, and campaign DNA chooser` |

Prioridade: Problema 4 (vazamento) antes do Problema 5 (cosmético); 5 vem logo depois do 4 porque compartilham `SettingsRoot`/`ui-settings-models`.

## Ações que só o usuário executa

1. Executar A0 no editor SQL do Supabase (verificação de membership; nenhum dado é alterado) e registrar a ramificação escolhida; depois aplicar A1, A2, A3 (Parte A) nessa ordem.
2. Aplicar as migrações novas dos Problemas 1 e 2 (arquivos criados por mim em `supabase/migrations/`, nunca executados por mim).
3. Verificar em produção, após cada commit de código: os itens dos checklists de cada problema.

## Fora do escopo

- Alterações em `packages/core/` e `packages/llm/` (proibição) — inclui o gate de papel de `listAdapters`/`listDeclared`/`discoverModels`, registrado como dívida.
- Alterações na lane `test:web`.
- Reescrita do `custom_access_token_hook` para claim `is_admin` (alternativa para o servidor ler a flag sem a via plataforma; hoje desnecessária porque a identidade já carrega `tenantId` plataforma).
- Tabelas `llm_models`/`tenant_llm_providers` do painel admin antigo além do que A3 já fecha via RLS.
