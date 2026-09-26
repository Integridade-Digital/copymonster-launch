# CopyMonster: Plano de Engenharia para Isolamento Multi-Tenant, Blindagem de Workspaces e RBAC de Provedores de IA

**Documento:** Arquitetura e Engenharia de Correção Definitiva  
**Autor:** Engenharia Lovable / CopyMonster  
**Data:** 26 de Setembro de 2026  
**Status:** Aguardando Aprovação do Usuário para Execução  
**Classificação:** Crítica (Segurança e Isolamento de Dados)

---

## 1. Visão Geral e Objetivos do Projeto

O objetivo deste plano é solucionar em definitivo, com qualidade e rigor de nível de engenharia de software sênior, três problemas críticos identificados no **CopyMonster** (fork do DeepSeek Harness):

1. **Vazamento Cruzado de Dados entre Usuários (Multi-Tenancy Quebrado):**
   Garantir isolamento estrito de dados (banco de dados, sessões, mensagens, metadados) usando Row Level Security (RLS) no Supabase e contexto nativo de autenticação no backend.
2. **Vazamento de Workspaces e Filesystem do VPS para Novos Usuários:**
   Impedir que qualquer novo usuário enxergue diretórios do servidor host (VPS) ou projetos pertencentes a outros clientes. Cada tenant/usuário terá seu próprio diretório isolado (*jail sandbox*) montado sob `/var/copymonster/tenants/{tenant_id}/workspaces/{user_id}/`.
3. **Exposição de Configurações de Provedores de IA a Usuários Comuns:**
   Restringir integralmente a visualização e alteração de provedores LLM (chaves de API, modelos, provedores DeepSeek, OpenAI, Anthropic, Ollama) apenas a administradores (`role IN ('owner', 'admin')`), tanto visualmente no frontend quanto por autorização estrita no backend RPC/HTTP.

Nenhuma funcionalidade existente (chat, criação de sessões, execução de ferramentas, UI/UX do estúdio) será degradada.

---

## 2. Diagnóstico Técnico Detalhado das Falhas

### 2.1. O Motor Original do DeepSeek Harness
O *DeepSeek Harness* foi concebido como uma ferramenta de desktop/CLI local (mono-usuário):
- O `WorkspaceRegistry` (`packages/workspace/workspace/src/index.ts`) lê e cataloga caminhos absolutos arbitrários do sistema de arquivos da máquina local.
- O `WorkspaceFeed` (`packages/api/workspace-controller/src/feed.ts`) despacha a lista global de `ctx.workspaceRegistry.list()` para qualquer cliente WebSocket/RPC conectado, sem filtrar por identidade ou token.
- O `DirectoryPickerController` (`packages/api/workspace-controller/src/directory-picker.ts`) permite navegação livre pelo sistema de arquivos do VPS se não for restringido por uma raiz enjaulada.

### 2.2. A Camada de Configuração de Modelos (LLM Settings)
- O pacote `packages/client/ui-settings-models` e a casca de configurações em `packages/client/ui-settings` registram seções como `@deepseek-ai/dsh-model-control` diretamente na interface do usuário.
- O backend aceita operações de patch/write nas configurações de provedores sem verificar a role do usuário logado (`ctx.authIdentity.role`).

### 2.3. As Políticas de Dados no Supabase
- Embora existam migrações preliminares (`001` a `004`), o vínculo de tenant de novos usuários necessita de garantia determinística no trigger `on_auth_user_created`, e todas as consultas de workspaces devem passar pela tabela `workspaces_meta` associada a `tenant_id` e `user_id`.

---

## 3. Arquitetura de Isolamento Proposta

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CLIENTE WEB (Browser)                         │
│  - useAuth() fornece { userId, tenantId, role }                        │
│  - ui-settings-models: condicionado a role === "admin" | "owner"       │
│  - DirectoryPicker: confinado à raiz relativa do usuário                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSocket / RPC com Bearer Token
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        GATEWAY & CORDIS BACKEND                        │
│  - ctx.authIdentity: validado via JWT claims (tenant_id, user_role)     │
│  - WorkspaceFeed: filtra workspaces por tenant_id                      │
│  - DirectoryPickerController: validação de path traversal (chroot jail)│
│  - SettingsController: bloqueia mutação de LLM se role !== admin/owner │
└───────────────────────┬────────────────────────┬───────────────────────┘
                        │                        │
                        ▼                        ▼
┌───────────────────────────────────┐  ┌─────────────────────────────────┐
│     FILESYSTEM ISOLADO (VPS)      │  │        SUPABASE (PostgreSQL)    │
│  /data/tenants/{tenant_id}/       │  │  - RLS ativado em 100% tabelas   │
│    └── users/{user_id}/           │  │  - tenant_id no JWT claim       │
│          └── workspaces/          │  │  - workspaces_meta filtrado     │
└───────────────────────────────────┘  └─────────────────────────────────┘
```

---

## 4. Plano Passo a Passo de Implementação

### FASE 1: Banco de Dados e Supabase (Identidade e Isolamento Estrito)

#### 1.1. Tabela `workspaces_meta` e Políticas RLS
Garantir no Supabase uma migração formal (`005_workspaces_multi_tenant.sql`):
```sql
CREATE TABLE IF NOT EXISTS public.workspaces_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_tenant_workspace UNIQUE (tenant_id, workspace_id)
);

ALTER TABLE public.workspaces_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workspaces of their tenant"
  ON public.workspaces_meta FOR SELECT
  TO authenticated
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (user_id = auth.uid() OR (auth.jwt() ->> 'user_role') IN ('owner', 'admin'))
  );

CREATE POLICY "Users can insert workspaces in their tenant"
  ON public.workspaces_meta FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND user_id = auth.uid()
  );

CREATE POLICY "Users can delete own workspaces or admins can delete tenant workspaces"
  ON public.workspaces_meta FOR DELETE
  TO authenticated
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (user_id = auth.uid() OR (auth.jwt() ->> 'user_role') IN ('owner', 'admin'))
  );
```

#### 1.2. Provisionamento Determinístico de Novo Usuário (Trigger)
Garantir que todo usuário novo receba seu próprio tenant individual (caso seja self-signup) ou entre no tenant para o qual foi convidado:
- Criação em `public.tenants` com slug amigável único.
- Inserção em `public.users`.
- Inserção em `public.user_tenant_roles` com papel `owner` (se criar seu tenant) ou `member` (se for convidado).
- Atualização imediata do claim do JWT através do `custom_access_token_hook`.

---

### FASE 2: Backend — Enjaulamento de Filesystem e Workspaces no VPS

#### 2.1. Definição do Diretório Raiz por Tenant/Usuário
Em `packages/workspace/workspace` e `packages/api/workspace-controller`:
1. Definir a variável de ambiente central:
   `COPYMONSTER_DATA_DIR` (padrão: `/var/copymonster/data` ou `./data/tenants`).
2. Implementar a função utilitária `resolveTenantSandboxPath(tenantId: string, userId: string, subPath?: string)`:
   - Garante a criação de `${COPYMONSTER_DATA_DIR}/${tenantId}/${userId}/workspaces`.
   - Utiliza `path.resolve` e impede estritamente **path traversal** (`..`), garantindo que o caminho resolvido sempre comece com o prefixo da pasta do tenant.
   - Qualquer tentativa de acessar caminhos do sistema (ex: `/etc`, `/root`, `/home`, ou workspaces de terceiros) lança `RemoteError.forbidden('Acesso negado fora do sandbox do tenant')`.

#### 2.2. Filtragem no `WorkspaceFeed` e `WorkspaceCommands`
Em `packages/api/workspace-controller/src/feed.ts`:
- No método `baseline(cursor)` e no listener de mutações:
  - Recuperar `ctx.authIdentity`. Se não houver identidade autenticada, retornar baseline vazia.
  - Consultar no banco Supabase (ou cache de metadados) os workspaces vinculados àquele `tenantId` e `userId`.
  - Transmitir no `feed` apenas os workspaces autorizados daquele usuário/tenant.
- Em `packages/api/workspace-controller/src/commands.ts`:
  - `create(request)`: Verificar se o path fornecido está dentro do sandbox do usuário. Se não estiver, redirecionar o path para dentro do sandbox `${tenantDir}/workspaces/${request.name}`.
  - Persistir o metadado em `workspaces_meta`.

#### 2.3. Blindagem do `DirectoryPickerController`
Em `packages/api/workspace-controller/src/directory-picker.ts`:
- O comando `listDirectories` e `browse` deve receber como raiz máxima (`root`) o caminho do sandbox do usuário.
- Desabilitar a capacidade de navegar para o diretório pai (`..`) quando o usuário já estiver na raiz do seu sandbox.

---

### FASE 3: Controle de Acesso a Provedores de IA (RBAC)

#### 3.1. Proteção Visual no Frontend
1. **Identificação de Permissão:**
   - No hook `useAuth()`, extrair `user.role` do perfil/JWT.
   - Criar o helper `isAdminOrOwner = role === 'owner' || role === 'admin'`.
2. **Ocultar Abas no Painel de Configurações:**
   - Em `packages/client/ui-settings/src/client/` e `packages/client/ui-settings-models`:
     - Condicionar o registro do item de menu / aba **"Provedores de Modelos"** / **"Model Providers"** e **"Chaves de API"**:
       ```tsx
       if (!isAdminOrOwner) {
         return null; // Não renderiza a aba nem a opção na barra lateral
       }
       ```
3. **Guarda de Rota e Fallback:**
   - Se o usuário tentar forçar a abertura de modal ou URL direta para configuração de provedores, renderizar card explicativo:  
     *"Configurações de IA são gerenciadas exclusivamente pelo administrador da sua organização."*

#### 3.2. Bloqueio no Backend (Host Settings RPC)
1. **Validação nas Mutações de Configuração:**
   - No manipulador de mutação do namespace de configurações de modelos (`@deepseek-ai/dsh-model-control` ou equivalente):
     ```typescript
     const identity = ctx.authIdentity;
     if (!identity || (identity.role !== 'owner' && identity.role !== 'admin')) {
       throw new RemoteError('forbidden', 'Apenas administradores podem configurar provedores de IA.');
     }
     ```
   - Impedir que usuários comuns leiam as chaves de API cruas cadastradas no servidor.

---

### FASE 4: Criação do Workspace Inicial Automático (Zero-State)

Para novos usuários:
1. Quando um novo usuário fizer login pela primeira vez, o sistema não deve exibir erro nem tela em branco:
   - Detectar se `workspaces` está vazio.
   - Criar automaticamente uma pasta padrão no VPS:  
     `${COPYMONSTER_DATA_DIR}/${tenantId}/${userId}/workspaces/Meu-Primeiro-Projeto`.
   - Inicializar um arquivo de boas-vindas (`README.md` ou guia do CopyMonster).
   - Registrar no Supabase `workspaces_meta`.
   - Entregar o usuário diretamente em seu workspace privado, pronto para trabalhar.

---

### FASE 5: Matriz de Testes e Validação de Segurança

| Caso de Teste | Ação Executada | Resultado Esperado |
|:---|:---|:---|
| **1. Novo Usuário** | Cadastrar conta com email teste | Usuário entra em um workspace limpo; não enxerga nenhuma pasta do VPS. |
| **2. Tentativa de Path Traversal** | Enviar requisição RPC tentando abrir `/etc/` ou `/root` | Backend rejeita com erro `forbidden`. |
| **3. Isolamento Cruzado** | Usuário A cria arquivo; Usuário B faz login | Usuário B não vê nem lista os arquivos e workspaces de Usuário A. |
| **4. Visibilidade de Provedores (Membro)** | Logar como usuário com role `member` | Aba de Provedores de IA não aparece nas configurações. |
| **5. Bloqueio de API de Provedores** | Membro tenta enviar payload de mutação de API key | Backend retorna status 403 Forbidden. |
| **6. Acesso Admin de Provedores** | Logar como usuário com role `admin` ou `owner` | Painel de configuração de modelos e chaves funciona normalmente. |

---

## 5. Próximos Passos e Governança

Este plano cobre de ponta a ponta:
- Integridade do banco de dados (PostgreSQL/Supabase com RLS).
- Isolamento do sistema de arquivos no VPS (jail sandboxing).
- Proteção da API do harness e do frontend (RBAC).

**Nenhum código será alterado sem a sua autorização expressa.**
Quando você aprovar, iniciaremos a execução faseada conforme as etapas descritas acima.
