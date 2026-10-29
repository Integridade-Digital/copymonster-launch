# Plano de Isolamento Multi-Tenant com `dsh-server-login`
## Hard Isolation por Conta de SO Linux, Port Guard, Cloudflare Tunnel (:3080) e Supabase (Plano Free)

> **Status:** Plano Técnico Atualizado & Aprovado para Execução em Staging/Produção  
> **Licença:** MIT (CopyMonster — fork do DeepSeek Harness / DSH)  
> **Repositório do Orquestrador:** `https://github.com/pointer-a/dsh-server-login.git`  
> **Topologia de Borda:** Cloudflare Tunnel (`cloudflared`) escutando na porta local `3080`  
> **Camada de Dados & Auth:** Supabase (Plano Free) para o SaaS CopyMonster + SQLite local para o supervisor do VPS  
> **Regra de Ouro:** NUNCA alterar `packages/core/` nem `packages/llm/`. Não liberar o Market de plugins antes da validação completa dos testes de isolamento de rede e sistema de arquivos.

---

## 1. Sumário Executivo & Contexto do Negócio

O **CopyMonster** é uma plataforma SaaS de automação de copy e geração de conteúdo, construída como fork sob licença MIT do DeepSeek Harness (DSH). A plataforma opera sob modelo de assinatura (planos gerenciados no Supabase e checkout via Stripe). Um dos grandes diferenciais competitivos planejados é a abertura do ecossistema de extensões (**Market com mais de 7.200 plugins**).

### O Problema Crítico de Segurança no DSH Nativo
1. Todas as sessões rodam sob o mesmo processo ou usuário do sistema operacional (`root` na maioria das instalações VPS).
2. Os plugins instalados via Market executam código Node.js no mesmo runtime e contexto de permissões do processo hospedeiro.
3. Não há isolamento nativo de sistema de arquivos (`fs`), variáveis de ambiente de processo (`process.env`) ou soquetes de rede local (`127.0.0.1`).

**Vetor de Ataque:** Um usuário malicioso (ou um plugin vulnerável instalado por um assinante) teria privilégios para:
- Ler os arquivos de workspace, prompts e documentos de outros assinantes no disco (`fs.readFile`).
- Roubar chaves de API globais (OpenAI, Anthropic, Supabase `service_role_key`, Stripe secrets).
- Fazer varredura de portas em `127.0.0.1` e assumir controle de outras instâncias DSH ou serviços locais.

### A Solução Selecionada
Adoção do **`dsh-server-login`** em modo de **Hard Isolation (isolamento real por conta do Sistema Operacional)** combinado com **Port Guard (bloqueio de portas de loopback via `iptables`)**:
- Cada usuário/assinante ganha uma conta Linux dedicada no sistema operacional (`uid >= 100000`).
- O DSH e todos os seus plugins rodam rebaixados via `setpriv` sob o UID/GID exclusivo daquele usuário.
- O diretório home de cada usuário opera com permissão estrita `0700` (`chmod 700`).
- O `Port Guard` insere regras no topo do `iptables OUTPUT` para impedir que processos de um usuário acessem a porta HTTP/RPC de instâncias DSH vizinhas em `127.0.0.1`.
- **Cloudflare Tunnel na porta 3080:** Roteia tanto o domínio base quanto os subdomínios wildcard dos usuários diretamente para a porta local `3080`, sem expor portas na internet pública da VPS e sem necessidade de Nginx ou Certbot.

---

## 2. Topologia de Infraestrutura: Cloudflare Tunnel + VPS + Supabase

```text
                             INTERNET (Clientes HTTPS)
                                        │
                                        ▼
             ┌───────────────────────────────────────────────────────┐
             │            Cloudflare Edge (Zero Trust / DNS)          │
             │   - SSL Wildcard Gerenciado (*.app.copymonster.co)    │
             │   - Proteção DDoS, WAF e Gerenciamento de Borda       │
             └──────────────────────────┬────────────────────────────┘
                                        │ (Túnel criptografado de saída)
                                        ▼
             ┌───────────────────────────────────────────────────────┐
             │                   VPS (Host Linux)                     │
             │                                                       │
             │  cloudflared (Serviço Systemd)                        │
             │     └── Redireciona tráfego HTTP & WS para 127.0.0.1:3080
             │                                                       │
             │  dsh-server-login (Orquestrador / Proxy - Porta 3080) │
             │     ├── Escuta em: 127.0.0.1:3080                     │
             │     ├── SQLite Local: /var/lib/dsh-server-login/db    │
             │     ├── Port Guard: Regras iptables OUTPUT owner-match│
             │     │                                                 │
             │     ├── Host: app.copymonster.co ──► Portal / Auth    │
             │     └── Host: user1.app... ──► setpriv (UID 100001)   │
             │                                  └── DSH (:42135)     │
             └──────────────────────────┬────────────────────────────┘
                                        │
                         Consultas API / Webhooks
                                        │
                                        ▼
             ┌───────────────────────────────────────────────────────┐
             │                 Supabase (Plano Free)                 │
             │  - Supabase Auth (auth.users: Logins, JWT, OAuth)     │
             │  - Banco PostgreSQL (public.*):                       │
             │      * users, tenants, user_tenant_roles              │
             │      * subscriptions (Stripe), planos                 │
             │      * llm_providers, llm_models, sessions_index     │
             │      * metrics_daily                                  │
             └───────────────────────────────────────────────────────┘
```

---

## 3. Integração com o Supabase (Plano Free): Análise & Mitigações

O CopyMonster SaaS utiliza o Supabase para gerenciar a camada de negócio (autenticação de clientes, papéis, faturamento e catálogo de modelos). Para integrar com o VPS sem erros em produção, respeitamos as seguintes diretrizes:

### 3.1. Divisão de Responsabilidades
- **Supabase (Plano Free):** Banco de dados central autoritativo do negócio. Armazena perfis de usuários, controle de planos, assinaturas Stripe, controle de acesso (`user_tenant_roles`), metadados de sessões (`sessions_index`) e métricas diárias (`metrics_daily`).
- **Supervisor do VPS (`dsh-server-login`):** Responsável estritamente pelo ciclo de vida dos processos no servidor (alocação de portas locais, execução do `setpriv`, montagem de diretórios e regras de firewall).

### 3.2. Armazenamento Interno do Orquestrador (SQLite Local vs Postgres Supabase)

#### Padrão Ouro (Recomendado): SQLite Local para o Orquestrador
O `dsh-server-login` armazena internamente sessões ativas de proxy, portas efêmeras alocadas e mapeamento de subdomínios em `/var/lib/dsh-server-login/server-login.db` (SQLite).
**Por que esta é a melhor escolha no Plano Free do Supabase?**
1. **Latência Zero de Roteamento:** Cada requisição HTTP e handshake WebSocket que chega na porta 3080 consulta o banco interno do orquestrador. Manter o SQLite local garante resposta em microssegundos sem chamadas de rede.
2. **Economia Estrita de Conexões do Supabase Free:** O Supabase Free possui cota limitada de conexões diretas (~60 conexões simultâneas). O SQLite local consome 0 conexões do Supabase.
3. **Imunidade à Pausa por Inatividade do Supabase Free:** Projetos no plano Free do Supabase são pausados após 7 dias sem atividade na API. Se o orquestrador do VPS dependesse de uma conexão Postgres persistente direta para atender a porta 3080, a VPS cairia se o Supabase hibernasse.
4. **Isolamento Total de Schema (Evita Colisão):** Conforme auditado no código, o `dsh-server-login` cria uma tabela chamada `users (id, username, pass_hash, ...)`. A migration `001_initial_identity.sql` do CopyMonster no Supabase já possui uma tabela `public.users (id UUID, email, full_name, ...)`. O SQLite local elimina qualquer risco de conflito de tabelas.

#### Opção Alternativa: Usando o PostgreSQL do Supabase (`DSH_SERVER_LOGIN_DB_URL`)
Caso seja requisito unificar o banco no Supabase remoto:
- **Regra Obrigatória 1 (Schema Isolado):** Criar previamente no Supabase o schema dedicado:
  ```sql
  CREATE SCHEMA IF NOT EXISTS dsh;
  ```
  E configurar a URL com `search_path`:
  ```bash
  DSH_SERVER_LOGIN_DB_URL="postgresql://postgres:[SENHA]@db.[REF].supabase.co:6543/postgres?options=-csearch_path=dsh,public"
  ```
  *Nota:* Isso garante que as migrações automáticas do `dsh-server-login` criem `dsh.users` e `dsh.sessions` sem corromper `public.users`.
- **Regra Obrigatória 2 (Porta do Pooler):** Usar sempre a porta `6543` (Supavisor Transaction Pooler) ou `5432` em Session mode, nunca a conexão direta IPv4.

### 3.3. Proteção das Credenciais do Supabase
- As variáveis `SUPABASE_SERVICE_ROLE_KEY` e credenciais de banco jamais devem ser expostas aos usuários.
- O arquivo de configuração `/etc/dsh-server-login.env` deve ter permissões estritas `chmod 600 root:root`.
- O método `scrubEnv()` em `src/supervisor/spawn.ts` do orquestrador remove ativamente as variáveis do processo pai antes de invocar o DSH dos usuários, impedindo que plugins tenham acesso às credenciais do Supabase.

---

## 4. Integração com o Cloudflare Tunnel na Porta 3080

O uso do **Cloudflare Tunnel (`cloudflared`)** simplifica radicalmente a infraestrutura:
- **Sem Nginx na VPS:** O `dsh-server-login` já é um servidor Fastify de alta performance com proxy reverso e suporte a WebSocket embutidos.
- **Sem Certbot / Desafio DNS-01:** O Cloudflare Edge gera, valida e renova os certificados SSL Wildcard automaticamente na borda.
- **Firewall da VPS 100% Fechado:** Nenhuma porta de entrada (80, 443 ou 3080) precisa ser aberta no firewall da VPS; o `cloudflared` estabelece túneis de saída seguros para a rede da Cloudflare.

### 4.1. Configuração do Ingress no Cloudflare Tunnel

Seja pelo painel **Cloudflare Zero Trust** (Networks -> Tunnels -> Public Hostnames) ou via arquivo de configuração `/etc/cloudflared/config.yml` no servidor:

```yaml
tunnel: <UUID_DO_SEU_TUNNEL>
credentials-file: /root/.cloudflared/<UUID_DO_SEU_TUNNEL>.json

ingress:
  # 1. Subdomínios dos usuários isolados (Wildcard)
  - hostname: "*.app.copymonster.co"
    service: http://localhost:3080
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s

  # 2. Domínio principal (Portal / Autenticação / Admin)
  - hostname: "app.copymonster.co"
    service: http://localhost:3080
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s

  # 3. Fallback padrão obrigatório do cloudflared
  - service: http_status:404
```

### 4.2. Registro no DNS do Cloudflare
No painel do Cloudflare DNS para a zona `copymonster.co`:
- Registro CNAME para `app`: Apontando para `<UUID_DO_SEU_TUNNEL>.cfargotunnel.com` (Nuvem Laranja Ativa).
- Registro CNAME para `*.app`: Apontando para `<UUID_DO_SEU_TUNNEL>.cfargotunnel.com` (Nuvem Laranja Ativa).

---

## 5. Especificação Técnica do Orquestrador (`dsh-server-login`)

### 5.1. Variáveis de Ambiente Oficiais (`/etc/dsh-server-login.env`)

```bash
# Porta onde o dsh-server-login escuta (onde o cloudflared entrega o tráfego)
DSH_SERVER_LOGIN_PORT=3080
DSH_SERVER_LOGIN_HOST=127.0.0.1

# Modo de Isolamento Real (Hard Isolation)
DSH_SERVER_LOGIN_ISOLATION_MODE=account
DSH_SERVER_LOGIN_BASE_UID=100000

# Bloqueio de Portas Loopback via iptables (Leitura estrita de variável de ambiente)
DSH_SERVER_LOGIN_PORT_GUARD=true

# Domínios e Cookies Globais para Subdomínios
DSH_SERVER_LOGIN_BASE_DOMAIN=app.copymonster.co
DSH_SERVER_LOGIN_COOKIE_DOMAIN=.app.copymonster.co
DSH_SERVER_LOGIN_SECURE_COOKIES=true

# Caminhos de Binários e Dados Locais
DSH_SERVER_LOGIN_DSH_BIN=/usr/local/bin/dsh
DSH_SERVER_LOGIN_DATA_ROOT=/var/lib/dsh-server-login
```

> **Atenção:** Como o usuário acessa via `https://*.app.copymonster.co` no navegador, o Cloudflare Tunnel adiciona o header `X-Forwarded-Proto: https`. Portanto, `DSH_SERVER_LOGIN_SECURE_COOKIES=true` funciona perfeitamente e garante que o cookie de sessão seja compartilhado com segurança entre o domínio raiz e todos os subdomínios dos usuários.

---

## 6. Plano de Execução Passo a Passo no VPS

### Fase 1: Validação do Sistema Operacional e Binários Globais
1. **Conectar como root no VPS:**
   ```bash
   uname -a
   which setpriv || apt-get update && apt-get install -y util-linux iptables
   ```
2. **Instalação Global do Node 22 e DSH (Fora de `/root`):**
   *Aviso Crítico:* Não usar NVM dentro de `/root/.nvm`. O usuário rebaixado não tem permissão para acessar `/root`.
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt-get install -y nodejs
   
   # Validar instalação global
   /usr/bin/node -v
   /usr/bin/npm -v
   
   # Instalar DSH com prefixo global
   NPM_CONFIG_PREFIX=/usr/local npm install -g @deepseek-ai/dsh
   which dsh # Deve retornar /usr/local/bin/dsh
   ```
3. **Instalação e Build do `dsh-server-login`:**
   ```bash
   mkdir -p /opt/copymonster
   cd /opt/copymonster
   git clone https://github.com/pointer-a/dsh-server-login.git
   cd dsh-server-login
   npm ci
   npm run build
   ```

### Fase 2: Configuração do Serviço e Provisionamento Automático
1. **Criar arquivo de ambiente restrito:**
   ```bash
   cat << 'EOF' > /etc/dsh-server-login.env
   DSH_SERVER_LOGIN_PORT=3080
   DSH_SERVER_LOGIN_HOST=127.0.0.1
   DSH_SERVER_LOGIN_ISOLATION_MODE=account
   DSH_SERVER_LOGIN_PORT_GUARD=true
   DSH_SERVER_LOGIN_BASE_UID=100000
   DSH_SERVER_LOGIN_BASE_DOMAIN=app.copymonster.co
   DSH_SERVER_LOGIN_COOKIE_DOMAIN=.app.copymonster.co
   DSH_SERVER_LOGIN_SECURE_COOKIES=true
   DSH_SERVER_LOGIN_DSH_BIN=/usr/local/bin/dsh
   DSH_SERVER_LOGIN_DATA_ROOT=/var/lib/dsh-server-login
   EOF
   chmod 600 /etc/dsh-server-login.env
   ```
2. **Script de Provisionamento de Contas Linux (`/usr/local/bin/provision-new-users.sh`):**
   ```bash
   cat << 'EOF' > /usr/local/bin/provision-new-users.sh
   #!/usr/bin/env bash
   set -euo pipefail

   DATA_ROOT="${DSH_SERVER_LOGIN_DATA_ROOT:-/var/lib/dsh-server-login}"
   USERS_DIR="$DATA_ROOT/users"
   BASE_UID="${DSH_SERVER_LOGIN_BASE_UID:-100000}"

   mkdir -p "$USERS_DIR"
   chmod 0711 "$DATA_ROOT"

   for userDir in "$USERS_DIR"/*; do
     [ -d "$userDir" ] || continue
     username="$(basename "$userDir")"
     osUser="dsh-$username"
     uidFile="$userDir/.uid"

     if [ -f "$uidFile" ]; then
       uid="$(cat "$uidFile")"
     else
       rowId="$(stat -c %i "$userDir" 2>/dev/null || echo 1)"
       uid=$(( BASE_UID + (rowId % 50000) ))
       echo "$uid" > "$uidFile"
     fi

     if ! id "$osUser" &>/dev/null; then
       useradd -u "$uid" -M -s /usr/sbin/nologin "$osUser" || true
     fi

     chown -R "$osUser:$osUser" "$userDir"
     chmod 0700 "$userDir"
   done
   EOF
   chmod 0700 /usr/local/bin/provision-new-users.sh
   ```
3. **Watcher do Systemd para Provisionamento Instantâneo:**
   - Criar `/etc/systemd/system/dsh-provision.path`:
     ```ini
     [Unit]
     Description=Monitor de Novos Assinantes CopyMonster
     [Path]
     PathModified=/var/lib/dsh-server-login/users
     [Install]
     WantedBy=multi-user.target
     ```
   - Criar `/etc/systemd/system/dsh-provision.service`:
     ```ini
     [Unit]
     Description=Provisiona Contas Linux para Assinantes CopyMonster
     [Service]
     Type=oneshot
     ExecStart=/usr/local/bin/provision-new-users.sh
     ```
   - Ativar watcher:
     ```bash
     systemctl daemon-reload
     systemctl enable --now dsh-provision.path
     ```
4. **Configurar o Serviço Principal do Orquestrador:**
   - Criar `/etc/systemd/system/dsh-server-login.service`:
     ```ini
     [Unit]
     Description=CopyMonster DSH Isolation Supervisor
     After=network.target

     [Service]
     Type=simple
     User=root
     WorkingDirectory=/opt/copymonster/dsh-server-login
     EnvironmentFile=/etc/dsh-server-login.env
     ExecStart=/usr/bin/node dist/cli.js
     Restart=always
     RestartSec=5
     LimitNOFILE=65536

     [Install]
     WantedBy=multi-user.target
     ```
   - Habilitar e iniciar:
     ```bash
     systemctl daemon-reload
     systemctl enable --now dsh-server-login.service
     ```

### Fase 3: Validação do Cloudflare Tunnel
1. No arquivo `/etc/cloudflared/config.yml` (ou no painel Zero Trust), certificar que o túnel aponta para `http://localhost:3080`:
   ```bash
   cloudflared tunnel ingress validate
   systemctl restart cloudflared
   ```
2. Testar resposta local:
   ```bash
   curl -I http://127.0.0.1:3080
   ```
   Deve retornar `200 OK` ou `302 Redirect` para `/login`.

### Fase 4: Bootstrap do Administrador
1. Gerar as credenciais do primeiro superadmin:
   ```bash
   cd /opt/copymonster/dsh-server-login
   node dist/cli.js bootstrap-admin --username admin --role admin
   ```
2. Acessar `https://app.copymonster.co/login` pelo navegador e logar como admin.

---

## 7. Protocolo de Testes Críticos de Isolamento (Gate Bloqueante)

O ecossistema do Market com mais de 7.200 plugins **NÃO PODE** ser disponibilizado publicamente até que os 4 testes a seguir passem com 100% de sucesso no ambiente de testes/staging:

### Teste 1: Validação do Processo e UID
1. Fazer login com o Usuário A (`user-a`).
2. No servidor VPS, verificar os processos em execução:
   ```bash
   ps -ef | grep dsh
   ```
3. **Critério de Sucesso:** O processo DSH do usuário deve rodar com UID `>= 100000` (ex: `dsh-user-a`), **NUNCA como root**.

### Teste 2: Isolamento de Plugins do Market
1. Usuário A instala um plugin via Market (ex: plugin de análise SEO).
2. Verificar que os arquivos do plugin foram baixados estritamente em `/var/lib/dsh-server-login/users/user-a/.dsh/plugins/`.
3. Usuário B (`user-b`) faz login em seu subdomínio (`user-b.app.copymonster.co`).
4. **Critério de Sucesso:** O Usuário B **não vê, não tem carregado e não tem acesso** ao plugin instalado pelo Usuário A.

### Teste 3: Isolamento de Sistema de Arquivos (Traversal / Read)
1. Através de um plugin ou terminal do DSH do Usuário A, executar uma tentativa de leitura no diretório de outro usuário:
   ```javascript
   const fs = require('fs');
   fs.readdirSync('/var/lib/dsh-server-login/users/user-b');
   ```
2. **Critério de Sucesso:** Operação deve falhar obrigatoriamente com `EACCES: permission denied` graças ao `chmod 0700`.

### Teste 4: Isolamento de Rede Loopback (Port Guard / iptables)
1. Identificar a porta efêmera atribuída ao Usuário A (ex: `34125`).
2. Como Usuário B (UID 100002), tentar efetuar uma requisição HTTP direta para a porta do Usuário A:
   ```bash
   curl -I http://127.0.0.1:34125
   ```
3. **Critério de Sucesso:** A conexão deve ser rejeitada imediatamente (`Connection refused` gerado pela regra `iptables OUTPUT ... ! --uid-owner 0 -j REJECT`).

---

## 8. Rollback e Regras Permanentes

1. **Rollback Imediato:**
   Caso ocorra instabilidade no supervisor, o Cloudflare Tunnel pode ser revertido instantaneamente para apontar diretamente para a instância única original do CopyMonster, alterando a linha `service: http://localhost:3080` no `config.yml` e reiniciando o `cloudflared`.
2. **Imutabilidade de Core:**
   Nenhuma alteração é permitida nos pacotes internos `packages/core/` e `packages/llm/`. Todo o isolamento é garantido na camada de infraestrutura e orquestração do sistema operacional.
