# Plano de Implementação: Credenciais LLM Centralizadas e Seguras para Tenants

**Status:** Aguardando aprovação para implementação  
**Atualizado em:** 21 de novembro de 2026  
**Repositórios-alvo:**
- `copymonster-dsh-server-login` — orquestrador multi-tenant e serviços confiáveis no VPS
- `copymonster-launch` — UI, adaptadores LLM, sessão e configuração de roteamento

---

## 1. Objetivo e diagnóstico

O Admin (`funel`) gerencia chaves de provedores em **Settings > Models** e o roteamento em **Provider routing**. As chaves salvas pelo DSH ficam no cofre do tenant Admin, em `home/.credentials.yaml`; o roteamento da plataforma é armazenado separadamente no Supabase.

O problema de raiz é a separação entre esses dados e o processo de cada tenant comum: o orquestrador não deve presumir que a chave salva no cofre do Admin existe no cofre local do tenant. No código analisado, `credentials-local` consegue resolver credenciais de `process.env` como fallback quando não há valor salvo no cofre local, mas isso, por si só, não conecta o cofre do Admin ao processo de outro tenant.

A mensagem “A chave API é inválida” é genérica e não prova, sozinha, qual provedor, chave ou resposta HTTP causou a falha. A implementação deverá registrar diagnósticos seguros e distinguir credencial ausente, rejeição do provedor e erro de saldo/permissão, sem expor segredos.

### 1.1 O que permanece igual para o Administrador

- O Admin continua gerenciando provedores, chaves, modelos primários e contingência em **Settings > Models**.
- O roteamento continua centralizado; tenants comuns não podem editar nem consultar as chaves ou a configuração administrativa.
- Novos tenants e existentes devem usar a política vigente sem exigir cópia manual, recriação de conta ou edição de arquivos via SSH.

---

## 2. Requisito de segurança: não copiar chaves para tenants

As chaves de provedor são segredos mestre da plataforma. Elas **não devem ser copiadas** para:

- `home/.credentials.yaml` de tenants comuns;
- `.env`, profiles, patches, diretórios de workspace ou arquivos temporários dos tenants;
- logs, mensagens de erro, respostas de API para o navegador ou metadados de sessão.

### 2.1 Por que `baseEnv` não é uma fronteira de segurança suficiente

Passar `OPENROUTER_API_KEY` ou outra chave pelo `baseEnv` evita a gravação em disco no tenant, mas a variável fica disponível ao processo filho e, em geral, ao código/plugin executado dentro dele. Um plugin malicioso com execução no mesmo processo pode ler `process.env`; dependendo da configuração do sistema, processos do mesmo UID também podem inspecionar ambientes de processos irmãos. Portanto, **injeção de chaves brutas no ambiente do tenant não atende ao requisito de isolamento contra plugins maliciosos**.

O `baseEnv` pode levar configurações não secretas e uma identidade/token de serviço de escopo limitado, mas não as chaves mestres dos provedores. Não considerar “sem arquivo no disco” equivalente a “segredo isolado”.

### 2.2 Arquitetura-alvo

Manter as chaves em uma fonte confiável do lado do servidor (o cofre do Admin com acesso restrito ao serviço confiável, ou um cofre central equivalente) e fazer as chamadas aos provedores através de um **gateway/proxy LLM central**:

1. O processo do tenant envia ao gateway apenas a solicitação de inferência, o alias/modelo autorizado e uma identidade de serviço assinada e limitada ao tenant.
2. O gateway valida a identidade e as permissões do tenant, consulta o roteamento central, escolhe provedor/modelo e obtém a chave do cofre mestre somente em memória no lado confiável.
3. O gateway chama o provedor e devolve o stream/resposta ao tenant. A chave do provedor nunca é devolvida nem injetada no processo do tenant.
4. O gateway aplica limites, auditoria sem segredos e failover antes do primeiro chunk de resposta. Após enviar o primeiro chunk, não pode trocar de provedor para a mesma resposta.

O gateway precisa autenticar chamadas sem entregar um token que permita ler a chave ou invocar rotas administrativas. O token/identidade deve ser específico do serviço e do tenant, validado no servidor e protegido contra falsificação e replay conforme o mecanismo de identidade já usado pelo orquestrador.

---

## 3. Plano de implementação

### Fase 1 — Fonte confiável das credenciais e acesso restrito (`copymonster-dsh-server-login`)

- Identificar de forma inequívoca o usuário Admin por identidade/role persistida, sem depender apenas do slug do subdomínio `funel`.
- Implementar leitura segura das credenciais do cofre do Admin no lado confiável. Validar caminho canônico, proprietário/permissões, formato, referências de credencial e tratamento de arquivo ausente/inválido.
- Manter os valores em memória apenas no componente confiável que precisa chamar o provedor; nunca serializar valores em logs, respostas, estado do tenant ou argumentos de processo.
- Definir política de cache e rotação: atualização no Admin invalida/recarrega o segredo de forma segura; não registrar valores antigos nem deixá-los ativos além da janela explicitamente definida.
- Não usar `/root/.dsh/.credentials.yaml` como fallback silencioso que possa selecionar credencial antiga. Se houver necessidade operacional de compatibilidade, ela deverá ser explícita, temporária, observável e coberta por teste; a fonte ativa deve ser inequívoca.

### Fase 2 — Gateway LLM central sem exposição da chave (`copymonster-dsh-server-login` e integração em `copymonster-launch`)

- Criar/estender endpoint de inferência server-side que receba chamadas autenticadas dos processos dos tenants e encaminhe-as aos providers.
- Validar a identidade do tenant e permitir somente aliases, provedores e modelos autorizados pela política central.
- Resolver a chave correspondente somente dentro do gateway e nunca incluí-la no payload de resposta, cabeçalhos devolvidos, logs ou tracing.
- Aplicar limites de requisições/tokens por tenant e limites globais, com respostas de erro seguras e métricas de consumo sem dados secretos.
- Adaptar o caminho de chamadas LLM do app para usar o gateway central. O tenant não deve fazer chamada direta ao provedor usando uma chave compartilhada.
- Se necessário, o `baseEnv` dos tenants deve conter apenas URL do gateway e credencial de serviço curta/limitada, sem nenhuma chave de provedor.

### Fase 3 — Roteamento, failover e atualização operacional

- Usar a configuração de **Provider routing** mantida pelo Admin como fonte central de rota primária e contingência.
- Fazer o gateway obter a rota atual (com cache versionado/invalidação confiável), de modo que alteração de rota alcance chamadas subsequentes de tenants novos e existentes sem sincronizar arquivos locais.
- Tentar contingência apenas para erros elegíveis e antes do primeiro chunk. Distinguir falhas de autenticação, 402/saldo, 429, indisponibilidade e erros não elegíveis; não mascarar uma credencial inválida como indisponibilidade genérica.
- Preservar o alias público `copymonster/copy-monster-default` para usuários comuns, sem expor nomes de provedores ou modelos privados quando essa for a política definida.
- Fazer rotação de chave valer em novas chamadas assim que a atualização for confirmada pelo serviço confiável; chamadas já em andamento podem terminar com a credencial que já haviam carregado, sem persistir a chave antiga.

### Fase 4 — Remoção de caminhos inseguros e compatibilidade

- Remover do provisionamento e do auto-launch qualquer cópia de credenciais mestre para os arquivos de tenants comuns.
- Garantir que credenciais antigas já gravadas nos cofres de tenants não tenham precedência sobre o gateway compartilhado. Planejar limpeza/migração somente após inventário e backup, preservando credenciais pessoais não relacionadas, se existirem.
- Retirar a propagação de chaves de provedor por `platformApiKeys()`/`baseEnv` para filhos de tenants; conservar somente variáveis não secretas e identidades limitadas que o desenho do gateway exigir.
- Garantir que nenhum caminho de compatibilidade reative silenciosamente credenciais antigas ou chamadas diretas a providers.

### Fase 5 — Testes de segurança, integração e operação

- Testar criação de tenant novo, tenant existente, restart, rotação de chave e mudança de rota sem copiar segredos para o tenant.
- Testar integração ponta a ponta em ambiente de staging com providers mockados e, quando autorizado, uma validação controlada com provider real.
- Testar autenticação entre tenant e gateway, isolamento de tenant, permissões, limites de uso, rejeição de replay e prevenção de acesso a rotas administrativas.
- Testar failover antes do primeiro chunk, comportamento após início de streaming e erros de chave inválida/sem saldo/rate limit.
- Adicionar testes negativos verificando que a chave mestre não aparece em `process.env`/`/proc/<pid>/environ` do tenant, arquivos do tenant, logs, tracing, respostas HTTP ou artefatos de teste.
- Fazer revisão de segurança para plugins maliciosos: um plugin no processo do tenant não pode recuperar a chave do provedor nem acessar o cofre mestre.

---

## 4. Critérios de aceite

A implementação só estará pronta quando todos estes itens forem demonstrados em testes:

1. O Admin continua configurando chaves e roteamento em **Settings > Models**.
2. Tenants comuns novos e existentes conseguem usar o alias/modelo autorizado sem provisionamento manual.
3. Alterações de chave e rota chegam a novas chamadas de forma previsível e documentada.
4. Nenhum segredo mestre é persistido em diretório de tenant ou entregue ao processo/plugin do tenant.
5. Um plugin malicioso no tenant não consegue ler a chave mestre por ambiente, arquivo ou API.
6. O gateway aplica autenticação, autorização, limites por tenant, logs redigidos e failover controlado.
7. Testes e build dos escopos alterados passam; limitações de teste ou validação em produção ficam registradas, não presumidas.

---

## 5. Runbook após aprovação e implementação

A aplicação em produção deverá ser feita somente depois da aprovação deste plano, da implementação e dos testes. O procedimento final será documentado com os comandos de atualização, build, migrações/configurações necessárias, reinício seguro e validação de rollback para cada repositório. Não executar mudanças em Cloudflare Tunnel, `.env` de produção ou banco de dados fora do escopo aprovado.

---

## 6. Decisão pendente

Este documento é um plano para revisão, não uma autorização para alterar código. A decisão solicitada é aprovar ou ajustar a arquitetura de **gateway LLM central sem entregar chaves mestres aos processos dos tenants**. A injeção de chaves brutas via `baseEnv` fica explicitamente fora da arquitetura aprovada por não isolar o segredo de plugins que rodam no tenant.
