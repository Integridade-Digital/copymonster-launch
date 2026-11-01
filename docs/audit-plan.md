# Auditoria CopyMonster — Causas Raiz e Plano de Correção

**Repositório:** `Integridade-Digital/copymonster-launch` · **Commit auditado:** HEAD de `master` em 01/11/2026 · **Estado:** auditoria concluída, sem alterações de código ou deploy · **Escopo:** causas raiz, ficheiros e linhas, correção passo a passo e esforço

---

## 1. Sumário executivo

| # | Problema | Gravidade | Causa raiz confirmada |
|---|---|---|---|
| 1 | Novo usuário não entra no subdomínio e vê a página de login outra vez | P0 | Base domain e cookie domain do orquestrador errados; contratos de cookie diferentes (`cm_session` vs `sid`); login só chama o app principal; falta guarda de subdomínio após confirmação |
| 2 | Plataforma ainda mostra “DSH” | P1 | Textos de locale do shell e do Admin ainda usam “DSH” em 7 pacotes |
| 3 | Monster DNA desapareceu de “Predefinições do agente” | P0 | O preset `brand-positioning-monster` foi apagado na migração upstream “feat(preset): declare Agent compositions in profile YAML (#4569)” e não foi recriado no novo formato de patch |
| 4 | Gates de Models e do seletor usam role em vez de `isAdmin` | P1 | Regressão do commit “feat(auth): restrict model selector and settings models to admin roles”: `role === 'owner' \|\| 'admin'` expõe superfícies de admin a qualquer owner de tenant e não separa Models (BYOK) de Admin > LLM Providers |
| 5 | Botão do plug-in de áudio na aba Plug-ins não funciona | P1 | Causa ainda não reproduzida; perfil por usuário não inclui o bundle de voz e `enablePatch` está desligado |
| 6 | Idioma escolhido no CopyMonster não chega ao shell DSH e traduções divergem | P2 | Dois sistemas de locale independentes; nomes dos presets divergem entre os 8 idiomas |
| 7 | Instalação de plugin não está isolada por usuário | P0 | O orquestrador arranca o `dsh` global sem o bundle CopyMonster, sem patch e com perfil `web` vazio; o app partilhado instala no `~/.dsh` do root |

**Achado transversal mais grave:** o orquestrador multi-tenant executa `/usr/local/bin/dsh` (`0.2.1-rc.2`, sem bundle CopyMonster) com `DSH_HOME` por usuário, mas sem `--patch` e sem seed de perfil. Cada subdomínio arranca um DSH genérico, não o produto CopyMonster. Isto bloqueia os problemas 1, 3, 5 e 7 ao mesmo tempo.

---

## 2. Evidências verificadas

- A migração `043_tenant_slug_signup.sql` está aplicada: `is_tenant_slug_available('zz-audit-check-123')` devolve `true`; o tenant mais recente é `enois`, criado em `2026-11-01T18:27:48` para `adrianogrowthhacking@gmail.com`.
- O trigger `handle_new_user()` cria o tenant pessoal e o papel `owner` corretamente (`supabase/migrations/043_tenant_slug_signup.sql:17-105`).
- A base SQLite do orquestrador (`/var/lib/dsh-server-login/server-login.db`) só tem `eusouadrianovieira@gmail.com`, `integridade.digital@gmail.com`, `CopyMonster` e `admin`; não existe linha para `enois`.
- `enois.copymonster.co` resolve e devolve HTTP 200, mas entrega a página de login do orquestrador.
- O orquestrador está a correr com `DSH_SERVER_LOGIN_BASE_DOMAIN=app.copymonster.co` e `DSH_SERVER_LOGIN_COOKIE_DOMAIN=.app.copymonster.co` (`/etc/dsh-server-login.env:6-7`).
- `parseSubdomain('enois.copymonster.co', 'app.copymonster.co')` devolve `null`; o host não termina em `.app.copymonster.co` (`/opt/copymonster/dsh-server-login/src/supervisor/proxy.ts:55-63`).
- O app principal emite o cookie `cm_session` (`packages/util/constants/src/index.ts:22`) com domínio `.app.copymonster.co` (`packages/api/auth-http/src/session-token.ts:95` e `.env:16`).
- O orquestrador lê o cookie `sid` e exige as claims `u,s,n,jti,iat` (`/opt/copymonster/dsh-server-login/src/web/middleware/authn.ts:31-41` e `src/web/session-cookie.ts:24-40`).
- `LoginPage` chama apenas `/api/auth/session-token` do app principal e redireciona para `https://<slug>.copymonster.co/` (`apps/web/src/pages/LoginPage.tsx:29-48`); nunca chama o endpoint SSO do orquestrador.
- O orquestrador já tem o endpoint `POST /api/auth/session-token` que troca o JWT Supabase, cria a linha em `users` e emite `sid` (`/opt/copymonster/dsh-server-login/src/web/routes/auth.ts:160-220`).
- O orquestrador arranca `/usr/local/bin/dsh` (`/etc/dsh-server-login.env`, `DSH_SERVER_LOGIN_DSH_BIN`) com `--profile web`, `HOME=<ws>` e `DSH_HOME=<home>` (`src/supervisor/orchestrator.ts:177-234`).
- `DSH_SERVER_LOGIN_ENABLE_PATCH` não está definido; o default é `false` (`src/config.ts:143` e `:254`), portanto o patch do runtime e a seleção de plugins por pasta nunca são injetados (`src/supervisor/orchestrator.ts:216`).
- Os homes por usuário existentes estão vazios (sem `profiles/web/package.json`), pelo que o primeiro arranque cria o template `web` apenas com `@deepseek-ai/dsh-base` e `@deepseek-ai/dsh-web-app` (`packages/util/official-bundles/src/bundles.ts:10-20`).
- O `dsh` global instalado é `0.2.1-rc.2` e não depende de nenhum pacote CopyMonster.
- O preset `brand-positioning-monster` existe no backup pré-sync, mas foi removido no commit upstream “feat(preset): declare Agent compositions in profile YAML (#4569)”.
- `apps/web/src/components/dna/installDnaOnboarding.ts:17` ainda referencia `brand-positioning-monster`, mas nenhum pacote o declara; `agentPresets.select` recusa a seleção.
- O commit “feat(auth): restrict model selector and settings models to admin roles” repôs o gate de admin no seletor e em Settings > Models; o commit anterior “fix(web): make Settings Models creator BYOK for every user” tinha aberto o Models como BYOK para todos.
- O perfil partilhado `.dsh/profiles/web/package.json` inclui `@deepseek-ai/dsh-experimental-voice-input-bundle`, mas o perfil criado por usuário não.
- O sistema de locale do app (`apps/web/src/locales`) só tem `en`, `zh` e `pt`, guarda `dsh_locale`/`locale` no `localStorage` (`apps/web/src/locales/index.ts:8-34`); o locale do shell guarda `locale.preference` no documento de settings do Host (`packages/client/locale/src/locale-settings.ts`).
- O bundle de voz regista o botão de configuração via `ctx.get('pluginNavigation')?.openBundle('@deepseek-ai/dsh-experimental-voice-input-bundle')` (`packages/experimental/client-ui-voice-input/src/client/mount.ts:29-38`).

---

## 3. Problema 1 — Novo usuário não entra no subdomínio

### 3.1 Sintoma

O registo cria o tenant com slug correto, mas após a confirmação de email o criador continua em `app.copymonster.co`. Ao tentar `enois.copymonster.co`, recebe a página de login do orquestrador em vez do workspace. Em alguns casos o login no app principal devolve a mensagem de sessão isolada falhada e volta para `/`.

### 3.2 Causa raiz

1. O orquestrador está configurado com a base domain errada. `enois.copymonster.co` não é reconhecido como subdomínio de `app.copymonster.co`; a condição `name.endsWith('.' + baseDomain)` falha.
2. O cookie do app principal é `cm_session` com domínio `.app.copymonster.co`; não é enviado a `*.copymonster.co` e não é o cookie `sid` que o orquestrador valida.
3. O `LoginPage` troca o JWT Supabase apenas no app principal. O endpoint SSO do orquestrador, que criaria a linha em `users` e emitiria `sid`, nunca é chamado.
4. Não existe guarda pós-registo/pós-confirmação. Só o `LoginPage` redireciona; um usuário já autenticado que aterra em `/` continua no app principal.
5. O orquestrador não tem linha para `enois`, porque o provisionamento SSO só acontece no endpoint que o browser não chama.

### 3.3 Ficheiros afetados

- `apps/web/src/pages/LoginPage.tsx:29-48`
- `apps/web/src/pages/RegisterPage.tsx:107-125`
- `apps/web/src/lib/auth/host-boot.ts` e `apps/web/src/main.tsx` (boot autenticado)
- `packages/api/auth-http/src/session-token.ts:95,352-358`
- `packages/util/constants/src/index.ts:22`
- `.env:16`
- `/etc/dsh-server-login.env:6-7` (configuração de deploy, não alterar sem aprovação)
- `/opt/copymonster/dsh-server-login/src/supervisor/proxy.ts:55-63,107-130`
- `/opt/copymonster/dsh-server-login/src/web/routes/auth.ts:160-220`
- `/opt/copymonster/dsh-server-login/src/web/middleware/authn.ts:31-41`

### 3.4 Solução passo a passo

1. Corrigir a configuração do orquestrador: `DSH_SERVER_LOGIN_BASE_DOMAIN=copymonster.co` e `DSH_SERVER_LOGIN_COOKIE_DOMAIN=.copymonster.co`. Esta alteração é de deploy; fica listada para aplicação posterior, não será aplicada nesta fase.
2. Alinhar o domínio do cookie do app principal: `SESSION_COOKIE_DOMAIN=.copymonster.co` em `.env`, mantendo `HttpOnly`, `Secure` e `SameSite=Lax`.
3. Fazer o login trocar a sessão no orquestrador. A opção recomendada é chamar o endpoint existente `POST https://<slug>.copymonster.co/api/auth/session-token` com `{ supabaseJwt }` e `credentials: 'include'`; o orquestrador valida o JWT no app principal, cria/liga o usuário e emite `sid` em `.copymonster.co`.
4. Se o browser bloquear o POST cross-origin, adicionar CORS restrito a `https://app.copymonster.co` no orquestrador ou relay server-side no app principal que devolve o `Set-Cookie` do orquestrador.
5. Usar o `redirectUrl` devolvido pelo orquestrador em vez de construir a URL no cliente.
6. Adicionar guarda de subdomínio no boot autenticado: quando o host é `app.copymonster.co`, o perfil tem `tenant.slug` e a rota não é pública nem de admin da plataforma, redirecionar para `https://<slug>.copymonster.co/`. Excluir `/login`, `/register`, `/auth/*`, `/admin/*` e callbacks.
7. Garantir que o link de confirmação do Supabase aterra numa rota que executa a guarda e a troca de sessão.
8. Criar uma rotina idempotente de provisionamento para usuários existentes sem linha no orquestrador; executar apenas com aprovação e sem apagar dados.

### 3.5 Testes e verificação

- Unitário: `parseSubdomain('enois.copymonster.co', 'copymonster.co') === 'enois'` e rejeição de `app.copymonster.co`.
- Integração: login de usuário confirmado cria linha em `users`, emite `sid` com domínio `.copymonster.co` e redireciona para o subdomínio.
- Manual: registo novo, confirmação de email, abertura de `https://<slug>.copymonster.co/`, recarregar a página e confirmar que a sessão persiste.
- Regressão: admin da plataforma continua a conseguir abrir `app.copymonster.co/admin` sem ser redirecionado.

### 3.6 Esforço

Médio (6 a 10 horas), incluindo CORS/relay, guarda de rotas e testes de integração.

---

## 4. Problema 2 — Rebranding “DSH” para “CopyMonster”

### 4.1 Causa raiz

Os dicionários de locale do shell e de pacotes experimentais ainda usam “DSH” em textos visíveis. As referências técnicas (`@deepseek-ai/dsh-*`, `__DSH_AUTH__`, `DSH_HOME`, nomes de variáveis) não devem ser alteradas.

### 4.2 Ocorrências confirmadas

| Ficheiro | Ocorrências | Exemplos |
|---|---:|---|
| `packages/client/ui-plugin-manager/src/client/locales.ts` | 111 | “This plugin ships with DSH”, “DSH could not compare…” |
| `packages/experimental/client-ui-voice-input/src/client/locales.ts` | 56 | “machine running DSH”, “downloadAdvice.*” |
| `packages/client/ui-plugin-market/src/client/locales.ts` | 32 | “Provided by DSH”, “incompatible with DSH {runtime}” |
| `packages/client/ui-entry-customization/src/client/locales.ts` | 24 | “Create a DSH plugin…” |
| `packages/experimental/client-ui-plugin-recommendations/src/client/locales.ts` | 16 | “Update DSH and retry” |
| `packages/client/ui-model-selection/src/client/locales.ts` | 8 | “another running DSH instance” |
| `packages/experimental/client-ui-creation-recommendations/src/client/locales.ts` | 7 | “Restart DSH to apply it” |
| `apps/web/src/pages/admin/tabs/AdminSystemTab.tsx:431` | 1 | “DSH Web Frontend” |

### 4.3 Solução passo a passo

1. Substituir “DSH” por “CopyMonster” apenas nos textos de produto: “CopyMonster plugin”, “CopyMonster Web”, “reiniciar o CopyMonster”, “incompatível com o CopyMonster {runtime}”.
2. Manter sem alteração: nomes de pacotes, imports, variáveis de ambiente, chaves de settings, nomes de providers de modelo (`DeepSeek Account`) e metadados de plugins de terceiros.
3. Atualizar os 8 idiomas de cada dicionário (`en`, `zh`, `ja`, `es`, `fr`, `de`, `ru`, `pt`), preservando placeholders.
4. Adicionar um teste que falhe se um dicionário de produto contiver `\bDSH\b` fora de uma allowlist técnica.
5. Atualizar snapshots de UI que contenham os textos alterados.

### 4.4 Esforço

Médio (4 a 6 horas), sobretudo revisão de traduções e snapshots.

---

## 5. Problema 3 — Monster DNA desapareceu

### 5.1 Causa raiz

O commit upstream “feat(preset): declare Agent compositions in profile YAML (#4569)” substituiu as composições de preset em `packages/preset/agent-presets/` por declarações YAML em `packages/bundle/web-app/presets/*.patch.yml`. A migração levou apenas `standard`, `ptc`, `minimal` e `cordis`; o preset `brand-positioning-monster` foi apagado e não foi recriado. O código de onboarding continua a pedir `brand-positioning-monster`, pelo que a seleção é recusada e o fluxo de DNA não inicia.

### 5.2 Ficheiros afetados

- `apps/web/src/components/dna/installDnaOnboarding.ts:17,184`
- `packages/preset/agent-preset-registry/src/display.ts:12-44`
- `packages/client/ui-agent-preset/src/client/locales.ts`
- `packages/bundle/copymonster/package.json` (`dsh.bundle.patch` é uma string)
- `packages/bundle/copymonster/cordis.patch.yml`
- `packages/host/positioning-injection/` (já existe)
- Backup de referência: `packages/preset/agent-presets/presets/brand-positioning-monster/agent.cordis.yml` e `preset.yml` no branch `backup-pre-sync-20261027`

### 5.3 Solução passo a passo

1. Criar `packages/bundle/copymonster/presets/brand-positioning-monster.patch.yml` com uma declaração `@deepseek-ai/dsh-agent-preset`:
   - `id: brand-positioning-monster`
   - `order: 0`
   - `plugins`: `persona` com o prefixo do backup, `tool-ask-user` e `positioning-injection`.
2. Alterar `packages/bundle/copymonster/package.json` para `dsh.bundle.patch: ["./cordis.patch.yml", "./presets/brand-positioning-monster.patch.yml"]`.
3. Registar o nome e a descrição localizados: adicionar `presetBrandPositioningName` e `presetBrandPositioningDescription` em `BuiltInPresetCopyKey`, em `BUILT_IN_PRESET_KEYS` e nos 8 dicionários de `ui-agent-preset`. Sem isto, o preset aparece como texto não traduzido.
4. Confirmar que `@deepseek-ai/dsh-host-positioning-injection` é dependência do bundle e que a linha continua ativa no `cordis.patch.yml`.
5. Garantir que o preset existe no perfil que cada usuário arranca. Isto depende do problema 7; sem o bundle CopyMonster no perfil por usuário, o preset não aparece no subdomínio.
6. Testar: o registry lista `brand-positioning-monster`; o onboarding seleciona o preset sem recusa; `My DNA` abre; uma sessão com `positioningMappingId` recebe o bloco `POSITIONING CONTEXT`.

### 5.4 Esforço

Médio (4 a 8 horas), incluindo traduções e teste de onboarding.

---

## 6. Problema 4 — Gates de Models e do seletor de modelos

### 6.1 Causa raiz

O commit “feat(auth): restrict model selector and settings models to admin roles” repôs gates que o commit anterior “fix(web): make Settings Models creator BYOK for every user” tinha removido. A verificação trata `role === 'owner'` e `role === 'admin'` como admin de plataforma, mas cada criador é `owner` do próprio tenant pessoal. O resultado depende do valor de `role` no JWT: quando é `owner`, qualquer criador vê o seletor e Settings > Models; quando não é, criadores legítimos perdem o Models. Em ambos os casos a regra do roadmap não é respeitada: Settings > Models é BYOK do criador, enquanto Admin > LLM Providers é a superfície restrita ao operador da plataforma.

### 6.2 Ficheiros afetados

- `packages/client/ui-model-selection/src/client/index.ts:112-122,154,200`
- `packages/client/ui-settings-models/src/client/index.ts:60-70,111,148-157`
- `apps/web/src/main.tsx:39-107` (publicação de `__DSH_AUTH__`)
- `apps/web/src/lib/auth/platform-admin.ts`
- `apps/web/src/components/layout/AdminModal.tsx:46-56` (Admin da plataforma, deve continuar restrito)

### 6.3 Solução passo a passo

1. Remover `role === 'owner'` e `role === 'admin'` dos gates de Models e do seletor. A única fonte de admin de plataforma é `__DSH_AUTH__.isAdmin === true`, resolvida de `users.metadata.is_admin`.
2. Manter Settings > Models visível para todos os criadores como BYOK; manter o seletor de modelos disponível para toda sessão que não seja subagente endereçado. Isto responde à dúvida do pedido: estes dois não devem ser apenas admin.
3. Manter `Admin → LLM Providers` e as restantes abas de Admin atrás de `isPlatformAdmin` (tenant master), que é a superfície que deve ser apenas admin.
4. Atualizar testes: criador comum vê Models e o seletor; owner de tenant sem `is_admin` vê; admin vê; subagente endereçado continua bloqueado.
5. Atualizar o roadmap ou o comentário que documenta a regra, para não voltar a introduzir o gate por role.

### 6.4 Esforço

Pequeno a médio (2 a 4 horas), com testes de permissão.

---

## 7. Problema 5 — Botão do plug-in de áudio

### 7.1 Estado da investigação

A causa exata ainda não foi reproduzida. O bundle de voz está ativo no perfil partilhado, a UI regista o microfone no composer e o cartão na aba Plug-ins, e não há erros de `speech`/`voice` no `journalctl`. Três hipóteses permanecem:

1. O perfil por usuário (subdomínio) não inclui `@deepseek-ai/dsh-experimental-voice-input-bundle`; nesse DSH não existe botão de áudio.
2. No app partilhado, o botão “Abrir detalhes” chama `ctx.get('pluginNavigation')?.openBundle(...)`; se o serviço de navegação não estiver ativo, a chamada é silenciosamente ignorada.
3. O botão “Preparar” descarrega o modelo SenseVoice para `speech-to-text/sensevoice`; falhas de rede, permissões ou caminho por usuário podem deixar o botão sem feedback visível.

### 7.2 Ficheiros afetados

- `packages/experimental/client-ui-voice-input/src/client/mount.ts:29-38`
- `packages/experimental/client-ui-voice-input/src/client/VoiceInput.tsx:163`
- `packages/experimental/client-ui-voice-input/src/client/VoiceSetupPrompt.tsx:35`
- `packages/experimental/client-ui-voice-input/src/client/PreparationCard.tsx`
- `packages/experimental/client-ui-voice-input/src/client/readiness.ts`
- `packages/experimental/voice-input-bundle/cordis.patch.yml`
- `.dsh/profiles/web/package.json:16`
- `/opt/copymonster/dsh-server-login/src/supervisor/orchestrator.ts:211-217`

### 7.3 Solução passo a passo

1. Reproduzir com o botão exato: microfone do composer, cartão da aba Plug-ins ou “Preparar”. Registar consola do browser, pedidos `/api/speech/*` e `journalctl -u dsh-orchestrator -u copymonster`.
2. Se o problema for o perfil por usuário, incluir o bundle de voz no seed do perfil CopyMonster (problema 7).
3. Se for `pluginNavigation`, tornar a dependência explícita e mostrar o botão apenas quando o serviço existir; caso contrário, apresentar uma mensagem em vez de um clique sem efeito.
4. Se for a preparação local, mostrar o erro real no cartão e no modal, incluindo origem do download, código HTTP e caminho de destino; garantir permissões no `DSH_HOME` do usuário.
5. Adicionar testes de `openBundle`, de falha de preparação e de isolamento do modelo por usuário.

### 7.4 Esforço

Pequeno se for perfil (1 a 2 horas); médio se for download/runtime (4 a 8 horas). Requer 30 minutos de reprodução antes de estimar a correção.

---

## 8. Problema 6 — Idioma e traduções

### 8.1 Causa raiz

Existem dois sistemas independentes:

- `apps/web/src/locales` usa `localStorage` (`dsh_locale` e `locale`) e só tem `en`, `zh` e `pt`.
- O shell DSH guarda `locale.preference` no documento de settings do Host e tem 8 idiomas.

Alterar o idioma no app não escreve a preferência do shell, e alterar no shell não atualiza o app. Além disso, os nomes dos presets divergem: inglês e chinês usam “Monster”; japonês, espanhol, francês, alemão, russo e português usam “Modo/Mode”; o português tem “modo PTC” em minúscula e o `nav` “Predefinições de agente” em vez de “Predefinições do agente”.

### 8.2 Ficheiros afetados

- `apps/web/src/locales/index.ts:8-34`
- `apps/web/src/locales/LocaleContext.tsx`
- `packages/client/locale/src/locale-settings.ts`
- `packages/client/locale/src/client/index.ts:245-260`
- `packages/client/ui-agent-preset/src/client/locales.ts:38-365`
- `packages/client/ui-agent-preset/src/client/guide-locales.ts`

### 8.3 Solução passo a passo

1. Escolher uma fonte de verdade. Recomendado: quando `setActiveLocale` corre no app, escrever também `locale.preference` no settings do Host através do remote/config form; e subscrever `locale/change` para atualizar o app.
2. Enquanto a ponte não existe, fazer o shell ler `localStorage.locale` como fallback provisional, para o idioma escolhido sobreviver ao reload.
3. Alinhar os 8 dicionários com um glossário único: “Standard Monster”, “PTC Monster”, “Minimal Monster”, “Creator mode”; `nav` “Agent presets” / “Predefinições do agente”.
4. Corrigir maiúsculas e placeholders; garantir que todas as chaves existem nos 8 idiomas.
5. Adicionar teste de paridade de chaves e de termos de marca entre locales.

### 8.4 Esforço

Médio (4 a 6 horas), incluindo revisão de traduções.

---

## 9. Problema 7 — Isolamento de plugins por usuário

### 9.1 Causa raiz

O isolamento de sistema de ficheiros por conta Linux existe (`isolation.ts`, `workspace.ts`, `spawnAsUser`), mas o produto não é isolado na prática:

1. O orquestrador arranca o `dsh` global `0.2.1-rc.2`, que não tem o bundle CopyMonster.
2. `DSH_SERVER_LOGIN_ENABLE_PATCH` não está definido; o default é `false`, pelo que o patch do runtime e a seleção de plugins por pasta não são injetados.
3. O perfil por usuário é criado do template `web` apenas com `dsh-base` e `dsh-web-app`; não inclui o bundle CopyMonster, o bundle de voz nem o preset de DNA.
4. No app partilhado (`app.copymonster.co`), qualquer usuário autenticado usa o DSH do root; instalar um plugin escreve em `/root/.dsh/profiles/web` e afeta todos.
5. `fs/plugins.ts` filtra todos os pacotes `@deepseek-ai/*`, incluindo bundles oficiais que o usuário deveria poder ativar por pasta.

### 9.2 Ficheiros afetados

- `/opt/copymonster/dsh-server-login/src/supervisor/orchestrator.ts:177-234`
- `/opt/copymonster/dsh-server-login/src/config.ts:124,143,254`
- `/opt/copymonster/dsh-server-login/src/fs/plugins.ts:24,42-65`
- `/opt/copymonster/dsh-server-login/src/web/routes/plugins.ts:38-74`
- `/etc/dsh-server-login.env`
- `packages/util/official-bundles/src/bundles.ts:10-20`
- `packages/bundle/copymonster/package.json`
- `.dsh/profiles/web/package.json`

### 9.3 Solução passo a passo

1. Fazer o orquestrador arrancar o build CopyMonster (`/root/copymonster-launch/apps/cli/lib/bin.js`) ou instalar o bundle CopyMonster no `dsh` global e usá-lo no `--patch`.
2. Ativar `DSH_SERVER_LOGIN_ENABLE_PATCH=true` e garantir que o patch do runtime é sempre montado.
3. Semear o perfil de cada usuário com `dsh-base`, `dsh-web-app`, o bundle CopyMonster e os bundles opcionais acordados (voz, DNA). O seed deve ser idempotente e não sobrescrever plugins instalados pelo usuário.
4. Restringir instalação de plugins no app partilhado a admin de plataforma, ou desativar o plugin manager nesse contexto.
5. Rever o filtro `@deepseek-ai/*`: distinguir bundles de instalação (não selecionáveis por pasta) de bundles oficiais opcionais (selecionáveis).
6. Testar com dois usuários: cada um instala um plugin diferente, vê apenas o seu, e o subdomínio arranca com identidade CopyMonster.

### 9.4 Esforço

Grande (12 a 20 horas), incluindo seed de perfis, migração de usuários existentes e testes multi-tenant.

---

## 10. Ordem de execução recomendada

| Fase | Problemas | Motivo |
|---|---|---|
| P0 | 1 e 7 | Sem sessão no subdomínio e sem DSH CopyMonster por usuário, os restantes fluxos não são testáveis |
| P0 | 3 | O onboarding de DNA está bloqueado enquanto o preset não existir |
| P1 | 4 e 2 | Modelos e rebranding afetam a perceção de produto |
| P2 | 6 e 5 | Idioma e áudio podem ser corrigidos depois do caminho principal estar estável |

---

## 11. Critérios de aceitação

- Registo novo → confirmação de email → aterragem em `https://<slug>.copymonster.co/` com sessão válida e sem loop de login.
- `enois` (e qualquer usuário existente) passa a ter linha no orquestrador e `sid` válido.
- O onboarding de DNA seleciona `brand-positioning-monster` sem recusa e o `My DNA` funciona.
- Criador comum vê o seletor de modelos e Settings > Models; Admin continua restrito a `is_admin`.
- Nenhum texto de produto mostra “DSH”; plugins de terceiros e nomes de providers não são alterados.
- Idioma escolhido no app e no shell mantém-se consistente após reload.
- Dois usuários instalam plugins diferentes e cada subdomínio vê apenas os seus.

---

## 12. Limites desta fase

- Nenhum ficheiro de código, configuração de deploy, base de dados ou serviço foi alterado.
- As alterações a `/etc/dsh-server-login.env`, `.env` de produção e systemd ficam listadas para aplicação posterior; não serão aplicadas sem aprovação explícita.
- Nenhum dado será apagado. O provisionamento de usuários existentes será idempotente.
- Nenhum plugin de terceiros será renomeado; o rebranding aplica-se apenas à estrutura da plataforma.
