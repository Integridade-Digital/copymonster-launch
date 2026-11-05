# FIX_AFFILIATE_UI_ERRORS — Diagnóstico e plano de correção

Data: 05/11/2026 · Escopo: frontend dos afiliados, Admin, aba Usage e sessão no subdomínio do tenant.
Este documento **não altera código**. Ficam fora do escopo, sem mudanças: Cloudflare Tunnel, migrations 052/053 e billing do Stripe.

Legenda: **Confirmado** = a causa aparece no código. **Hipótese** = provável, precisa ser verificada em produção pelos passos indicados.

---

## 1. Admin › Affiliate program: `Could not load affiliate data: [object Object]`

### Diagnóstico
- Arquivo: `apps/web/src/pages/admin/tabs/AdminAffiliates.tsx`
  - Linha ~10: `const errorText = (e: unknown) => e instanceof Error ? e.message : String(e)`
  - Linha ~37: `for (const r of [...]) if (r.error) throw r.error`
- **Confirmado (motivo do `[object Object]`):** o supabase-js devolve `PostgrestError` como **objeto simples** `{ message, code, details, hint }`, que não é instância de `Error`. Por isso `String(e)` gera `[object Object]` e a mensagem real se perde.
- **Hipótese (motivo da falha da consulta):** as 5 consultas usam `supabase.schema('affiliate')` / `.schema('finance')` direto pelo PostgREST. Possíveis causas, da mais para a menos provável:
  1. Os schemas `affiliate` e `finance` **não estão em "Exposed schemas"** da API do Supabase (Settings › API). O erro esperado nesse caso é `PGRST106 – The schema must be one of the following…`. Isso é configuração do projeto, não uma migration.
  2. Faltam `GRANT USAGE ON SCHEMA` / `GRANT SELECT` para `authenticated` (erro `42501 permission denied`).
  3. A RLS com `public.is_admin_or_owner()` retorna falso para o usuário admin do tenant `funnel`. Nesse caso o SELECT costuma voltar `[]` sem erro, então essa causa só explica uma lista vazia, não o erro.
- O mesmo defeito de formatação existe em `AffiliateSettings.tsx` (`getErrorMessage`, linha ~40).

### Solução passo a passo
1. Criar um helper compartilhado, por exemplo `apps/web/src/lib/error-text.ts`:
   - `Error` → `e.message`
   - objeto com `message` → `` `${message}${code ? ` (${code})` : ''}${hint ? ` – ${hint}` : ''}` ``
   - qualquer outro caso → `JSON.stringify(e)` com fallback para `String(e)`
2. Usar esse helper no lugar de `errorText` (AdminAffiliates) e de `getErrorMessage` (AffiliateSettings).
3. Em `load()`, registrar no console qual das 5 consultas falhou, para facilitar o diagnóstico.
4. Com a mensagem real visível, aplicar a correção que ela indicar:
   - `PGRST106` → adicionar `affiliate` e `finance` em Exposed schemas no painel do Supabase. É configuração, não migration.
   - `42501` → registrar a necessidade de um GRANT, que exige decisão à parte, já que as migrations 052/053 estão fora do escopo.
5. Opcional e mais robusto: carregar os dados do admin por RPCs `SECURITY DEFINER` já existentes ou por um endpoint `/api/admin/affiliate/*` no `auth-http`, no lugar de SELECT direto de tabelas.

### Plano de teste
- Entrar como admin em `funnel` › Admin › Affiliates: a mensagem mostra texto legível com código, ou a lista carrega.
- Executar no console: `await supabase.schema('affiliate').from('profiles').select('id').limit(1)` e confirmar `error === null`.
- Entrar como usuário comum: as abas do admin não aparecem, ou retornam lista vazia sem expor dados.

---

## 2. Settings › Affiliate: formulário KYC não aceita dados

### Diagnóstico
- Arquivo: `apps/web/src/pages/settings/AffiliateSettings.tsx` (linhas ~225–265).
- **Confirmado:** os inputs são controlados (`value` + `onChange`), sem `disabled` ou `readOnly`. O formulário só aparece depois de `loading=false` e quando `profile===null`. Portanto **não existe um `isLoading` infinito** que bloqueie os campos: enquanto carrega, aparece o spinner, não o formulário.
- **Confirmado:** o componente é renderizado dentro do shell DSH pelo slot `settings.affiliate.item` (`packages/client/ui-settings-general/src/client/AffiliateSection.tsx` e `index.ts` linhas ~62 e ~235). O shell do DSH tem atalhos de teclado globais e foco gerenciado pelo composer e pelos modais.
- **Hipótese A (mais provável):** um listener global de `keydown` do shell (atalhos ou composer) captura e cancela (`preventDefault`) as teclas antes que cheguem ao input do modal de Settings. O sintoma típico é: o campo recebe foco mas não aceita texto.
- **Hipótese B:** uma camada sobreposta (overlay ou máscara com `pointer-events`) ou um `z-index` do CSS module bloqueia o clique. Note que o `<form>` reutiliza `className={css.page}`.
- **Hipótese C (contexto do tenant):** no subdomínio `campaign.copymonster.co`, a sessão Supabase fica no `localStorage` **por origem**. Se não houver sessão nesse subdomínio, `supabase.auth.getUser()` falha. O usuário vê o formulário com um erro em cima, e o submit falha com `loginRequired`, o que parece "não aceita dados". O código não usa `tenantId`: o RPC `register_profile` deriva o usuário de `auth.uid()`, então o contexto de tenant **não** é a causa.

### Solução passo a passo
1. Reproduzir no tenant `campaign` com o DevTools aberto: clicar no campo e digitar.
   - Se o campo não recebe foco → Hipótese B: inspecionar com "Elements › Computed › pointer-events / z-index" o elemento sobre o input e corrigir no CSS module.
   - Se recebe foco mas não aceita texto → Hipótese A: em `Event Listeners › keydown`, achar o handler do shell e fazer com que ignore eventos cujo `target` seja `input`, `textarea`, `select` ou `[contenteditable]`. Como alternativa local, adicionar `onKeyDown={e => e.stopPropagation()}` no `<form>` do KYC.
2. Hipótese C: no início do `load()`, verificar `supabase.auth.getSession()`. Se não houver sessão no subdomínio, mostrar um aviso claro ("Faça login novamente") com link para `app.copymonster.co`, no lugar do formulário.
3. Aplicar o helper de erro da seção 1 para que falhas de RPC fiquem legíveis.
4. Validação: manter `required`. Adicionar validação de CPF/CNPJ (somente dígitos, 11 ou 14) antes do RPC, com mensagem i18n.

### Plano de teste
- No `campaign`: digitar em todos os campos, marcar os termos e enviar → aparece "affiliate.register.success" e o status KYC `PENDING`.
- Repetir em `funnel` e no domínio principal.
- Abrir em uma aba anônima direto no subdomínio, sem sessão → aparece a mensagem de reautenticação, não um formulário "travado".

---

## 3. Settings › Usage: `client api: settings/getTenantMetrics expected 1 argument(s), got 0`

### Diagnóstico — Confirmado
- Servidor: `packages/api/settings-controller/src/index.ts` linha ~297–298:
  `@RemoteScope('auth', 'getTenantMetrics') async getTenantMetrics(request?: { tenantId?: string })`. O descriptor RPC registra **1 parâmetro**, mesmo sendo opcional.
- Gateway: `packages/api/gateway/src/client/index.ts` linhas ~508–516 (`prepareInvocation`) exige `values.length === descriptor.parameters.length`. Opcionalidade em TypeScript não conta.
- Cliente: `packages/client/ui-settings-models/src/client/index.ts` linha ~111:
  `await ctx.remote.settings.getTenantMetrics()` → envia **0** argumentos e dispara o erro.
- O argumento faltante é o objeto `request` (`{ tenantId?: string }`). Na aba Usage ele deve ser **vazio**: o servidor resolve o tenant pela identidade autenticada (`getAuthIdentity(ctx).tenantId`). Não é preciso tirar `tenantId` de props ou rota.

### Solução passo a passo
1. Em `ui-settings-models/src/client/index.ts` (~111), trocar por `ctx.remote.settings.getTenantMetrics({})`. O gateway ignora valores `undefined`, então `getTenantMetrics(undefined)` também funciona.
2. Procurar outras chamadas remotas com parâmetro opcional chamadas sem argumento (`grep -rn "remote\.settings\.\w*()" packages/client`) e corrigir do mesmo jeito.
3. Opcional: adicionar um teste em `ui-settings-models` que verifique que o load chama `getTenantMetrics` com 1 argumento.

### Plano de teste
- Settings › Usage em `campaign` e `funnel`: aparecem plano, trial e consumo, sem erro.
- `pnpm run test` em `packages/client/ui-settings-models` e `packages/api/settings-controller` passa.

---

## 4. Inconsistência visual: modal Admin × modal Settings

### Diagnóstico
- `apps/web/src/components/layout/AdminModal.tsx` (linhas ~12 e ~63–100) usa estrutura e CSS próprios: `FooterActionsRoot.module.css` com `overlay`, `mask`, `panel`, `navRail`, `railCell`, `railIcon` com emoji e `contentArea`.
- O Settings é renderizado pelo shell `packages/client/ui-settings-general/src/client/SettingsRoot.tsx` + `SettingsRoot.module.css` / `chrome.module.css` / `GeneralSection.module.css`, com tokens próprios: navegação lateral sem emoji, cabeçalho, espaçamento e tipografia do shell.
- As abas novas usam ainda outros módulos (`AdminAffiliates.module.css`, `AffiliateSettings.module.css`). Resultado: três sistemas visuais diferentes.
- Divergências principais: ícones emoji na nav do Admin (linha ~46 e ~89, incluindo `'🤝'` em `affiliates`), dimensões e raio do painel, cabeçalho e padding do conteúdo, e cores fora dos tokens de `apps/web/src/cm-theme.css`.

### Solução passo a passo
1. Abrir os dois modais lado a lado e anotar no DevTools os valores calculados do Settings: largura e altura do painel, `border-radius`, largura da nav, padding do conteúdo, fonte e tamanho do título, cor de fundo e borda.
2. Alterar `FooterActionsRoot.module.css` (só as classes do AdminModal) para usar as mesmas variáveis CSS de `cm-theme.css` e os mesmos valores do `SettingsRoot.module.css`/`chrome.module.css`. A opção preferida é importar ou compor essas classes, em vez de duplicar valores.
3. Remover o `icon` emoji das abas do Admin (array `tabs`, linha ~40–46) e o `<span className={css.railIcon}>`, ou trocar por ícones SVG iguais aos do Settings.
4. Alinhar `AdminAffiliates.module.css` aos estilos de tabela, botão e input usados em `AffiliateSettings.module.css`, para que as duas telas compartilhem a mesma base.

### Plano de teste
- Comparar capturas de tela do Admin e do Settings no desktop (1440px) e no mobile (390px), nos temas claro e escuro: painel, nav, cabeçalho e espaçamentos idênticos.
- Rodar `apps/web/tests` (Playwright) e conferir que não há regressão.

---

## 5. Emoji no título "🤝 Programa de afiliados"

### Diagnóstico — Confirmado
- O emoji está **hardcoded no JSX**, não no i18n: `apps/web/src/pages/settings/AffiliateSettings.tsx` linha **223**:
  `<h2 className={css.title}>🤝 {t('affiliate.title')}</h2>`
- Também aparece como ícone da aba no Admin: `apps/web/src/components/layout/AdminModal.tsx` linha **46** (`icon: '🤝'`).

### Solução
1. Linha 223: trocar por `<h2 className={css.title}>{t('affiliate.title')}</h2>`.
2. Rodar `grep -rn "🤝" apps/web/src/locales packages/client/*/src/client/locales.ts` e confirmar que nenhuma tradução (`en/pt/zh/es`) contém o emoji. Se alguma contiver, remover.
3. AdminModal linha 46: remover junto com o item 4.3.

### Teste
- Settings › Affiliate nos 4 idiomas: o título aparece sem emoji.

---

## 6. Bug crítico: workspace/chat não abre após inatividade, com 404 no subdomínio

### Diagnóstico — o que o código mostra
Orquestrador (`copymonster-dsh-server-login/src/supervisor/proxy.ts`):
- Linha ~151: `unknown_user` → **404**. Linha ~166: `endpointFor()` sem instância `running` → `{ error: 'not_running', code: 404 }`.
- Linhas ~305–330: o auto-launch com a página "launching" só acontece em condições específicas. Quando `access.error === 'reauthentication-required'` e a requisição é GET de HTML, há um redirecionamento 302 para `mainAppUrl`. **Em qualquer outro caso de erro** a resposta é JSON cru com o código (`reply.code(access.code).send({ error })`). É isso que o usuário vê como "404" ao atualizar a página.
- Isso explica por que "só volta ao acessar o app principal": o app refaz o SSO (`/api/auth/session-token`), renova o cookie `sid` e dispara o launch do tenant.

### Pontos de falha prováveis (hipóteses, por ordem)
1. **A instância DSH do tenant parou durante a inatividade** (crash, reap de escopo ou restart do orquestrador — ver commits `b66fc5c` e `378d938`). O status deixa de ser `running` e o proxy devolve `not_running` 404 em vez de relançar ou mostrar a página "launching".
2. **Expiração de sessão:** o `cm_session`/`sid` ou a linha em `sessions` expira, ou a identidade assinada (TTL de 5 min, `IDENTITY_TTL_MS`) não é reassinada em uma reconexão WebSocket longa. O resultado é `unknown_user` (404) em vez de `reauthentication-required` (302).
3. **Frontend do tenant:** a sessão Supabase no `localStorage` do subdomínio expira (access token de 1h). Se `autoRefreshToken` não estiver ativo, ou o refresh token não existir nessa origem, as chamadas com `Authorization: Bearer` falham. O WebSocket do workspace cai e a UI não tenta reconectar nem reautenticar: o chat "não abre".
4. **Handler de workspace:** depois do 401/404, a UI do workspace (`packages/client/ui-workspace`, `ui-conversation`) fica em estado de erro sem retry. Os commits recentes `fd5a06fc6b` e `d7a665bc36` mexeram nesse fluxo de carregamento.

### Solução passo a passo (sem tocar no Cloudflare)
1. **Orquestrador, `proxy.ts`:** para GET de navegação (`accept: text/html`):
   - `not_running` → disparar `supervisor.launch` e responder com `getLaunchingHtml()`, como o auto-launch já faz, em vez de 404 JSON.
   - `unknown_user` ou sessão expirada → tratar como `reauthentication-required` e responder 302 para `mainAppUrl?return=<subdomínio>`.
2. **App principal:** após o login/SSO, respeitar o `return` (com validação contra a lista de subdomínios do próprio usuário) e voltar automaticamente ao tenant.
3. **Frontend do tenant:**
   - Confirmar em `apps/web/src/lib/supabase/client.ts` que `autoRefreshToken: true` e `persistSession: true` estão ativos.
   - Ao detectar 401/403/404 em chamadas `/api/*` ou o fechamento do WebSocket, tentar `supabase.auth.refreshSession()` + reconectar. Se falhar, redirecionar para `app.copymonster.co` (fluxo SSO).
   - No `visibilitychange` (aba volta a ficar visível), checar `/api/dsh/status` e a sessão antes de reabrir o workspace.
4. **UI de workspace:** adicionar estado "reconectando" com retry e backoff, em vez de deixar a falha permanente.
5. **Observabilidade:** registrar no orquestrador o motivo (`not_running`, `unknown_user`, `reauthentication-required`) e o `user.id` em cada 404/302, para confirmar qual hipótese ocorre em produção.

### Plano de teste
- Abrir o workspace em `campaign`, deixar inativo por mais de 1h (ou forçar com `kill` do processo do tenant ou apagando a linha da sessão) e depois:
  - atualizar a página → aparece a tela "launching" e o workspace reabre, **ou** há redirecionamento ao login e retorno automático ao `campaign`. Nunca um 404 JSON.
  - sem atualizar, enviar mensagem no chat → a UI reconecta sozinha ou pede reautenticação.
- Conferir nos logs do orquestrador o motivo registrado.

---

## Resumo

| # | Problema | Causa | Status |
|---|---|---|---|
| 1 | `[object Object]` no Admin | `PostgrestError` não é `Error`; falha real provavelmente nos schemas expostos ou nos grants | Formatação confirmada; causa da query é hipótese |
| 2 | KYC não aceita dados | Não é loading nem tenantId; provável captura de teclado ou overlay do shell, ou sessão ausente no subdomínio | Hipótese, com passos para isolar |
| 3 | `getTenantMetrics expected 1` | Chamada sem argumento em `ui-settings-models/index.ts:111` | Confirmado |
| 4 | Admin diferente do Settings | CSS próprio (`FooterActionsRoot.module.css`) e nav com emoji | Confirmado |
| 5 | Emoji no título | Hardcoded em `AffiliateSettings.tsx:223` (e `AdminModal.tsx:46`) | Confirmado |
| 6 | 404 após inatividade | Proxy devolve 404 JSON para `not_running`/`unknown_user`; sem reconexão no frontend | Mecanismo confirmado; gatilho é hipótese |
