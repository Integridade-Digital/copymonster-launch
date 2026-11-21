# Plano de Arquitetura e Implementação: Gateway Central de Modelos LLM em Loopback com Streaming SSE e Isolamento de Chaves

**Status:** Aprovado conceitualmente para implementação  
**Data:** 21 de Novembro de 2026  
**Autor:** Equipe de Engenharia CopyMonster  
**Repositórios-Alvo:**
- `copymonster-dsh-server-login` — Orquestrador multi-tenant, Gateway LLM loopback, Cofre mestre e Emissor de tokens de sessão
- `copymonster-launch` — Frontend SPA, Adaptador LLM para Gateway, UI de Settings > Models (Admin) e Chat

---

## 1. Sumário Executivo & Diagnóstico Raiz

### 1.1 Cenário Atual
Na plataforma CopyMonster:
1. O subdomínio `funel.copymonster.co` opera como o **Tenant Mestre do Administrador**. Através de **Settings > Models**:
   - O Admin cadastra e gerencia as chaves reais de API (OpenRouter, DeepSeek, OpenAI, etc.), que ficam ativas e validadas (indicador verde).
   - O Admin configura a política de roteamento em **Provider routing** (modelo primário e modelo de contingência), persistida no Supabase via RPC `save_platform_model_routing`.
2. As chaves salvas pelo DSH são gravadas no cofre do tenant Admin em `/var/lib/dsh-server-login/users/<admin-uuid>/home/.credentials.yaml`.
3. Os tenants comuns (como `funnels.copymonster.co`, `vieir.copymonster.co` e novos cadastros) rodam em seus próprios diretórios e processos isolados (`/var/lib/dsh-server-login/users/<tenant-uuid>/`).
4. Ao enviar mensagens no chat, os tenants comuns tentam resolver as credenciais dos provedores localmente. Como os tenants não possuem essas chaves em seu cofre local nem em seu ambiente, a chamada é abortada com o erro:
   > **"Falha / Este turno falhou A chave API é inválida"** (`message.failure.auth`)

---

### 1.2 Modelo de Ameaça (Threat Model) & Por Que Soluções Ingênuas Falham

| Abordagem Avaliada | Mecanismo | Risco Crítico de Segurança | Veredito |
| :--- | :--- | :--- | :--- |
| **Cópia para arquivo local** | Copiar chaves para `home/.credentials.yaml` de cada tenant | Chaves mestres salvas em disco no diretório do tenant. Qualquer usuário com acesso ao terminal ou plugin malicioso pode ler o arquivo e roubar a chave e saldo da conta. | **Rejeitado (Inseguro)** |
| **Injeção via `baseEnv`** | Injetar chaves em `process.env` do processo do tenant | O processo filho do tenant tem a chave em memória. Plugins maliciosos instalados pelo usuário rodam no mesmo processo e podem inspecionar `process.env` ou ler `/proc/<pid>/environ`, exfiltrando a credencial mestre. | **Rejeitado (Inseguro)** |
| **Gateway Central em Loopback com SSE** | Chaves mantidas exclusivamente no servidor confiável; tenant consome API interna com token de sessão | O processo do tenant **nunca recebe a chave**, nem em disco, nem no ambiente, nem na memória, nem em cabeçalhos HTTP. Elimina 100% o vetor de exfiltração. | **Aprovado (Padrão da Indústria)** |

A arquitetura de **Gateway Central em Loopback** é o padrão utilizado por SaaS enterprise (ex: OpenAI Proxy, LiteLLM, Cloudflare AI Gateway, Portkey) e resolve o problema na raiz: **o segredo nunca entra na fronteira de confiança do tenant**.

---

## 2. Desenho da Arquitetura: Gateway Central em Loopback

### 2.1 Fluxo de Dados e Fronteira de Isolamento

```
+----------------------------------------------------------------------------------------------------+
|                                    FRONTEIRA DO TENANT (NÃO CONFIÁVEL)                             |
|                                                                                                    |
|  [ Browser do Usuário ]                                                                            |
|          | (SSE / WebSocket)                                                                       |
|          v                                                                                         |
|  [ Processo do Tenant (copymonster-launch) ]                                                       |
|          |  Variáveis injetadas:                                                                   |
|          |    - COPYMONSTER_LLM_GATEWAY_URL="http://127.0.0.1:4010/internal/v1/llm"                |
|          |    - COPYMONSTER_INTERNAL_SESSION_TOKEN="<token_assinado_hmac>"                         |
|          |                                                                                         |
|          |  *NENHUMA CHAVE DE PROVEDOR PRESENTE EM ARQUIVO OU ENV*                                |
+----------|-----------------------------------------------------------------------------------------+
           |
           | HTTP POST /internal/v1/llm/chat/completions
           | Header: Authorization: Bearer <token_assinado_hmac>
           | Body: { model: "copymonster/copy-monster-default", messages: [...], stream: true }
           | Conexão restrita a 127.0.0.1 (Loopback)
           v
+----------------------------------------------------------------------------------------------------+
|                                    FRONTEIRA DO SERVIDOR (CONFIÁVEL - VPS)                         |
|                                                                                                    |
|  [ Gateway Central LLM (dsh-server-login / Fastify interno em 127.0.0.1:4010) ]                   |
|          |                                                                                         |
|          |-- 1. Valida Assinatura do Token Interno (HMAC-SHA256) e extrai tenant_id                |
|          |-- 2. Consulta Roteamento Ativo (Provider Routing no Supabase / Cache em memória)        |
|          |-- 3. Resolve Chave Mestre Atual no Cofre do Admin (/home/.credentials.yaml do Admin)    |
|          |-- 4. Executa Failover se Primário retornar erro antes do 1º chunk (401, 402, 429, 503)  |
|          |                                                                                         |
|          v                                                                                         |
|  [ Cliente HTTP Upstream do Gateway ]                                                              |
|          | Injeta: Authorization: Bearer <CHAVE_MESTRE_REAL>                                       |
|          | Destino: https://openrouter.ai/api/v1/chat/completions (ou DeepSeek / OpenAI)           |
+----------|-----------------------------------------------------------------------------------------+
           |
           | Chamada HTTPS Externa
           v
+------------------------------------+
|    PROVEDOR EXTERNO (OpenRouter)   |
|   Recebe chave mestre da plataforma|
|   Gera tokens de inferência        |
+------------------------------------+
           |
           | Streaming SSE de Resposta (chunks: data: {"choices":[{"delta":{"content":"..."}}]})
           v
+----------------------------------------------------------------------------------------------------+
|  [ Gateway Central LLM ]                                                                           |
|          | Repassa SSE em tempo real (pipe direto com flush imediato, latência zero)               |
|          | Sanitiza cabeçalhos (remove qualquer referência a chaves ou upstream interno)            |
+----------|-----------------------------------------------------------------------------------------+
           | text/event-stream (SSE)
           v
+----------------------------------------------------------------------------------------------------+
|  [ Processo do Tenant ]                                                                            |
|          | Consome SSE e despacha para a UI do chat                                                |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. Especificação Técnica Detalhada

### 3.1 Mecanismo de Autenticação do Tenant (Internal Session Token)

1. **Geração do Token pelo Orquestrador:**
   - Ao inicializar o processo do tenant (em `spawnInstance`), o `dsh-server-login` gera um token interno assinado com chave secreta do host (`GATEWAY_INTERNAL_SECRET` gerada e persistida em `/var/lib/dsh-server-login/.gateway-secret`).
   - O payload do token contém:
     ```json
     {
       "sub": "<tenant_user_id>",
       "slug": "<tenant_subdomain>",
       "iat": 1763697600,
       "exp": 1763784000,
       "scope": "llm:infer"
     }
     ```
   - O token possui escopo estrito `llm:infer`. Não tem permissão para acessar nenhuma rota administrativa do DSH, ler credenciais ou invocar outras APIs.
2. **Validação no Gateway:**
   - O Gateway verifica a assinatura HMAC-SHA256 e o tempo de expiração (`exp`).
   - Valida se o `tenant_user_id` existe e está ativo na tabela `users` do banco local SQLite.
   - Aplica rate-limit de segurança por tenant (ex: 60 requisições/minuto) para evitar abuso.

---

### 3.2 Endpoint do Gateway Central (Fastify / Loopback)

1. **Associação de Rede (Binding):**
   - Escuta **exclusivamente** em `127.0.0.1:4010` (ou socket unix `/run/copymonster-llm.sock`).
   - Não há exposição em interfaces externas (`0.0.0.0`), portas públicas do Nginx ou túneis do Cloudflare.
2. **Rota:**
   - `POST /internal/v1/llm/chat/completions`
   - Compatível com a especificação standard de OpenAI/OpenRouter (recebe `model`, `messages`, `temperature`, `max_tokens`, `stream: true`).
3. **Resolução de Chave em Memória:**
   - O Gateway lê o arquivo de credenciais do Admin (`/var/lib/dsh-server-login/users/<admin-uuid>/home/.credentials.yaml`) sob demanda com cache seguro de 30 segundos ou invalidação por evento.
   - O valor da chave (`OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, etc.) reside apenas na memória volátil da requisição HTTP do Gateway e **nunca é registrado em log, payload ou cabeçalho retornado**.
4. **Streaming SSE End-to-End:**
   - O Gateway define cabeçalhos HTTP:
     ```http
     Content-Type: text/event-stream
     Cache-Control: no-cache
     Connection: keep-alive
     X-Accel-Buffering: no
     ```
   - Cada chunk SSE recebido do provedor upstream é repassado imediatamente ao stream de resposta do tenant (`response.raw.write(chunk)` com flush).
   - Não há bufferização do corpo completo, garantindo **Time-To-First-Token (TTFT)** idêntico à chamada direta.

---

### 3.3 Failover Transparente Antes do Primeiro Chunk

1. **Erros Elegíveis para Contingência:**
   - HTTP 401/403 (Credencial do provedor primário revogada/inválida).
   - HTTP 402 (Saldo esgotado no provedor primário).
   - HTTP 429 (Rate limit estourado no provedor primário).
   - HTTP 502/503/504 (Provedor primário temporariamente indisponível).
2. **Comportamento do Failover:**
   - O Gateway inspeciona o status code da resposta do provedor primário **antes** de enviar os cabeçalhos SSE para o tenant.
   - Se houver falha elegível:
     1. O Gateway não envia erro ao tenant.
     2. Consulta a rota de contingência configurada em **Provider routing** (ex: `Fallback Provider: deepseek`, `Fallback Model: deepseek-chat`).
     3. Resolve a chave do provedor de contingência no cofre do Admin.
     4. Dispara a requisição para o provedor de contingência e conecta o stream SSE ao tenant.
     5. Emite log de auditoria interno seguro (ex: `[LLM-GATEWAY] Failover triggered: openrouter -> deepseek for tenant funnels`).
   - Se o primeiro chunk SSE já tiver sido despachado para o tenant, a conexão não pode mais ser trocada, garantindo que o stream não seja corrompido.

---

## 4. Plano de Implementação por Repositório

### Fase 1: Gateway Central em Loopback (`copymonster-dsh-server-login`)
**Arquivos afetados:**
1. `src/gateway/llm-loopback-server.ts` *(Novo)*:
   - Instanciação de servidor Fastify dedicado escutando em `127.0.0.1:4010`.
   - Rotas de health check (`GET /internal/health`) e inferência (`POST /internal/v1/llm/chat/completions`).
2. `src/gateway/token-validator.ts` *(Novo)*:
   - Criação e validação de tokens internos HMAC-SHA256 (`createTenantToken`, `verifyTenantToken`).
3. `src/supervisor/master-credentials.ts` *(Novo)*:
   - Leitura segura e em memória das credenciais do tenant mestre Admin (`funel` / `role === 'admin'`).
   - Suporte a cache com TTL de 30s e recarregamento atômico quando o arquivo do cofre for modificado.
4. `src/gateway/upstream-client.ts` *(Novo)*:
   - Despachante HTTP com fetch nativo e streaming SSE.
   - Injeção das credenciais reais no cabeçalho `Authorization: Bearer <key>`.
   - Lógica de failover pré-chunk com chave de contingência.
5. `src/supervisor/orchestrator.ts` *(Modificação)*:
   - No método `baseEnv(userId)`:
     - Gerar o token de sessão interna com `createTenantToken(user)`.
     - Injetar no ambiente do tenant:
       ```typescript
       COPYMONSTER_LLM_GATEWAY_URL: 'http://127.0.0.1:4010/internal/v1/llm',
       COPYMONSTER_INTERNAL_SESSION_TOKEN: internalToken
       ```
     - **Remover** qualquer injeção de chaves reais (`OPENROUTER_API_KEY`, etc.) em `platformApiKeys()`.
6. `src/index.ts` *(Modificação)*:
   - Inicializar o `llmLoopbackServer` no ciclo de vida de boot do orquestrador e fechá-lo graciosamente no shutdown.

---

### Fase 2: Adaptador do Cliente LLM (`copymonster-launch`)
**Arquivos afetados:**
1. `packages/llm/` ou `packages/client/ui-chat/`:
   - Configurar o cliente de inferência do tenant para detectar a presença de `COPYMONSTER_LLM_GATEWAY_URL`.
   - Quando presente (em tenants normais):
     - Roteia as chamadas de chat para o endpoint do Gateway local via `127.0.0.1:4010`.
     - Anexa o cabeçalho `Authorization: Bearer ${process.env.COPYMONSTER_INTERNAL_SESSION_TOKEN}`.
     - Consome o streaming SSE nativo da resposta e entrega os eventos à UI sem nenhuma alteração visual para o usuário.
2. `packages/api/settings-controller/src/index.ts`:
   - Manter a governança do Admin: apenas usuários com `role === 'admin' || role === 'owner' || isAdmin === true` podem visualizar e alterar as chaves em Settings > Models.
   - Tenants comuns continuam sem permissão de acesso à tela de chaves e visualizam somente o modelo padrão do sistema.

---

### Fase 3: Sanitização e Eliminação de Vetores Antigos
1. Remover qualquer rotina no provisionamento (`initUserRoot`, `seedGlobalCredentials`) que copie ou crie links simbólicos de arquivos de credenciais para as pastas de tenants.
2. No `dsh-server-login`, assegurar que tenants comuns tenham seus arquivos `.credentials.yaml` limpos de chaves mestres herdadas em migrações anteriores.
3. Garantir redaction absoluto em qualquer logger: qualquer string correspondente ao padrão `sk-or-v1-`, `sk-ant-`, `sk-proj-`, `dsk-` deve ser substituída por `[REDACTED_KEY]`.

---

## 5. Matriz de Validação & Testes

| Categoria | Caso de Teste | Ação Executada | Resultado Esperado |
| :--- | :--- | :--- | :--- |
| **Segurança** | **1. Exfiltração via `process.env`** | Executar script/plugin no processo do tenant lendo `process.env`. | Nenhuma chave de provedor (`OPENROUTER_API_KEY`, etc.) é encontrada. Apenas a URL do gateway e o token temporário estão presentes. |
| **Segurança** | **2. Exfiltração via Arquivo Local** | Inspecionar `/var/lib/dsh-server-login/users/<tenant>/home/.credentials.yaml`. | O arquivo não contém chaves dos provedores mestres da plataforma. |
| **Segurança** | **3. Acesso Não Autorizado ao Gateway** | Chamar `http://127.0.0.1:4010/internal/v1/llm/chat/completions` sem token ou com token forjado. | Retorna HTTP 401 Unauthorized imediatamente. |
| **Segurança** | **4. Acesso Externo ao Gateway** | Tentar acessar a porta 4010 a partir de IP público externo ou via subdomínio público. | Conexão recusada (Connection Refused); serviço restrito a `127.0.0.1`. |
| **Funcional** | **5. Novo Tenant - Chat Funcional** | Criar nova conta no SaaS, acessar chat e enviar "Olá". | Gateway autentica o token interno, chama OpenRouter com a chave do Admin e responde via SSE sem erros. |
| **Funcional** | **6. Streaming SSE em Tempo Real** | Tenant envia prompt longo no chat. | Os tokens chegam gradualmente em tempo real (Time-to-First-Token < 1s), idêntico à chamada direta. |
| **Operacional** | **7. Rotação Imediata de Chave** | Admin altera a chave no painel `funel.copymonster.co`. | O Gateway invalida o cache em memória e o próximo turno de chat de qualquer tenant já utiliza a nova chave sem exigir restart de serviços. |
| **Resiliência**| **8. Failover Pré-Chunk** | Simular provedor primário retornando 402 ou 429. | O Gateway redireciona a chamada para o provedor de contingência antes de emitir o primeiro chunk; o usuário recebe a resposta sem notar a falha. |

---

## 6. Runbook de Rollout e Aplicação no VPS

Após a aprovação deste plano e a execução das Fases 1 a 3 nos repositórios, a aplicação no VPS seguirá este procedimento estrito:

```bash
# 1. Acesso SSH ao VPS
ssh root@mail.copymonster.co

# 2. Atualizar o Orquestrador com o Gateway Loopback
cd /root/copymonster-dsh-server-login
git pull origin master
pnpm install
pnpm run build

# 3. Atualizar o Core/Launch (Adaptador do Cliente LLM)
cd /root/copymonster-launch
git pull origin master
pnpm install
pnpm run build

# 4. Reiniciar o serviço do Orquestrador
systemctl restart dsh-server-login

# 5. Validar o Gateway Interno em Loopback
curl -I http://127.0.0.1:4010/internal/health
# Deve responder: HTTP/1.1 200 OK

# 6. Testar no navegador
# Acessar https://funnels.copymonster.co, abrir o chat e enviar mensagem.
```

---

## 7. Decisão e Próximos Passos

Com a definição desta arquitetura de **Gateway Central em Loopback com Streaming SSE e Token de Sessão Interno**, o modelo de segurança da plataforma CopyMonster atinge o padrão de isolamento exigido para ambientes multi-tenant com plugins de terceiros.

A implementação detalhada pode ser iniciada imediatamente após o registro deste documento.
