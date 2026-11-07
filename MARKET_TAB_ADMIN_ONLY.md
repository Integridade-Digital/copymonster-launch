# MARKET_TAB_ADMIN_ONLY

## Resumo da Alteração

Implementada a ocultação da aba **"CopyMonster Market"** para utilizadores não-admin na página de Plugins.

## O que foi feito

### 1. Modificação no `PluginManagerPage.tsx`

**Arquivo:** `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx`

**Alterações:**

1. **Import adicionado:** `isPlatformAdmin` de `@deepseek-ai/dsh-client-ui-primitives`

2. **Lógica de filtragem de abas:**
   - Obtém todas as abas contribuídas via slot `plugins.tab`
   - Para utilizadores **admin**: mostra todas as abas (Installed, CopyMonster Market, Discover)
   - Para utilizadores **não-admin**: filtra a aba com id `"dsh-market"` (CopyMonster Market), mostrando apenas "Installed" e "Discover"

3. **Redirecionamento automático:**
   - Se um não-admin tentar aceder à aba "CopyMonster Market" diretamente via URL (ex: `#tab=dsh-market`), é redirecionado automaticamente para a aba "Installed"

### 2. Identificação da aba "CopyMonster Market"

A aba é contribuída pelo plugin externo `dshmarket` (rebrandado para CopyMonster Market via script `apply-dshmarket-rebrand.mjs`). O ID da aba é `"dsh-market"` (namespace do plugin).

## Comportamento

| Utilizador | Abas Visíveis | Acesso direto à URL do Market |
|------------|---------------|-------------------------------|
| **Admin** | Installed, CopyMonster Market, Discover | Acesso permitido |
| **Não-admin** | Installed, Discover | Redirecionado para Installed |

## O que NÃO foi alterado (conforme proibições)

- ✅ Menu lateral "Plugins" continua visível para todos
- ✅ Aba "Instalado" continua visível para todos  
- ✅ Aba "Descubra" (Discover) continua visível para todos
- ✅ Nenhuma alteração em backend, migrações, infraestrutura ou deploy

## Testes

Todos os testes existentes passam:
- `packages/client/ui-plugin-manager/tests/components.client.spec.tsx` - 153 testes ✅
- `packages/client/ui-plugin-manager/tests/config-ledger.client.spec.ts` - 4 testes ✅
- `packages/client/ui-plugin-manager/tests/browser-plugin.client.spec.tsx` - 7 testes ✅
- `packages/client/ui-plugin-manager/tests/manager-store.client.spec.ts` - 129 testes ✅

## Build

Build completo bem-sucedido (`pnpm run build:artifacts`).

## Notas Técnicas

- A verificação de admin usa `isPlatformAdmin()` que lê `globalThis.__DSH_AUTH__?.isAdmin === true`
- O shell publica este flag após resolver `public.users.metadata.is_admin` do perfil
- A filtragem acontece no render da página, não no registro do slot (o plugin `dshmarket` continua a registrar a aba, mas ela não é renderizada para não-admins)
- O redirecionamento é feito via `useEffect` que verifica se a aba selecionada é a de market e o utilizador não é admin