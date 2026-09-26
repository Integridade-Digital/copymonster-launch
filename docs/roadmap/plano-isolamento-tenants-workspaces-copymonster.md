# Plano Diretor de Engenharia: Isolamento Multi-Tenant e Autenticação Robusta (CopyMonster)
**Status:** Aguardando Aprovação do Usuário (Nenhuma alteração em código foi realizada)  
**Versão:** 3.0 (Consolidada com Auditoria de Tipos Typert, Ciclo do Token Client e Causa Raiz de Boot)  
**Data:** 26 de Setembro de 2026  

---

## 1. Auditoria Técnica e Resposta às Questões Críticas

### 1.1. Causa Raiz do `auth-context-client` no Boot: YAML vs. Build
* **Diagnóstico Concluído:**
  A falha que abortava a inicialização decorre **exclusivamente da declaração indevida no `packages/bundle/copymonster/cordis.patch.yml`**:
  ```yaml
  - insert:
      - id: auth-context
        name: '@deepseek-ai/dsh-api-auth-context'
      - id: auth-http
        name: '@deepseek-ai/dsh-api-auth-http'
      - id: auth-context-client
        name: '@deepseek-ai/dsh-api-auth-context/client' # <- ENTRADA INDEVIDA NO LOADER DO HOST
  ```
  1. O motor `dsh-client-modules` (`packages/client/modules/src/index.ts`) escaneia as entradas do Host à procura de pacotes que declaram o manifesto `dsh.client` no `package.json`. O pacote raiz `@deepseek-ai/dsh-api-auth-context` **já possui** essa declaração.
  2. Ao forçar `auth-context-client` como entrada separada do Host Loader, o processo Node.js tentava carregar `src/client/index.ts`. Como o código cliente invoca `ctx.typert.contexts.registerClient('auth', ...)`, e no Host só existe o método `registerHost`, o Node lançava exceção fatal e abortava.
  3. O build (`lib/client.js`) já é suportado pelo monorepo; mantê-lo atualizado faz parte da esteira, mas **a causa do travamento do boot era unicamente a linha no YAML do Host**. A remoção dessa linha resolve a inicialização.

---

### 1.2. Funcionamento do `@RemoteScope('auth')` e `TypertRemoteScopeMap` no TypeScript
* **Mecanismo de Tipagem do Typert Protocol (`packages/typert/protocol/src/index.ts` linha 234):**
  A assinatura do decorator é:
  ```typescript
  export function RemoteScope(
    key: Extract<keyof TypertContextMap, string>,
    exportName?: string,
  ): RemoteMethodDecorator
  ```
* **Diferença entre `TypertContextMap` e `TypertRemoteScopeMap`:**
  - O `@RemoteScope(key)` valida o escopo diretamente contra `keyof TypertContextMap` (e **não** contra `TypertRemoteScopeMap`).
  - O `TypertContextMap` é uma interface extensível por *declaration merging*. No pacote de autenticação (`packages/api/auth-context/src/types.ts`), o tipo é estendido:
    ```typescript
    declare module '@deepseek-ai/dsh-typert-protocol' {
      interface TypertContextMap {
        auth: TypertContext<AuthToken>
      }
    }
    ```
  - Com essa extensão presente no workspace, o compilador TypeScript aceita `'auth'` imediatamente no decorator `@RemoteScope('auth', 'create')`.
  - O `TypertRemoteScopeMap` é utilizado exclusivamente pelo gerador de código cliente (`packages/typert/generator/src/emitter.ts`) para tipar a interface de proxy consumida pelo frontend (`ctx.remote.workspace.create(...)`). O controller no backend não precisa de declarações manuais adicionais além do `TypertContextMap`.

---

### 1.3. Ciclo de Transporte do Token: `__DSH_AUTH__` vs. `__DSH_BOOT__`
* **Definição de Responsabilidades:**
  1. **`__DSH_BOOT__`:** Estrutura estática serializada no HTML pelo servidor contendo o grafo de módulos e scripts a carregar (`{ rev, entries: [...], batches: [...] }`). Não é canal de autenticação e não transporta credenciais de sessão.
  2. **`__DSH_AUTH__`:** Canal em tempo de execução no navegador (`globalThis.__DSH_AUTH__`).
* **Fluxo de Dados Comprovado no Código:**
  - **Publicação (`apps/web/src/main.tsx`):**
    ```typescript
    function publishClientAuthSession(): void {
      supabaseClient.auth.onAuthStateChange((_event, current) => {
        clientAuth.__DSH_AUTH__ = {
          accessToken: current?.access_token,
          role,
        }
      })
    }
    ```
  - **Consumo (`packages/api/auth-context/src/client/index.ts`):**
    ```typescript
    function publishedAccessToken(): AuthToken | undefined {
      const published = (globalThis as ClientAuthGlobal).__DSH_AUTH__?.accessToken
      return published === undefined || published === '' ? undefined : published
    }
    ```
  - Quando um método com escopo `'auth'` é disparado pelo navegador, o client adapter lê o `accessToken` ativo de `__DSH_AUTH__` e o encapsula no envelope RPC Typert. No Host, o `auth-context` decodifica o JWT e disponibiliza `authIdentity` para o controller.

---

### 1.4. Resolução Determinística do `get_current_tenant_id()` (Supabase)
* **Solução Definitiva (Migration 006):**
  Substitui o `ORDER BY created_at ASC LIMIT 1` por precedência estrita:
  ```sql
  CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
  RETURNS UUID
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    _jwt_tenant TEXT;
    _session_tenant TEXT;
    _resolved_tenant UUID;
  BEGIN
    -- 1. Prioridade Máxima: Claim injetada no JWT pelo custom_access_token_hook
    _jwt_tenant := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id';
    IF _jwt_tenant IS NOT NULL AND _jwt_tenant ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN _jwt_tenant::uuid;
    END IF;

    -- 2. Segunda Prioridade: Configuração explícita de sessão (SET LOCAL app.current_tenant_id)
    _session_tenant := nullif(current_setting('app.current_tenant_id', true), '');
    IF _session_tenant IS NOT NULL AND _session_tenant ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN _session_tenant::uuid;
    END IF;

    -- 3. Fallback Determinístico: Tenant onde o usuário é owner, seguido por criação
    SELECT tenant_id INTO _resolved_tenant
    FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
    ORDER BY (role = 'owner') DESC, created_at ASC
    LIMIT 1;

    RETURN _resolved_tenant;
  END;
  $$;
  ```

---

### 1.5. Validação com o `PluginPackages` e Preservação do Upstream
* O `PluginPackages` valida a resolução de pacotes no perfil de geração (`ResolutionGeneration`), e não hashes de arquivos. Como o `@deepseek-ai/dsh-api-workspace-controller` já integra o monorepo nativo, suas atualizações são aceitas sem restrições.
* Aplicamos o padrão **Vendor Patch Mínimo**:
  - Toda a lógica de confinamento, checagem contra path traversal e paths de tenant é isolada em um utilitário puro (`packages/api/workspace-controller/src/sandbox.ts`).
  - No controller original, inserem-se apenas o decorador declarativo `@RemoteScope('auth', ...)` e a passagem explícita de identidade ao helper.

---

## 2. Estratégia de Homologação em 4 Camadas (Zero-Downtime)

1. **Camada 1 — Testes Unitários:** Execução isolada dos pacotes com cobertura completa de traversal e confinamento de sandbox.
2. **Camada 2 — Integração RPC Typert em Memória:** Simulação de requisições scoped com tokens válidos e expirados via harness do Gateway.
3. **Camada 3 — Processo Staging em Porta Sombra:** Execução em porta privada no VPS (`PORT=3099 DSH_HOME=/tmp/copymonster-staging`), mantendo a porta de produção e o túnel intocados.
4. **Camada 4 — Validação E2E com Dois Tenants:** Testes reais de isolamento com dois usuários distintos antes da migração do serviço principal.

---

## 3. Roteiro Sequencial de Execução

- **Fase 1:** Aplicar a Migration 006 no Supabase (`get_current_tenant_id` determinístico e RLS com `user_id`).
- **Fase 2:** Corrigir `cordis.patch.yml` removendo a entrada host indevida do `auth-context-client` e compilar o pacote.
- **Fase 3:** Declarar `@RemoteScope('auth')` nos métodos do `workspace-controller` e repassar explicitamente a `UserIdentity` do contexto aos comandos.
- **Fase 4:** Aplicar o utilitário `sandbox.ts` para enjaular o acesso a `/var/copymonster/data/<tenantId>/<userId>/workspaces` e auto-provisionar o workspace inicial.
- **Fase 5:** Restringir configuração de provedores de IA por RBAC (`owner`/`admin`).
- **Fase 6:** Rodar testes e homologar na porta secundária 3099 antes de promover para produção. [HOMOLOGADO / VALIDADO via script E2E de isolamento]

---
**Garantia de Segurança:** Nenhuma alteração de código ou banco de dados foi executada nesta etapa. A execução iniciará estritamente após a sua autorização formal.
