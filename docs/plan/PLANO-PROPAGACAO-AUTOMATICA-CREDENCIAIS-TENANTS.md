# Plano de Implementação: Propagação Automática de Credenciais e Rotas de IA para Tenants

**Status:** Aguardando Aprovação  
**Data:** 21 de Novembro de 2026  
**Autor:** Equipe de Engenharia CopyMonster  
**Repositórios Alvo:**  
- `copymonster-dsh-server-login` (Orquestrador multi-tenant / VPS)  
- `copymonster-launch` (Frontend SPA, Backend Cordis e Políticas de Roteamento)

---

## 1. Sumário Executivo & Diagnóstico Raiz

### 1.1 O Cenário Atual
Na arquitetura do CopyMonster, o subdomínio `funel.copymonster.co` opera como o **Tenant Mestre do Administrador**. Através da interface web em **Settings > Models**:
1. O Administrador cadastra e gerencia as chaves de API de provedores (OpenRouter, DeepSeek, Nvidia, Mistral, etc.), as quais são validadas com sucesso (exibindo status ativo/bolinha verde).
2. O Administrador define o roteamento central em **Provider routing** (ex: Primary Provider: `openrouter`, Primary Model: `Nemotron 3 Ultra 550B`), que é persistido no Supabase via RPC `save_platform_model_routing`.

### 1.2 A Causa Raiz do Erro de Autenticação (`A chave API é inválida`)
1. **Isolamento de Credenciais por Tenant:**  
   Quando o Admin salva as chaves na UI, o serviço `credentials-local` do DSH grava os segredos exclusivamente no arquivo local do tenant do admin:  
   `/var/lib/dsh-server-login/users/<admin-uuid>/home/.credentials.yaml`.
2. **Desconexão da Fonte Global no Orquestrador:**  
   O orquestrador (`dsh-server-login`) possui a função `seedGlobalCredentials`, mas ela lê exclusivamente da constante `DEFAULT_GLOBAL_CREDENTIALS` (`/root/.dsh/.credentials.yaml`). Como o Admin gerencia tudo pela interface web (e não via terminal no arquivo do root), o arquivo de origem global permanece vazio ou ausente.
3. **Tenants Órfãos de Credenciais:**  
   Cada usuário comum (como `funnels.copymonster.co`, `vieir.copymonster.co` ou novos cadastros) roda em sua própria pasta isolada (`/var/lib/dsh-server-login/users/<tenant-uuid>/home/`). Quando o chat tenta acionar o modelo mascarado (`copymonster/copy-monster-default`), o adapter tenta resolver `OPENROUTER_API_KEY` no cofre local do tenant ou nas variáveis de ambiente. Como ambos estão vazios para aquele processo, a chamada é abortada com o erro:  
   `message.failure.auth` -> *"A chave API é inválida"*.

---

## 2. Diretrizes da Arquitetura Definitiva (À Prova de Falhas)

A arquitetura de longo prazo deve eliminar qualquer dependência de comandos manuais no terminal e garantir operação 100% autônoma pelo painel web:

1. **Tenant Admin como Fonte da Verdade Única (Single Source of Truth):**  
   O orquestrador deve reconhecer dinamicamente o usuário com role de administrador (`funel` / `role = 'admin'`) e utilizar o seu cofre (`.credentials.yaml`) como o repositório mestre de credenciais ativas.
2. **Propagação Imediata na Criação (Zero-Day Readiness):**  
   Todo novo tenant provisionado via `initUserRoot` deve receber automaticamente a cópia sanitizada das chaves do Admin e o arquivo de roteamento apontando para o modelo mascarado da plataforma.
3. **Reconciliação Automática para Tenants Existentes:**  
   Ao iniciar instâncias existentes (via auto-launch ou restart), o orquestrador deve reconciliar as chaves do tenant com o cofre mestre do Admin, aplicando rotações de chave ou novos provedores sem exigir recriação de conta.
4. **Dupla Camada de Resiliência (Arquivo + Process Environment):**  
   Além de gravar no cofre `.credentials.yaml` (com permissão segura `0600` e UID do tenant), o orquestrador deve repassar as chaves conhecidas diretamente para as variáveis de ambiente do processo filho (`baseEnv`). Se uma camada falhar ou sofrer delay de I/O, a outra garante a autenticação imediata.
5. **Failover e Continuidade Operacional:**  
   Manter a contingência configurada em **Provider routing** (ex: se o primário falhar com 402 sem créditos ou 429 rate limit, a rota de contingência é acionada antes de emitir qualquer erro ao usuário).

---

## 3. Plano Detalhado de Implementação

### Fase 1: Módulo de Resolução de Credenciais Mestre (`copymonster-dsh-server-login`)
**Arquivo:** `src/supervisor/master-credentials.ts` (Novo)
- Implementar classe/função `resolveMasterCredentials(db: DatabaseAdapter, dataRoot: string): CredentialStore`:
  1. Consulta a tabela `users` para localizar o usuário com `role = 'admin'` (ou slug mestre `funel`).
  2. Localiza o caminho do cofre: `join(userRoot(dataRoot, adminUser.id), 'home', '.credentials.yaml')`.
  3. Realiza parse seguro via `js-yaml`.
  4. Se não encontrar ou o arquivo estiver vazio, aplica fallback gracioso para `/root/.dsh/.credentials.yaml`.
  5. Retorna o mapa de chaves ativas (`refs`).

### Fase 2: Atualização do Mecanismo de Semente de Credenciais (`local-user-fs.ts`)
**Arquivo:** `src/fs/local-user-fs.ts`
- Atualizar a função `seedGlobalCredentials(home: string, masterCredentials?: CredentialStore)`:
  - Receber as credenciais mestre resolvidas na Fase 1.
  - Ler o `.credentials.yaml` do tenant destino (se existir).
  - Fazer o merge onde as chaves configuradas pelo Admin têm precedência sobre configurações vazias.
  - Persistir o arquivo de forma atômica (`writeFileSync` com modo seguro `0o600`).
  - Assegurar que as permissões e o ownership do arquivo sejam ajustados para o UID do tenant (impedindo erro de permissão EACCES ou rejeição do plugin de credenciais).

### Fase 3: Injeção de Ambiente em Tempo de Execução (`orchestrator.ts`)
**Arquivo:** `src/supervisor/orchestrator.ts`
- Atualizar `baseEnv(userId: string)`:
  - Obter as chaves mestre do Admin.
  - Estender `platformApiKeys` para extrair dinamicamente todas as chaves de provedores presentes nas `refs` do Admin:
    - `OPENROUTER_API_KEY`
    - `DEEPSEEK_API_KEY`
    - `OPENAI_API_KEY`
    - `NVIDIA_API_KEY`
    - `MISTRAL_API_KEY`
  - Injetar essas variáveis no ambiente do processo filho DSH.
- Atualizar `spawnInstance`:
  - Antes do `spawnAsUser`, garantir uma chamada rápida de verificação do `.credentials.yaml` do tenant para que o arquivo esteja sempre atualizado com a última versão do Admin.

### Fase 4: Garantia de Replicação no Auto-Launch (`proxy.ts`)
**Arquivo:** `src/supervisor/proxy.ts`
- No hook de auto-launch (quando o usuário acessa seu subdomínio e a instância ainda não está ativa):
  - A chamada existente `await app.userFs.initUserRoot(user.id, uid, publicOrigin)` já garante a execução completa da sincronização de rotas e credenciais.
  - Adicionar log estruturado claro confirmando: `credentials synchronized from admin to tenant [tenant_name]`.

---

## 4. Matriz de Validação e Testes

| Cenário de Teste | Ação Executada | Resultado Esperado |
| :--- | :--- | :--- |
| **1. Novo Tenant** | Criar um novo usuário / subdomínio e acessar. | O orquestrador executa `initUserRoot`, copia a chave do `funel` e o novo usuário consegue enviar mensagens no chat sem erro. |
| **2. Tenant Existente** | Acessar subdomínio de tenant comum já existente (ex: `funnels`). | O auto-launch atualiza o `.credentials.yaml` local, injeta as envs e o chat responde normalmente. |
| **3. Rotação de Chave** | Admin altera a chave do OpenRouter em `funel.copymonster.co`. | A nova chave é salva no `.credentials.yaml` do admin e propagada automaticamente para as sessões dos tenants. |
| **4. Alteração de Rota** | Admin altera o modelo primário em **Provider routing** (ex: muda de Nemotron para outro modelo). | A nova rota é gravada no Supabase e aplicada aos tenants no próximo ciclo/turn do chat. |
| **5. Segurança e RLS** | Tenant comum tenta acessar a rota de administração de modelos. | Acesso é bloqueado com 403; o tenant comum só enxerga o modelo virtual `Model CopyMonster` (`copymonster/copy-monster-default`). |

---

## 5. Procedimento de Aplicação no VPS (Runbook Pós-Aprovação)

Após o commit e push do código nos repositórios, a aplicação no VPS consistirá apenas em:
1. Conectar via SSH ao VPS.
2. Navegar até a pasta do serviço: `cd /root/copymonster-dsh-server-login`.
3. Puxar as atualizações: `git pull origin master`.
4. Recompilar o serviço: `pnpm build` (ou `npm run build`).
5. Reiniciar o serviço do orquestrador: `systemctl restart dsh-server-login`.
6. Testar no navegador acessando `funnels.copymonster.co` e enviando uma mensagem no chat.

---

## 6. Conclusão

Com este plano, o problema de chaves de IA em tenants comuns fica definitivamente solucionado. A plataforma ganha uma arquitetura multi-tenant robusta, onde o painel administrativo do tenant mestre (`funel`) governa com autoridade total as credenciais e roteamentos de todos os clientes do SaaS de maneira transparente e instantânea.
