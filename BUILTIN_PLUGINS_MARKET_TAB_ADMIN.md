# BUILTIN_PLUGINS_MARKET_TAB_ADMIN

## Resumo da Alteração

Implementada a ocultação da aba **"CopyMonster Market"** na secção **Settings > Plug-ins integrados** (Built-in plugins) para utilizadores não-admin.

## O que foi feito

### 1. Modificação no `PluginsSettingsSection.tsx`

**Arquivo:** `packages/client/ui-settings-plugins/src/client/PluginsSettingsSection.tsx`

**Alterações:**

1. **Import adicionado:** `isPlatformAdmin` de `@deepseek-ai/dsh-client-ui-primitives`

2. **Lógica de filtragem de abas:**
   - Obtém todas as abas contribuídas via slot `settings.plugins.tab`
   - Para utilizadores **admin**: mostra todas as abas (ex: "Lista de plug-ins", "CopyMonster Market")
   - Para utilizadores **não-admin**: filtra a aba com id `"dsh-market"` (CopyMonster Market), mostrando apenas as outras abas (ex: "Lista de plug-ins")

3. **Redirecionamento automático:**
   - Se um não-admin tentar aceder à aba do Market (ex: estado prévio ou navegação direta), é redirecionado automaticamente para a primeira aba disponível (ex: "Lista de plug-ins")

### 2. Identificação da aba "CopyMonster Market"

A aba é contribuída pelo plugin externo `dshmarket` (rebrandado para CopyMonster Market via script `apply-dshmarket-rebrand.mjs`). O ID da aba é `"dsh-market"` (namespace do plugin), registrada com `order: 60` no slot `settings.plugins.tab`.

## Comportamento

| Utilizador | Abas Visíveis | Acesso direto à aba do Market |
|------------|---------------|-------------------------------|
| **Admin** | Lista de plug-ins, CopyMonster Market, outras | Acesso permitido |
| **Não-admin** | Lista de plug-ins, outras | Redirecionado para primeira aba disponível |

## O que NÃO foi alterado (conforme proibições)

- ✅ Menu lateral "Plugins" continua visível para todos
- ✅ Aba "Lista de plug-ins" (Plugin list) continua visível para todos  
- ✅ Outras abas de "Plug-ins integrados" continuam visíveis para todos
- ✅ Nenhuma alteração em backend, migrações, infraestrutura ou deploy
- ✅ Foco estritamente no código de frontend (`packages/client/`)

## Testes

Todos os testes existentes passam:
- `packages/client/ui-settings-plugins/tests/section.client.spec.tsx` - 4 testes ✅
- `packages/client/ui-settings-plugins/tests/apply.client.spec.ts` - 6 testes ✅

## Build

Build completo bem-sucedido (`pnpm run build:artifacts`).

## Lint

Sem erros de lint (`npx oxlint`).

## Notas Técnicas

- A verificação de admin usa `isPlatformAdmin()` que lê `globalThis.__DSH_AUTH__?.isAdmin === true`
- O shell publica este flag após resolver `public.users.metadata.is_admin` do perfil
- A filtragem acontece no render da secção, não no registro do slot (o plugin `dshmarket` continua a registrar a aba, mas ela não é renderizada para não-admins)
- O redirecionamento é feito via `useEffect` que verifica se o utilizador não é admin e a aba ativa é a de market