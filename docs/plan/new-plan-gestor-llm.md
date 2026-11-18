# Plano de Arquitetura: Gestão Central de Providers LLM em Settings > Models

**Estado:** proposta para aprovação; nenhuma implementação incluída.  
**Objetivo:** permitir ao administrador definir, num único local, o provider/modelo primário e o provider/modelo de contingência usados por novos tenants, sem gerir chaves fora do gestor nativo do DSH.

## 1. Resumo executivo

O `Settings > Models` já é a superfície oficial do DSH para configurar providers, modelos e credenciais. A página é registada dentro de `whenPlatformAdmin`, e o componente `ModelsSection` já expõe o slot extensível `settings.models.footer`. Portanto, é viável adicionar ali um cartão de política de roteamento sem substituir nem alterar o editor nativo de providers e chaves.

Há, porém, uma causa importante para o comportamento atual: a seleção feita no chat pelo administrador não é apenas visual ou limitada à sessão. `session-controller` chama `ctx.agentDefaultModel.saveSelection(selected)`, e o serviço persiste a seleção no perfil de configuração. Agentes que não tenham uma escolha própria consultam esse default. Isso explica por que uma escolha feita no chat de administrador pode repercutir nos tenants.

A recomendação é separar responsabilidades e definir uma única fonte de verdade para o **roteamento global**:

- `Settings > Models` continua a gerir providers, modelos disponíveis e credenciais através dos mecanismos nativos do DSH.
- Um novo cartão no rodapé dessa página gere apenas a política global: primário, contingência, ativação e regras de fallback.
- A política é persistida no host, num bloco de configuração próprio, com validação e aplicação dinâmica; nunca armazena chaves.
- O chat continua a mostrar o seletor apenas a administradores, conforme a política existente. A seleção feita nesse chat deixa de sobrescrever o default global e fica limitada à sessão administrativa. A política global é alterada no cartão de Settings.
- Os tenants mantêm a identidade `Model CopyMonster`; provider, modelo real e rota de contingência não são expostos no catálogo, nos eventos ou nos erros apresentados ao tenant.

O failover deve ser implementado no runtime do host, não no componente React. A tentativa secundária só pode começar antes de qualquer conteúdo ter sido entregue ao cliente; uma stream parcialmente transmitida não deve ser repetida, para evitar respostas duplicadas ou inconsistentes.

## 2. Regras que não mudam

1. **`Settings > Models` nativo é intocável como gestor de credenciais.** Não substituir, desligar, duplicar nem mover o editor oficial de providers/chaves.
2. **A seleção de modelos no chat continua exclusiva de administradores.** Preservar os gates `whenPlatformAdmin` existentes tanto no comando `/model` como no seletor do composer. Não expor controlos de provider ou modelo real a utilizadores comuns.
3. **Não alterar infraestrutura, deploy, serviços ou dados de tenants** como parte deste plano.
4. A máscara `Model CopyMonster` permanece. O alias não deve tornar-se uma credencial, nem o provider real deve ser enviado ao browser do tenant.
5. OpenRouter é uma opção de rota de contingência, não uma dependência obrigatória. A política deve aceitar providers e modelos que estejam realmente configurados e utilizáveis no catálogo nativo.

## 3. Auditoria do fluxo atual

### 3.1 Seletor no chat administrativo

O pacote `packages/client/ui-model-selection` fornece os dois pontos de entrada de seleção: comando `/model` e slot `conversation.input.model`. Ambos usam o mesmo diretório da sessão e submetem a seleção por `session.selectModel`.

Em `packages/api/session-controller/src/commands.ts`, `selectModel()` valida a rota, atualiza a seleção da sessão e, em segundo plano, chama `agentDefaultModel.saveSelection(selected)`. Em `packages/core/agent-default-model/src/index.ts`, esse serviço persiste o default através de `configEditor.edit`. O `session-controller` constrói agentes sem seleção explícita usando a seleção corrente de `agentDefaultModel`. Assim, a seleção administrativa também pode virar o default de novos agentes/tenants.

A visibilidade já é protegida por `whenPlatformAdmin` no registo dos dois seletores. Essa política deve ser mantida sem exceções.

### 3.2 Settings > Models

`packages/client/ui-settings-models/src/client/index.ts` regista a secção `models` sob `whenPlatformAdmin`. `ModelsSection.tsx` apresenta o catálogo configurável, edição dos providers, estados de credenciais e os slots de extensão. O slot `settings.models.footer` é um ponto adequado para o novo cartão, porque fica na página oficial sem modificar o editor de chaves.

O contrato do slot é de lista no escopo root; o componente não recebe automaticamente a store interna da página. O desenho de implementação deve obter a configuração e o catálogo por uma API/face Host explicitamente injetada, tipada e testável, em vez de presumir que `controller.rows` estará disponível ao componente do footer.

### 3.3 Máscara atual e limite da auditoria

`packages/host/model-mask/src/index.ts` regista o provider virtual `copymonster` e anuncia `copy-monster-default`. O adapter atualmente recebe `primaryProvider` e `primaryModel` em sua configuração e encaminha a stream para essa rota. A configuração descrita no código atual é estática para a instância do plugin; não há ali um gestor administrativo dinâmico completo para a rota primária e secundária.

O plano não assume que editar a configuração do plugin em runtime já seja suportado. A Fase 1 deve confirmar as capacidades reais de `configEditor`, o ciclo de vida do plugin e a forma segura de propagar atualizações. Se a atualização dinâmica não puder ser aplicada com garantia sem recriar a instância, deve-se construir uma operação Host que faça a aplicação atómica e documentar qualquer requisito operacional antes da execução. Não prometer “sem restart” até esse comportamento estar demonstrado num teste de integração.

## 4. Arquitetura proposta

```text
Administrador
  │
  ├── Settings > Models (nativo)
  │     ├── provider/model catalog e chaves: APIs DSH existentes
  │     └── settings.models.footer: novo cartão de roteamento
  │                         │ operação autenticada e validada no Host
  ▼                         ▼
Host: política central versionada (sem segredos)
  ├── primary: provider + model
  ├── fallback: provider + model (opcional)
  └── política: erros elegíveis, timeout, limite de tentativas
           │
           ├── agente/tenant novo → alias Model CopyMonster
           └── adapter virtual → primário; contingência segura se elegível

Chat admin: seletor continua visível só para admin; escolha local à sessão,
            sem sobrescrever a política global.
Tenant: não recebe catálogo, provider, modelo real ou detalhes do fallback.
```

### 4.1 Fonte de verdade e persistência

Usar uma configuração central do host, independente do cofre de credenciais e do default mutável pelo chat. A implementação deve preferir o mecanismo de configuração durável já suportado pelo perfil/runtime do DSH, se ele permitir leitura e atualização em execução com autorização administrativa. A política deve ter versão de schema e valores explícitos, por exemplo:

```json
{
  "version": 1,
  "primary": { "provider": "<route-id-validado>", "model": "<model-id-validado>" },
  "fallback": { "provider": "<route-id-validado>", "model": "<model-id-validado>" },
  "fallbackPolicy": { "enabled": true, "maxAttempts": 1 }
}
```

O exemplo é ilustrativo, não fixa IDs de modelo nem a disponibilidade de uma rota específica. A configuração não inclui API key, endpoint secreto ou conteúdo de credenciais.

Se o perfil do DSH não oferecer persistência e atualização dinâmica seguras, a Fase 1 deve comparar duas alternativas antes de codificar: (a) extensão autenticada do armazenamento de configuração do host, sincronizada com o runtime; (b) RPCs/tabela central já autorizados no Supabase com evento/invalidação para o runtime. Não criar uma segunda fonte de verdade. A escolha e os trade-offs devem ser registados antes da Fase 2.

### 4.2 Validação do catálogo

Antes de guardar, validar no Host que:

- provider e modelo existem no catálogo ativo do `ctx.llm`;
- a combinação resolve por `ctx.llm.resolveCallConfig`;
- provider está operacional e tem credencial configurada no mecanismo nativo, sem ler nem devolver o segredo ao browser;
- primário e contingência não são a mesma rota, salvo se a política permitir explicitamente;
- a política está completa, dentro do schema e sujeita a limites de timeout/tentativas;
- mudanças concorrentes não sobrescrevem uma versão mais recente sem deteção (revision/ETag ou serialização).

Se uma rota guardada for removida ou ficar inválida, não a substituir silenciosamente: preservar o valor para diagnóstico, sinalizar estado degradado ao administrador e usar o comportamento seguro previamente definido. Nunca encaminhar tenants para um provider não validado.

### 4.3 Política de seleção e compatibilidade

A seleção do chat e a política central hoje partilham o default do agente. Para evitar dois controlos concorrentes:

- `Settings > Models` passa a ser a única interface que altera a política global de novos tenants.
- A escolha do seletor no chat fica associada à sessão do administrador e não chama `saveSelection` para alterar o default central.
- Agentes dos tenants sem uma escolha explícita recebem a política central/máscara CopyMonster.
- Uma sessão que já tenha seleção explícita deve preservar a semântica existente; definir migração ou fallback apenas para sessões novas e não reescrever históricos.
- O seletor no chat permanece admin-only. Não usar o seu estado como fonte implícita do primário, nem enviar a escolha do chat para outras sessões.

A alteração de semântica de `saveSelection` é sensível e deve ser validada contra CLI/headless, testes e outros consumidores do `agentDefaultModel`; pode ser necessário separar “default global do deployment” de “seleção da sessão” sem mudar os contratos públicos não relacionados.

### 4.4 Failover em streaming

O adapter `model-mask` deve ler uma fotografia imutável da política no início de cada geração. Para cada pedido:

1. Resolver e tentar o primário.
2. Só ativar fallback em falhas transitórias bem tipadas: rate limit (429, conforme política), indisponibilidade/server error, falha de rede e timeout configurado.
3. Não ativar em erro de autenticação/configuração, pedido inválido, limite de contexto ou conteúdo rejeitado, salvo decisão explícita posterior.
4. Se ainda não houve chunk de conteúdo observável, cancelar/encerrar a tentativa primária com segurança e tentar o fallback no máximo o número permitido.
5. Se algum conteúdo já foi emitido, não reiniciar no secundário. Propagar o erro/encerramento segundo o contrato de stream para evitar resposta duplicada, mistura de duas respostas ou corrupção do estado da conversa.
6. Preservar cancelamento do cliente, abort signals, telemetria sem prompt/chaves e o alias virtual em logs visíveis ao tenant.
7. Registar, apenas em logs internos protegidos, rota tentada, classe do erro, latência e resultado; não registar credenciais, conteúdo sensível ou dados do tenant desnecessários.

OpenRouter pode impor limites de contexto, formato, ferramentas ou parâmetros diferentes do primário. A validação deve testar a compatibilidade de `GenerateOptions`, tool calls, reasoning effort e encerramento da stream; não assumir equivalência entre providers.

## 5. Plano de execução por fases

### Fase 0 — Congelar requisitos e contratos
1. Confirmar que “novos tenants” significa novos agentes/sessões sem seleção explícita, e definir o efeito pretendido sobre sessões existentes.
2. Aprovar se o fallback é automático, quais classes de falhas são elegíveis e o timeout/tentativas máximos, sem fixar números sem teste de latência.
3. Confirmar se a operação precisa refletir-se imediatamente em todos os workers/runtime ou se há janela de propagação aceitável.
4. Registar os invariantes: Settings nativo intocado; segredo nunca sai do Host; seletor do chat continua admin-only; tenants veem apenas o alias.

### Fase 1 — Auditoria técnica e prova de persistência dinâmica
1. Documentar os consumidores de `agentDefaultModel.saveSelection()` e `currentSelection()` além do web chat, incluindo CLI, headless, presets e sessões já persistidas.
2. Verificar o contrato real de `configEditor.edit`: autorização, persistência, evento de atualização, consistência entre processos e se as referências de configuração atualizam sem reiniciar plugin/runtime.
3. Verificar a autoridade de identidade usada por `whenPlatformAdmin` no browser e o equivalente obrigatório no Host/RPC. UI escondida, sozinha, não é controlo de autorização.
4. Mapear APIs Host existentes para listar providers/modelos/credenciais configuradas. O browser recebe apenas IDs, nomes e estado booleano de configuração, nunca valores secretos.
5. Escrever ADR curto com a fonte de verdade, propagação, concorrência, comportamento de sessões existentes e fallback antes de alterar código.

**Saída/critério de avanço:** prova automatizada de que uma alteração central persiste e chega ao runtime ativo sem sobrescrever configuração concorrente. Se isso não for possível, voltar à decisão da fonte de dados antes de implementar UI.

### Fase 2 — Modelo de domínio e API Host
1. Definir schema versionado de `LlmRoutingPolicy` com primário obrigatório, fallback opcional, política de retry/timeout e revisão.
2. Implementar serviço Host responsável por `read`, `validate` e `update`; autorização administrativa deve ser verificada no servidor em cada mutação.
3. Guardar a política fora das credenciais, com atualização atómica, validação contra catálogo atual, auditoria e rollback da versão anterior.
4. Expor uma operação de leitura sanitizada e uma operação de gravação tipada; rejeitar IDs arbitrários, rotas inexistentes e propriedades não permitidas.
5. Atualizar o carregamento do modelo padrão para que novos tenants usem o alias e a política central, sem dependência do provider escolhido no chat de administrador.
6. Limitar a mudança da seleção no chat ao escopo da sessão administrativa; manter intacto o gate de visibilidade `whenPlatformAdmin`.

**Testes:** autorização negada para tenant mesmo com chamada direta; validação de catálogo; persistência; concorrência; reinício/reload; leitura sanitizada; preservação de sessões existentes.

### Fase 3 — UI de gestão no Settings > Models
1. Criar `PlatformRoutingCard` como componente do pacote `ui-settings-models`, usando componentes, tokens e padrões nativos do DSH/CopyMonster.
2. Registar o cartão em `settings.models.footer`, dentro do ciclo administrativo já protegido; manter o editor oficial de chaves e providers sem alterações.
3. Construir o catálogo de selects com dados reais do Host e indicar claramente provider/modelo sem chave ou inválido, sem expor segredo.
4. Permitir primário e contingência opcionais, com validação em tempo real e botão de guardar explícito. Não aplicar alterações parciais enquanto o formulário estiver em edição.
5. Apresentar estado carregando, erro/retry, guardado, configuração inválida/desatualizada e conflito de versão; permitir reverter para a última política válida.
6. Não introduzir um seletor para tenants nem alterar a disponibilidade do seletor do chat administrativo.

### Fase 4 — Runtime do alias e failover
1. Substituir o destino estático do adapter virtual por leitura da política central, com fotografia por geração e atualização segura.
2. Implementar fallback com erros tipados, timeout cancelável, no máximo uma tentativa secundária por pedido por padrão, e sem loops de providers.
3. Garantir que a troca ocorre apenas antes do primeiro chunk observável. Após saída parcial, manter o contrato de erro atual sem reiniciar a resposta.
4. Verificar tool calls, reasoning, streaming, cancelamento, tokens de uso e headers contra as capacidades dos dois providers.
5. Manter a rota real fora da resposta do catálogo de tenants, da seleção persistida e das mensagens de erro públicas.
6. Adicionar métricas internas de sucesso/fallback/falha por rota e classe de erro, sem conteúdo de prompts ou dados pessoais.

### Fase 5 — Internacionalização e acessibilidade
1. Adicionar copy em inglês como idioma base e traduções completas para todos os idiomas suportados pelo pacote.
2. Incluir labels, estados, erros, confirmação de alteração global, fallback desligado e estado de credencial não configurada.
3. Usar nomes de providers/modelos como dados da fonte nativa; não traduzir IDs técnicos.
4. Validar navegação por teclado, foco, leitores de ecrã, contraste e layout responsivo no padrão de Settings.

### Fase 6 — Verificação, lançamento e observabilidade
1. Unit tests do schema, permissão, persistência, validação e versionamento.
2. Testes de componente para renderização, gravação, conflitos, falhas e ausência do cartão quando não admin.
3. Testes Host para alias, rota primária, fallback elegível, fallback não elegível, timeout, cancelamento e falha após chunk parcial.
4. Testes e2e: admin altera no Settings e novo tenant usa a política; tenant não vê menu/seletor/modelo real; credenciais do Settings nativo continuam editáveis e utilizáveis.
5. Fazer teste controlado com provider de falha simulado antes de usar chaves/provedores reais; verificar custo e evitar disparos duplicados.
6. Só depois da aprovação operacional, publicar/deploy conforme processo próprio. Este plano não autoriza deploy.

## 6. Critérios de aceitação

- Admin consegue escolher e guardar primário e fallback válidos em `Settings > Models`.
- A mudança permanece após reload e é aplicada pelo runtime dentro da janela de propagação aprovada, sem restart se a Fase 1 provar suporte dinâmico.
- `Settings > Models` continua sendo o único gestor das chaves; valores secretos não são retornados à UI nem armazenados na política.
- Seleção no chat continua exclusivamente admin-only; trocar a seleção na sessão do admin não altera o default global de tenants.
- Novas sessões/tenants sem escolha própria usam o alias CopyMonster e a rota central configurada.
- Failover só ocorre para falhas autorizadas e antes da saída de conteúdo; não há duplicação nem mistura de respostas.
- Erros, logs e catálogo de tenant não revelam provider/modelo real.
- Testes passam para inglês e todos os idiomas suportados, sessão nova e existente, provider configurado e desativado.

## 7. Riscos e rollback

| Risco | Mitigação / reversão segura |
|---|---|
| Alterar default afeta CLI ou outros pontos além de tenants | Inventariar consumidores na Fase 1; separar política de plataforma da seleção de sessão; manter compatibilidade e testar headless/CLI. |
| O perfil não propaga atualização em runtime | Não prometer aplicação imediata; escolher fonte/propagação suportada antes da UI. Se necessário, deixar nova política pendente até aplicação confirmada. |
| Chave/provider primário ausente | Rejeitar gravação ou marcar política inválida; manter última versão válida, sem fallback silencioso para uma rota desconhecida. |
| Fallback incompatível ou indisponível | Validar catálogo/credencial/capacidades; permitir desativar fallback e manter rota primária. |
| Retry após conteúdo parcial duplica resposta | Nunca reiniciar após primeiro chunk observável; testar com streams parciais. |
| Seletor de chat e cartão disputam o default | Uma única autoridade: Settings muda política central; chat altera apenas sessão administrativa. |
| Exposição indevida de rotas reais | Autorização Host, respostas sanitizadas, testes de tenant e logs sem segredos/dados de prompt. |
| Atualização central defeituosa | Guardar revisão anterior e fornecer ação de rollback no cartão; reverter somente a política, não apagar credenciais nem dados de tenants. |

### Rollback operacional da futura implementação

1. Desativar fallback pela política central, preservando o primário validado.
2. Reverter a política para a última revisão válida através da operação Host; nunca apagar a configuração nativa de provider/chave.
3. Se o componente UI causar regressão, remover apenas o registo do slot `settings.models.footer`; a página oficial e o gestor nativo permanecem.
4. Se a integração com `agentDefaultModel` causar regressão, restaurar o comportamento compatível após avaliar consumidores, mantendo separada a política até correção. Não alterar a visibilidade do seletor admin-only.
5. Confirmar com testes de regressão que novas sessões continuam a usar uma rota segura e que tenants só recebem o alias CopyMonster.

## 8. Decisões que devem ser fechadas antes da execução

1. A fonte de persistência será o perfil/configuração do Host ou armazenamento central Supabase sincronizado com o Host? A escolha depende da prova da Fase 1; não manter ambos como autoridades.
2. Qual janela máxima de propagação para mudanças de roteamento em runtimes/instâncias múltiplas?
3. Quais falhas acionam fallback, e qual limite de tempo/tentativas é aceitável após medir latência e custos?
4. A política aplica-se apenas a novas sessões ou também a sessões sem escolha explícita já abertas? Recomendação: não reescrever seleção explicitamente persistida; mudança passa a aplicar-se às novas gerações que dependam do default.

## 9. Conclusão

A forma mais simples e segura de administrar os providers é estender `Settings > Models` com um cartão de roteamento global no slot já existente, preservando o gestor oficial de chaves. A causa do efeito observado no chat é a persistência de `session.selectModel` como `agentDefaultModel`; por isso, a mudança arquitetural essencial é separar a seleção local do administrador da política global de roteamento. A execução deve começar pela prova de persistência dinâmica e autorização no Host, não pelo desenho visual. O seletor continua restrito a administradores, e a experiência do tenant continua mascarada como CopyMonster.
