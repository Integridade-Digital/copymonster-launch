# Plano de Arquitetura e Execução: Gestão Central de Providers LLM em Settings > Models

**Estado:** plano de execução (arquitetura validada contra o código existente).
**Objetivo:** dar ao administrador uma forma simples, central e flexível de definir o provider LLM primário e o secundário (contingência) usados pelos **novos tenants**, a partir do `Settings > Models` oficial — DeepSeek como primário e OpenRouter como secundário por padrão, mas **não fixo**: o admin altera direto do painel da conta a qualquer momento.

## 1. Resumo executivo

O `Settings > Models` já é a superfície oficial do DSH para configurar providers, modelos e credenciais. A página já registra a seção `models` sob `whenPlatformAdmin` e expõe o slot extensível `settings.models.footer`, onde já está montado o `PlatformRoutingCard`. Esse cartão já gerencia a política central de roteamento (primário, contingência, failover) persistida no namespace `model-mask` do Host, sem tocar nas chaves de API.

Portanto, o plano **não substitui nem duplica** o `Settings > Models` oficial. Ele usa o que já existe:

- `Settings > Models` continua o gestor exclusivo de credenciais e do catálogo de providers/modelos (intocado).
- O `PlatformRoutingCard` (já presente no `settings.models.footer`) é a UI do admin para definir primário e secundário.
- O `model-mask` (Host) resolve a máscara `Model CopyMonster` para tenants, aplicando primário → contingência com failover seguro antes do primeiro chunk.
- O seletor de modelos no chat continua **exclusivo de administradores** (`whenPlatformAdmin`); a escolha ali fica limitada à sessão do admin e não sobrescreve a política global dos tenants.

Padrão para novos tenants: **DeepSeek oficial (primário) + OpenRouter (secundário/contingência)**, configurável pelo admin a qualquer momento no `Settings > Models`.

## 2. Regras que não mudam (invariantes)

1. **`Settings > Models` nativo é intocável como gestor de credenciais.** Não substituir, desligar, duplicar nem mover o editor oficial de providers/chaves.
2. **O seletor de modelos no chat continua exclusivo de administradores.** Preservar os gates `whenPlatformAdmin` existentes no comando `/model` e no slot `conversation.input.model`. Não expor controlos de provider/modelo real a usuários comuns.
3. **Não alterar infraestrutura, deploy, serviços nem dados de tenants** como parte deste plano.
4. **A máscara `Model CopyMonster` permanece.** O alias não se torna credencial; o provider/modelo real nunca é enviado ao browser do tenant, nem aos eventos nem aos erros públicos.
5. **OpenRouter é uma opção de contingência, não uma dependência obrigatória.** A política aceita apenas providers/modelos realmente configurados e utilizáveis no catálogo nativo.

## 3. Auditoria do fluxo atual (o que já existe no código)

### 3.1 Seletor no chat administrativo
`packages/client/ui-model-selection` fornece o comando `/model` e o slot `conversation.input.model`. Ambos usam o diretório da sessão e submetem a seleção via `session.selectModel`. Em `packages/api/session-controller/src/commands.ts`, `selectModel()` valida a rota, atualiza a seleção da sessão e, em segundo plano, chama `agentDefaultModel.saveSelection(selected)`. Esse serviço persiste o default através de `configEditor.edit`. Agentes sem seleção própria consultam o default de `agentDefaultModel`.

A visibilidade já é protegida por `whenPlatformAdmin` no registro dos dois seletores. Essa política é mantida sem exceções.

### 3.2 Settings > Models + PlatformRoutingCard (já implementado)
`packages/client/ui-settings-models/src/client/index.ts` registra a seção `models` sob `whenPlatformAdmin` e injeta `PlatformRoutingCard` no slot `settings.models.footer` (linhas 190-195). O cartão (`PlatformRoutingCard.tsx`) já:

- Lê o catálogo real de providers/modelos que o Host anuncia ao administrador (`ctx.remote.session.modelCatalog()`), filtrando o alias virtual `copymonster`.
- Edita primário (`primaryProvider`/`primaryModel`) e contingência (`fallbackProvider`/`fallbackModel`), mais o interruptor de failover (`fallbackPolicy.enabled`).
- Grava via `operations.writeSettings('model-mask', [...])`, com controle de concorrência por revisão (`maskNamespace?.revision`).
- Mostra estados de carregando, erro/retry, salvo, conflito de versão e rota indisponível.
- Não exibe chaves nem segredos; apenas IDs e nomes de provider/modelo.

### 3.3 Máscara e failover (já implementado)
`packages/host/model-mask/src/index.ts` registra o adapter virtual `copymonster` e anuncia `copy-monster-default`. O adapter:

- Resolve a cadeia de rotas a cada geração a partir dos pins do admin e do catálogo ao vivo (`ctx.llm`).
- Tenta o primário; falhas transitórias elegíveis (429, 5xx, timeout, rede, 401/402 de chave) disparam failover para a contingência **antes do primeiro chunk**.
- Depois do primeiro chunk emitido, o failover é estritamente proibido (não mistura nem duplica respostas).
- `gateway-client.ts` já expõe `generateImageGateway` e `streamGateway` para o loopback central (`COPYMONSTER_LLM_GATEWAY_URL`).

### 3.4 O que não existe ainda / precisa ser decidido
- Nenhum código grava um **padrão pré-configurado** (DeepSeek primário + OpenRouter secundário) para novos tenants quando o admin ainda não salvou nada. Hoje, sem pin, a máscara segue o catálogo ao vivo (primeiro modelo disponível).
- A escolha do seletor de chat do admin ainda chama `agentDefaultModel.saveSelection`, podendo virar o default de novos agentes/tenants. O plano separa isso: a seleção do chat fica restrita à sessão do admin; a política global só muda pelo cartão de `Settings > Models`.

## 4. Arquitetura proposta

```
Administrador
  │
  ├── Settings > Models (nativo, intocado)
  │     ├── catálogo de providers/modelos + chaves: APIs DSH existentes
  │     └── settings.models.footer: PlatformRoutingCard (primário/fallback)
  │                         │ operação autenticada e validada no Host
  ▼                         ▼
Host: política central de roteamento (sem segredos)
  ├── primary: deepseek-official / <modelo DeepSeek>   (padrão novo tenant)
  ├── fallback: openrouter / openrouter/free            (padrão novo tenant)
  └── fallbackPolicy: { enabled: true, maxAttempts: 1 }
            │
            ├── novo agente/tenant sem escolha → alias Model CopyMonster
            └── adapter virtual → primário; contingência segura se elegível

Chat admin: seletor continua visível só para admin; escolha local à sessão,
            sem sobrescrever a política global de tenants.
Tenant: não recebe catálogo, provider, modelo real nem detalhes do fallback.
```

## 5. Plano de execução passo a passo

### Fase 0 — Congelar requisitos e contratos
1. Confirmar que "novos tenants" significa novos agentes/sessões sem seleção de modelo explícita. Sessões existentes com seleção persistida não são reescritas.
2. Aprovar o padrão inicial: primário = DeepSeek oficial, contingência = OpenRouter, falhando para o primeiro catálogo disponível se ambos estiverem ausentes. Esse padrão é apenas o **valor inicial**; o admin pode alterar a qualquer momento no `Settings > Models`.
3. Confirmar quais classes de falha disparam failover (429, 5xx, timeout, rede, 401/402) e o limite de tentativas (recomendado: 1 tentativa secundária por padrão, máximo 3).
4. Registrar os invariantes: Settings nativo intocado; segredo nunca sai do Host; seletor do chat continua admin-only; tenants veem apenas o alias CopyMonster.

**Critério de avanço:** todos os invariantes acima estão escritos e aprovados antes de qualquer código.

### Fase 1 — Padrão de roteamento para novos tenants (valor inicial)
1. No `model-mask` (Host), quando `primaryProvider`/`primaryModel` estiverem vazios (sem pin do admin), resolver o primário para `deepseek-official` se o catálogo anunciar; senão, o primeiro modelo do catálogo ao vivo.
2. Quando `fallbackProvider`/`fallbackModel` estiverem vazios, resolver a contingência para `openrouter` / `openrouter/free` se o catálogo anunciar; senão, seguir a ordem do catálogo sem contingência fixa.
3. Esse padrão só vale para **novos agentes/tenants sem seleção explícita**. Nunca sobrescreve a seleção de um admin feita no chat nem a política já salva no cartão.
4. Adicionar teste Host: sem pin, novo tenant recebe DeepSeek primário e OpenRouter contingência quando anunciados; quando ausentes, não falha silenciosamente — usa o primeiro catálogo disponível.

### Fase 2 — Separar seleção do chat da política global
1. Verificar os consumidores de `agentDefaultModel.saveSelection()` e `currentSelection()` além do web chat (CLI, headless, presets, sessões persistidas).
2. Alterar `session-controller`/`selectModel` para que a seleção feita pelo seletor de chat do admin fique associada à sessão administrativa e **não** chame `saveSelection` para alterar o default central de novos tenants.
3. Manter intacto o gate de visibilidade `whenPlatformAdmin` no seletor do chat (não expor a tenants).
4. Manter a compatibilidade: sessões com seleção explícita preservam a semântia existente; a mudança aplica-se a novas gerações que dependem do default.

**Critério de avanço:** teste de autorização nega a gravação para tenant; teste de sessão confirma que a seleção do chat do admin não altera o default global de novos tenants.

### Fase 3 — Validação de catálogo e persistência atômica
1. No Host, antes de gravar a política, validar que provider e modelo existem no catálogo ativo do `ctx.llm` e que a combinação resolve por `ctx.llm.resolveCallConfig`.
2. Rejeitar primário e contingência iguais (salvo se a política permitir explicitamente).
3. Gravar a política fora das credenciais, com atualização atômica, revisão/ETag para detecção de mudanças concorrentes, auditoria e rollback da versão anterior.
4. Expor leitura sanitizada e gravação tipada; rejeitar IDs arbitrários, rotas inexistentes e propriedades não permitidas. Nunca retornar segredos ao browser.

**Critério de avanço:** prova automatizada de que uma alteração central persiste e chega ao runtime ativo sem sobrescrever configuração concorrente; rota removida/inválida não é substituída silenciosamente — sinaliza estado degradado ao admin.

### Fase 4 — UI de gestão no Settings > Models (já presente, validar e ajustar)
1. Validar que `PlatformRoutingCard` está montado no `settings.models.footer` e visível apenas a admins (`whenPlatformAdmin`). Não criar novo seletor para tenants nem alterar a disponibilidade do seletor do chat.
2. Ajustar o cartão, se necessário, para exibir claramente o padrão inicial (DeepSeek primário / OpenRouter contingência) quando não houver pin salvo, sem expor segredos.
3. Manter validação em tempo real, botão de guardar explícito, estados de carregando/erro/salvo/conflito e opção de reverter para a última política válida.
4. Internacionalização: copy em inglês base + traduções completas; não traduzir IDs técnicos de provider/modelo.

**Critério de avanço:** teste de componente renderiza o cartão apenas para admin; gravação persiste e é aplicada pelo runtime; tenant não vê o cartão nem o seletor.

### Fase 5 — Runtime do alias e failover (já presente, validar)
1. Confirmar que o adapter `model-mask` lê uma fotografia imutável da política no início de cada geração.
2. Confirmar failover: rota que falha com erro transitório **antes de qualquer chunk** avança para a próxima; após o primeiro chunk, o erro é propagado sem reiniciar.
3. Confirmar que tool calls, reasoning, streaming, cancelamento, tokens de uso e headers funcionam contra as capacidades de DeepSeek e OpenRouter.
4. Métricas internas de sucesso/fallback/falha por rota e classe de erro, sem conteúdo de prompts nem dados pessoais.

**Critério de avanço:** testes Host para alias, rota primária, fallback elegível, fallback não elegível, timeout, cancelamento e falha após chunk parcial.

### Fase 6 — Verificação, lançamento e observabilidade
1. Testes unitários de schema, permissão, persistência, validação e versionamento.
2. Testes de componente para renderização, gravação, conflitos, falhas e ausência do cartão quando não admin.
3. Testes e2e: admin altera no `Settings > Models` e novo tenant usa a política; tenant não vê menu/seletor/modelo real; credenciais do `Settings > Models` continuam editáveis e utilizáveis.
4. Teste controlado com provider de falha simulado antes de usar chaves/provedores reais; verificar custo e evitar disparos duplicados.
5. Só após aprovação operacional, publicar/deploy conforme processo próprio. Este plano não autoriza deploy.

## 6. Critérios de aceitação

- Admin consegue escolher e guardar primário e fallback válidos em `Settings > Models`.
- A mudança permanece após reload e é aplicada pelo runtime dentro da janela de propagação aprovada, sem restart se o suporte dinâmico estiver demonstrado.
- `Settings > Models` continua sendo o único gestor das chaves; valores secretos não são retornados à UI nem armazenados na política.
- Seleção no chat continua exclusivamente admin-only; trocar a seleção na sessão do admin não altera o default global de tenants.
- Novas sessões/tenants sem escolha própria usam o alias CopyMonster e a rota central configurada (padrão: DeepSeek primário + OpenRouter contingência).
- Failover só ocorre para falhas autorizadas e antes da saída de conteúdo; não há duplicação nem mistura de respostas.
- Erros, logs e catálogo de tenant não revelam provider/modelo real.
- Testes passam para inglês e todos os idiomas suportados, sessão nova e existente, provider configurado e desativado.

## 7. Riscos e rollback

| Risco | Mitigação / reversão segura |
|---|---|
| Alterar default afeta CLI ou outros pontos além de tenants | Inventariar consumidores na Fase 1; separar política de plataforma da seleção de sessão; manter compatibilidade e testar headless/CLI. |
| O perfil não propaga atualização em runtime | Não prometer aplicação imediata; escolher fonte/propagação suportada antes da UI. Se necessário, deixar nova política pendente até aplicação confirmada. |
| Chave/provider primário ausente | Rejeitar gravação ou marcar política inválida; manter última versão válida, sem fallback silencioso para rota desconhecida. |
| Fallback incompatível ou indisponível | Validar catálogo/credencial/capacidades; permitir desativar fallback e manter rota primária. |
| Retry após conteúdo parcial duplica resposta | Nunca reiniciar após primeiro chunk observável; testar com streams parciais. |
| Seletor de chat e cartão disputam o default | Uma única autoridade: Settings muda política central; chat altera apenas sessão administrativa. |
| Exposição indevida de rotas reais | Autorização Host, respostas sanitizadas, testes de tenant e logs sem segredos/dados de prompt. |
| Atualização central defeituosa | Guardar revisão anterior e fornecer ação de rollback no cartão; reverter somente a política, não apagar credenciais nem dados de tenants. |

### Rollback operacional
1. Desativar fallback pela política central, preservando o primário validado.
2. Reverter a política para a última revisão válida através da operação Host; nunca apagar a configuração nativa de provider/chave.
3. Se o componente UI causar regressão, remover apenas o registro do slot `settings.models.footer`; a página oficial e o gestor nativo permanecem.
4. Confirmar com testes de regressão que novas sessões continuam a usar uma rota segura e que tenants só recebem o alias CopyMonster.

## 8. Decisões que devem ser fechadas antes da execução

1. A fonte de persistência é a configuração do Host (namespace `model-mask`), já usada pelo `PlatformRoutingCard` — não criar uma segunda fonte de verdade.
2. Janela máxima de propagação para mudanças de roteamento em runtimes/instâncias múltiplas: a ser confirmada na Fase 1 (atualização via `loader/volatile-update`, `llm/adapters-updated`, `settings/document-updated` já existe).
3. Quais falhas acionam fallback e qual limite de tempo/tentativas é aceitável após medir latência e custos (padrão sugerido: 1 tentativa secundária).
4. A política aplica-se a novas sessões sem escolha explícita; sessões com seleção persistida não são reescritas.

## 9. Conclusão

A forma mais simples e segura de gerenciar os providers LLM para novos tenants é estender o `Settings > Models` com o cartão de roteamento global que já existe (`PlatformRoutingCard` no `settings.models.footer`), preservando o gestor oficial de chaves. O padrão inicial DeepSeek (primário) + OpenRouter (contingência) é apenas o valor de partida; o admin altera direto do painel da conta a qualquer momento, sem fixar nada. O seletor de chat continua restrito a administradores, e a experiência do tenant continua mascarada como `Model CopyMonster`.
