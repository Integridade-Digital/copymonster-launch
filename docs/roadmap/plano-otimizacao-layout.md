# Plano de Otimização de Layout — CopyMonster

**Status:** auditoria técnica de código concluída; auditoria visual de runtime pendente de capturas autenticadas.
**Escopo:** seções de Settings e superfícies principais que compartilham o tema CopyMonster.
**Base analisada:** branch `master` no checkout desta auditoria, incluindo `apps/web/src/cm-theme.css`, os registros de slots de Settings, estilos dos componentes client e `scripts/apply-dsh-plugins-rebrand.mjs`.

> Este documento é um plano para revisão. Não altera a implementação nem autoriza a execução dos commits de otimização.

## 1. Resumo executivo

### Achados comprovados por código

- `apps/web/src/cm-theme.css` tem **90 ocorrências de `!important`**, concentradas nas regras de foco, gate visual de admin e normalização de superfícies de plugins/seções.
- O tema define **27 tokens `--cm-*`**, todos de cor, estado, sombra ou overlay. Não há tokens centralizados de geometria ou tipografia para radius, padding, gap, tamanho de fonte ou família tipográfica.
- Há **11 IDs de seção** explicitamente estilizados no tema (Agent presets, Better Sidebar, Market, Models, My DNA, Plans, Plugins, Profile, Scheduled tasks, Vercel MCP e IM bots), além da seção General como referência. A navegação também registra Archived sessions, mas não há regra `data-settings-section="archived-sessions"` no tema.
- O CSS central aplica receitas semelhantes com valores fixos repetidos (`12px` radius e `16px` padding), enquanto os próprios componentes têm outras medidas: por exemplo, General usa cubos com radius `20px`; Models usa cards `16px`, editor `12px`, linhas internas `10px` e controles tipo pill; Agent presets usa `14px` e `16px` em superfícies diferentes. Algumas diferenças são hierarquia intencional, mas hoje não estão expressas como tokens/variantes comuns.
- `!important` é usado para vencer estilos de plugins e declarações inline. Essa estratégia ajuda na integração atual, porém torna a cascata difícil de prever e amplia o risco de sobrescrever estados nativos (featured/current/selected/broken), especialmente quando o seletor captura classes CSS-module genéricas como `_card_`.

### Causa raiz e recomendação

A inconsistência não vem de uma única origem: coexistem tokens de cor CopyMonster, tokens DSW nos componentes nativos, valores geométricos locais sem fonte comum e estilos de plugins com diferentes mecanismos de encapsulamento. Recomenda-se introduzir tokens de geometria e tipografia, mapear os valores existentes para variantes semânticas, reduzir as regras globais de `!important` e manter adaptações isoladas por seção/plugin. Para conteúdo realmente em iframe, usar uma ponte explícita de tokens; para conteúdo no mesmo documento, preferir CSS escopado e API de tema suportada.

### Limite da auditoria visual

Não foi possível produzir screenshots autenticados de cada seção em dark e light neste ambiente. Portanto, **não afirmo diferenças visuais observadas em runtime nem um total visual de inconsistências**. As comparações abaixo são achados de código e valores declarados. O passo de capturas reais e conferência lado a lado com General permanece obrigatório antes de aprovar implementação visual.

## 2. Inventário técnico por área

| Área | Evidência e mecanismo | Valores/observação de layout no código | Situação a validar visualmente |
|---|---|---|---|
| General | `ui-settings-general/src/client/GeneralSection.tsx` renderiza itens por slot; `GeneralSection.module.css` só organiza coluna e remove o divisor final. Itens são implementados pelos pacotes de tema, locale, chat, conversation e permission-presets. | `AppearanceRow.module.css`: linhas `16px 0`, gap `8px`, cubos radius `20px`, padding `20px 32px`. `LanguageRow`: linha `16px 0`; seletor pill radius `18px`. Não é um cartão único. | Usar como referência de espaçamento e hierarquia, não assumir que toda seção deve virar cartão.
| Profile | `ProfileSection` recebe slot e `apps/web/src/main.tsx` injeta a página Profile existente. CSS da página em `apps/web/src/pages/ProfilePage.css`; normalização em `cm-theme.css`. Conteúdo no DOM principal. | `.cm-profile-card`: fill, border, radius `12px`, padding `16px`, sem shadow por regra central; cards separados por `16px`. | Confirmar densidade e comportamento em largura estreita e nos dois temas.
| Plans | `PlansSection` projeta página Plans existente, `apps/web/src/pages/billing/PlansPage.tsx` e `billing.css`; CSS central em `cm-theme.css`. Conteúdo no DOM principal. | Cards recebem radius `12px`, padding `16px`; featured/current possuem borda/realce próprios; banner usa `12px`/`16px`. | Conferir se preço, quota, call-to-action e estados featured/current continuam distinguíveis após normalização.
| My DNA | `MyDnaSection` projeta conteúdo por slot; tema central identifica CSS Modules por padrão de classe `_card_`. | A regra central força fill, borda, radius `12px`, padding `16px`, shadow none. Os detalhes do componente pertencem ao slot da aplicação. | Verificar classes concretas entregues pelo build, estados vazio/salvo e light/dark.
| Built-in plugins | `PluginsSettingsSection` agrega plugins através de slot. CSS central trata inventory cards e MCP Connector; MCP Connector tem documento de UI em `ui/index.html` e recebe `<style>` e script por `injectMcpTheme`. | Inventory usa surface de card com `12px`; conteúdo interno `16px`. MCP card/header/body recebem regras próprias. | Confirmar que escopo do seletor não altera cards de outras abas e que estilos de foco/hover mantêm contraste.
| Agent presets | `AgentPresetSection.module.css` é CSS Module carregado no documento principal; o tema central normaliza preferência e cards. | CSS original varia: preferência `14px` e `14px 16px`; tema passa a `12px` e `16px` em seletores de superfície. Cabeçalhos e cards internos têm hierarquia própria. | Conferir estado ativo, quebrado e rodapé após o reset de surface.
| IM bots | Regra do tema usa classes globais `.dim-botCard`, `.dim-channel`, `.dim-botCardBody`; o pacote instalado não está no repositório analisado para inspecionar seus estilos-fonte. Não há evidência de iframe/shadow DOM nas fontes pesquisadas. | Tema impõe border, radius `12px`, padding corporal `16px`; canal selecionado tem cor primary. | A confirmar no plugin instalado, inclusive se o CSS é carregado no documento host.
| Archived sessions | Seção registrada como `archived-sessions` em `ui-settings-unarchive-sessions/src/client/index.ts`; não há regra com esse identificador no `cm-theme.css`. | Não há normalização CopyMonster específica identificada no tema. | Verificar se a ausência é intencional ou gera diferença de superfície.
| Scheduled tasks | CSS central usa classes globais `.dsh-st-*`. `apply-dsh-plugins-rebrand.mjs` injeta `AUTOMATION_THEME_CSS` no bundle client e configura tokens Ant Design/DSW em subárvores; não é uma injeção em iframe. | Tema normaliza cards/banner para radius `12px`, padding `16px`; o CSS original e o tema injetado coexistem. | Conferir popovers/portals, campos e temas, pois portais podem sair da subárvore estilizada.
| Side card / Better Sidebar | `apply-dsh-plugins-rebrand.mjs` traduz strings de arquivos `lib/client*.js`; o tema host usa seletores CSS Module por padrão `_group_`/`_card_`. A busca no código versionado não encontrou `attachShadow`/`shadowRoot` para este plugin. | Tema força grupos/cards para radius `12px`, padding `16px` em alguns níveis; possíveis regras sobrepostas em elementos aninhados. | Verificar DOM runtime para confirmar se o pacote realmente não usa shadow root e se seletores CSS Module compilados coincidem.
| Vercel MCP | O script altera strings e declarações inline em `lib/client.js` por substituição (`VERCEL_THEME_REPLACEMENTS`); o tema host também estiliza o elemento de card em `[data-settings-section="vercel-mcp"]`. Sem evidência de iframe no código versionado analisado. | Valores de cor são substituídos por `var(--cm-*)`; a regra host usa `!important` porque a superfície é inline. | Confirmar DOM real, inline styles gerados e alinhamento do cartão com demais extensões.
| GenUI | O script rebranda `lib/client.js`, locale e `package.json`; não injeta `AUTOMATION_THEME_CSS` nem estilo de geometria para GenUI. Sem evidência de iframe/shadow root na busca dos fontes versionados. | Nenhuma receita `data-settings-section` específica identificada para GenUI. | Identificar suas superfícies em runtime e decidir se pertencem ao escopo principal de Settings ou de UI do chat.
| UI principal | Tokens de cor em `cm-theme.css`; controles e shell nativos usam frequentemente `--dsw-alias-*` e valores locais. A superfície global inclui chat, sidebar, popovers e overlays. | Exemplo: Settings panel usa largura `800px`, radius `32px`; navegação usa gap `18px`, células radius `12px`; controles variam entre `6px`, `8px`, `14px`, `18px` e `20px`. | Capturar telas principais (chat vazio/ativo, sidebar expandida/recolhida, modal Settings e overlays) em dark/light.

## 3. Design Tokens propostos

Adicionar tokens semânticos em `apps/web/src/cm-theme.css`, preservando tokens existentes de cor. Os valores abaixo são uma proposta inicial, não uma decisão de substituir automaticamente todas as medidas locais:

```css
:root {
  /* Geometria */
  --cm-radius-sm: 6px;
  --cm-radius-md: 8px;
  --cm-radius-lg: 12px;
  --cm-padding-card: 16px;
  --cm-padding-section: 24px;
  --cm-gap-card: 12px;
  /* Tipografia */
  --cm-font-size-sm: 12px;
  --cm-font-size-md: 14px;
  --cm-font-size-lg: 16px;
  --cm-font-size-xl: 20px;
}
```

Mapeamento sugerido para revisão: `sm` para controles/elementos internos compactos; `md` para cards e inputs; `lg` para containers e agrupamentos; padding/gap devem ser aplicados por variante de componente, não universalmente. Adicionar `--cm-font-family` somente após confirmar a família efetiva comum no host; não inventar uma fonte nova nem substituir `--ds-font-family-code` em conteúdo monoespaçado. Manter radius maiores (p.ex. Settings panel `32px`, cubos seletivos `20px`, pills) como exceções nomeadas se forem decisões deliberadas.

Tokens devem ser disponibilizados nos contextos dark/light pelo mecanismo atual: cores continuam variando sob `body[data-ds-dark-theme]`; tokens geométricos e tipográficos são invariantes salvo decisão de design explícita.

## 4. Estratégia de aplicação

1. **Inventariar antes de substituir:** registrar computed styles de cada surface (background, border, radius, padding, gap, font-size/line-height/family) e classificar componente em `surface/card`, `control`, `nested surface`, `pill` ou `shell`.
2. **Introduzir tokens sem alterar aparência:** declarar tokens e mapear receitas existentes mantendo valores computados. Criar variantes semânticas; evitar regras genéricas baseadas em substrings de CSS Modules quando houver atributos/classes estáveis próprios.
3. **Reduzir `!important` por propriedade:** remover primeiro onde o estilo pode ser definido no componente ou numa classe de integração. Preservar exceções documentadas para inline style ou prioridade de acessibilidade; não fazer substituição global em lote. `:focus-visible` precisa manter prioridade suficiente e comportamento acessível.
4. **CSS escopado no host:** limitar regras a `[data-settings-section="<id>"]` e a classes/atributos estáveis do plugin. Estados `featured`, `current`, `selected`, `active` e `broken` devem ter variantes explícitas e testar precedência.
5. **Iframes:** CSS do documento host não atravessa a fronteira. O MCP Connector é identificado no script como iframe same-origin e já recebe ponte runtime que lê os valores `--cm-*` do parent e os mapeia para tokens internos; ampliar somente o contrato necessário e validar falha segura quando aberto standalone/cross-origin. Não presumir que Vercel MCP use iframe.
6. **Shadow DOM:** a busca dos fontes versionados não encontrou `attachShadow`/`shadowRoot` nos plugins citados. Confirmar no DOM de runtime antes de escolher estratégia. Se confirmado, usar API de tema/documented custom properties expostas pelo componente; não depender de seletor CSS externo atravessando shadow boundary.
7. **Bundles de plugins:** `apply-dsh-plugins-rebrand.mjs` transforma arquivos de distribuição locais. Adições devem ser idempotentes, testadas em `--check`, e limitadas aos plugins explicitamente suportados. Automation injeta CSS e tokens Ant Design/DSW; Vercel recebe substituições de cores inline; MCP Connector recebe CSS+script no HTML do iframe; GenUI e Better Sidebar, na versão do script examinada, recebem rebrand de texto mas não uma ponte geral de geometria.

## 5. Plano de execução e ordem dos commits

Cada etapa é um commit pequeno, validado isoladamente. A auditoria visual pendente é pré-requisito para fechar os valores finais dos tokens.

1. **`docs(layout): record baseline and visual audit`** — anexar ao plano a matriz real de screenshots/computed styles, com viewport, tema e build/versão.
2. **`style(theme): add semantic geometry and typography tokens`** — adicionar tokens sem mudar aparência; teste de contrato para nomes/valores e dark/light.
3. **`style(settings): normalize native sections to shared variants`** — migrar componentes nativos e seções Profile, Plans, My DNA, Models e Agent presets em grupos pequenos, mantendo estados.
4. **`style(plugins): scope host-side settings surfaces`** — migrar plugins no documento host (IM, sidebar, tasks e outros confirmados), remover seletor genérico somente após equivalência visual.
5. **`style(plugins): align iframe and inline-style theme bridges`** — atualizar separadamente o MCP iframe e a estratégia inline de Vercel; manter o mecanismo da Automation isolado e idempotente.
6. **`style(theme): remove obsolete important overrides`** — apagar apenas regras comprovadamente redundantes e registrar exceções necessárias.
7. **`test(layout): add dark-light visual regression coverage`** — snapshots/capturas para viewport padrão e estreito, com diferenças visuais revisadas.

## 6. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Sobrescrever estado semântico (selecionado, plano atual, ativo, quebrado) ao normalizar a superfície | Testar todos os estados e declarar variantes depois da regra base, com escopo por componente.
| Remover `!important` e perder estilo de declaração inline ou de pacote | Fazer remoção por propriedade e seção; comparar computed styles antes/depois.
| Token não existir dentro de iframe ou outro documento | Ponte explícita de tokens com fallback seguro; testar tema claro/escuro, carga tardia e execução standalone.
| CSS Module mudar nomes hash e quebrar seletor substring | Preferir `data-*`/classe pública estável; enquanto não houver contrato, adicionar teste de DOM/bundle.
| Portais/popovers da Automation escaparem da subárvore tematizada | Validar os portais no documento e aplicar tokens no root apropriado sem colorir superfícies alheias.
| Mudança de geometria reduzir legibilidade ou densidade | Usar screenshots de referência, viewport desktop/mobile e revisão de conteúdo longo.
| Dark mode divergir porque componentes usam DSW e web usa CM | Validar computed styles nos dois temas e estabelecer uma ponte documentada, sem duplicar paletas.
| Plugin atualizado alterar HTML/CSS que o script transforma | Manter transformações idempotentes, `--check`, fixtures de pacote e falha explícita quando âncora não corresponder.
| Auditoria visual incompleta levar a afirmações não comprovadas | Não declarar conformidade visual até capturar todas as seções e registrar evidências.

## 7. Checklist de aceitação

### Auditoria visual (a concluir antes da implementação)
- [ ] Capturar General, Profile, Plans, My DNA, Built-in plugins, Agent presets, IM bots, Archived sessions, Scheduled tasks, Side card e Vercel MCP em tema dark e light.
- [ ] Usar mesmo viewport, zoom e estado de carregamento; registrar casos de loading, vazio, ativo/selecionado e erro quando aplicável.
- [ ] Capturar UI principal: chat, sidebar, Settings shell e pelo menos um overlay/modal.
- [ ] Comparar cada área com General e registrar computed styles para border, radius, padding, gap, background, font family, size, weight e line-height.
- [ ] Registrar plugins ausentes, falha de autenticação, iframe inacessível ou superfície que não pôde ser capturada; não classificar como aprovada.

### Implementação (após aprovação do plano)
- [ ] Tokens geométricos/tipográficos existem em um ponto de origem e têm nomes documentados.
- [ ] As receitas de card/control/shell usam tokens ou variantes nomeadas; exceções têm justificativa.
- [ ] Nenhuma regra host pretende atravessar iframe ou shadow root.
- [ ] MCP iframe reflete light/dark e permanece legível quando a ponte não consegue ler o parent.
- [ ] Vercel inline styles e Automation/Ant Design continuam tematizados sem afetar conteúdo não relacionado.
- [ ] Estados featured/current/selected/active/broken preservam distinção e contraste.
- [ ] `!important` foi reduzido seletivamente; exceções remanescentes são comentadas.
- [ ] Testes de contrato, typecheck, builds e snapshots visuais passam.
- [ ] Screenshots antes/depois foram revisadas em desktop e largura estreita.

## Apêndice — arquivos e referências principais

- `apps/web/src/cm-theme.css` — paleta CopyMonster, 90 usos de `!important` e receitas atuais das seções.
- `packages/client/ui-settings-general/src/client/SettingsRoot.module.css` — shell Settings, geometria do painel e navegação.
- `packages/client/ui-settings-general/src/client/GeneralSection.module.css` — coluna da seção General.
- `packages/client/ui-theme/src/client/AppearanceRow.module.css` e `packages/client/locale/src/client/LanguageRow.module.css` — valores de referência de linhas/cubos.
- `packages/client/ui-settings-models/src/client/ModelsSection.module.css` e `packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css` — superfícies e controles nativos.
- `packages/client/ui-settings-general/src/client/index.ts` e `apps/web/src/main.tsx` — registro de seções e conteúdo Profile/Plans/My DNA.
- `packages/client/ui-settings-unarchive-sessions/src/client/index.ts` — registro de Archived sessions.
- `scripts/apply-dsh-plugins-rebrand.mjs` — transformação de plugins; MCP theme bridge, Vercel color replacement, Automation theme injection, GenUI/Better Sidebar rebrand.
