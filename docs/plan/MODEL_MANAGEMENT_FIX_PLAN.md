# Plano de correção do gerenciamento de modelos

**Projeto:** CopyMonster (`copymonster-launch`)  
**Data da auditoria:** 18 de novembro de 2026  
**Estado:** Plano para revisão e aprovação. Nenhuma correção de produção está autorizada por este documento.  
**Escopo desta entrega:** auditoria de código somente leitura e documentação. Não inclui build, migração, alteração de código operacional, reinício ou deploy.

## 1. Resumo executivo

A auditoria encontrou duas fontes distintas que a interface de `Admin > Configurações` apresenta como se fossem uma única configuração de modelos:

1. Os dropdowns de providers/modelos do Admin leem metadados e estado de chave das tabelas Supabase `public.llm_providers` e `public.llm_models`, por meio das RPCs `get_admin_llm_providers()` e `get_admin_llm_models(p_provider_id)`.
2. O runtime DSH configura providers/modelos pela composição do perfil e da configuração `llm-pi-ai`/`llm-deepseek`; as credenciais são referências resolvidas pelo serviço nativo `credentials`. `Settings > Models` usa essa configuração e esse cofre nativos. O Admin não consulta `ctx.llm.listProviders()` nem `ctx.llm.listModels()` para compor seus dropdowns, e a leitura das tabelas Supabase não lê o cofre de credenciais DSH.

Além disso, `AdminSystemTab` grava seleção primária, fallback, delegação e valores de máscara em chaves próprias de `public.system_config` (`llm.primary.*`, `llm.fallback`, `llm.delegation.*` e `llm.mask.*`). A máscara já existe separadamente no runtime: `session-controller` devolve aos tenants identificados o alias `copymonster/copy-monster-default`, e o plugin `model-mask` encaminha esse alias para uma rota primária estática definida no patch do bundle CopyMonster. O README do plugin registra que a leitura de configuração central ainda está adiada.

**Diagnóstico:** o painel Admin duplica a seleção/roteamento de modelos com dados Supabase que não são a fonte autoritativa do runtime DSH. Isso permite divergência entre o que o Admin lista/salva e o que o tenant consegue efetivamente executar com credenciais do cofre nativo. A presença do alias é uma capacidade exclusiva e útil, mas a seleção/roteamento do painel ainda não está comprovadamente conectada ao runtime. O código sustenta o risco de incompatibilidade; a auditoria do repositório, sem acesso ao banco, aos arquivos reais dos tenants ou aos logs de produção, não comprova qual chave específica está ausente nem que um tenant concreto esteja quebrado.

## 2. Regra de ouro e limites

- **`Settings > Models` nativo do DSH é intocável:** permanece o único lugar para configurar providers, credenciais/API keys e catálogo operacional do DSH.
- Não alterar, ocultar, substituir ou desativar a página nativa, seus slots, seus namespaces, suas RPCs remotas nem o cofre `credentials`.
- Não alterar Cloudflare, Nginx, portas, serviços, arquivos `.env`, tenants ou dados de tenants.
- Não alterar os quatro pacotes MCP (Zernio, SendPulse, LeadLovers e Kiwify).
- Não fazer deploy nem reiniciar serviços.
- Este documento não aprova nem inicia as fases corretivas. Cada etapa futura exige aprovação explícita.

## 3. Fase 1 — Auditoria somente leitura: achados

### 3.1 Admin > Configurações (`AdminSystemTab.tsx`)

O componente `apps/web/src/pages/admin/tabs/AdminSystemTab.tsx` implementa uma área intitulada Central LLM Routing:

- `loadProviders()` chama a RPC Supabase `get_admin_llm_providers()`.
- `loadModelsForProvider()`, `loadModelsForFallback()` e `loadModelsForDelegation()` chamam `get_admin_llm_models({ p_provider_id })`.
- As rotas e a máscara são inicializadas a partir de `get_admin_system_config()` e gravadas via `admin_upsert_system_config()`.
- As chaves de configuração gravadas pelo painel são `llm.mask.enabled`, `llm.mask.virtualModel`, `llm.mask.virtualModelName`, `llm.primary.provider`, `llm.primary.model`, `llm.fallback`, `llm.delegation.enabled`, `llm.delegation.provider` e `llm.delegation.model`.
- Os dropdowns mostram os registros retornados pelas RPCs Supabase, incluindo um indicador `has_api_key` derivado da tabela de providers; esse indicador não é uma leitura do cofre DSH.
- Existe também uma tabela genérica de parâmetros `llm.*` com ações Supabase de criar/editar/excluir, distinta das configurações nativas do DSH.

### 3.2 Fonte DSH nativa (`Settings > Models`)

A documentação e implementação em `packages/client/ui-settings-models/` mostram que a página nativa:

- lê e atualiza os namespaces de configuração de provider servidos pelo Host;
- guarda as chaves por meio de `credentials.set`, com leitura de estado por `credentials.describe`; os valores secretos não são retornados ao formulário;
- atualiza a lista a partir do catálogo do runtime e reage aos eventos `settings/document-updated`, `credentials/reference-updated` e `llm/adapters-updated`.

Isso é diferente de `public.llm_providers.api_key_encrypted` / `public.llm_models`: a estrutura Supabase guarda catálogo e credenciais da aplicação SaaS, mas o código do componente Admin não chama as APIs nativas `settings`, `credentials` ou `ctx.llm` do DSH.

### 3.3 Sessões e mascaramento

- `packages/api/session-controller/src/index.ts` calcula a identidade de quem pede `modelCatalog()`. Para tenant identificado (`isAdmin === false`), `catalog.ts` devolve exclusivamente o alias virtual `copymonster/copy-monster-default`, com o nome “Model CopyMonster”. Para administrador identificado, devolve o catálogo completo obtido de `ctx.llm.listProviders()`, `ctx.llm.listModels()` e `ctx.llm.resolveModelInfo()`.
- Chamadas sem identidade resolvida preservam o comportamento legado de catálogo completo; a proteção de identidade e a composição do serviço são, portanto, parte importante da validação.
- `packages/host/model-mask/src/index.ts` registra um provider virtual e encaminha as chamadas ao provider/model primários configurados no próprio plugin. Em `packages/bundle/copymonster/cordis.patch.yml`, esses valores são atualmente estáticos (`deepseek-official` / `deepseek-chat`).
- `packages/host/model-mask/README.md` declara como limitação conhecida que o plugin ainda não lê `llm.central_routing`; a integração com uma fonte central foi adiada.
- O plugin de fallback também recebe sua configuração pelo patch do bundle. Nenhum consumidor de runtime de `llm.primary.*`, `llm.fallback` ou `llm.delegation.*` foi encontrado nesta auditoria do repositório. Portanto, salvar esses valores no Admin não prova que alterem o roteamento ativo dos tenants.

### 3.4 Causa e limite da conclusão

A causa arquitetural é a duplicação de fonte e responsabilidade: o Admin usa registros Supabase para montar e persistir opções/rotas, enquanto o DSH executa com adapters ativos no Host e credenciais no cofre nativo. O painel pode mostrar um provider/modelo cadastrado no Supabase mesmo que esse provider não esteja configurado/credenciado no runtime DSH, e a configuração salva em `system_config` não é lida pelo `model-mask` estático documentado. Isso explica como o painel pode parecer correto enquanto a rota real do tenant não corresponde.

A auditoria foi somente de código versionado. Não consultou Supabase de produção, cofres de credenciais, configurações reais dos tenants, arquivos de perfil implantados ou logs. Assim, “está a quebrar os tenants” permanece um relato importante, mas a ocorrência e o mecanismo específico em produção precisam ser confirmados na validação controlada.

### 3.5 Funcionalidade que merece ser preservada

A máscara virtual acrescenta uma capacidade que a página `Settings > Models` não oferece por si só: limitar o catálogo apresentado ao tenant a um alias CopyMonster, mantendo a visão completa para administradores e resolvendo a rota real no Host. **Preservar apenas essa fronteira de catálogo/alias e encaminhamento**, não a gestão duplicada de providers, chaves ou catálogo no Admin.

## 4. Fase 2 — Correção proposta, segura e reversível

A correção deve ser feita em etapas pequenas, cada uma com diff, testes e ponto de rollback. A ordem abaixo evita remover a proteção de máscara antes de estabelecer uma fonte correta de roteamento.

### Etapa 0 — Aprovação, baseline e cópia de segurança

1. Obter aprovação explícita deste plano antes de qualquer mudança de produção.
2. Registrar o commit inicial, o estado da branch, as versões atuais do perfil e do bundle, e os valores atuais de configuração relevantes sem capturar ou imprimir segredos.
3. Fazer backup versionado/revisável dos arquivos de configuração envolvidos e export de metadados Supabase pertinente conforme o procedimento autorizado; não copiar nem expor chaves de API.
4. Identificar um tenant interno de teste, sem alterar ou excluir dados de cliente.

**Rollback:** retornar ao commit baseline e restaurar apenas arquivos de configuração de aplicação previamente preservados; não restaurar ou sobrescrever credenciais.

### Etapa 1 — Retirar do Admin a gestão duplicada

1. Remover do `AdminSystemTab` a edição de rota primária, cadeia de fallback e delegação que escreve em `llm.primary.*`, `llm.fallback` e `llm.delegation.*`.
2. Remover os dropdowns Supabase de providers/modelos dessa área e a tabela genérica `llm.*` que permite manipular configuração de runtime por outra fonte.
3. Não apagar automaticamente linhas históricas de `system_config`, `llm_providers` ou `llm_models`. Primeiro deixar de as consumir; qualquer limpeza futura é uma tarefa separada, com análise de dependências, backup e aprovação.
4. Se necessário para orientação do operador, deixar uma mensagem/link somente informativo para `Settings > Models`, sem formulário de chaves ou provider no Admin.
5. Não mexer em `Settings > Models`, nas migrations das tabelas nativas, nos RPCs de credenciais nem nas tabelas Supabase sem prova de que são usadas por outras funções da aplicação.

**Rollback:** reverter o commit de UI; dados persistidos permanecem inalterados.

### Etapa 2 — Manter apenas máscara e encaminhamento virtual

1. Preservar o contrato de alias existente (`copymonster/copy-monster-default`) e o comportamento do `session-controller` que entrega catálogo mascarado a tenants autenticados e catálogo real ao Admin.
2. Não deixar `llm.mask.*` em `system_config` aparentar controlar o runtime enquanto o runtime não lê essas chaves. A interface deve ou apresentar a máscara como política fixa/gerida pela plataforma, ou ler uma configuração central autoritativa apenas depois de existir um contrato runtime seguro e testado.
3. Não adicionar um segundo catálogo de credenciais nem ler chaves do browser/Admin. O Host deve resolver a referência de credencial por meio do mecanismo nativo já configurado em `Settings > Models`.
4. Antes de tornar a rota configurável centralmente, mapear uma única fonte de configuração runtime (perfil/serviço Host ou plano central) e implementar uma leitura validada, com último valor válido/cache resiliente se necessário, sem segredo em logs ou payloads.
5. Garantir que a rota primária e cada fallback se referem a providers/modelos existentes no `ctx.llm` e com credenciais disponíveis no cofre. Em configuração inválida ou incompleta, falhar de forma explícita e segura; não silenciosamente selecionar um provider Supabase que o Host não serve.
6. Manter fallback/delegação desativados se sua configuração não for consumida pelo runtime; reativar somente quando a integração estiver implementada e comprovada.

**Rollback:** configuração mascarada atual permanece no patch; uma alteração futura à leitura central deve oferecer feature flag ou caminho de retorno ao par estático anterior, sem desativar o alias para tenants.

### Etapa 3 — Compatibilidade de UI e permissões

1. Confirmar que `Settings > Models` continua disponível para operador/admin conforme as regras de autorização existentes.
2. Confirmar que Admin não oferece campos para digitar, revelar, copiar, editar ou apagar API keys.
3. Conferir que os RPCs Supabase existentes não sejam removidos se usados por telas diferentes do fluxo LLM; restringir a mudança à área duplicada comprovadamente identificada.
4. Manter “Admin vê catálogo real” somente para identidade de administrador verificada pelo Host; não usar ausência de identidade como autorização administrativa em novas rotas.

## 5. Fase 3 — Plano de validação antes de produção

### 5.1 Testes automatizados

- Unitários de `catalog.ts`: tenant recebe somente o alias; Admin recebe catálogo completo; provider real e mensagens de falha não aparecem no catálogo mascarado.
- Unitários de `model-mask`: alias encaminha para o provider/model configurados; a seleção/log público permanece virtual; falha de credencial/provider não vaza o nome real.
- Testes de integração no Host com configuração nativa realista: listar provider e modelos do runtime, descrever somente o estado da credencial, e confirmar que o alias usa o adapter esperado.
- Testes da UI Admin: não há controle duplicado de provider, modelo ou API key; conteúdo de configurações antigas `llm.*` não é alterado ou apagado pela nova tela.
- Testes de não-regressão do `Settings > Models`: leitura, alteração de endpoint/catálogo, salvar chave via `credentials.set`, estado mascarado via `credentials.describe`, conflito de revision e atualização por eventos continuam funcionando.

### 5.2 Staging e teste controlado

1. Aplicar em ambiente de staging primeiro, não no VPS de produção.
2. Usar um tenant interno sem dados de cliente; configurar ou verificar provider e chave apenas por `Settings > Models` e pelo cofre nativo.
3. Confirmar no Host que `ctx.llm.listProviders()` e `ctx.llm.listModels()` incluem a rota autorizada e que a referência de credencial correspondente está configurada, sem imprimir o segredo.
4. Confirmar que tenant vê apenas “Model CopyMonster”, envia uma solicitação curta e conclui o turno pelo adapter real configurado.
5. Confirmar separadamente que Admin autorizado vê o catálogo real e que uma sessão tenant não consegue selecionar rota real, nem por payload direto nem por modelo previamente salvo.
6. Confirmar o comportamento de indisponibilidade: ausência de provider/chave resulta em erro seguro, sem looping ou exposição de detalhes internos.
7. Registrar versões, logs sanitizados e resultado de cada teste; nenhuma evidência pode conter API keys ou valores de credenciais.

### 5.3 Critérios para liberação futura

Só considerar mudança pronta quando:
- `Settings > Models` e `credentials` permanecem sem alteração e passam sua suíte de testes;
- o caminho de execução usa o provider e a credencial nativos configurados, não os registros Supabase de catálogo;
- alias e autorização são testados para tenant e Admin;
- configurações LLM antigas continuam preservadas, ainda que não utilizadas;
- testes, build, revisão do diff e plano de rollback foram aprovados;
- o usuário autoriza separadamente qualquer deploy ou reinício.

## 6. Matriz de riscos e rollback

| Risco | Impacto | Mitigação | Rollback seguro |
|---|---|---|---|
| Provider/modelo listado no Supabase não existe no runtime DSH | Tenant falha ao gerar | Obter catálogo do Host e validar a rota no runtime antes de qualquer mudança | Reverter integração; manter alias e configuração anterior conhecida |
| Admin continuar mostrando “chave configurada” sem credencial nativa | Falsa confiança operacional | Remover indicador Supabase da configuração runtime; usar confirmação não secreta do serviço `credentials` no Host se necessária | Reverter UI, sem apagar dados |
| Rota primária salva em `system_config` não ser consumida | Admin altera valor sem efeito ou diverge da execução | Descontinuar editor duplicado; uma fonte runtime por contrato documentado | Reverter somente código do painel; preservar registros antigos |
| Remoção do painel afetar funcionalidades gerais de Admin | Regressão de operações não LLM | Diff mínimo; não retirar os demais controles/abas; testes de navegação e Admin | Reverter commit específico de UI |
| Máscara deixar de ocultar rota real | Exposição de provedores ou seleção indevida | Testes de autorização, catálogo, request, logs e erro; preservar `session-controller` | Restaurar código estável do alias e patch anterior |
| Alteração concorrente em `Settings > Models` | Configuração perdida | Não editar os mesmos namespaces; usar revision nativa e eventos | Reaplicar valor pelo painel nativo, nunca copiar segredo |
| Tenant existente receber config incompatível | Interrupção de serviço | Testar tenant isolado, não fazer backfill ou reescrita em massa nesta correção | Reverter somente configuração/pacote afetado, sem apagar workspace ou dados |
| Deploy prematuro ou inesperado | Interrupção de produção | Deploy/restart fora do escopo e exigindo autorização separada | Sem deploy nesta etapa; se autorizado futuramente, manter versão anterior pronta para retorno |

## 7. Arquivos e áreas examinados

- `apps/web/src/pages/admin/tabs/AdminSystemTab.tsx`
- `packages/client/ui-settings-models/README.md` e referências à implementação nativa em `src/client/`
- `packages/api/session-controller/src/index.ts`
- `packages/api/session-controller/src/catalog.ts`
- `packages/host/model-mask/src/index.ts` e `README.md`
- `packages/bundle/copymonster/cordis.patch.yml`
- `.dsh/profiles/web/cordis.patch.yml`
- `supabase/migrations/008_admin_expanded_backend.sql`
- `supabase/migrations/014_admin_llm_providers.sql`
- `supabase/migrations/015_admin_llm_models.sql`
- `supabase/migrations/016_admin_system_config.sql`
- `supabase/migrations/037_get_admin_llm_providers_route_fields.sql`
- Histórico dos commits `575306b98f` (máscara e catálogo por identidade) e `9736eef115` (dropdowns de provider/model no Admin).

## 8. Aprovação e próxima ação

Este documento é uma proposta, não uma autorização de execução. Após a revisão e aprovação explícita do plano, a próxima solicitação deve especificar o início da Etapa 0/Etapa 1. Nenhuma remoção de interface, atualização de runtime, migração, deploy ou reinício está incluída nesta entrega.
