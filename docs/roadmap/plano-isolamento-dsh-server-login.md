# Plano de Isolamento Multi-Tenant com `dsh-server-login`
## Hard Isolation por Conta de SO Linux, Port Guard e Proteção de Plugins para o CopyMonster SaaS

> **Status:** Plano Técnico Aprovado para Execução em Staging/Produção  
> **Licença:** MIT (CopyMonster — fork do DeepSeek Harness / DSH)  
> **Repositório do Orquestrador:** `https://github.com/pointer-a/dsh-server-login.git`  
> **Alvo:** Servidor VPS Ubuntu/Debian (Single-Host Multi-Tenant)  
> **Regra de Ouro:** NUNCA alterar `packages/core/` nem `packages/llm/`. Não liberar o Market de plugins antes da validação completa dos testes de rede e sistema de arquivos.

---

## 1. Sumário Executivo & Contexto do Negócio

O **CopyMonster** é uma plataforma SaaS de geração e otimização de copy e conteúdo, construída como fork do DeepSeek Harness (DSH). A plataforma opera sob modelo de assinatura (planos gerenciados via Supabase + Stripe). Um dos maiores diferenciais competitivos planejados é a abertura do ecossistema de extensões (**Market com mais de 7.200 plugins**).

### O Problema Crítico de Segurança
No DSH nativo:
1. Todas as sessões rodam sob o mesmo processo ou usuário do sistema operacional (frequentemente `root` em instalações padrão).
2. Os plugins instalados via Market executam código Node.js no mesmo runtime e contexto de permissões do processo hospedeiro.
3. Não há isolamento nativo de sistema de arquivos (`fs`), variáveis de ambiente de processo (`process.env`) ou soquetes de rede local (`127.0.0.1`).

**Vetor de Ataque:** Um usuário malicioso (ou um plugin vulnerável instalado por um assinante) teria privilégios para:
- Ler os arquivos de workspace, prompts e documentos de outros assinantes no disco.
- Roubar chaves de API globais (OpenAI, Anthropic, Supabase `service_role_key`, Stripe secrets).
- Escalar privilégios na VPS ou interferir em instâncias de outros clientes.

### A Solução Selecionada
Adoção do **`dsh-server-login`** em modo de **Hard Isolation (isolamento real por conta do Sistema Operacional)** combinado com **Port Guard (bloqueio de portas de loopback via `iptables`)**:
- Cada usuário/assinante ganha uma conta Linux dedicada no sistema operacional (`uid >= 100000`).
- O DSH e todos os seus plugins rodam rebaixados via `setpriv` sob o UID/GID exclusivo daquele usuário.
- O diretório home de cada usuário opera com permissão estrita `0700` (`chmod 700`).
- O `Port Guard` insere regras no topo do `iptables OUTPUT` para impedir que processos de um usuário acessem a porta HTTP/RPC de instâncias DSH vizinhas em `127.0.0.1`.
- Acesso externo é roteado via subdomínios dedicados (`<username>.app.copymonster.co`) protegidos por terminação TLS wildcard e proxy reverso.

---

## 2. Análise Criteriosa da Arquitetura & Modelo de Ameaças

Com base na auditoria aprofundada realizada diretamente no código-fonte do `dsh-server-login` (`src/config.ts`, `src/supervisor/firewall.ts`, `src/supervisor/orchestrator.ts`, `docs/hard-isolation.md`), a arquitetura divide-se em 5 camadas vitais:

```text
               INTERNET (Clientes HTTPS)
                          │
                          ▼
            [ Wildcard DNS: *.app.copymonster.co ]
                          │
                          ▼
       [ Nginx / Caddy Proxy Reverso + TLS Wildcard ]
                          │
                          ▼ HTTP (127.0.0.1:3080)
        [ dsh-server-login (Orquestrador Fastify/SQLite - Root) ]
        ├── Autenticação / Sessão / Cookie Domain (.app.copymonster.co)
        ├── Dynamic Port Allocation (ex: portas 34001, 34002...)
        └── Port Guard Engine (iptables OUTPUT owner-match)
             │
             ├──► Usuário A (UID 100001) -> setpriv -> DSH Instância A (:34001)
             │     └── /var/lib/dsh-server-login/users/A/ (chmod 0700)
             │     └── Plugins de A isolados no HOME de A
             │
             └──► Usuário B (UID 100002) -> setpriv -> DSH Instância B (:34002)
                   └── /var/lib/dsh-server-login/users/B/ (chmod 0700)
                   └── Plugins de B isolados no HOME de B
```

### 2.1 Camada 1: Isolamento de Arquivos e Processos (OS Account Isolation)
- **Modo:** `DSH_SERVER_LOGIN_ISOLATION_MODE=account`
- **Mecanismo:** Ao inicializar a instância DSH do usuário, o orquestrador invoca o comando `setpriv`:
  ```bash
  setpriv --reuid {UID} --regid {GID} --inh-caps=-all --clear-groups -- /usr/local/bin/dsh ...
  ```
  Isso descarta todas as Linux Capabilities (`--inh-caps=-all`), remove grupos suplementares (`--clear-groups`) e muda o UID/GID efetivo para o usuário do cliente.
- **Sistema de Arquivos:** Cada diretório de usuário `/var/lib/dsh-server-login/users/<id>/` pertence a `dsh-<id>` e possui permissão `0700`. Como o processo do usuário B roda sob UID `100002`, o kernel Linux nega qualquer tentativa de leitura (`Permission denied`) nos dados do usuário A (UID `100001`).

### 2.2 Camada 2: Isolamento de Rede Local (Loopback Port Guard) — O Ponto Cego Resolvido
- **Modo:** `DSH_SERVER_LOGIN_PORT_GUARD=true`
- **A Vulnerabilidade que ele Corrige:** Cada instância DSH do usuário escuta em `127.0.0.1:<porta_dinamica>` sem autenticação local interna (confiando que apenas o orquestrador fala com ela). Em um sistema Linux multi-usuário sem Port Guard, qualquer script ou plugin do Usuário B poderia executar:
  ```bash
  curl http://127.0.0.1:34001/api/... # Acessa o DSH do Usuário A!
  ```
  Isso contornaria 100% o isolamento de arquivos, controlando a sessão do Usuário A via RPC de loopback.
- **Como o Port Guard Funciona:** Implementado em `src/supervisor/firewall.ts`, o orquestrador insere uma regra no topo da tabela `filter` do `OUTPUT` do `iptables` assim que a instância DSH inicia:
  ```bash
  iptables -t filter -I OUTPUT 1 -p tcp --dport <porta> -m owner ! --uid-owner 0 -j REJECT
  ```
  - **Tráfego do Orquestrador (UID 0 - root):** O proxy reverso local roda como root, portanto `! --uid-owner 0` é FALSO -> Pacote NÃO é rejeitado -> Proxy conecta normalmente.
  - **Tráfego de Outro Usuário (UID >= 100000):** O socket local pertence a um UID não-root, portanto `! --uid-owner 0` é VERDADEIRO -> `REJECT` imediato -> O cliente recebe `Connection refused` instantaneamente.
  - **Fail Loud / Fail Closed:** Se `PORT_GUARD=true` estiver ativado e o host não for Linux com root, o orquestrador recusa a inicialização. Se o `iptables` falhar ao aplicar a regra na porta, o processo DSH recém-criado é eliminado com `SIGKILL` para nunca operar desprotegido.

### 2.3 Camada 3: Coexistência de Dados (Supabase vs dsh-server-login)
É crucial separar os planos de arquitetura:
1. **Execution Plane (Plano de Execução - VPS / Linux):**
   - Gerenciado pelo `dsh-server-login` (Fastify + SQLite local).
   - Responsável por: ciclo de vida de processos DSH, isolamento de pastas de plugins, workspaces locais, soquetes WebSockets e regras de firewall.
2. **Data Plane (Plano de Negócio - Supabase Cloud / Postgres):**
   - Mantido como fonte da verdade do SaaS CopyMonster.
   - Responsável por: contas de clientes, planos e assinaturas (Stripe), papéis (`owner`/`admin`/`member`), DNA de marca, métricas e sessões persistentes com Row Level Security (RLS).
   - O banco SQLite do `dsh-server-login` **não** substitui o Supabase.

### 2.4 Riscos Adicionais e Mitigações de Hardening
1. **Diretório `/tmp` Compartilhado:**
   - No Linux, `/tmp` é compartilhado por padrão (`1777`). Um plugin malicioso poderia ler ou gravar arquivos temporários em `/tmp`.
   - *Mitigação:* Configurar a variável de ambiente `TMPDIR=/var/lib/dsh-server-login/users/<id>/home/tmp` para cada instância de usuário.
2. **Exaustão de Recursos (CPU / RAM / DoS):**
   - Um plugin com loop infinito ou mineração poderia derrubar a VPS.
   - *Mitigação:* Aplicar limites via `/etc/security/limits.conf` para os UIDs `>= 100000` (limite de 150 processos e 2GB de RAM por UID).

---

## 3. Variáveis de Configuração Oficiais & Comprovadas

A auditoria do código confirmou as variáveis exatas exigidas em `/etc/dsh-server-login.env`:

| Variável | Valor Recomendado | Função no Sistema |
|---|---|---|
| `DSH_SERVER_LOGIN_ISOLATION_MODE` | `account` | Ativa o hard isolation via contas dedicadas de SO Linux. |
| `DSH_SERVER_LOGIN_PORT_GUARD` | `true` | Ativa o guard de portas loopback via `iptables owner-match`. |
| `DSH_SERVER_LOGIN_BASE_UID` | `100000` | UID inicial dos usuários virtuais (evita conflito com contas do sistema). |
| `DSH_SERVER_LOGIN_DATA_ROOT` | `/var/lib/dsh-server-login` | Raiz onde os diretórios e homes dos usuários residem. |
| `DSH_SERVER_LOGIN_DSH_BIN` | `/usr/local/bin/dsh` | Caminho do executável do DSH (fora de `/root`). |
| `DSH_SERVER_LOGIN_PORT` | `3080` | Porta HTTP local do orquestrador (onde o Nginx entrega o tráfego). |
| `DSH_SERVER_LOGIN_HOST` | `127.0.0.1` | Vinculação estritamente em loopback (não expor 3080 para a internet). |
| `DSH_SERVER_LOGIN_BASE_DOMAIN` | `app.copymonster.co` | Domínio pai para subdomínios (`<user>.app.copymonster.co`). |
| `DSH_SERVER_LOGIN_COOKIE_DOMAIN` | `.app.copymonster.co` | Permite que o cookie de sessão do login atravesse todos os subdomínios. |
| `DSH_SERVER_LOGIN_SECURE_COOKIES` | `true` | Força flag `Secure` nos cookies de autenticação (exige HTTPS). |

> **Nota Crítica sobre CLI flags:** A opção `--isolation-mode` existe no CLI, mas `--port-guard` **não** está exposta como flag no `src/cli.ts` (é lida apenas de `process.env.DSH_SERVER_LOGIN_PORT_GUARD`). Portanto, **o arquivo `/etc/dsh-server-login.env` é o canal oficial e obrigatório para ambas as diretivas.**

---

## 4. Plano Passo a Passo de Implementação

### Fase 1: Preparação do Ambiente no VPS (Pré-requisitos de SO)
1. **Verificação de Privilégios e Kernel:**
   - Garantir acesso `root` no VPS.
   - Testar o comando `setpriv`:
     ```bash
     setpriv --reuid 65534 --regid 65534 --inh-caps=-all id
     # Deve retornar: uid=65534(nobody) gid=65534(nogroup)
     ```
2. **Instalação do Node.js 22 e DSH em Nível de Sistema:**
   - *Pegadinha Crítica:* O DSH e o Node **não podem** estar em `/root/.nvm/`, pois os usuários de SO (`uid 100000+`) não têm permissão para ler `/root`.
   ```bash
   # 1. Node.js 22 global
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt-get install -y nodejs iptables

   # 2. Instalar DSH com prefixo global forçado
   NPM_CONFIG_PREFIX=/usr/local /usr/bin/npm install -g @deepseek-ai/dsh
   ls -la /usr/local/bin/dsh # Verificar se o binário está aqui
   ```
3. **Instalação do Orquestrador `dsh-server-login`:**
   ```bash
   mkdir -p /opt/copymonster
   cd /opt/copymonster
   git clone https://github.com/pointer-a/dsh-server-login.git
   cd dsh-server-login
   npm ci
   npm run build
   chmod -R 755 /opt/copymonster/dsh-server-login
   ```

---

### Fase 2: Configuração do Serviço e Automação de Provisionamento

1. **Criar o Arquivo de Variáveis de Ambiente:**
   Criar `/etc/dsh-server-login.env`:
   ```ini
   DSH_SERVER_LOGIN_ISOLATION_MODE=account
   DSH_SERVER_LOGIN_PORT_GUARD=true
   DSH_SERVER_LOGIN_BASE_UID=100000
   DSH_SERVER_LOGIN_DATA_ROOT=/var/lib/dsh-server-login
   DSH_SERVER_LOGIN_DSH_BIN=/usr/local/bin/dsh
   DSH_SERVER_LOGIN_PORT=3080
   DSH_SERVER_LOGIN_HOST=127.0.0.1
   DSH_SERVER_LOGIN_BASE_DOMAIN=app.copymonster.co
   DSH_SERVER_LOGIN_COOKIE_DOMAIN=.app.copymonster.co
   DSH_SERVER_LOGIN_SECURE_COOKIES=true
   DSH_SERVER_LOGIN_LOG_LEVEL=info
   ```

2. **Criar o Script de Provisionamento de Contas Linux:**
   Criar `/usr/local/bin/provision-new-users.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   USERS_DIR="/var/lib/dsh-server-login/users"
   mkdir -p "$USERS_DIR"

   for dir in "$USERS_DIR"/*/; do
     [ -d "$dir" ] || continue
     userId="$(basename "$dir")"
     osUser="dsh-$userId"

     # Obter UID determinístico calculado pelo dsh-server-login
     uid="$(/opt/copymonster/dsh-server-login/bin/dsh-server-login uid-for-user "$userId")"

     # Criar conta Linux se não existir (sem home padrão e sem shell de login)
     if ! id "$osUser" &>/dev/null; then
       useradd -u "$uid" -M -s /usr/sbin/nologin "$osUser"
       echo "[PROVISION] Conta criada: $osUser (UID: $uid)"
     fi

     # Garantir que todo o diretório pertence exclusivamente a esse usuário com permissão 0700
     chown -R "$uid:$uid" "$dir"
     chmod 700 "$dir"
     chmod -R go-rwx "$dir"
   done
   ```
   Conceder permissão de execução: `chmod +x /usr/local/bin/provision-new-users.sh`.

3. **Configurar o Path Watcher no Systemd (Gatilho Automático na Criação de Usuário):**
   Criar `/etc/systemd/system/dsh-provision.path`:
   ```ini
   [Unit]
   Description=Monitora diretorios de novos usuarios do CopyMonster

   [Path]
   PathExistsGlob=/var/lib/dsh-server-login/users/*/home
   Unit=dsh-provision.service

   [Install]
   WantedBy=multi-user.target
   ```

   Criar `/etc/systemd/system/dsh-provision.service`:
   ```ini
   [Unit]
   Description=Provisiona conta Linux para novo usuario CopyMonster
   After=dsh-server-login.service

   [Service]
   Type=oneshot
   ExecStart=/usr/local/bin/provision-new-users.sh
   ```

4. **Configurar o Serviço Principal do Orquestrador:**
   Criar `/etc/systemd/system/dsh-server-login.service`:
   ```ini
   [Unit]
   Description=CopyMonster Server Login Orchestrator
   After=network.target

   [Service]
   Type=simple
   User=root
   WorkingDirectory=/opt/copymonster/dsh-server-login
   EnvironmentFile=/etc/dsh-server-login.env
   Environment=PATH=/usr/local/bin:/usr/bin:/bin
   ExecStart=/usr/bin/node dist/cli.js
   Restart=always
   RestartSec=3
   LimitNOFILE=65536

   [Install]
   WantedBy=multi-user.target
   ```

   Ativar os serviços:
   ```bash
   systemctl daemon-reload
   systemctl enable --now dsh-provision.path
   systemctl enable --now dsh-server-login.service
   ```

---

### Fase 3: Ingress, Reverse Proxy (Nginx) & Wildcard SSL

1. **Configuração DNS:**
   - Criar entrada tipo A no DNS da Cloudflare / Provedor:
     - `app.copymonster.co` -> `<IP_DO_VPS>`
     - `*.app.copymonster.co` -> `<IP_DO_VPS>`
2. **Certificado SSL Wildcard:**
   - Emitir certificado wildcard para `app.copymonster.co` e `*.app.copymonster.co` via Certbot Cloudflare Plugin ou Let's Encrypt.
3. **Configuração Nginx (`/etc/nginx/sites-available/copymonster.conf`):**
   ```nginx
   server {
       listen 80;
       server_name app.copymonster.co *.app.copymonster.co;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name app.copymonster.co *.app.copymonster.co;

       ssl_certificate /etc/letsencrypt/live/app.copymonster.co/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/app.copymonster.co/privkey.pem;

       client_max_body_size 50M;

       location / {
           proxy_pass http://127.0.0.1:3080;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 86400s;
           proxy_send_timeout 86400s;
       }
   }
   ```
   Ativar site e reiniciar: `ln -s /etc/nginx/sites-available/copymonster.conf /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx`.

---

## 5. Protocolo Obrigatório de Validação e Testes de Segurança

> ⚠️ **Garantia de Liberação:** O Market de plugins só pode ser disponibilizado aos clientes assinantes quando os 4 testes abaixo passarem sem ressalvas no ambiente de Staging.

### Teste 1: Criação de Usuários de Teste e Verificação de UID
1. Executar bootstrap do admin:
   ```bash
   cd /opt/copymonster/dsh-server-login
   node dist/cli.js bootstrap-admin --username admin --password "SenhaForte123!"
   ```
2. Acessar `https://app.copymonster.co`, logar como admin e criar:
   - Usuário `teste-a` (ID: `usr_aaa111`)
   - Usuário `teste-b` (ID: `usr_bbb222`)
3. Fazer login como `teste-a` e abrir seu painel DSH.
4. No servidor VPS, verificar se o processo DSH subiu com UID não-root:
   ```bash
   ps -ef | grep dsh | grep -v grep
   ```
   *Critério de Aceite:* O UID do processo deve ser `>= 100000` (ex: `100001`), **nunca 0 (root)**.

### Teste 2: Isolamento de Plugins no Market
1. Logado como `teste-a`, acessar o Market e instalar um plugin (ex: `dsh-vision-router` ou qualquer plugin de teste).
2. Fazer logout de `teste-a`.
3. Fazer login como `teste-b`.
4. Abrir a lista de plugins instalados de `teste-b`.
5. *Critério de Aceite:* O plugin instalado por `teste-a` **não pode aparecer nem estar ativo** para `teste-b`. O ambiente de plugins de `teste-b` deve estar completamente virgem.

### Teste 3: Teste de Acesso a Ficheiros (Permissions Denied)
1. Como `teste-a`, criar um arquivo de segredo no seu workspace:
   ```bash
   echo "PROMPT_SECRETO_DO_CLIENTE_A" > /var/lib/dsh-server-login/users/usr_aaa111/home/segredo.txt
   ```
2. Obter o UID do usuário B (`id dsh-usr_bbb222`).
3. Simular execução pelo usuário B tentando ler o arquivo de A:
   ```bash
   sudo -u dsh-usr_bbb222 cat /var/lib/dsh-server-login/users/usr_aaa111/home/segredo.txt
   ```
4. *Critério de Aceite:* O comando **deve falhar** obrigatoriamente retornando:
   `cat: /var/lib/dsh-server-login/users/usr_aaa111/home/segredo.txt: Permission denied`

### Teste 4: Teste Crítico de Rede (Port Guard Loopback)
1. Identificar a porta loopback onde o DSH de `teste-a` está escutando:
   ```bash
   ss -tulpn | grep dsh-usr_aaa111
   # Exemplo de saída: 127.0.0.1:34892
   ```
2. Conferir se a regra do Port Guard está presente no `iptables`:
   ```bash
   iptables -L OUTPUT -v -n | grep 34892
   # Deve exibir: REJECT tcp -- * * 0.0.0.0/0 0.0.0.0/0 tcp dpt:34892 !owner UID match 0 reject-with icmp-port-unreachable
   ```
3. Testar acesso como root (Orquestrador / Proxy):
   ```bash
   curl -I -s -m 2 http://127.0.0.1:34892/
   # Deve retornar HTTP 200 ou 404 da instância (conexão aceita)
   ```
4. Testar acesso vindo do processo/conta do Usuário B:
   ```bash
   sudo -u dsh-usr_bbb222 curl -I -s -m 2 http://127.0.0.1:34892/
   ```
5. *Critério de Aceite:* A requisição do Usuário B **deve falhar imediatamente** com erro:
   `curl: (7) Failed to connect to 127.0.0.1 port 34892: Connection refused`

Se todos os 4 testes forem aprovados, o isolamento entre assinantes está formalmente certificado e o Market pode ser liberado com segurança.

---

## 6. Procedimento de Rollback & Governança

### Plano de Contingência
Se qualquer instabilidade ou falha de compatibilidade ocorrer durante o rollout:
1. Parar o serviço do orquestrador: `systemctl stop dsh-server-login`.
2. Restaurar o proxy Nginx para apontar diretamente para a porta do DSH administrativo original.
3. Limpar eventuais regras residuais no `iptables`:
   ```bash
   iptables -F OUTPUT
   ```
4. Nenhuma tabela do Supabase precisa de rollback, pois os esquemas de banco não são modificados pela instalação do orquestrador.

### Regras Permanentes de Segurança
- **Proibição de Escopo:** Sob nenhuma circunstância alterar o código de `packages/core/` ou `packages/llm/`.
- **Chaves de API:** A chave `service_role_key` do Supabase nunca deve ser compartilhada ou exposta nos arquivos de configuração do `dsh-server-login`.
- **Registro de Evidências:** Ao concluir a homologação no VPS, registrar os outputs dos testes no documento `docs/roadmap/fork-preservation.md`.
