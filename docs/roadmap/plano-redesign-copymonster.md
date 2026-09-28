# Plano de Redesign — CopyMonster

**Data:** 2026-09-27 · **Repositório:** `Integridade-Digital/copymonster-launch` · **Branch:** `master` · **Commit de referência:** `f6ecdc0` (`chore: remover arquivos .bak e ignorar .dsh-build`)

> **Status:** PLANO APROVADO COM DIRETRIZES CONFIRMADAS — nenhum arquivo de código alterado, nenhum commit/push feito ainda.
> **Regras obrigatórias acordadas:**
> 1. Uma fase por vez = 1 commit por fase.
> 2. NÃO commitar NEM dar push sem aprovação explícita do Adriano.
> 3. Rodar `pnpm run build:lib:host` e `pnpm run build:lib:client` e exibir o output antes de cada commit.
> 4. Build quebrado é corrigido antes de commitar.
> 5. Validação em cada fase. Dúvida = PARAR e perguntar.

---

## Parte A — Respostas às 4 perguntas (diagnóstico verificado no código)

### 1. O `settings-controller` está no `cordis.patch.yml`?

**SIM, está.** Em `packages/bundle/web-app/cordis.patch.yml` (linhas ~134–137):

```yaml
    - id: settings-controller
      name: '@deepseek-ai/dsh-api-settings-controller'
```

E o bundle CopyMonster (`packages/bundle/copymonster/cordis.patch.yml`) adiciona por cima, via overlay:

```yaml
- insert:
    - id: auth-context
      name: '@deepseek-ai/dsh-api-auth-context'
    - id: auth-http
      name: '@deepseek-ai/dsh-api-auth-http'
```

O problema de "settings are unavailable in this browser" **NÃO é registro ausente**. A causa real está em `packages/client/ui-settings/src/client/index.ts:58`:

```ts
const persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'
```

Em `app.copymonster.co` (servido pela rede, não por `localhost`), `isLoopback` é `false`. Com `persistence = 'memory'`, o `SettingsDescribeMirror` nasce com `status: 'unavailable'` e **nunca cruza o fio** — nem chega a chamar `settings.describe()`. É por isso que a mensagem exata `settings are unavailable in this browser` aparece (`packages/client/ui-settings-models/src/client/store.ts:192`). O backend RBAC que implementamos na Fase 3 anterior está intacto e correto; a falha é a decisão de persistência do cliente.

### 2. O `auth.provider.tsx` trata usuário anônimo?

**SIM, o app React trata — mas ele nunca chega a rodar.** O fluxo em `apps/web/src/main.tsx` está correto: `ProtectedRoute`/`PublicRoute` cobrem todas as rotas e o usuário não-logado seria levado a `/login`.

A tela preta `dsh web authentication required; reopen the URL printed by dsh web` vem de **abaixo** do React:

- `packages/client/connection/src/browser-auth.ts` (método `writeUnauthorized`, linha ~311): o gateway do Host responde **401 com esse texto** para o índice da conexão quando não há cookie de sessão válido.
- `packages/host/frontend-static/src/index.ts` (`serveStatic`, com `authorizeIndex()`): o servidor de estáticos só entrega o `index.html` se a autorização passar; sem sessão, nada é servido — o app React nem é baixado.

Ou seja: o visitante anônimo nunca recebe o HTML do SPA, então os redirects do `main.tsx` não têm chance de rodar. A correção é no layer Host (`frontend-static` / `browser-auth`), não no `auth.provider.tsx`.

### 3. O `/plans` está no `main.tsx` com `ProtectedRoute`?

**SIM para a proteção, NÃO para o layout.** Em `apps/web/src/main.tsx`:

```tsx
<Route path="/plans" element={
  <ProtectedRoute>
    <div style={{ height: '100%', width: '100%', overflowY: 'auto' }}>
      <PlansPage />
    </div>
  </ProtectedRoute>
} />
```

A rota existe e é protegida, mas renderiza `PlansPage` **fora** do shell do workspace (o `LazyWebApp` só monta na rota `/`). Resultado: sem sidebar, sem dark theme, cards brancos soltos — exatamente o Problema 3.

### 4. O `ui-sidebar` tem slot para rodapé (perfil/logout)?

**SIM.** `packages/client/ui-sidebar/src/client/SidebarRoot.tsx`, na `footArea`:

```tsx
<div className={css.footArea}>
  <div className={css.footerActions}>
    {renderSlot('sidebar.footer.action', { wide })}
  </div>
  <div className={css.settingsArea}>
    {renderSlot('sidebar.settings', { wide })}
  </div>
</div>
```

Existe o slot **`sidebar.footer.action`** disponível, renderizado acima do botão Settings em ambas as larguras (expandida e rail). É o ponto de encaixe nativo para o bloco avatar + nome + "Sair" e para o atalho "Plans". Não é preciso alterar a geometria do sidebar — basta um plugin cliente que ocupe o slot.

---

## Parte B — Princípios de execução (todas as fases)

1. **Uma fase por vez, um commit por fase.** Nada é commitado sem o output do build e a sua aprovação.
2. **Antes de cada commit:** rodar `pnpm run build:lib:host` e `pnpm run build:lib:client` e colar o output no chat. Build vermelho = corrigir antes de prosseguir.
3. **Testes dos pacotes tocados:** `pnpm vitest run <caminhos dos pacotes alterados>` (com `DSH_LEFTHOOK_ALLOW_HOOKS_PATH_OVERRIDE=1` se o `core.hooksPath` herdados de `/dev/null` reclamar).
4. **Nada do que já funciona é reescrito.** Cada fase altera o mínimo de arquivos listado; qualquer arquivo extra só entra com anúncio explícito no chat antes.
5. **O plano inteiro preserva o RBAC das fases anteriores** (migrations 005–007, sandbox de filesystem, guards de settings/credentials).
6. **Dúvida ou ambiguidade = PARAR e perguntar.** Nada é inventado.

---

## Parte C — As 7 fases, passo a passo

---

### FASE 1 — Models não carrega (CRÍTICO) 🔴

**Causa-raiz confirmada:** `persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'` em `packages/client/ui-settings/src/client/index.ts:58` mata o describe antes da chamada de rede em deployments não-loopback.

**Entregável:** Settings → Models carrega a lista de provedores/modelos para `owner`/`admin` em `app.copymonster.co`.

**Arquivos:**
- `packages/client/ui-settings/src/client/index.ts` — decisão de persistência
- `packages/client/ui-settings/src/client/settings-mirror.ts` — o caminho `memory → unavailable` (só se a correção exigir)
- `packages/client/ui-settings/tests/*` — ajustar/adiar testes que fixam o comportamento non-loopback

**Passos:**

1. **Corrigir a decisão de persistência.** Trocar o critério de "loopback" por "existe um Remote autenticado capaz de responder": quando `ctx.remote.$host` estiver disponível e a conexão autenticada (o token já é publicado em `__DSH_AUTH__` pelo `publishClientAuthSession`), usar `persistence = 'host'`. Manter `memory` apenas quando não houver Host remoto de verdade (ex.: render estático, testes).
   - Detalhe de implementação preferido: expor no adaptador de conexão um fato `canDescribeSettings` (ou reutilizar a presença de `ctx.remote.$host` com transporte ativo) em vez de checar URL/loopback. Nenhuma chave secreta desce ao browser — o describe continua com `redactSecrets: true` no backend.
2. **Garantir que o RBAC do backend não seja o que falha:** o `SettingsController.describe()` já filtra namespaces protegidos para não-admins e mantém tudo para `owner`/`admin` (`assertAdminRole`, `isProtectedNamespace`). Nenhuma mudança de backend esperada nesta fase — se a investigação em runtime mostrar que `ctx.authIdentity` não chega ao controller via Gateway, paramos e discutimos antes de alterar `auth-context`.
3. **Rodar os testes do espelho:** `pnpm vitest run packages/client/ui-settings packages/client/ui-settings-models` — atualizar os specs que hoje afirmam `unavailable` para o cenário não-loopback autenticado (o teste `store.client.spec.ts:285` e `settings-mirror.client.spec.ts:97–102`).
4. **Build completo:** `pnpm run build:lib:host` + `pnpm run build:lib:client`, output colado no chat.
5. **Você valida em staging**, então commit: `fix(settings): usar persistência host em deployments remotos autenticados (corrige Models)`.

**Critério de pronto:** em `app.copymonster.co`, logado como `owner`, Settings → Models lista DeepSeek/OpenAI/Anthropic com estados de credencial; logado como `member`, a seção mostra o cartão "Acesso Restrito" (guard já existente em `ModelsSection.tsx`).

---

### FASE 2 — Rota anônima: visitante vê login (CRÍTICO) 🔴

**Causa-raiz confirmada:** `frontend-static` + `browser-auth` respondem 401 texto puro para quem não tem cookie de sessão; o SPA nunca é servido.

**Decisão confirmada:** Servir um HTML público estático e separado (sem `__DSH_BOOT__`, sem boot graph) para requisições de documento não autenticadas.
- O HTML público é o shell do React (`main.tsx`) sem o boot graph do Cordis.
- O React carrega, detecta a ausência de `__DSH_AUTH__` e redireciona imediatamente para `/login` (ou rota pública requisitada).
- O backend mantém 401 rigoroso para `/api/*`, SSE, WebSocket e chamadas de dados.
- Segurança garantida: o `frontend-static` não injeta `__DSH_BOOT__` neste shell público, preservando sigilo total dos plugins internos e configurações do host para usuários anônimos.

**Entregável:** visitante não-logado em `app.copymonster.co` recebe o shell React público e é direcionado para `/login` (com `/register`, `/forgot-password`, `/reset-password` funcionando).

**Arquivos:**
- `packages/host/frontend-static/src/index.ts` — `serveStatic` / servir shell público sem injeção de boot graph para documentos anônimos
- `packages/client/connection/src/browser-auth.ts` — manter proteção 401 em APIs, websockets e endpoints restritos
- `packages/host/frontend-static/tests/frontend-static.spec.ts` — validar entrega de shell público vs bloqueio de API
- `apps/web/src/lib/auth/protected-route.tsx` — confirmação de redirecionamento para `/login`

**Passos:**
1. Configurar no `frontend-static` a entrega do shell HTML estático limpo (sem boot graph injetado) quando a requisição for de documento SPA (`Accept: text/html` ou sem extensão) e anônima.
2. Manter a recusa 401 para todas as requisições de API, RPC, WebSocket e rotas restritas.
3. Testar comportamento no browser com cookies limpos e confirmar fluxo `/` → `/login`.
4. Testes automatizados: `pnpm vitest run packages/host/frontend-static packages/client/connection`.
5. Build host + client, apresentação do output, validação e commit: `feat(auth): servir shell público sem boot graph para visitantes e redirecionar ao login`.

---

### FASE 3 — Plans dentro do painel (CRÍTICO) 🔴

**Decisão confirmada (Opção a):**
- Criação de `AppFrame` autenticado próprio que reusa e importa o `SidebarRoot` do DSH.
- Utilização do slot nativo `sidebar.footer.action` do `SidebarRoot`.
- Ocupante do rodapé: botão "Plans" (acima de Settings) no rail/sidebar.
- A rota `/plans` roda encapsulada pelo `AppFrame` com `ProtectedRoute`, mantendo o sidebar perfeitamente visível e o dark theme institucional aplicado.

**Entregável:** botão "Plans" no sidebar acima de "Settings"; `/plans` renderiza dentro do layout do painel com sidebar e tema escuro institucional.

**Arquivos:**
- `apps/web/src/components/layout/AppFrame.tsx` — layout com o sidebar integrado
- `apps/web/src/main.tsx` — encapsular `/plans` dentro do `AppFrame`
- `apps/web/src/pages/billing/PlansPage.tsx` — dark theme nos cards Starter, Pro e Legend (#E7BF73 / #D8AE5F / #B0955E / #FBF0DA)
- `apps/web/src/pages/billing/billing.css` — estilos institucionais para billing
- `packages/client/ui-sidebar/src/client/*` — ocupante no slot `sidebar.footer.action` para acionar `/plans`

**Passos:**
1. Implementar o occupant do slot `sidebar.footer.action` com botão "Plans" (ícone + texto em modo aberto, ícone em modo rail).
2. Estruturar o `AppFrame` para que rotas como `/plans`, `/profile`, `BillingSuccessPage` e `BillingCancelPage` compartilhem a mesma casca e navegação lateral do painel.
3. Atualizar o CSS e os cards da `PlansPage` para o padrão visual escuro do CopyMonster.
4. Testes + builds host e client + validação + commit: `feat(billing): Plans integrado ao painel com sidebar e tema institucional`.

---

### FASE 4 — Profile + Logout (ALTO) 🔴

**Decisão confirmada:**
- Validação de WhatsApp em padrão **E.164 com entrada tolerante**: o usuário pode digitar com espaços, traços e parênteses; o frontend normaliza para `+5511999999999` antes de persistir, rejeitando somente números manifestamente inválidos com feedback claro e amigável.
- As colunas `full_name` e `whatsapp` já existem na tabela `public.users` (confirmado nas migrations 001, 003 e 005), dispensando migration desnecessária.

**Entregável:** rodapé do sidebar com avatar + nome + atalho de perfil e logout; página `/profile` dentro do painel para editar nome, WhatsApp e senha; logout funcional direcionando a `/login`.

**Arquivos:**
- `apps/web/src/pages/ProfilePage.tsx` — tela de perfil com formulário e dark theme
- `apps/web/src/lib/auth/auth.provider.tsx` — métodos `signOut()` e `updateProfile()`
- `packages/client/ui-sidebar/src/client/*` — ocupante de perfil/logout no slot `sidebar.footer.action`
- `apps/web/src/main.tsx` — rota `/profile` encapsulada no `AppFrame`

**Passos:**
1. Adicionar `signOut` e `updateProfile` no `auth.provider.tsx` atualizando `public.users`.
2. Criar `ProfilePage` integrada ao `AppFrame`: edição de nome, WhatsApp (com sanitização E.164) e alteração de senha via Supabase Auth.
3. Acoplar ao rodapé do sidebar o componente de usuário: avatar + nome + menu com "Perfil" e "Sair".
4. Testes + builds + validação + commit: `feat(profile): tela de perfil com sanitização E.164 e logout no sidebar`.

---

### FASE 5 — Nomes amigáveis de plugins (i18n en + zh em lockstep) (MÉDIO) 🟡

**Diretrizes obrigatórias de i18n:**
- O projeto adota estritamente `en` e `zh` em `packages/client/locale/src/locales/` (`en.ts`, `zh.ts`, `settings.ts`).
- **NÃO** criar `pt-br.ts` (o app suporta `en` e `zh`).
- As chaves nos dois arquivos DEVEM ser rigorosamente idênticas — garantido pelo TypeScript com `satisfies`.
- Alterações são feitas estritamente em **lockstep** em `en.ts` e `zh.ts`.

**Entregável:** plugins com nomes claros e descrições intuitivas em inglês no `en.ts` e equivalentes em chinês no `zh.ts`.

**Arquivos:**
- `packages/client/locale/src/locales/en.ts`
- `packages/client/locale/src/locales/zh.ts`
- Componentes de UI que renderizam a lista de plugins

**Passos:**
1. Mapear os identificadores técnicos de plugins (`hmr`, `llm`, `session`, etc.).
2. Adicionar chaves idênticas em `zh.ts` e `en.ts` com nomes claros e descrições funcionais.
3. Validar tipagem e checagem de paridade com `satisfies`.
4. Testes + builds + validação + commit: `feat(plugins): nomes e descrições amigáveis em en e zh em lockstep`.

---

### FASE 6 — Presets renomeados para o padrão Monster (en + zh em lockstep) (MÉDIO) 🟡

**Diretrizes obrigatórias de i18n:**
- No `en.ts`: utilizar a nomenclatura oficial Monster — "Standard Monster", "PTC Monster", "Minimal Monster", "Creator Monster", "SDR Monster" com descrições claras de uso.
- No `zh.ts`: tradução em chinês equivalente, preservando "Monster" como marca (ex.: `标准 Monster`, `PTC Monster`, `极简 Monster`, `创作者 Monster`, `SDR Monster`).
- Chaves rigorosamente idênticas entre `en.ts` e `zh.ts`.
- Sem arquivo `pt-br.ts`.

**Entregável:** presets padronizados sob a marca CopyMonster ("... Monster") com descrições compreensíveis em ambos os idiomas oficiais.

**Arquivos:**
- `packages/client/locale/src/locales/en.ts`
- `packages/client/locale/src/locales/zh.ts`
- `packages/client/ui-agent-preset/src/client/*`

**Passos:**
1. Localizar as entradas dos presets nos dicionários e metadados.
2. Atualizar em lockstep `en.ts` e `zh.ts` mantendo as chaves pareadas.
3. Garantir integridade dos identificadores de sessão existentes.
4. Testes + builds + validação + commit: `feat(presets): renomear presets para padrão Monster em en e zh em lockstep`.

---

### FASE 7 — Auth pages com cores institucionais (MÉDIO) 🟡

**Entregável:** `/login`, `/register`, `/forgot-password`, `/reset-password` na paleta institucional, sem resíduo azul DeepSeek.

**Arquivos:**
- `apps/web/src/auth.css`, `apps/web/src/auth-gate.css`
- `apps/web/src/pages/LoginPage.tsx`, `RegisterPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx` — só classes, sem lógica

**Passos:**
1. Inventariar todo literal de cor/gradiente que referencie azul antigo.
2. Aplicar a paleta #E7BF73 / #D8AE5F / #B0955E / #FBF0DA sobre fundo escuro consistente com o shell.
3. Checklist visual por página (botões, links, alertas de erro).
4. Testes + builds + output + validação + commit: `style(auth): paleta institucional nas páginas de autenticação`.

---

### FASE 8 — Wizard "Criar novo preset" (MÉDIO, por último) 🟡

**Entregável:** botão "Criar novo preset" com wizard guiado (nome, descrição, ferramentas permitidas, permissões, modelo base), gerando um preset `trust: user` no diretório do usuário.

**Arquivos:**
- `packages/client/ui-agent-preset/src/client/*` (novo componente Wizard)
- `packages/api/settings-controller/src/index.ts` — só se for preciso expor um RPC de criação (o `openAgentPresetDirectory` já existe; avalio primeiro reuso, sem alterar backend sem te mostrar o porquê)

**Passos:**
1. Mapear o formato exato de um preset em disco (o `dsh-agent-presets` com `includeUserRoot`).
2. Wizard em 4 passos: Identidade → Ferramentas → Permissões → Revisão/Criar.
3. Validação de schema antes de gravar; preset criado aparece na lista sem reiniciar.
4. Testes + builds + output + validação + commit: `feat(presets): wizard de criação de preset`.

---

## Parte D — Ordem de execução e pontos de decisão

| Fase | Entregável | Risco | Dependência |
|------|-----------|-------|-------------|
| 1 | Models carrega | Baixo (correção local no ui-settings) | — |
| 2 | Visitante vê login | Médio (muda gate do host) | — |
| 3 | Plans no painel | Baixo | Decisão de composição (a) ou (b) |
| 4 | Profile + Logout | Baixo | Fase 3 (mesmo slot do sidebar) |
| 5 | Nomes de plugins | Mínimo | — |
| 6 | Presets renomeados | Baixo | — |
| 7 | Auth com cores | Mínimo | — |
| 8 | Wizard de presets | Médio | Fase 6 |

## Parte E — Decisões Ratificadas

1. **i18n (Fases 5 e 6):**
   - Alterações em `en.ts` e `zh.ts` estritamente em lockstep.
   - Chaves 100% idênticas nos dois arquivos, validadas pelo TypeScript (`satisfies`).
   - Não criar `pt-br.ts`.
   - Nomenclatura Monster no `en.ts` ("Standard Monster", "PTC Monster", etc.) e equivalente no `zh.ts` mantendo a marca "Monster".
2. **Fase 2 (HTML público):**
   - Servir shell HTML estático do React sem `__DSH_BOOT__` (sem boot graph) para visitantes anônimos.
   - O React detecta ausência de auth e redireciona para `/login`.
   - Manter recusa 401 estrita para `/api/*`, SSE, WebSocket e rotas de dados.
3. **Fase 3 (Opção a):**
   - Layout `AppFrame` autenticado importando `SidebarRoot` do DSH.
   - Encaixe nativo via slot `sidebar.footer.action`.
   - `/plans` renderizado com sidebar visível e dark theme institucional.
4. **Fase 4 (WhatsApp E.164):**
   - Entrada tolerante no formulário, sanitização para formato internacional `+5511999999999` antes de salvar.
   - Rejeição amigável apenas de números manifestamente inválidos.

---

*Fim do plano. Nenhum arquivo do repositório foi modificado. Aguardando sua aprovação para iniciar a Fase 1.*
