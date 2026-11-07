# SETTINGS_CARDS_LAYOUT_UNIFICATION

## Resumo da Alteração

Uniformizado o layout dos cartões nos painéis **Profile**, **My DNA**, **Plans** e **Affiliate** dentro do modal Settings, aplicando o mesmo estilo visual do painel **Zernio MCP** (fundo `var(--cm-card)`, borda `var(--cm-border)`, raio `var(--cm-radius-lg)`, padding `var(--cm-padding-card)`).

## O que foi feito

### 1. Modificação em `apps/web/src/main.tsx`

**Adicionados wrappers `<div className="cm-settings-page">`** nos componentes SettingsItem:

- `PlansSettingsItem` - agora wrappa `<PlansPage />`
- `MyDnaSettingsItem` - agora wrappa `<MyDnaPage onClose={() => {}} />`
- `AffiliateSettingsItem` - agora wrappa `<AffiliateSettings />`

O `ProfileSettingsItem` já tinha wrapper com classes `cm-settings-page cm-settings-profile-card`.

### 2. Modificação em `apps/web/src/cm-theme.css`

**Adicionados seletores de filho direto** `[data-slot="settings.section"] > div` para as seções:
- `[data-settings-section="profile"] [data-slot="settings.section"] > div`
- `[data-settings-section="plans"] [data-slot="settings.section"] > div`
- `[data-settings-section="my-dna"] [data-slot="settings.section"] > div`
- `[data-settings-section="affiliate"] [data-slot="settings.section"] > div`

Estes seletores seguem o mesmo padrão usado para **Zernio MCP** e **Vercel MCP** (linhas 186-187), garantindo que o container direto do slot receba o estilo de cartão:
- `background: var(--cm-card)`
- `border: 1px solid var(--cm-border)`
- `border-radius: var(--cm-radius-lg)`
- `padding: var(--cm-padding-card)`
- `box-shadow: none`

## Comportamento Visual

| Painel | Antes | Depois |
|--------|-------|--------|
| **Profile** | Já tinha cartão (`.cm-settings-profile-card`) | Mantido + seletor direto adicionado |
| **Plans** | Sem wrapper, cartões individuais com `.cm-plan-card` | Wrapper `cm-settings-page` + cartão unificado |
| **My DNA** | Sem wrapper, cartões individuais com `.cm-settings-dna-card` | Wrapper `cm-settings-page` + cartão unificado |
| **Affiliate** | Sem wrapper, usa CSS Modules próprio | Wrapper `cm-settings-page` + cartão unificado |
| **Zernio MCP** | Referência (inline styles + seletor direto) | Inalterado |

## O que NÃO foi alterado (conforme proibições)

- ✅ Lógica de negócio dos formulários
- ✅ Funcionamento dos botões e inputs (mantêm seus estilos próprios via CSS Modules)
- ✅ Backend, migrações, infraestrutura, deploy
- ✅ Apenas camada visual (CSS e estrutura de containers)

## Testes

- Build completo bem-sucedido (`pnpm run build:artifacts`)
- Sem novos erros de lint introduzidos (erros existentes em `main.tsx` são pré-existentes e não relacionados às alterações)

## Notas Técnicas

- O seletor `[data-slot="settings.section"] > div` atinge o filho direto do slot, que agora é o wrapper `cm-settings-page` adicionado em cada SettingsItem
- Isso garante consistência com o padrão Zernio/Vercel sem duplicar estilos inline
- Os botões e inputs dentro de cada painel mantêm seus estilos próprios (via CSS Modules), herdando apenas as variáveis de cor do tema (`--cm-primary`, `--cm-border`, etc.)