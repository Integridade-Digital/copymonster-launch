# PLANO DE SOLUÇÃO ARQUITETURAL: Integração Segura dsh-server-login + CopyMonster SaaS
## Restauração do App Principal (:3080), Segregação de Borda (Cloudflare Tunnel), Supressão de Desktop e Isolamento de SO (Linux Account)

> **Status:** Proposta de Arquitetura & Plano Passo a Passo para Aprovação do Proprietário  
> **Data:** 31 de Outubro de 2026  
> **Escopo:** Restauração do `copymonster.service`, realocação do `dsh-server-login` para a porta 3081, supressão de desktop, roteamento de subdomínios, clareza no onboarding de cadastro e garantia de SSO Supabase Auth.  
> **Regra Estrita:** Nenhuma alteração de código ou configuração em produção/VPS será aplicada antes da aprovação explícita deste plano.

---

## 1. Sumário Executivo & Reconhecimento Formal da Falha de Planejamento

O **CopyMonster** é uma plataforma SaaS proprietária (construída como fork sob licença MIT do DeepSeek Harness / DSH) focada em automação de copy de alta conversão, funis de lançamento e memória estratégica de marca (Brand DNA Engine). Para liberar o ecossistema de extensões (**Market com mais de 7.200 plugins**) sem colocar em risco a segurança do host nem os dados confidenciais dos assinantes, foi selecionado o orquestrador `dsh-server-login` em modo de isolamento estrito por conta de SO Linux (`account`).

### Reconhecimento Explícito da Falha Crítica de Arquitetura
Durante a elaboração do plano anterior (`docs/roadmap/plano-isolamento-dsh-server-login.md`), ocorreu uma **falha grave de planejamento arquitetural**:
1. **Conflito de Porta Fatal (3080):** O orquestrador `dsh-server-login` foi configurado para escutar na porta local `127.0.0.1:3080`, desconsiderando que a aplicação principal do SaaS CopyMonster (`copymonster.service`) já operava e dependia historicamente da porta `3080`.
2. **Derrubada do SaaS e Inacessibilidade do Painel:** Ao iniciar o `dsh-server-login` na porta 3080, ocorreu uma colisão de socket (`EADDRINUSE`) ou a captura indevida do tráfego do Cloudflare Tunnel. O serviço `copymonster.service` foi derrubado e o painel de controle do CopyMonster tornou-se completamente inacessível para clientes e administração.
3. **Quebra Total da Experiência do Usuário (UX):** Além de derrubar o app, o tráfego de `app.copymonster.co` passou a exibir a interface padrão do `dsh-server-login` — incluindo uma tela de "desktop de arquivos" (`web/desktop.html`) com botões manuais de lançamento ("启动 DSH", "Abrir DSH"). Isso eliminou o onboarding proprietário do CopyMonster, descaracterizou a identidade visual e expôs os clientes a um ambiente cru e confuso.

**Compromisso Deste Plano:** O aplicativo CopyMonster (`copymonster.service`) deve ser **a única porta de entrada visível e soberana** do produto. O `dsh-server-login` deve funcionar estritamente como um **orquestrador de infraestrutura invisível (headless backend)** nos bastidores, escutando em porta dedicada e restrita, sem nunca interferir na porta 3080 nem exibir telas de desktop intermediárias.

---

## 2. Topologia de Arquitetura Corrigida

A nova topologia física e de rede segrega completamente o App SaaS do orquestrador de contêineres/contas Linux:

```text
                               INTERNET (Clientes HTTPS)
                                          │
                                          ▼
             ┌─────────────────────────────────────────────────────────┐
             │              Cloudflare Edge (Zero Trust / DNS)         │
             │   - Certificado Wildcard (*.app.copymonster.co)         │
             │   - Borda WAF, TLS Termination e Proteção DDoS          │
             └────────────────────────────┬────────────────────────────┘
                                          │ (Túnel criptografado cloudflared)
                                          ▼
             ┌─────────────────────────────────────────────────────────┐
             │                     VPS Linux Host                      │
             │                                                         │
             │  cloudflared (Túnel Systemd)                            │
             │     ├── Ingress 1: Host app.copymonster.co              │
             │     │      └──► Roteia para: 127.0.0.1:3080             │
             │     │                                                   │
             │     └── Ingress 2: Host *.app.copymonster.co (Wildcard) │
             │            └──► Roteia para: 127.0.0.1:3081             │
             │                                                         │
             │  ─────────────────────────────────────────────────────  │
             │                                                         │
             │  [PORTA 3080] copymonster.service (App Principal SaaS)  │
             │     ├── Frontend React/Vite + Brand DNA Engine          │
             │     ├── Onboarding Personalizado CopyMonster            │
             │     ├── Painel Admin, Billing (Stripe), Métricas        │
             │     └── Comunicação direta com Supabase Auth/PostgreSQL │
             │                                                         │
             │  ─────────────────────────────────────────────────────  │
             │                                                         │
             │  [PORTA 3081] dsh-orchestrator.service (Invisível)      │
             │     ├── Escuta exclusivamente em: 127.0.0.1:3081        │
             │     ├── Valida sessão Supabase e cookie sid (.app...)   │
             │     ├── Port Guard ativo (iptables OUTPUT owner-match)  │
             │     ├── SEM DESKTOP: Proxy direto para DSH do usuário   │
             │     └── Spawn sob demanda via setpriv (UID >= 100000)   │
             │            ├── user1.app... ──► UID 100001 (:42135)     │
             │            └── user2.app... ──► UID 100002 (:42136)     │
             └────────────────────────────┬────────────────────────────┘
                                          │
                           Sessões, JWT & Dados de Negócio
                                          │
                                          ▼
             ┌─────────────────────────────────────────────────────────┐
             │                  Supabase (Plano Free)                  │
             │  - auth.users: Logins, validação de e-mail e JWT        │
             │  - public.users: username (slug do subdomínio), perfis  │
             │  - public.tenants, subscriptions, DNA Engine, RLS       │
             └─────────────────────────────────────────────────────────┘
```

---

## 3. Passo 1: Restauração Imediata do `copymonster.service` (Porta 3080)

Para restabelecer imediatamente a operação do CopyMonster no VPS e reverter o conflito sem qualquer risco de indisponibilidade residual:

### 3.1 Comandos de Desocupação e Restauração no VPS

1. **Parar imediatamente o orquestrador que tomou ou conflita com a porta 3080:**
   ```bash
   sudo systemctl stop dsh-server-login
   sudo systemctl disable dsh-server-login
   ```
2. **Confirmar que a porta 3080 foi liberada de qualquer processo zumbi:**
   ```bash
   sudo ss -tulpn | grep :3080
   # Se houver algum processo remanescente:
   sudo fuser -k 3080/tcp
   ```
3. **Reiniciar o serviço principal do CopyMonster:**
   ```bash
   sudo systemctl restart copymonster.service
   sudo systemctl status copymonster.service
   ```
4. **Verificar resposta local da aplicação CopyMonster:**
   ```bash
   curl -I http://127.0.0.1:3080
   # Deve retornar HTTP 200 OK ou 302 Redirect da interface CopyMonster
   ```
5. **Garantir que o Cloudflare Tunnel entrega `app.copymonster.co` na 3080:**
   Verificar no arquivo `/etc/cloudflared/config.yml` se a regra principal está correta:
   ```yaml
   ingress:
     - hostname: app.copymonster.co
       service: http://127.0.0.1:3080
     - service: http_status:404
   ```
6. **Reiniciar o túnel da Cloudflare e validar publicamente:**
   ```bash
   sudo systemctl restart cloudflared
   ```
   *Teste de validação:* Acessar `https://app.copymonster.co` no navegador. O onboarding, login e painel proprietário do CopyMonster devem carregar normalmente.

---

## 4. Passo 2: Reposicionamento do `dsh-server-login` na Porta 3081 (Orquestrador Invisível)

O orquestrador `dsh-server-login` é reposicionado para operar em uma porta de infraestrutura dedicada e desvinculada (`3081`), atuando apenas como roteador de subdomínios isolados.

### 4.1 Configuração de Ambiente do Orquestrador (`/etc/dsh-server-login/.env`)
```bash
# Porta dedicada para evitar qualquer conflito com o CopyMonster (:3080)
PORT=3081
HOST=127.0.0.1

# Modo de isolamento real por conta Linux e Port Guard ativo
DSH_SERVER_LOGIN_ISOLATION_MODE=account
DSH_SERVER_LOGIN_PORT_GUARD=true
DSH_SERVER_LOGIN_UID_BASE=100000

# Domínio base para proxy de subdomínios
BASE_DOMAIN=app.copymonster.co

# Caminho do executável DSH e Node fora de /root
DSH_PATH=/usr/local/bin/dsh
NODE_PATH=/usr/local/bin/node

# Supabase Auth e Banco do Orquestrador
SUPABASE_URL=https://<seu-projeto>.supabase.co
SUPABASE_ANON_KEY=<sua-anon-key>
SQLITE_DB_PATH=/var/lib/dsh-server-login/orchestrator.db
```

### 4.2 Nova Unidade Systemd Dedicada (`/etc/systemd/system/dsh-orchestrator.service`)
```ini
[Unit]
Description=CopyMonster DSH Multi-Tenant Account Orchestrator (Backend)
After=network.target copymonster.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/dsh-server-login
EnvironmentFile=/etc/dsh-server-login/.env
ExecStart=/usr/local/bin/node dist/cli.js serve
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

---

## 5. Passo 3: Configuração do Cloudflare Tunnel (Roteamento de Borda)

O arquivo `/etc/cloudflared/config.yml` deve segregar de forma estrita o tráfego do App Principal e dos Subdomínios de Usuários:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json

ingress:
  # -------------------------------------------------------------
  # 1. APP PRINCIPAL (CopyMonster SaaS): Landing, Login, Onboarding, DNA
  # -------------------------------------------------------------
  - hostname: app.copymonster.co
    service: http://127.0.0.1:3080
    originRequest:
      http2Origin: true
      noTLSVerify: true

  # -------------------------------------------------------------
  # 2. SUBDOMÍNIOS ISOLADOS (*.app.copymonster.co): Instâncias DSH dos Usuários
  # -------------------------------------------------------------
  - hostname: "*.app.copymonster.co"
    service: http://127.0.0.1:3081
    originRequest:
      http2Origin: true
      noTLSVerify: true

  # -------------------------------------------------------------
  # 3. FALLBACK OBRIGATÓRIO (Qualquer outro tráfego não reconhecido)
  # -------------------------------------------------------------
  - service: http_status:404
```

### DNS no Cloudflare Dashboard
Garantir duas entradas CNAME apontando para o túnel (`<TUNNEL_UUID>.cfargotunnel.com`):
1. `app.copymonster.co` -> CNAME `<TUNNEL_UUID>.cfargotunnel.com` (com Proxy ativo ☁️).
2. `*.app.copymonster.co` -> CNAME `<TUNNEL_UUID>.cfargotunnel.com` (com Proxy ativo ☁️).

---

## 6. Passo 4: Supressão do Desktop do `dsh-server-login` e Proxy Transparente

O arquivo `web/desktop.html` do `dsh-server-login` nunca mais será exibido para nenhum usuário. A experiência será 100% contínua e sem telas intermediárias.

### 6.1 Análise do Problema no Código Atual
No código nativo do `dsh-server-login`:
- `web/index.html` e `web/login.html` executam `location.href = '/desktop.html'`.
- `web/desktop.html` exibe uma janela estilo SO em chinês onde o usuário precisa manualmente clicar em "启动 DSH" e depois em "打开 DSH ↗" para que uma nova aba abra `https://<username>.app.copymonster.co`.
- Se o usuário acessar `<username>.app.copymonster.co` e a instância estiver parada, o hook em `src/supervisor/proxy.ts` retorna status `404 not_running`.

### 6.2 Solução Arquitetural: Auto-Launch e Bypass Headless

1. **Eliminação do Desktop:**
   - Desabilitar a rota e o arquivo `/desktop.html`. O orquestrador não serve interface gráfica própria de desktop.
2. **Auto-Launch no Subdomínio:**
   - No `onRequest` do arquivo `src/supervisor/proxy.ts`: quando o usuário autenticado acessa `https://<username>.app.copymonster.co/`:
     - Se a instância DSH do usuário já estiver ativa, o proxy HTTP e WebSocket encaminha a requisição imediatamente para `127.0.0.1:<PORTA_DSH_DO_USUARIO>`.
     - Se a instância DSH **não** estiver ativa (`not_running`), o orquestrador não retorna 404. Ele executa automaticamente `app.supervisor.launch(user.id, userHome)` em segundo plano e serve uma tela de transição ultra-rápida e elegante (com a identidade Dark/Gold do CopyMonster): *"Iniciando seu ambiente seguro CopyMonster..."*.
     - Assim que o socket local do DSH responde (normalmente 1 a 2 segundos), a página faz reload automático e entra direto na interface do DSH/CopyMonster.
3. **Ponto de Acesso a partir do SaaS:**
   - No painel do CopyMonster (`app.copymonster.co`), quando o assinante clica em "Abrir Workspace de Copy" ou "Executar Agente de Lançamento", o app simplesmente redireciona o navegador para `https://<username>.app.copymonster.co/`.
   - Como o cookie de sessão do Supabase/orquestrador é compartilhado no domínio `.app.copymonster.co`, o usuário entra direto no ambiente sem qualquer fricção.

---

## 7. Passo 5: Especificação Clara dos Dados para Criação de Nova Conta

Esta seção responde detalhadamente e sem ambiguidades à solicitação:
> *"Quais dados precisam ser solicitados para criação de nova conta do usuario sendo que antes o supabase solicitava nome e email. Isso deve ser claro."*

### 7.1 A Necessidade Técnica do "Username / Subdomínio"
No Supabase Auth tradicional, bastavam:
- **Nome Completo** (`full_name`)
- **E-mail** (`email`)
- **Senha** (`password`)

No entanto, a arquitetura de **isolamento por conta Linux (`account`)** e **subdomínio dedicado (`<username>.app.copymonster.co`)** impõe três restrições técnicas inegociáveis:
1. **Padrão de Nome de Usuário Linux (`useradd`):** O sistema operacional exige nomes de usuário minúsculos, alfanuméricos, sem acentos, sem espaços e sem caracteres especiais (`regex: ^[a-z0-9][a-z0-9_-]{2,30}$`). O comando `useradd -u 100001 dsh-adriano` falha se houver espaços ou caracteres inválidos.
2. **Padrão DNS RFC 1123 (Subdomínios):** Nomes de subdomínio só aceitam letras minúsculas, números e hífens. Não aceitam arroba (`@`), pontos (`.`) ou sublinhados (`_`).
3. **Proteção contra Nomes Reservados:** Usuários não podem registrar subdomínios como `app`, `api`, `admin`, `root`, `www`, `dsh`, `copymonster`, `mail`, `static`, etc., pois quebrariam o roteamento global.

---

### 7.2 Definição dos Dados a Solicitar: As Duas Abordagens Possíveis

Apresentamos as duas estratégias viáveis para decisão do proprietário do SaaS:

#### Opção A (Recomendada: Menor Atrito de Conversão + Auto-Slug no Onboarding)
*Esta opção mantém a taxa de conversão máxima na página de cadastro e resolve o subdomínio no Onboarding do CopyMonster.*

1. **Tela de Cadastro (Página de Registro):**
   - **Nome Completo** (ex: `Adriano Vieira`)
   - **E-mail** (ex: `adrianovp@gmail.com`)
   - **Senha** (mínimo 8 caracteres)
2. **Geração Automática do Slug no Backend do CopyMonster:**
   - O sistema gera automaticamente um slug limpo a partir do e-mail (ou nome): `adrianovp@gmail.com` -> `adrianovp`.
   - Se houver colisão de nomes, anexa um sufixo numérico incremental (ex: `adrianovp2`).
3. **Confirmação Visual no Onboarding (Passo 1 do CopyMonster):**
   - Durante o onboarding (onde o usuário define sua marca e Brand DNA), o CopyMonster exibe o campo já pré-preenchido para aprovação do assinante:
     ```text
     ┌─────────────────────────────────────────────────────────────────┐
     │ Seu Endereço Seguro de Workspace:                               │
     │ https:// [ adrianovp           ] .app.copymonster.co            │
     │ (Você pode personalizar agora. Apenas letras minúsculas e números)│
     └─────────────────────────────────────────────────────────────────┘
     ```
   - O assinante pode confirmar ou alterar seu slug antes de salvar.

#### Opção B (Campo Explícito no Cadastro)
*Esta opção solicita todos os dados já no primeiro formulário de registro.*

1. **Tela de Cadastro (Formulário Direto):**
   - **Nome Completo**
   - **E-mail de Trabalho**
   - **Seu Subdomínio / Workspace** (ex: `adrianovp` gerando `adrianovp.app.copymonster.co`)
   - **Senha**
2. **Validação em Tempo Real no Formulário:**
   - Feedback instantâneo via debounce checando se o username está disponível no banco e se respeita o formato `^[a-z0-9][a-z0-9-]{2,28}[a-z0-9]$`.

---

### 7.3 Tabela de Campos e Mapeamento de Banco de Dados

| Campo Solicitado | Obrigatório | Regras de Validação | Onde é Salvo | Uso no Sistema |
|---|---|---|---|---|
| **E-mail** | Sim | Formato de e-mail RFC 5322 válido; bloqueio de descartáveis | `auth.users(email)`, `public.users(email)` | Login, recuperação de senha e notificações Stripe |
| **Nome Completo** | Sim | 2 a 100 caracteres | `public.users(full_name)` | Exibição no cabeçalho do CopyMonster, faturas e perfil |
| **Senha** | Sim | Mínimo 8 caracteres, complexidade padrão | `auth.users(encrypted_password)` | Autenticação criptografada no Supabase |
| **Username (Slug do Subdomínio)** | Sim (auto-gerado na Opção A ou digitado na Opção B) | `3` a `30` caracteres; apenas `[a-z0-9-]`; não pode iniciar/terminar com hífen; blacklist de slugs reservados | `public.users(username)`, `dsh-server-login.db(username)` | Criação da conta Linux (`dsh-<username>`), diretório `/home/dsh-<username>` e subdomínio `https://<username>.app.copymonster.co` |

#### Lista de Slugs Reservados (Blacklist Obrigatória):
`admin`, `administrator`, `api`, `app`, `assets`, `auth`, `billing`, `cdn`, `cloud`, `copymonster`, `dashboard`, `dev`, `dns`, `docs`, `dsh`, `ftp`, `help`, `internal`, `login`, `mail`, `orchestrator`, `payment`, `portal`, `root`, `signup`, `smtp`, `ssl`, `staging`, `static`, `status`, `stripe`, `support`, `system`, `test`, `tunnel`, `vpn`, `webhook`, `www`.

---

## 8. Passo 6: Garantia de Autenticação Supabase (SSO e Sincronização)

O Supabase Auth permanece como a autoridade central e soberana de identidade de todo o negócio CopyMonster.

### 8.1 Fluxo de Login Unificado (Single Sign-On)
1. O usuário acessa `https://app.copymonster.co/login` e insere e-mail e senha.
2. O app CopyMonster autentica contra o Supabase (`supabase.auth.signInWithPassword()`), obtendo o JWT de acesso.
3. O app CopyMonster aciona o endpoint de sessão do orquestrador local (`http://127.0.0.1:3081/api/auth/session-token`) passando o token Supabase verificado.
4. O orquestrador valida o token via Supabase Auth e emite o cookie de sessão `sid`:
   ```http
   Set-Cookie: sid=<token-criptografado>; Domain=.app.copymonster.co; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
   ```
5. **Resultado SSO:** Como o cookie é emitido para o domínio pai wildcard (`.app.copymonster.co`), quando o usuário navega entre `app.copymonster.co` e `https://<username>.app.copymonster.co`, o cookie viaja automaticamente.
6. O orquestrador na porta 3081 recebe o cookie, valida a sessão e encaminha o tráfego diretamente para a instância DSH do usuário correspondente, sem solicitar senha novamente.

### 8.2 Provisionamento Automático da Conta Linux no Primeiro Login
1. Ao concluir o onboarding ou no primeiro acesso ao workspace, o serviço de provisionamento é acionado:
   ```bash
   /usr/local/bin/dsh-provision.sh <username> <uid>
   ```
2. O script executa:
   ```bash
   useradd -u <uid> -m -d /home/dsh-<username> -s /usr/sbin/nologin dsh-<username>
   chmod 700 /home/dsh-<username>
   mkdir -p /home/dsh-<username>/workspace /home/dsh-<username>/.dsh
   chown -R dsh-<username>:dsh-<username> /home/dsh-<username>
   ```
3. O orquestrador registra o usuário como `active` no seu banco SQLite local e fica apto a lançar o processo DSH daquele usuário via `setpriv --reuid=<uid> --regid=<uid> --clear-groups`.

---

## 9. Matriz de Riscos, Dependências e Mitigação

| Risco Identificado | Impacto | Nível | Mitigação Arquitetural |
|---|---|---|---|
| Novo conflito de portas | Derrubada do SaaS CopyMonster | Crítico | Segregação estrita: porta 3080 exclusiva para `copymonster.service`; porta 3081 exclusiva para `dsh-orchestrator.service`. Ingress do Cloudflare Tunnel isola os hostnames. |
| Colisão de nomes de subdomínio | Falha no provisionamento Linux | Alto | Checagem de unicidade em `public.users(username)` + blacklist de palavras reservadas + sufixo numérico automático em caso de duplicidade. |
| Sobrecarga de memória RAM com muitos DSHs simultâneos | Lentidão ou instabilidade no VPS | Médio | Configurar idle timeout no orquestrador: se o usuário ficar 30 minutos sem atividade no WebSocket, a instância DSH é desligada graciosamente (`app.supervisor.stop()`). No próximo acesso, auto-launch restaura em 1-2 segundos. |
| Permissões incorretas no diretório home | Plugins acessando arquivos de vizinhos | Alto | `chmod 700` obrigatório no diretório `/home/dsh-<username>`. Processos rodam via `setpriv` com UID `>= 100000` estrito. Port Guard bloqueia conexões loopback a outras portas. |
| Executáveis Node e DSH restritos ao root | Erro de permissão no spawn do DSH | Médio | Garantir Node.js e DSH instalados em caminhos com permissão global de leitura e execução (`/usr/local/bin`), nunca dentro de `/root`. |

---

## 10. Cronograma de Execução e Estimativa de Esforço

| Fase | Ação | Responsável | Esforço Estimado |
|---|---|---|---|
| **Fase 1** | **Restauração Imediata da Produção:** Parar `dsh-server-login`, reiniciar `copymonster.service` na 3080 e confirmar acesso a `app.copymonster.co`. | Operador / VPS | 10 a 15 minutos |
| **Fase 2** | **Reconfiguração do Cloudflare Tunnel:** Atualizar ingress rules separando `app.copymonster.co` (:3080) e `*.app.copymonster.co` (:3081). | Operador / VPS | 15 minutos |
| **Fase 3** | **Ajuste de Código no Repositório do Orquestrador:** Suprimir `desktop.html`, implementar auto-launch no proxy de subdomínio e configurar porta padrão 3081. | OpenCode / Repositório | 1 a 2 horas |
| **Fase 4** | **Ajuste de UI/Onboarding no CopyMonster:** Garantir geração/validação do `username` (slug) no cadastro/onboarding conforme Opção A. | OpenCode / Repositório | 1 hora |
| **Fase 5** | **Deploy e Validação em Staging/Produção:** Subir `dsh-orchestrator.service` na porta 3081, testar criação de conta, auto-launch de subdomínio e testes de isolamento de rede/arquivos. | Operador + OpenCode | 1 hora |

---

## 11. Conclusão e Próximo Passo

Este plano de solução resolve de forma definitiva e elegante todos os pontos críticos levantados:
1. **O app principal CopyMonster volta a ser soberano e exclusivo na porta 3080**, sem risco de derrubadas ou conflitos.
2. **O desktop do `dsh-server-login` é totalmente eliminado**, garantindo que o cliente viva uma experiência fluida, sem telas intermediárias nem botões manuais.
3. **O isolamento de SO por conta Linux e Port Guard continua intacto nos bastidores**, permitindo a liberação futura dos 7.2k plugins do Market com segurança real.
4. **Fica explicitado exatamente quais dados devem ser solicitados no cadastro** (Nome, E-mail, Senha e definição de Username/Slug de subdomínio).

> **Aguardando aprovação:** Nenhuma alteração de código ou configuração em produção/VPS será realizada até a validação e autorização do proprietário do SaaS.
