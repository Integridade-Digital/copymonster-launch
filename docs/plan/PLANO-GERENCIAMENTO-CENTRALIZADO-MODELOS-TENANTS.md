# PLANO TÉCNICO: GERENCIAMENTO CENTRALIZADO DE MODELOS PARA TENANTS NO COPYMONSTER

> **Documento:** `docs/plan/PLANO-GERENCIAMENTO-CENTRALIZADO-MODELOS-TENANTS.md`
> **Status:** Proposta Arquitetural e Plano de Ação Passo a Passo (Aguardando Aprovação)
> **Data:** Novembro de 2026
> **Ambiente:** SaaS Multi-Tenant CopyMonster (Fork DeepSeek Harness - DSH)
> **Regra estrita:** Apenas planejamento e documentação técnica neste ciclo. Nenhuma linha de código de produção, configuração de VPS ou Cloudflare Tunnel deve ser alterada antes da aprovação formal deste plano.

---

## 1. Sumário Executivo e Diagnóstico da Arquitetura Atual

O **CopyMonster** é uma plataforma SaaS corporativa multi-tenant baseada no DeepSeek Harness (DSH). A infraestrutura atual opera com segregação em duas frentes:
1. **Orquestrador Central (`copymonster-dsh-server-login`)**: Processo de controle rodando internamente na porta loopback `:3081`. Responsável por autenticar usuários, provisionar subdomínios (`<tenant>.app.copymonster.co`), criar contas de sistema operacional isoladas (modo Linux Account) e injetar arquivos de configuração no perfil web de cada tenant (`profiles/web`).
2. **Aplicação Principal / Host Web (`copymonster-launch`)**: Instância principal do CopyMonster que serve a interface do usuário, rotas de billing, autenticação e execução dos agentes de copywriting e funis.

### 1.1. O Problema Identificado

Atualmente, quando o orquestrador provisiona um novo tenant (`LocalUserFs.initUserRoot` em `src/fs/local-user-fs.ts`):
- O perfil web do tenant é criado copiando o template do Admin (`/root/.dsh/profiles/web` ou `/var/lib/copymonster-dsh/profiles/web`).
- O orquestrador executa `seedGlobalCredentials()`, mesclando as chaves de API globais do operador (`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, etc.) em `/root/.dsh/.credentials.yaml`.
- O arquivo `settings.yaml` do template contém a lista completa de provedores reais do Admin (`llm-pi-ai.providers` e `llm-deepseek`).

**Consequência de Segurança e Negócio:**
1. O tenant visualiza a lista completa dos modelos reais do Admin (ex: *DeepSeek V4.1 Flash*, *Claude 3.5 Sonnet*, *OpenRouter Free*, etc.) no seletor de modelos da tela de chat (`@Remote('modelCatalog')` em `session-controller`).
2. Caso o tenant instale ou ative plugins do ecossistema DSH (como o **dsh-im** para integração com Telegram, ou plugins de automação e tarefas agendadas), esses plugins consultam o catálogo do Host (`ctx.llm.listModels()`) e expõem os nomes reais de modelos, tokens e infraestrutura subjacente.
3. Não há controle centralizado granular onde o Admin defina regras de failover e roteamento de custos válidas para todos os tenants sem alterar manualmente o perfil de cada cliente.

---

## 2. Requisitos Funcionais e Regras de Negócio

| Requisito | Descrição Técnica |
|---|---|
| **Gerenciamento Centralizado** | O Admin define em um único ponto central (fonte de configuração ainda a decidir: recomenda-se tabela protegida do Supabase, com snapshot validado/cache local no orquestrador; um JSON local pode ser bootstrap/fallback operacional) quais modelos estão ativos, suas credenciais operacionais, cadeias de failover e regras de roteamento. |
| **Aplicação Automática (Zero-Touch)** | A configuração central deve ser injetada automaticamente na criação de novos tenants e aplicada retroativamente aos tenants existentes no momento do arranque (`backfill` no orquestrador). |
| **Máscara "Model CopyMonster"** | O usuário final nunca deve ver o nome real do modelo (ex: "DeepSeek V4.1 Flash" ou "Claude Opus"). Deve ver estritamente **"Model CopyMonster"** (identificador virtual: `copy-monster-default`). |
| **Failover Automático (HA)** | Em caso de erro transitório no modelo principal (HTTP 429 Rate Limit, 500/502/503 Server Error ou Timeout), a execução do agente deve alternar instantaneamente para um modelo reserva sem abortar o turno do usuário. |
| **Roteamento Inteligente (Cost Optimization)** | Roteamento baseado no tipo de tarefa: tarefas leves (geração de títulos de sessão, resumos de chat, buscas, categorização) consom modelos ultrarrápidos e econômicos; tarefas pesadas (criação de copy, VSLs, cartas de vendas, refatoração de código) consom o modelo de topo de linha. Redução projetada de custos de até **66,7%**. |
| **Blindagem de Plugins de Terceiros** | O runtime deve interceptar o catálogo do Host de modo que novos plugins instalados pelo tenant (ex: `dsh-im` para Telegram) recebam exclusivamente `Model CopyMonster` na lista de modelos disponíveis. |

---

## 3. Análise de Plugins do Ecossistema DSH (`https://awesome-dsh-plugin.com/?cat=model`)

Foi feita uma análise inicial do catálogo de plugins DSH na categoria Models & Providers e das páginas dos plugins sugeridos. Os resultados abaixo descrevem o que os anúncios dizem fazer; isso não equivale a auditoria do código-fonte, teste no runtime atual ou confirmação de compatibilidade com DSH `0.2.1-rc.3`. Antes de instalar qualquer dependência, a Fase 0 deve inspecionar repositório, licença, origem, manutenção, dependências, versões peer, permissões e comportamento de rede. Plugins de terceiros executam código com as permissões do processo que os carrega e não devem ser tratados como sandbox. [Catálogo de modelos](https://awesome-dsh-plugin.com/model/)

### 3.1. Mascaramento e Visibilidade de Catálogo
* **`dsh-ofm-model-manager`**: a página do catálogo descreve controles de ativação/ocultação e renomeação apresentados em Settings > Models, com preferências persistidas no perfil. Isso é útil como referência de UX, mas a descrição não comprova que altere a resposta do RPC `modelCatalog`, o serviço `ctx.llm`, chamadas de plugins ou logs. Portanto, não atende sozinho ao requisito de mascaramento sistêmico. [Descrição do plugin](https://awesome-dsh-plugin.com/p/DeepseekDays/dsh-ofm-model-manager/)
* **`dsh-model-visibility`**: sua descrição fala em ocultar modelos do seletor de conversa, sem reconfigurar provedores. É uma alternativa de visibilidade de UI, não uma fronteira de segurança contra outros clientes/plugins. [Descrição do plugin](https://awesome-dsh-plugin.com/p/Lzh3070/dsh-model-visibility/)
* **Adaptação recomendada:** priorizar uma solução própria, no bundle `packages/bundle/copymonster/cordis.patch.yml` e no seam efetivamente consumido pelos agentes. Criar `@deepseek-ai/dsh-host-model-mask` só depois de confirmar que um plugin Cordis consegue controlar de forma suportada tanto o catálogo exposto quanto a resolução da rota real. A resposta RPC `modelCatalog` é implementada em `packages/api/session-controller/src/catalog.ts`; mapear/filtrar a resposta nessa função ou num seam suportado, não pressupor que um patch Cordis consiga interceptar um método de classe sem mecanismo explícito. Separar catálogo público (alias) de rota privada (provedor/modelo real).

### 3.2. Failover e Alta Disponibilidade
* **`dsh-ha-orchestrator`** anuncia recuperação de alta disponibilidade, circuit breaking e orquestração de subagentes. **`dsh-llm-fallbacks`** anuncia cadeias provider/model por papel, com política de retry/fallback e diagnóstico. São referências de comportamento, não dependências aprovadas. [HA Orchestrator](https://awesome-dsh-plugin.com/p/Saktawdi/dsh-ha-orchestrator/) · [LLM Fallbacks](https://awesome-dsh-plugin.com/p/omdsh-dev/dsh-llm-fallbacks/)
* **Estado no CopyMonster:** `packages/host/llm-fallback/` já implementa um plugin local que consome `agent/request-error` e `agent/request`, preserva o orçamento de retry downstream e permite fallback configurado. Ele não implementa ainda uma cadeia gerenciada dinamicamente pelo painel Admin nem um circuit breaker/half-open.
* **Ação recomendada:** evoluir o pacote existente e manter a configuração validada no plano central; adicionar limites de tentativas, cooldown/circuit breaker apenas se definidos e testados. Não duplicar listeners com plugins comunitários até auditoria de conflitos e precedência.

### 3.3. Roteamento Inteligente (Delegated Routing)
* **`dsh-delegate-router`**:
  * *O que faz:* Analisa o contexto da mensagem ou o tipo de subagente/ferramenta requisitada. Redireciona tarefas de baixa complexidade (títulos de sessão, resumos, classificação) para modelos menores/rápidos, e tarefas de alta complexidade para o modelo principal.
  * *Ação recomendada:* Integrar a lógica de delegação via waterfall `agent/request` no pacote de fallback/roteamento do CopyMonster, inspecionando o propósito da chamada (`session-title`, `compaction`, `agent-loop`).

### 3.4. Ocultação em Plugins de Mensageria (`dsh-im` - Telegram / Discord)
* **`dsh-im`** conecta DSH a canais de mensagens, incluindo Telegram e Discord, e sua descrição inclui configuração por bot para workspace, modelo e sessão. A página consultada não confirma que use `ctx.llm.listModels()` para enumerar opções, nem que o mascarador proposto a controle. [Descrição do dsh-im](https://awesome-dsh-plugin.com/p/xmanrui/dsh-im/)
* **Ação recomendada:** inspecionar a versão exata instalada e todos os caminhos de listagem/seleção. Aplicar política no ponto de autorização/resolução do modelo, e não apenas trocar a lista visível; testar comandos de listagem e alteração de modelo no canal. Plugins com conexão ou seleção própria precisam ser cobertos por adapter/policy específico. Nenhum plugin deve poder solicitar um provedor real fora da lista permitida.

---

## 4. Arquitetura Proposta em 2 Camadas

```
┌────────────────────────────────────────────────────────────────────────┐
│                      ADMIN / CONTROLE CENTRAL                          │
│                                                                        │
│   Arquivo: /etc/copymonster/admin-model-config.json                    │
│   (ou Supabase public.system_config -> key: 'llm.central_routing')     │
│   - Máscara: "Model CopyMonster" (id: copy-monster-default)             │
│   - Provedor Primário: DeepSeek Official / deepseek-chat               │
│   - Failover 1: OpenRouter (DeepSeek V3 / R1)                          │
│   - Failover 2: Groq / Nvidia / Backup Provider                        │
│   - Roteamento Leve: Model Fast (Títulos, resumos, busca)              │
│   - Roteamento Pesado: Model Pro (Copywriting, VSLs, funis)            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│       CAMADA 1: ORQUESTRADOR CENTRAL (dsh-server-login :3081)          │
│                                                                        │
│   1. Lê admin-model-config.json na inicialização e em cada spawn       │
│   2. Na criação/lançamento do tenant (LocalUserFs.initUserRoot):       │
│      - NÃO copia o settings.yaml cru com os modelos do Admin           │
│      - Injeta no cordis.patch.yml a configuração do modelo virtual     │
│      - Injeta o bundle de mascaramento (@deepseek-ai/dsh-copymonster)   │
│      - Aplica backfill imediato em tenants existentes                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│      CAMADA 2: RUNTIME CORDIS / HOST PLUGIN (copymonster-launch)       │
│                                                                        │
│   Plugin: @deepseek-ai/dsh-host-model-mask & dsh-host-llm-fallback     │
│   1. Intercepta @Remote('modelCatalog') e ctx.llm.listModels():        │
│      - Retorna APENAS: "Model CopyMonster" (copy-monster-default)      │
│   2. Intercepta agent/request:                                         │
│      - Mapeia copy-monster-default -> Modelo Real Configurado          │
│      - Se tarefa leve (título, resumo) -> Rota Econômica               │
│   3. Intercepta agent/request-error:                                   │
│      - Se erro 429, 5xx ou timeout -> Alterna para Failover            │
│   4. Plugins externos (dsh-im, automation, etc.):                      │
│      - Enxergam unicamente "Model CopyMonster"                         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Mapeamento das Áreas de Configuração e Administração

Toda a experiência de interface deve respeitar o layout existente em `apps/web/src/cm-theme.css`, com tipografia, botões, modais e paleta de cores Dark & Gold (`#0c0c0e`, `#1c1c1f`, `#d4af37`), além da segregação rígida de permissões:

### 5.1. Mapeamento de Settings (Configurações do Usuário / Tenant)

| Seção em Settings | Comportamento para Tenant Comum | Comportamento para Admin |
|---|---|---|
| **General** | Acesso normal a idioma, tema e preferências básicas. | Acesso total. |
| **Usage** | Visualiza consumo de tokens da sua conta e limites do plano. | Visualiza consumo geral e métricas de infraestrutura. |
| **Profile** | Edição de nome, e-mail e dados da organização. | Acesso total. |
| **Models** | A interface de configuração de providers já é condicionada por `isPlatformAdmin()` / `whenPlatformAdmin()` no pacote `ui-settings-models`; verificar e manter a política. A tela não deve expor credenciais/modelos de administração, mas o catálogo de chat e APIs de plugins precisam de política independente. | Acesso de operador ao cofre e configuração de providers conforme contratos Settings/Credentials; roteamento central é configuração separada. |
| **Plans** | Visualiza plano contratado (Free, Starter, Pro), cotas e upgrade. | Gestão de planos e precificação. |
| **My DNA** | Configuração do Brand DNA do cliente (posicionamento, tom de voz). | Acesso total. |
| **Affiliate** | Painel do parceiro (KYC, link `?ref=`, saldo, saques PayPal). | Redirecionamento para gestão de afiliados. |
| **Built-in plugins** | Lista de plugins ativados. Oculta aba "Market" para não-admins (conforme commit `334f72310a`). | Acesso total com aba de Market liberada. |
| **Agent presets** | Seleção de personas de copy (Copywriter, Funil, E-mail). Modelos vinculados forçados para `Model CopyMonster`. | Configuração de modelos base por preset. |
| **Scheduled tasks** | Agendamento de postagens e automações (`dsh-automation`). Campo de modelo forçado para `Model CopyMonster`. | Seleção livre de modelos. |
| **CopyMonster Market** | Aba oculta para tenants comuns. | Acesso total. |
| **Vercel MCP** | Configuração de integração MCP Vercel do tenant. | Acesso total. |
| **Zernio MCP** | Configuração de integração MCP Zernio com `publicOrigin` dinâmico. | Acesso total. |

### 5.2. Mapeamento do Painel Admin (`AdminModal.tsx`)

| Aba no Admin | Funcionalidade e Impacto do Plano de Modelos |
|---|---|
| **Overview** | Exibe KPIs consolidados: MRR, usuários ativos, tokens consumidos no dia e **gráfico de distribuição de modelos reais utilizados internamente** (para auditoria de custos do Admin). |
| **Users** | Gestão de membros, papéis (`owner`, `admin`, `member`) e suspensão. |
| **Tenants** | Gestão de subdomínios, status de isolamento e cotas por tenant. |
| **Settings (System)** | Acrescentar subárea de controle da configuração central (fonte única, versionamento, validação e histórico): definir alias público, rota primária, fallbacks e regras de roteamento. Não gravar segredos no registro de configuração nem devolver modelos reais aos tenants. |
| **Sessions** | Auditoria global de sessões. Para o admin exibe o modelo real que executou a sessão para fins de auditoria de custo. |
| **Audit** | Log imutável de alterações (ex: quando o admin alterou a chave ou o modelo principal de failover). |
| **Billing** | Assinaturas Stripe, faturas, status de adimplência e histórico de planos. |
| **Affiliate program** | As 5 esteiras de afiliados: Afiliados, KYC, Validação de Comissões, Fila de Saques PayPal e Motor de Regras. |

---

## 6. Internacionalização (i18n) e Arquitetura Visual

1. **Idiomas Suportados**:
   - Inglês como idioma padrão e fonte da verdade (`en.json`, `locales/admin.ts`).
   - Português do Brasil (`pt.json`).
   - Espanhol (`es.json`), Chinês (`zh.json`) e demais idiomas suportados pelo DSH.
2. **Textos Padronizados**:
   - Nome visível do modelo no chat e plugins: `Model CopyMonster` (em todos os idiomas, preservando a marca global).
   - Descrição no seletor:
     - EN: `High-performance copywriting and funnel engine with automated failover.`
     - PT: `Motor de copywriting e funis de alta conversão com failover automático.`
     - ES: `Motor de copywriting y embudos de alta conversión con failover automático.`
3. **Estilos e Cores**:
   - Nenhum estilo isolado fora do padrão: reaproveitamento estrito de `cm-theme.css`, CSS Modules e classes utilitárias já existentes (`adminCard`, `adminButton`, `adminInput`, `adminSection`).

---

## 7. Plano de Implementação Passo a Passo (Fases)

### Fase 1: Especificação do Contrato de Configuração Central
1. Inspecionar `public.system_config` e os RPCs administrativos existentes antes de escolher persistência. Preferência: configuração versionada no banco central protegida por checagem server-side de admin, com validação Zod/schema, audit trail, optimistic concurrency e snapshot em cache no orquestrador. Não manter configurações divergentes simultaneamente como duas fontes de verdade. O JSON abaixo é contrato conceitual, não endpoint/schema já existente:
   ```json
   {
     "version": 1,
     "mask": {
       "displayName": "Model CopyMonster",
       "virtualModelId": "copy-monster-default",
       "description": "High-performance copywriting engine with auto-failover"
     },
     "routing": {
       "primary": {
         "provider": "deepseek-official",
         "model": "deepseek-chat"
       },
       "delegation": {
         "enabled": true,
         "lightweight": {
           "provider": "openrouter",
           "model": "deepseek/deepseek-chat"
         }
       },
       "failover": [
         {
           "provider": "openrouter",
           "model": "deepseek/deepseek-r1",
           "codes": ["RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT"]
         }
       ]
     }
   }
   ```
2. Armazenar na fonte central aprovada. Se o runtime exigir disponibilidade independente do banco, o orquestrador mantém último snapshot validado, com versão e data, em arquivo protegido, sem divergência editável. O painel não deve editar um arquivo do servidor diretamente.

### Fase 2: Implementação do Plugin de Mascaramento (`@deepseek-ai/dsh-host-model-mask`)
1. Definir e implementar o contrato de alias de modelo no Host, identificando a menor API suportada para: (a) catálogo público de tenant, (b) validação/seleção do alias pelo cliente, e (c) resolução privada do alias para provider/model antes da chamada LLM. O método atual `modelCatalog()` chama `buildModelCatalog(ctx)`; validar server-side a identidade do chamador e nunca depender do flag de UI `isPlatformAdmin` como autorização.
2. Para tenants, projetar somente o alias de produto (`Model CopyMonster`, `copy-monster-default`) no catálogo e aceitar somente esse alias, se a arquitetura de sessão permitir. O Admin recebe visão real apenas nas telas operacionais autorizadas.
3. Não declarar que `ctx.llm.listModels()` pode ser interceptado por plugin Cordis sem prova: verificar o tipo/serviço e todas as APIs de plugin. Onde plugins usam interface direta do registry, introduzir API de catálogo filtrado/policy com escopo de tenant e impedir acesso a rotas não autorizadas no runtime.
4. Resolver alias internamente para rota real em um serviço server-side; não colocar provider/model real nos dados do cliente, respostas de erro, notificações, prompts ou logs visíveis ao tenant. Avaliar também metadados de sessão, headers de chamada, telemetria e exportação de histórico.
5. Só depois registrar plugin/bundle próprio em `packages/bundle/copymonster/cordis.patch.yml`; adicionar testes para toda superfície, incluindo UI, RPC, plugins e execução.

### Fase 3: Roteamento Inteligente e Failover em Cascata
1. Estender o pacote `@deepseek-ai/dsh-host-llm-fallback`:
   - Inspecionar a intenção no waterfall `agent/request`:
     - Se o turno for identificado como tarefa leve (ex: metadados, títulos, resumos), encaminhar internamente para a rota `lightweight` da configuração.
     - Se for criação de conteúdo ou código, encaminhar para a rota `primary`.
   - No waterfall `agent/request-error`:
     - Alternar com failover transparente para a lista de modelos reserva sem interrupção para o usuário.
2. Adicionar testes unitários com mocks para simular falhas HTTP 429/500 e validar a troca transparente de modelo.

### Fase 4: Atualização do Orquestrador (`copymonster-dsh-server-login`)
1. Confirmar e documentar quais arquivos de perfil são compartilhados por symlink e quais são cópias: o código atual de `LocalUserFs.initUserRoot` copia o template sem `node_modules` quando cria o perfil e compartilha o `node_modules` do template; além disso, `seedGlobalCredentials()` copia referências de credenciais globais para o tenant. Isso significa que alterar `settings.yaml` globalmente pode impactar todos os tenants, e que ocultar nomes não substitui autorização.
2. Criar mecanismo versionado de configuração do modelo no momento do provisionamento/launch sem propagar configurações editáveis do Admin ao tenant. Definir allowlist do perfil de tenant e segredo/credenciais, em vez de copiar o settings completo às cegas.
3. Aplicar atualização idempotente a novos tenants e backfill gradual para existentes, com dry-run, checkpoint por tenant, logs sem segredos/model IDs expostos ao cliente, retomada após erro e rollback por versão.
4. Verificar caminho de leitura em todos os launch/restart/reconcile, garantindo que tenant não possa alterar o alias, fallback, credenciais globais ou origem da política.
5. Não alterar deploy, systemd, VPS ou Cloudflare Tunnel como parte da implementação desta funcionalidade.

### Fase 5: Ajustes no Frontend (Settings e Painel Admin)
1. **Settings > Models**:
   - Para usuários normais: ocultar o formulário de chaves e lista de provedores, exibindo o card informativo do CopyMonster Engine.
   - Para admins: manter formulário de configuração e cofre de chaves.
2. **Admin > Settings (System)**:
   - Adicionar interface para gerenciar o modelo primário, fallback e regras de economia.
3. Testar em todos os idiomas suportados (EN, PT, ES, ZH).

### Fase 6: Validação, Testes e Verificação de Não-Regressão
1. Antes de instalar plugins externos, fixar versão/commit, revisar código e dependências, verificar engines/peerDependencies frente ao runtime `0.2.1-rc.3`, license, build scripts e acessos a arquivos, rede e credenciais. O catálogo alerta que plugin pode executar com permissões do host e que instalar do GitHub pode executar build scripts; instalação só após aprovação específica e sem dados de produção.
2. Testar o fluxo completo de chat:
   - Criação de nova sessão.
   - Seletor de modelos exibindo apenas "Model CopyMonster".
   - Inspeção de rede (DevTools): garantir que nenhum nome real de provedor vaze na payload JSON do catálogo.
2. Testar integração com plugins externos:
   - Instalação e execução de plugin de teste (ex: `dsh-im`).
   - Confirmar que comandos de bot listam apenas `Model CopyMonster`.
3. Executar suites de testes e linter:
   - `pnpm run build:artifacts`
   - `pnpm test`
   - `npx oxlint`

---

## 8. Matriz de Riscos e Procedimentos de Contingência

| Risco Identificado | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Plugin tenant consulta registry/seleciona provider diretamente ou conecta endpoint externo | Média | Alto | Mapear APIs de plugins e validar isolamento de rede real; firewall de saída, por si só, não garante uso exclusivo do serviço do Host nem impede nomes/rotas acessíveis em APIs. Aplicar policy no server/runtime e testar. |
| Falha no provedor primário e secundário simultaneamente | Baixa | Alto | A cadeia de fallback suporta até 3 níveis de redundância configuráveis pelo Admin. |
| Alias não compatível com os contratos de seleção/persistência e `ModelCatalog` | Média | Alto | Prototipar contrato em testes e mapear `ModelCatalog`/`ModelSelection`; alias só é confiável quando validação e resolução do lado Host o suportam. |
| Atualização upstream muda seams ou plugin comunitário é incompatível/inseguro | Média | Alto | Testes de contrato, pin de versões, revisão de código e plano de rollback; patch não transforma automaticamente API interna em extensão compatível. |

---

## 9. Limites da Análise e Pontos que Exigem Prova Antes de Construir

1. A existência de uma página de plugin no catálogo não comprova segurança, qualidade, compatibilidade com o DSH exato instalado, nem cumprimento do requisito de ocultar modelos em todos os consumidores.
2. `dsh-ofm-model-manager` e `dsh-model-visibility` são descritos como gestão de nome/visibilidade em UI/model picker; não devem ser considerados um controle de acesso do Host.
3. `dsh-delegate-router` é descrito principalmente para chamadas de subagentes; tarefa leve/pesada no chat principal não é presumida.
4. A descrição consultada do `dsh-im` não prova o caminho do catálogo ou se a seleção de modelo pode ser restringida por plugin externo.
5. O modelo do exemplo (`deepseek-chat`, OpenRouter etc.) é ilustrativo e não decisão final de produto. Modelo, limites, fallback, failover de autenticação/quota e transparência em registros precisam de aprovação do Admin.
6. A atual separação de tenants envolve cópia de profile e compartilhamento de dependências/credenciais; o plano não presume que um `cordis.patch.yml` injetado sozinho cubra todos os tenants instalados e existentes.

---

## 10. Próximos Passos Imediatos

1. Revisão e aprovação formal deste documento de planejamento pelo usuário/responsável técnico.
2. Aprovar decisões pendentes: fonte única de configuração, regra de visibilidade para Admin/tenant, o que aparece em histórico/telemetria, política de roteamento/fallback e escopo de plugins externos.
3. Executar primeiro a descoberta e um protótipo de contrato em ambiente de desenvolvimento, antes de migrations, backfill ou instalação de plugins de terceiros.
4. Nenhuma alteração em produção, tenant existente, VPS ou Cloudflare Tunnel até aprovação explícita e plano de rollback validado.
