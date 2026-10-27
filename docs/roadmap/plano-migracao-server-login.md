# Plano de Migração para `dsh-server-login`
## Isolamento real por usuário e rebranding CopyMonster

> **Status:** proposta para revisão. Este documento não executa a migração, não altera o Supabase nem configura o VPS.
>
> **Decisão de segurança:** a migração só deve avançar após validar, em ambiente de teste, os limites de isolamento do modo `account`, a identidade Supabase usada por cada instância e a compatibilidade real do fluxo de login. Isolamento por conta Linux é uma camada adicional; não substitui autenticação e autorização no Supabase.

## 1. Objetivo e contexto

O CopyMonster pretende disponibilizar plugins do Market para usuários sem compartilhar entre eles o estado local, os arquivos ou a execução de plugins. No arranjo atual descrito para o DSH, plugins executam no mesmo processo/usuário do sistema, o que não oferece isolamento operacional suficiente para essa liberação.

A proposta é introduzir o `dsh-server-login` em **modo A (`account`)** como camada de login e orquestração: cada usuário aprovado recebe uma instância DSH executada sob uma conta Linux própria. O objetivo é reduzir o impacto de um plugin ou usuário sobre os dados e plugins de outros usuários.

**O que muda:** a entrada web passa pelo orquestrador, que encaminha o usuário autenticado à sua instância DSH isolada. Instalações e arquivos de plugins devem permanecer no espaço daquele usuário.

**O que não muda:** o Supabase permanece como sistema principal de dados de negócio do CopyMonster, incluindo DNA, sessões, planos e dados associados. O `dsh-server-login` não deve se tornar uma cópia desses dados nem substituir as regras de autorização do Supabase.

## 2. Arquitetura proposta

```text
Navegador
   │ HTTPS: usuário.app.copymonster.co
   ▼
Cloudflare DNS / certificado wildcard
   │
   ▼
Nginx (TLS, wildcard, proxy reverso)
   │ HTTP interno, porta 3080
   ▼
 dsh-server-login (login, aprovação e roteamento)
   ├── usuário A → instância DSH sob conta Linux A → arquivos/plugins de A
   ├── usuário B → instância DSH sob conta Linux B → arquivos/plugins de B
   └── ...
             │                         │
             └──────── HTTPS ──────────┴──► Supabase compartilhado
                                                com Auth e RLS
```

O diagrama representa a arquitetura desejada, não uma configuração já validada. A topologia de subdomínio, o modelo de proxy para cada instância e o mecanismo de identidade Supabase precisam ser confirmados com a implementação real do `dsh-server-login` e do DSH.

### Responsabilidade de cada camada

| Componente | Responsabilidade proposta | Não deve ser tratado como |
|---|---|---|
| `dsh-server-login` / SQLite | Contas aprovadas para entrar no orquestrador, credenciais/sessões próprias do login e metadados operacionais mínimos exigidos pelo serviço | Banco principal de DNA, planos, sessões de negócio ou perfil CopyMonster |
| Instância DSH por usuário | Execução do DSH e plugins, arquivos e configuração locais daquele usuário | Fronteira suficiente para autorizar acesso aos dados do Supabase |
| Supabase | Fonte principal de usuários CopyMonster, DNA, sessões, planos e dados de negócio, com políticas RLS | Banco automaticamente isolado só porque o cliente roda sob outra conta Linux |
| Nginx / Cloudflare | TLS, roteamento de hostnames e encaminhamento ao serviço | Controle de autorização de negócio |

### Identidade e RLS: requisito bloqueante de projeto

Antes de migrar, definir e testar como cada instância obtém uma identidade Supabase válida do usuário atual. Uma `SUPABASE_SERVICE_ROLE_KEY` compartilhada em `.env` ou `DSH_HOME` **não** respeita RLS e não pode ser usada por clientes/instâncias para operações normais de usuário. A chave `anon`/publishable isoladamente também não identifica o usuário: as chamadas protegidas por RLS precisam incluir um JWT de usuário válido, ou passar por um backend confiável que valide a identidade e aplique autorização.

Não colocar credenciais Supabase privilegiadas em arquivos acessíveis a plugins. Documentar rotação, escopo, permissões Unix e exposição em logs. Se houver segredo server-side inevitável, manter fora do alcance do processo/plugin não confiável e intermediar operações por serviço confiável com autorização explícita.

## 3. Pré-requisitos

### VPS e software

- VPS Linux suportado, com acesso administrativo/root e recursos dimensionados para uma instância DSH por usuário simultâneo, além do orquestrador.
- Node.js `^22.19` ou `>=24`, confirmando a versão suportada pelo `dsh-server-login` e pelo DSH no momento da implantação.
- DSH CLI instalado globalmente, conforme documentação/versionamento compatível: `npm i -g @deepseek-ai/dsh`.
- Nginx instalado e configuração atual exportada/backup disponível.
- Git, npm e ferramentas necessárias ao build; dependências e versões travadas/reprodutíveis.
- `dsh-server-login` inspecionado em commit/tag fixado, com processo de atualização e rollback definido.

### Rede e domínio

- Cloudflare sob controle do responsável pelo domínio.
- DNS wildcard `*.app.copymonster.co` apontando para o VPS, com DNS-only/proxy decidido e validado para WebSockets, cookies e tráfego do DSH.
- Certificado wildcard válido para `app.copymonster.co` e `*.app.copymonster.co` (Let's Encrypt DNS-01 ou Cloudflare Origin, conforme a cadeia TLS escolhida).
- Porta 3080 disponível apenas na rede local; não expor a porta de aplicação diretamente à internet.
- Firewall permitindo somente tráfego necessário; SSH administrativo restrito.

### Segurança operacional

- Permissão root necessária para provisionar contas Linux e executar o mecanismo `setuid` do modo `account`; validar comportamento e compatibilidade com systemd, diretórios, subprocessos e plugins.
- Confirmar limites de CPU, memória, processos, disco, arquivos, rede e tempo de execução por conta. `setuid` sozinho não limita recursos nem garante confinamento completo.
- Validar permissões e propriedade dos diretórios, symlinks, sockets, logs, temporários, caches e IPC entre instâncias.
- Definir retenção, backup/restauração e exclusão de contas/arquivos de usuários.
- Acesso ao projeto Supabase para configurar/validar Auth, políticas RLS, redirect URLs e fluxos de recuperação de conta, sem compartilhar chaves privilegiadas com plugins.

## 4. Passo a passo da migração (modo A)

Executar primeiro em staging com dados de teste e usuários não privilegiados. Não iniciar o corte de produção enquanto os critérios de segurança e identidade abaixo não forem aprovados.

1. **Inventário e decisão de compatibilidade**
   - Registrar versão/commit do DSH atual, comandos systemd, variáveis, caminhos de `DSH_HOME`, portas, proxy, integrações e plugins.
   - Ler e fixar uma versão revisada do `dsh-server-login`; confirmar requisitos, fluxo de provisionamento e limitações do modo `account`.
   - Desenhar o fluxo de identidade Supabase e testar RLS com duas contas distintas, incluindo tentativas de leitura e escrita cruzadas.

2. **Backup e recuperação**
   - Fazer backup consistente do `DSH_HOME` atual, configurações, dados persistentes e estado necessário para rollback; cifrar e restringir acesso ao backup.
   - Fazer snapshot/backup do Supabase pelo procedimento suportado pelo projeto/plano e confirmar que a restauração é possível. Registrar timestamp, responsável e teste de recuperação.
   - Guardar cópias versionadas da configuração Nginx, unit files systemd, arquivos de ambiente e DNS/certificado, removendo segredos de logs e do repositório.

3. **Preparar staging**
   - Provisionar host ou ambiente separado; instalar as versões de Node e DSH fixadas.
   - Clonar o `dsh-server-login` em diretório próprio, fixar commit/tag e executar `npm install` (preferir lockfile e instalação reproduzível) e `npm run build` conforme o README do commit escolhido.
   - Não assumir que os comandos ou opções abaixo permanecem iguais entre versões: conferir `--help` e documentação da revisão fixada.

4. **Configurar modo `account`**
   - Definir e validar, de acordo com a versão instalada:
     - `DSH_SERVER_LOGIN_ISOLATION_MODE=account`
     - `DSH_SERVER_LOGIN_BASE_DOMAIN=app.copymonster.co`
     - `DSH_SERVER_LOGIN_COOKIE_DOMAIN=.app.copymonster.co`
     - `DSH_SERVER_LOGIN_SECURE_COOKIES=true`
   - Guardar variáveis e segredos em arquivo protegido, fora do Git, com permissões mínimas.
   - Verificar domínio dos cookies, `SameSite`, `Secure`, CSRF, sessão, logout, expiração e comportamento em subdomínios. O cookie compartilhado no wildcard exige revisão específica contra subdomain takeover e origem não confiável.

5. **Criar o administrador do orquestrador**
   - Usar o mecanismo suportado pela versão fixada. O comando proposto para validar é `node lib/cli.js bootstrap-admin --username admin --password '<senha>'`.
   - Usar senha gerada e armazenada em cofre; não inserir segredo literal em histórico de shell, documentação, CI ou chat. Confirmar se a CLI oferece entrada interativa/variável segura.
   - Ativar MFA ou controles adicionais se suportados; restringir a administração por rede/identidade quando possível.

6. **Configurar Nginx, TLS e Cloudflare**
   - Configurar proxy HTTPS para o serviço interno na porta 3080, incluindo WebSocket/headers necessários e preservação correta de `Host` e IP encaminhado.
   - Implementar roteamento wildcard apenas para hosts válidos e rejeitar hosts desconhecidos; definir tamanho/timeout de upload e limites coerentes.
   - Testar certificado, renovação, redirects, cookies, headers de segurança e ausência de acesso público direto à porta 3080.

7. **Configurar systemd e contas isoladas**
   - Criar unit file com usuário de serviço dedicado para o orquestrador, hardening compatível, restart policy, logs e dependências de rede.
   - Seguir o modelo oficial do `dsh-server-login` para criação/execução de contas de usuário; não conceder sudo geral a processos de usuário/plugin.
   - Testar reinício, encerramento, provisionamento concorrente, limpeza, limites de recursos e falha parcial.

8. **Validar fluxo funcional e isolamento**
   - Criar duas contas de teste independentes, autenticar e abrir as instâncias em navegadores/perfis separados.
   - Instalar um plugin de teste aprovado (por exemplo, `dsh-vision-router`) apenas na conta A; verificar que B não o lista, executa, altera ou lê seus arquivos/configurações.
   - Testar caminhos conhecidos e tentativas de travessia, permissões Unix, processos, arquivos temporários, sockets, logs, cache, diretórios compartilhados e endpoints internos.
   - Validar DNA, sessões e planos no Supabase usando as duas identidades; confirmar RLS por testes negativos e logs/auditoria. Repetir com chamadas diretas, não apenas pela UI.
   - Testar logout, revogação/expiração, recuperação de acesso, aprovação de conta, troca de subdomínio e acesso a host inválido.

9. **Rebranding e revisão de conteúdo**
   - Aplicar o script de rebranding descrito na seção 5 somente à revisão fixada do `dsh-server-login`.
   - Revisar todas as telas, emails, títulos, metadados, mensagens de erro, acessibilidade, responsividade, idioma, favicon e textos de domínio; conferir que atualização/rebuild não sobrescreve o patch.

10. **Migração de usuários e corte**
    - Não presumir que contas do Supabase sejam migradas automaticamente. Definir mapeamento seguro entre identidade do orquestrador e usuário Supabase, evitando duplicatas e associação por email não verificado.
    - Comunicar aos usuários e planejar novo cadastro/aprovação somente se a integração não suportar migração segura. Preservar DNA e dados existentes vinculando-os à identidade correta, com teste de reconciliação.
    - A proposta de manter login antigo por 24 horas em paralelo requer análise de risco: não manter dois pontos de entrada sem política de sessão, revogação e roteamento consistentes. Preferir janela de manutenção/cutover controlado ou coexistência isolada em staging.
    - Após aprovação dos testes e janela de mudança, parar o serviço antigo, ativar o novo roteamento e monitorar erros, recursos e sinais de acesso cruzado. Não remover o backup nem o caminho de rollback até o período de observação acordado.

## 5. Rebranding do `dsh-server-login`

Criar um script versionado no repositório CopyMonster (por exemplo, `scripts/apply-server-login-rebrand.mjs`), inspirado em `scripts/apply-dsh-plugins-rebrand.mjs`, para aplicar substituições determinísticas sobre uma versão fixada do repositório upstream.

### Escopo do script

- Validar o caminho de entrada, versão/commit esperado e arquivos-alvo; encerrar com erro se o layout upstream divergir.
- Ser idempotente: segunda execução não duplica estilos nem altera novamente conteúdo já correto.
- Restringir alterações a arquivos de UI/branding; não substituir identificadores de ambiente no backend sem auditar todos os usos.
- Gerar diff/relatório de arquivos modificados e oferecer modo de verificação sem escrita; testar em cópia limpa da versão fixada.
- Não armazenar credenciais, certificados ou dados de produção no repositório.

### Mapeamentos a auditar

| Original | CopyMonster | Observação |
|---|---|---|
| `DSH Server Login` | `CopyMonster` | Login, títulos e metadados |
| `DSH` | `CopyMonster` | Substituição contextual; evitar alterar nomes de produto/identificadores técnicos quando isso quebrar comportamento |
| `DeepSeek Harness` | `CopyMonster` | Interface e textos visíveis |
| `DSH_SERVER_LOGIN` | `COPYMONSTER_SERVER_LOGIN` | Alteração de variáveis só com migração compatível de configuração, documentação e systemd; manter compatibilidade temporária se necessária |
| `--dsw-alias-*` | `--cm-*` | Migrar tokens e referências CSS de forma consistente, sem substituir seletor/variável desconhecida cegamente |
| `dsh.example.com` | `app.copymonster.co` | Exemplos, links e configuração; domínio final também depende de DNS e TLS |

### Identidade visual

- Usar a paleta dark/ouro já existente no `apps/web/src/cm-theme.css`, após identificar os tokens realmente aplicáveis ao app upstream.
- Adaptar telas de login, administração e usuários; manter contraste, foco visível, estados de erro/sucesso, navegação por teclado e layout responsivo.
- Validar visualmente em desktop/mobile e nos temas suportados; verificar que o estilo não sugere funcionalidades de segurança inexistentes.

## 6. Configuração do Supabase por instância

Cada instância DSH deve executar operações em nome do usuário autenticado ou chamar um backend confiável que faça a autorização. O Supabase continua compartilhado e o RLS permanece obrigatório.

- Preferir configuração não secreta com URL do projeto e chave pública `anon`/publishable, combinada com JWT Supabase válido do usuário para as operações protegidas por RLS.
- Definir um fluxo seguro para obtenção, renovação e revogação do JWT; nunca assumir que a autenticação separada do `dsh-server-login` cria automaticamente um usuário ou sessão Supabase.
- **Não** distribuir `service_role` ou outra credencial privilegiada no `.env` compartilhado, no `DSH_HOME` dos usuários, em plugins, bundles ou arquivos legíveis por processos não confiáveis.
- Se integração exigir acesso privilegiado, intermediar por serviço server-side confiável que valide a sessão e autorização por operação; não conceder acesso irrestrito só porque o pedido veio de uma instância isolada.
- Testar as políticas RLS com duas contas e operações permitidas/negadas, incluindo DNA, sessões, planos e tabelas relacionadas; testar chamadas via REST/RPC diretamente.
- Documentar quais dados são acessíveis pela instância, rotação/revogação de tokens, expiração e resposta em caso de perda/comprometimento de uma conta Linux.

## 7. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Usuários precisam de novo cadastro ou vínculo de identidade | Validar importação/vínculo antes do corte; exigir email verificado; não associar contas somente por email não verificado; comunicar e testar reconciliação de DNA/dados |
| Wildcard DNS/TLS ou cookies mal configurados | Preparar e testar subdomínio de staging; validar renovação, `Secure`, `SameSite`, CSRF, domínio do cookie e hostnames inválidos |
| Root/`setuid` indisponível ou inseguro no VPS | Verificar permissões e comportamento em staging; se não suportado, interromper o modo A e rever a arquitetura, sem contornar permissões |
| Conta Linux não fornece isolamento completo | Auditar processos, permissões, recursos, IPC, symlinks, rede e kernel; avaliar sandboxing adicional e limitar plugins/capacidades |
| Chave privilegiada Supabase vaza por instância/plugin | Não distribuir `service_role`; usar JWT por usuário ou backend mediador; revisar permissões e testar RLS com chamadas diretas |
| Plugin explora rede, recursos ou vulnerabilidade do kernel/DSH | Allowlist e revisão de plugins, limites de CPU/memória/processos/disco/rede, atualização rápida, monitoramento e resposta a incidentes |
| Falha operacional ou custo de múltiplas instâncias | Medir consumo em staging com carga representativa; cotas, alertas, logs estruturados, runbook e capacidade de desligar/limpar instâncias |
| Migração de login interrompe acesso | Janela de mudança, comunicação, backup testado, critérios de corte/rollback e não apagar o serviço/dados antigos prematuramente |
| Rebranding parcial ou perdido em atualização upstream | Script idempotente, versão fixada, diff automatizado e checklist de todas as telas após cada atualização |
| DSH_SERVER_LOGIN renomeado quebra compatibilidade | Manter nome técnico upstream ou oferecer alias/compatibilidade; mudar identificadores só após mapear código, unit files, documentação e upgrades |
| Rollback restaura arquivos, mas não sessões/estado atualizado | Definir sincronização e ponto de retorno dos dados; testar restauração; evitar escrita concorrente em dois sistemas durante coexistência |

## 8. Rollback

1. Acionar rollback se houver falha de autenticação ampla, perda de acesso a DNA/sessões, erro de isolamento, exposição de dados, instabilidade crítica ou incapacidade de operar plugins com segurança.
2. Remover o roteamento novo no Nginx/Cloudflare e restaurar a configuração anterior previamente versionada.
3. Parar e desabilitar o serviço `dsh-server-login`; reativar `copymonster.service` somente após confirmar que sua configuração e credenciais antigas continuam válidas.
4. Restaurar o `DSH_HOME` a partir do backup apenas se necessário e de acordo com o ponto de corte, evitando sobrescrever alterações legítimas posteriores sem decisão explícita.
5. Não restaurar snapshot do Supabase automaticamente: primeiro avaliar se houve alteração incompatível ou corrupção. Restaurar banco pode descartar dados válidos posteriores ao snapshot; exige aprovação e plano específico.
6. Revogar sessões/tokens potencialmente expostos, trocar segredos comprometidos e preservar logs para análise.
7. Manter o código do `dsh-server-login` e o patch de rebranding separados; rollback operacional não deve exigir apagar históricos ou modificar o upstream.
8. Registrar causa, horário, dados afetados e critério para nova tentativa.

## 9. Checklist de aceitação

### Infraestrutura e acesso

- [ ] Admin autorizado consegue entrar no orquestrador e não há credenciais padrão/compartilhadas.
- [ ] Usuário consegue se registrar, ser aprovado, entrar e acessar somente sua instância.
- [ ] TLS wildcard, cookies, CSRF, logout, expiração e hosts inválidos foram testados.
- [ ] Porta 3080 não está exposta diretamente à internet.
- [ ] Serviço systemd reinicia de forma previsível; logs não contêm senhas, tokens ou conteúdo sensível.

### Isolamento

- [ ] Dois usuários recebem contas Linux e diretórios distintos com permissões verificadas.
- [ ] Usuário A instala um plugin aprovado e consegue usá-lo na instância A.
- [ ] Usuário B não vê, executa, altera nem lê o plugin/configuração/arquivos de A.
- [ ] Testes negativos de arquivos, processos, IPC, symlinks, sockets, temporários, logs, cache, rede e endpoints internos passam.
- [ ] Limites de recursos por usuário foram configurados e testados.
- [ ] Há processo de suspensão, exclusão e limpeza de conta/arquivos com auditoria e recuperação definida.

### Supabase e dados

- [ ] A identidade do `dsh-server-login` está vinculada com segurança ao usuário Supabase correto.
- [ ] RLS está ativo nas tabelas relevantes e foi exercitado com usuários distintos e chamadas diretas.
- [ ] Usuário A não lê nem altera DNA, sessões, planos ou dados de B.
- [ ] Nenhuma `service_role`/credencial privilegiada fica acessível a plugins ou processos de usuário.
- [ ] DNA e sessões existentes permanecem acessíveis pela identidade correta após a migração.
- [ ] Fluxo de renovação, revogação e expiração de JWT foi testado.

### Rebranding e operação

- [ ] Login apresenta CopyMonster, logo e paleta dark/ouro com contraste acessível.
- [ ] Admin e usuários apresentam identidade CopyMonster em títulos, conteúdo e mensagens.
- [ ] Busca de strings/cores/domínios residuais foi revisada e documentada.
- [ ] Script de rebranding é idempotente e validado contra a versão upstream fixada.
- [ ] Backup e rollback foram testados em staging; responsáveis e janela de corte foram definidos.
- [ ] Monitoramento e alertas de isolamento, falhas, recursos e autenticação estão ativos.

## 10. Próximos passos após a migração

1. Liberar o Market gradualmente, inicialmente com plugins revisados/allowlisted, observando logs e consumo por instância.
2. Monitorar tentativas de acesso cruzado, falhas de provisionamento, uso de recursos e atualizações de plugins; definir resposta a incidentes e processo de suspensão.
3. Rever periodicamente permissões, dependências, isolamento de contas e políticas RLS.
4. Avaliar modo B (Kubernetes) somente quando requisitos operacionais, carga, custos e competências justificarem; não tratar K8s como substituto automático da autorização/RLS.

## Bloqueios e itens ainda não verificados

Este plano não confirma o estado do VPS, permissões root/`setuid`, versão do Node, DNS, certificado, Nginx, systemd, limites de recursos nem comportamento da revisão atual do `dsh-server-login`. Esses itens exigem acesso e testes no ambiente de staging/produção.

Também não está comprovado neste documento que o `dsh-server-login` integra diretamente com Supabase Auth ou transporta de forma segura a identidade Supabase para o DSH. O desenho de autenticação e RLS por usuário é um **bloqueio técnico anterior ao corte**; não deve ser resolvido distribuindo uma chave privilegiada compartilhada.
