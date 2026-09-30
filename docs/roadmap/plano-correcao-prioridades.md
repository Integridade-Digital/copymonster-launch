# Plano de Correção por Prioridades — CopyMonster Launch

**Documento:** `docs/roadmap/plano-correcao-prioridades.md`  
**Status:** Revisado com Ajustes Técnicos 1, 2 e 3 — Aprovado  
**Alinhamento Institucional:** DeepSeek Harness Multi-tenant SaaS / CopyMonster Launch

---

## 1. Contexto Geral (Descobertas dos 8 Commits Anteriores)

Ao longo dos últimos commits na branch `master` (desde a transição SaaS multi-tenant até as Fases 1 a 8 do Redesign):
1. **Infraestrutura SaaS e Isolamento Multi-tenant:** Foram consolidadas tabelas de tenants, assinaturas Stripe, cotas de IA, auditoria e isolamento rígido por RLS e sandboxing.
2. **Sistema de Remotes e Invocação Tipada (Typert):** Métodos que exigem token explícito do chamador usam `@RemoteScope('auth', ...)`, enquanto métodos gerais do workspace operam sob `@Remote` direto. O cliente `settings-mirror.ts` invoca `remote.settings.*` sem anexar `authToken`, o que inviabiliza métodos de escopo `auth` para leituras globais de settings.
3. **Shell Web vs. Ciclo de Vida do ModuleLoader:** O shell do DSH (`LazyWebApp` / `AppWebEntry`) inicializa o runtime de módulos do browser (`window.__ModuleLoader__`). A navegação via React Router para rotas fora de `/` desmonta o shell (`entry.dispose()`), e o retorno dispara erro fatal de reinicialização: `window.ModuleLoader.create called after module-system boot`.
4. **Identidade Visual CopyMonster:** Estabeleceu-se a paleta dourada institucional (`#E7BF73`, `#D8AE5F`, `#B0955E`, `#FBF0DA` sobre fundo dark `#0f1115` / `#161920`), mas telas do sprint SaaS mantiveram cores claras hardcoded (#ffffff / gray-50).
5. **Branding e Locales em Lockstep:** Agentes e seções alinhados ao padrão "Monster" em en/zh em lockstep estrito, restando resíduos pontuais herdados do DeepSeek original no chat.

---

## 2. Diagnóstico Detalhado dos 5 Problemas

---

### Problema A (CRÍTICO): Falha no Carregamento de Models / Provider Directory
**Sintoma em Produção:**  
`"Loading the provider directory failed: cannot get property 'authIdentity' without inject"`

#### Arquivo(s) e Linha(s) Exata(s):
* `packages/api/settings-controller/src/index.ts`:
  * Linhas 107-113: função `assertAdminRole(ctx, ...)` lê `ctx.authIdentity` diretamente
  * Linha 158: `@Remote` em `describe(): SettingsDescribeValue` (acessa `this.ctx.authIdentity` na linha 161)
  * Linha 178: `@Remote` em `update(...)` (chama `assertAdminRole` na linha 196)
  * Linha 199: `@Remote` em `replace(...)` (chama `assertAdminRole` na linha 216)
  * Linha 220: `@Remote` em `mutate(...)` (chama `assertAdminRole` na linha 238)
  * Linha 242: `@Remote` em `openSettingsDocument(...)` (chama `assertAdminRole` na linha 254)
  * Linha 273: `@Remote` em `openAgentPresetDirectory(...)` (chama `assertAdminRole` na linha 286)
* `packages/api/settings-controller/src/credentials.ts`:
  * Linha 88: `@Remote` em `describe()` (acessa `this.ctx.authIdentity` na linha 91)
  * Linha 106: `@Remote` em `set(...)` (acessa `this.ctx.authIdentity` na linha 114)
  * Linha 127: `@Remote` em `unset(...)` (acessa `this.ctx.authIdentity` na linha 131)

#### Causa Raiz Técnica:
No microkernel Cordis, `ctx` é um Proxy (`vendor/cordis/src/reflect.ts:144`). Quando `authIdentity` não foi injetado no contexto da invocação, o acesso direto via `this.ctx.authIdentity` dispara o trap restritivo e lança `cannot get property 'authIdentity' without inject`.

**Por que NÃO usar `@RemoteScope('auth')` (Ajuste 1):**
1. O cliente `settings-mirror.ts` chama `remote.settings.describe()` sem anexar `authToken`. Com `@RemoteScope('auth')`, o Gateway rejeitaria a chamada com `gateway/context-not-found` sempre que o token não fosse enviado no payload.
2. Em `credentials.ts`, converter todos os métodos para `@RemoteScope` deixaria o import/decorator `@Remote` sem uso, quebrando o build (TS6133 unused).

#### Snippet do Código Atual:
```typescript
// packages/api/settings-controller/src/index.ts:158-163
  @Remote
  describe(): SettingsDescribeValue {
    const settings = this.provider()
    const identity = this.ctx.authIdentity // <-- FALHA: Proxy Cordis sem inject
    const isNonAdmin = identity !== undefined && identity.role !== 'owner' && identity.role !== 'admin'
```

#### Solução Técnica Proposta:
1. **MANTER `@Remote` puro** nos 9 métodos (`index.ts`: describe, update, replace, mutate, openSettingsDocument, openAgentPresetDirectory; `credentials.ts`: describe, set, unset).
2. **ADICIONAR** o helper seguro:
   ```typescript
   function getAuthIdentity(ctx: Context): UserIdentity | undefined {
     if (Reflect.has(ctx, 'authIdentity')) {
       return (ctx as unknown as { authIdentity?: UserIdentity }).authIdentity
     }
     return undefined
   }
   ```
   `Reflect.has` verifica a presença da propriedade sem disparar o trap de leitura restritiva do Cordis.
3. **SUBSTITUIR** `this.ctx.authIdentity` / `ctx.authIdentity` por `getAuthIdentity(...)` nos 9 métodos e em `assertAdminRole` / `assertAdminOrOwnerAuth`.

- **Impacto:** Alto (Desbloqueia o diretório de modelos e configurações de IA).
- **Esforço Estimado:** Pequeno (Cirúrgico, sem alterar o protocolo RPC).
- **Risco:** Mínimo.

---

### Problema B (CRÍTICO): Rotas `/plans`, `/profile`, `/admin`, `/admin/audit` Fora do Painel e Falha do ModuleLoader
**Sintoma em Produção:**  
Ao navegar para as rotas e clicar em "Voltar ao Chat", o sistema trava com:  
`"client-modules: window.ModuleLoader.create called after module-system boot"`

#### Arquivo(s) e Linha(s) Exata(s):
* `apps/web/src/main.tsx`: Linhas 228-348 (rotas standalone no React Router)
* `packages/client/modules/src/client/system.ts`: Linha 137 (guarda anti-reboot do ModuleLoader)

#### Causa Raiz Técnica:
`/plans`, `/profile`, `/admin` e `/admin/audit` são rotas independentes que desmontam a rota `/`. O `<LazyWebApp />` executa `entry.dispose()` ao sair e tenta recriar o `AppWebEntry` ao voltar — proibido pela guarda de boot do microkernel.

**Por que apenas mudar o AppFrame NÃO resolve (Ajuste 2):** enquanto as rotas existirem no React Router, navegar para elas continua desmontando o `LazyWebApp`, e o retorno à `/` reexecuta o boot de módulos.

#### Snippet do Código Atual:
```typescript
// apps/web/src/main.tsx (rotas standalone atuais)
<Route path="/plans" element={<ProtectedRoute><AppFrame><PlansPage /></AppFrame></ProtectedRoute>} />
<Route path="/admin" element={<ProtectedRoute><RoleGate ...><AdminTenantsPage /></RoleGate></ProtectedRoute>} />
<Route path="/admin/audit" element={<ProtectedRoute><RoleGate ...><AdminAuditPage /></RoleGate></ProtectedRoute>} />
<Route path="/profile" element={<ProtectedRoute><AppFrame><ProfilePage /></AppFrame></ProtectedRoute>} />
<Route path="/" element={<ProtectedRoute><LazyWebApp /></ProtectedRoute>} />
```

#### Solução Técnica Proposta:
1. **MANTER `<LazyWebApp />` SEMPRE MONTADO** na rota `/` — o workspace nunca é desmontado durante a sessão ativa.
2. **REMOVER** as rotas `/plans`, `/profile`, `/admin` e `/admin/audit` de `apps/web/src/main.tsx`.
3. **TRANSFORMAR EM MODAIS** controlados por estado local, no padrão arquitetural do `SettingsPanel` (overlay + mask + panel com `role="dialog"`), renderizados por cima do chat sem tocar no ciclo de vida do shell.
4. Botões no sidebar e no menu de usuário abrem os modais correspondentes.
5. **EXCEÇÃO:** `/billing/success` e `/billing/cancel` permanecem rotas standalone, pois são alvos de redirect externo do Stripe Checkout.

- **Impacto:** Alto (Elimina o travamento fatal e unifica a navegação).
- **Esforço Estimado:** Médio.
- **Risco:** Baixo/Médio (Seguir fielmente o padrão de modal do `SettingsPanel`).

---

### Problema C (MÉDIO): Cards de `/plans` Brancos
**Sintoma em Produção:**  
Cards de planos com fundo branco `#ffffff`, bordas `#e2e8f0` e sombras de tema claro, destoando do tema dark/gold CopyMonster.

#### Arquivo(s) e Linha(s) Exata(s):
* `apps/web/src/pages/billing/billing.css`:
  * Linhas 53, 62: `.cm-billing-portal-btn`
  * Linhas 196, 202: `.cm-billing-toggle-btn`
  * Linhas 232, 252: `.cm-plan-card`, `.cm-plan-card--featured`
  * Linha 428: `.cm-billing-modal`
  * Linha 486: `.cm-cancel-confirm-card`

#### Causa Raiz Técnica:
Cores hexadecimais de tema claro hardcoded no CSS de billing, sem consumir os design tokens institucionais (`--cm-auth-bg`, `--cm-auth-card-bg`, `--cm-auth-border`, `--cm-auth-primary`).

#### Snippet do Código Atual:
```css
/* apps/web/src/pages/billing/billing.css:230-235 */
.cm-plan-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background-color: #ffffff; /* <-- Hardcoded branco */
  border-radius: 16px;
  border: 1px solid #e2e8f0;
```

#### Solução Técnica Proposta:
1. Refatorar `billing.css` com os tokens institucionais:
   - Cards e modais: `background-color: var(--cm-auth-card-bg, #161920);`
   - Bordas: `border-color: var(--cm-auth-border, rgba(231, 191, 115, 0.15));`
   - Textos: `var(--cm-auth-text, #f3f4f6)` e `var(--cm-auth-muted, #9ca3af);`
   - Destaques (featured/CTAs): ouro institucional `#E7BF73` / `#D8AE5F`.

- **Impacto:** Médio. **Esforço:** Pequeno. **Risco:** Mínimo (só CSS).

---

### Problema D (MÉDIO): Painel Admin (/admin e /admin/audit) sem Layout Institucional
**Sintoma em Produção:**  
Páginas de tenants e auditoria renderizadas com classes Tailwind de tema claro (`bg-gray-50 min-h-screen text-gray-900`), desintegradas do design system.

#### Arquivo(s) e Linha(s) Exata(s):
* `apps/web/src/pages/admin/AdminTenantsPage.tsx`: Linha 34
* `apps/web/src/pages/admin/AdminAuditPage.tsx`: Linha 48

#### Snippet do Código Atual:
```tsx
// AdminTenantsPage.tsx:34
<div className="p-8 bg-gray-50 min-h-screen">
// AdminAuditPage.tsx:48
<div className="p-8 bg-gray-50 min-h-screen">
```

#### Solução Técnica Proposta:
1. Integrar as views no padrão modal dark institucional (herdado do Bloco 2):
   - Fundo `#0f1115` / `#161920`, textos `#f3f4f6` / `#9ca3af`.
   - Tabelas com linhas `#262a34`, cabeçalhos escuros.
   - Badges de status e visualizador de JSON com paleta escura e acentos `#E7BF73`.
   - Abas de navegação unificadas entre "Tenants" e "Auditoria".

- **Impacto:** Médio. **Esforço:** Pequeno/Médio. **Risco:** Mínimo.

---

### Problema E (BAIXO): "Deep diving..." no Chat
**Sintoma em Produção:**  
Indicador de status do chat exibe o texto herdado `"Deep diving..."` / `"深度求索中..."`.

#### Arquivo(s) e Linha(s) Exata(s):
* `packages/client/ui-chat/src/client/locale.ts`:
  * Linha 25 (zh): `'chat.deepDiving': '深度求索中...',`
  * Linha 136 (en): `'chat.deepDiving': 'Deep diving...',`
* `packages/client/ui-chat/src/client/chat/ChatView.tsx`: Linha 194

#### Causa Raiz Técnica:
Texto residual do DeepSeek Harness não atualizado no redesign de branding.

#### Solução Técnica Proposta (lockstep en/zh):
```typescript
'en': 'chat.deepDiving': 'Monster is thinking...',
'zh': 'chat.deepDiving': 'Monster 思考中...',
```

- **Impacto:** Baixo. **Esforço:** Mínimo. **Risco:** Nulo.

---

## 3. Ordem de Execução Sugerida (1 Bloco = 1 Commit = 1 Validação)

Execução estritamente sequencial em 5 blocos atômicos:

```
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 1 (CRÍTICO) — Problema A                                         │
│ • Manter @Remote puro nos 9 métodos                                    │
│ • Adicionar helper getAuthIdentity(ctx) com Reflect.has                │
│ • Substituir this.ctx.authIdentity (index.ts e credentials.ts)         │
│ • Validação: build:lib:host + build:lib:client + vitest settings       │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 2 (CRÍTICO) — Problema B                                         │
│ • Manter LazyWebApp sempre montado na rota /                           │
│ • REMOVER rotas /plans, /profile, /admin, /admin/audit do main.tsx     │
│ • Transformar em modais no padrão SettingsPanel (overlay + mask)       │
│ • Manter /billing/success e /billing/cancel como rotas standalone      │
│ • Validação: build client + teste de abertura de modais sem unmount    │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 3 (MÉDIO) — Problema C                                           │
│ • Refatorar billing.css com tokens dark/gold                           │
│ • Validação: build client + validação visual                           │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 4 (MÉDIO) — Problema D                                           │
│ • Painel admin modal dark/gold (Tenants e Audit)                       │
│ • Validação: build client + teste de abas                              │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BLOCO 5 (BAIXO) — Problema E                                           │
│ • chat.deepDiving -> "Monster is thinking..." (en/zh lockstep)         │
│ • Validação: pnpm vitest packages/client/ui-chat                       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Regras de Execução e Garantia de Qualidade

1. **Validação Obrigatória antes de cada commit:**
   1. `pnpm run build:lib:host` (`tsc -b tsconfig.host.json`) -> **Build complete**, exit 0.
   2. `pnpm run build:lib:client` (`tsdown`) -> **Build complete**, exit 0.
   3. Testes unitários pertinentes via Vitest.
2. **Revisão e Aprovação:**
   - Para cada bloco: apresentar `diff` completo + testes + builds antes de commitar.
   - **NÃO commitar nem dar push sem aprovação explícita do usuário.**
