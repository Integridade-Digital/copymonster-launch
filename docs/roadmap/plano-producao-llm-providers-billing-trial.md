# Plano de Produção Definitivo — LLM Providers, Billing, Free Trial & Resiliência (Campanha 48h & Longo Prazo)

**Documento:** `docs/roadmap/plano-producao-llm-providers-billing-trial.md`
**Status:** GUIA DEFINITIVO APROVADO — PRONTO PARA EXECUÇÃO CONTROLADA.
**Data:** 2026-10-07
**Base analisada:** `master` @ `3f4232c29a` (fork `copymonster-launch`)
**Regras invioláveis:**
1. Nunca imprimir, expor ou commitar valores literais de chaves secretas ou senhas.
2. Não executar `INSERT`, `UPDATE` ou `DELETE` no Supabase sem aprovação prévia do script SQL.
3. Nunca alterar `packages/llm/` diretamente sem acionar o protocolo [STOP/REPORT].
4. Fail-closed em qualquer gate de autorização, assinatura ou cota de tokens.
5. Nunca usar `--no-verify` no Git; cada commit deve ter seu SHA formalmente registrado.
6. Isolamento estrito de tenants: nenhum usuário pode compartilhar cota, histórico ou dados confidenciais com outros clientes.

---

## 0. Como este plano funciona

Este documento é o contrato de execução técnica e estratégica para o lançamento do CopyMonster em produção com padrão de classe mundial.

A execução segue a regra de **uma etapa por vez com validação atômica, testes automatizados e aprovação explícita em todos os pontos de mutação** (banco de dados, injeção de segredos, rotas de infraestrutura).

Marcadores formais de governança:
- **[LEITURA]** — Comando somente leitura, seguro para execução imediata.
- **[APROVAÇÃO]** — Ponto de checagem obrigatório; a execução pausa até confirmação do operador.
- **[SQL]** — Script SQL proposto; nunca aplicado sem prévia aprovação e teste em sandbox.
- **[STOP/REPORT]** — Parada compulsória por risco de toque em áreas sensíveis (`packages/llm/`, produção viva, credenciais raiz).

Branch de trabalho recomendada: `release/prod-llm-billing-trial`.

---

## 1. Diagnóstico Arquitetural & Estratégico (Raio-X de Produção)

### 1.1 Perspectiva de Negócios & Unit Economics (CEO / Silicon Valley)
- **Proteção do COGS (Cost of Goods Sold):** No CopyMonster, a queima de tokens de LLM é o custo marginal direto. Modelos de IA não possuem custo zero por requisição. Cada chamada ao DeepSeek V3 / OpenRouter gera custo financeiro real em moeda forte.
- **Target de Margem Bruta:** Mínimo de 70% de margem de contribuição.
  - Custo bruto DeepSeek V3: ~$0.14 / 1M input, ~$0.28 / 1M output.
  - Venda nos Planos CopyMonster: Starter (R$ 97/mês, 3M tokens), Pro (R$ 297/mês, 10M tokens), Legend (R$ 997/mês, 35M tokens).
  - Markup estrutural: 3x a 5x sobre a camada de inferência para absorver storage, sandbox e infraestrutura.
- **Prevenção de Abuso no Free Trial (Anti-Sybil):** Um Free Trial aberto sem barreiras de cota estrita por usuário permite que bots ou usuários mal-intencionados esgotem o caixa operacional da empresa em menos de 48 horas. A cota precisa ser inviolável e pessoal.

### 1.2 O Gargalo do Tenant Único (Migrations 023/024)
- **Problema Detectado:** As migrações `023` e `024` direcionaram todos os novos usuários para o tenant único `00000000-0000-0000-0000-000000000001` ("Integridade Digital").
- **Impacto em Produção:**
  1. *Faturamento Global Quebrado:* A assinatura do Stripe é atrelada a `tenants.stripe_customer_id`. Se um usuário assina o Pro no tenant único, **todos os outros usuários ganham Pro de graça**, e novos pagamentos colidem.
  2. *Esgotamento Mútuo de Cotas:* `current_period_tokens_used` e `trial_tokens_used` residem em `tenants`. O consumo de um usuário desconta o saldo de todos os demais.
  3. *Privacidade Comprometida:* Workspaces agrupados pelo mesmo `tenant_id` exigem filtragem manual estrita na UI para não vazar projetos concorrentes.
- **Solução Arquitetural (Decisão D2 Revisada):** Implementar o **Personal Tenant Onboarding**. Todo novo usuário cria ou recebe seu próprio `tenant` isolado (ex: "Workspace de [Nome]"), onde seu Free Trial, seu Stripe Customer e seus limites rodam 100% isolados. O tenant `00000000-0000-0000-0000-000000000001` torna-se exclusivamente o Tenant Administrativo da Operadora.

### 1.3 Injeção de Credenciais LLM sem Tocar em `packages/llm/`
- **Cenário Atual:** As chaves de API salvas no Admin (`llm_providers`) ficam criptografadas no Supabase via `pgcrypto` (`014`, `028`). No entanto, o `LocalCredentialProvider` nativo do DSH busca credenciais apenas em variáveis de ambiente (`DEEPSEEK_API_KEY`) ou no arquivo local `~/.dsh/.credentials.yaml`.
- **Solução Arquitetural (Opção A1):** Criar o plugin de host `@deepseek-ai/dsh-host-llm-credentials-supabase` (dentro de `packages/host/`) ou conectá-lo via bundle. No boot do servidor (e sob demanda via evento de atualização), ele consulta a RPC `get_runtime_llm_catalog()` (exclusiva para `service_role`) e alimenta o seam `ctx.credentials` em memória.
- **Vantagem:** Preserva `packages/llm/` 100% íntegro para futuros merges com o upstream, sem gravar chaves descriptografadas em disco.
- **Atualização (2026-10-08):** as chaves já residem no cofre local (Settings → Models, `.credentials.yaml`) e funcionam. O Admin deixa de ser cofre e passa a ser controle de acesso; ver [`arquitetura-settings-cofre.md`](./arquitetura-settings-cofre.md) e o reescopo da Etapa 7.

### 1.4 Hard Gates de Quota Bidirecionais
- **Cenário Atual:** Os Blocos 8.2 e 8.3 implementaram com sucesso a telemetria de tokens ao término de cada turno (`turn/end`). Contudo, o sistema **não bloqueia preventivamente** se a cota do usuário estiver estourada.
- **Solução Arquitetural:**
  1. Criação da RPC `check_tenant_quota(p_tenant_id)` no Supabase.
  2. Interceptação estrita em `session.create` (impede criar nova sessão sem saldo).
  3. Interceptação estrita em `session.prompt` (impede enviar novas mensagens em sessões ativas quando o limite for atingido).

### 1.5 Resiliência Operacional & Health Check
- **Cenário Atual:** Não há endpoint padronizado de liveness e readiness para o balanceador de carga ou Cloudflare monitorar o container.
- **Solução Arquitetural:** Rota `/api/healthz` no `auth-http`, verificando: conectividade com o banco Supabase, integridade de credenciais e tempo de resposta.

---

## 2. Matriz de Decisões Técnicas & de Negócio

| Decisão | Descrição | Opção Escolhida | Justificativa |
|---|---|---|---|
| **D1** | Injeção de Chave Global | **Rota A1 (Plugin Host em Seam)** | Alimenta `ctx.credentials` em memória via Supabase RPC sem tocar no core upstream `packages/llm/`. **Revisada 2026-10-08:** o cofre é o Settings (`.credentials.yaml`); o Admin é controle de acesso (ver [`arquitetura-settings-cofre.md`](./arquitetura-settings-cofre.md)). |
| **D2** | Modelo de Tenant & Trial | **Personal Tenant por Usuário** | Garante faturamento individual no Stripe, isolamento absoluto de tokens e privacidade total de dados. |
| **D3** | Modelo de Cota de Tokens | **Agregação Input + Output com Hard Gate** | Limite global consolidado por plano no gate inicial, simplificando validação fail-closed em runtime. |
| **D4** | Markup de Revenda | **3.0x a 5.0x nos Planos** | Margem de contribuição mínima de 70% para cobrir sandbox, storage e volatilidade cambial. |
| **D5** | Mapeamento de Rotas LLM | **Campos Explícitos no Banco** | Adicionar `provider_route` e `api_key_env` em `llm_providers` para eliminar acoplamento por nomes literais. |
| **D6** | Modo do Gate de Cota | **Fail-Closed (`enforce`) com Override** | Nenhuma requisição consome API externa se o banco estiver indisponível ou a cota esgotada. |
| **D7** | Resiliência de Provedor | **Failover Graceful (DeepSeek -> OpenRouter)** | Se o DeepSeek retornar 429/503 em produção, fallback transparente mantém o usuário operacional. |

---

## 3. Roteiro Passo a Passo de Execução (Etapas 0 a 11)

### Etapa 0 — Pré-flight, Isolamento & Backup [LEITURA]
1. Confirmar `git status` 100% limpo na branch `master`.
2. Criar branch isolada de trabalho: `release/prod-llm-billing-trial`.
3. Criar tag Git de segurança: `pre-prod-llm-billing-YYYYMMDD`.
4. Checagem de presença de segredos obrigatórios no ambiente (apenas teste booleano, nunca imprimir valores):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LLM_ENCRYPTION_KEY`.
5. Validação de `.gitignore` para blindagem de `.env*`.

### Etapa 1 — Auditoria Read-Only de Banco & Catálogo [LEITURA]
1. Executar query de leitura para inventariar os registros em `public.llm_providers` e `public.llm_models`.
2. Validar que `public.plans` reflete os planos vigentes (`starter`, `pro`, `legend`) com seus respectivos `stripe_price_id_monthly`.
3. Validar a execução da RPC `get_runtime_llm_catalog()` via `service_role` apenas contando linhas (`SELECT count(*) FROM get_runtime_llm_catalog();`).

### Etapa 2 — Migração 032: Quota Gate, Mapeamento & Tenant Isolation [SQL] [APROVAÇÃO]
Criação do arquivo `supabase/migrations/032_production_gates_and_tenants.sql`:
1. **Campos de Roteamento:** Adicionar `provider_route` (ex: `deepseek-official`) e `api_key_env` (ex: `DEEPSEEK_API_KEY`) na tabela `public.llm_providers`.
2. **Markup Informativo:** Adicionar `markup_multiplier NUMERIC(6,3) DEFAULT 3.000` em `public.plans`.
3. **RPC `check_tenant_quota`:**
   - Verifica status de assinatura do tenant (`active`, `trialing`, `past_due`, `canceled`).
   - Bloqueia imediatamente se `status IN ('trial_expired', 'canceled', 'past_due', 'unpaid')`.
   - Compara tokens consumidos (`trial_tokens_used` ou `current_period_tokens_used`) contra o teto do plano.
   - Retorna `allowed: BOOLEAN`, `reason: TEXT`, `remaining_tokens: BIGINT`.
   - `SECURITY DEFINER`, `search_path = public`, privilégios exclusivos para `service_role`.
4. **Adequação do Trigger `handle_new_user()`:**
   - Criar tenant individual para novos inscritos com status `trialing`, plano `pro`, `trial_ends_at = now() + interval '7 days'` e limite de 1.000.000 tokens.
   - O tenant master `00000000-0000-0000-0000-000000000001` é preservado exclusivamente para administradores/operadores.

### Etapa 3 — Provedor de Credenciais em Memória (`packages/host/llm-credentials-supabase`) [APROVAÇÃO]
1. Desenvolver plugin de host `@deepseek-ai/dsh-host-llm-credentials-supabase`.
2. No ciclo de inicialização do Cordis (`Service.init`):
   - Conecta ao Supabase usando `service_role`.
   - Invoca `get_runtime_llm_catalog()`.
   - Para cada provider ativo configurado com `api_key` válida, registra a chave no seam de credenciais do harness em memória associada ao respectivo `api_key_env`.
3. Escutar eventos de sincronização ou recarregar periodicamente com debounce.
4. Testes automatizados em sandbox garantindo que nenhuma chave seja escrita em disco e que o seam resolva perfeitamente.

### Etapa 4 — Hard Gate de Quota em `session.create` e `session.prompt` [APROVAÇÃO]
1. Arquivo: `packages/api/session-controller/src/commands.ts`.
2. No comando `create`:
   - Chamar `check_tenant_quota(identity.tenantId)`.
   - Se `!allowed`, lançar `RemoteError('session/quota-exceeded', 'Limite de tokens do plano atingido. Faça upgrade para continuar.')`.
3. No comando `prompt`:
   - Validar cota antes de despachar o novo turno para o loop do agente.
   - Impedir que mensagens sejam processadas sem saldo disponível.
4. Configuração `quota_gate_mode`: `enforce` (padrão) com opção transitória `observe` caso ocorra degradação no Supabase.

### Etapa 5 — Endpoint de Observabilidade e Health Check (`/api/healthz`) [APROVAÇÃO]
1. Arquivo: `packages/api/auth-http/src/index.ts`.
2. Registrar rota `GET /api/healthz`:
   - Testa ping ao Supabase (`SELECT 1`).
   - Checa se o catálogo de modelos em memória está povoado.
   - Retorna `200 OK` com payload JSON padronizado (`{ status: "healthy", timestamp: ... }`).
   - Retorna `503 Service Unavailable` em caso de perda de conexão com o banco.

### Etapa 6 — Resiliência de Inferência & Fallback (DeepSeek <-> OpenRouter) [APROVAÇÃO]
1. Configurar fallback ordenado para mitigar indisponibilidade em lançamentos de tráfego intenso.
2. Se a rota nativa DeepSeek retornar timeout persistente ou erro 503/429 da API externa, redirecionar automaticamente para a rota alternativa via OpenRouter sem derrubar a sessão do cliente.
3. Não cobrar tokens de turnos abortados por falha técnica de upstream.

### Etapa 7 — Cadastro dos Provedores como Controle de Acesso [SQL] [APROVAÇÃO]

> **REESCOPO 2026-10-08** — decisão de arquitetura: Settings é o cofre, Admin é controle de acesso. Ver [`arquitetura-settings-cofre.md`](./arquitetura-settings-cofre.md).

1. Ler os provedores disponíveis do `.credentials.yaml` (`refs`) e do `settings.yaml` (`llm-pi-ai.providers`), **sem logar valores de chave**.
2. Cadastrar em `public.llm_providers` **apenas metadados** (sem `api_key`): `name`, `provider_type`, `base_url`, `provider_route`, `is_active = true`, `allowed_plans = ['starter','pro','legend']`.
3. `provider_route` alinhado à rota de runtime: `deepseek-official` (primário) e `openrouter` (fallback), conforme `packages/bundle/copymonster/cordis.patch.yml`.
4. `api_key_env`: **não persistir** enquanto o composite falhar-fechado para referência gerenciada sem chave (Opção A). Persistir somente após corrigir o composite para delegar ao cofre local (Opção B). Ver o achado crítico na nota de arquitetura.
5. O `admin_save_llm_provider` da migration 035 permanece: `p_api_key` continua aceito mas pode ser vazio — o Admin não é cofre.
6. Nenhuma chave é inserida ou versionada; a inserção de chaves ocorre exclusivamente no Settings → Models.

### Etapa 8 — Restrição de Seletor de Modelos na UI por Papel (Role Gating) [APROVAÇÃO]
1. Arquivo: `packages/client/ui-model-selection/src/client/ModelSelect.tsx`.
2. Ocultar o seletor de modelos e o menu `/model` para usuários comuns (`role: member` ou trial).
3. O usuário comum sempre utiliza o modelo padrão definido pelo plano (`is_default_for_plans`), blindando o sistema contra seleções indevidas de modelos com custo proibitivo.
4. Usuários `owner` e `admin` mantêm acesso completo para testes e alternância de modelos.

### Etapa 9 — Proteção Anti-Abuso & Sanitização Pré-Campanha [APROVAÇÃO]
1. Bloqueio de domínios de e-mails descartáveis no endpoint de cadastro (`auth-http`).
2. Rate-limiting por IP em endpoints de autenticação e criação de sessões.
3. Higienização controlada de workspaces e sessões órfãs geradas em testes internos prévios, com backup prévio documentado.

### Etapa 10 — Testes Automatizados E2E & Validação de Builds [APROVAÇÃO]
1. Suíte completa de testes unitários e de integração:
   - `pnpm exec vitest run packages/api/session-controller`
   - `pnpm exec vitest run packages/api/auth-http`
   - `pnpm exec vitest run packages/host/brand-assets`
2. Builds formais de validação obrigatórios:
   - `pnpm run build:lib:host`
   - `pnpm run build:lib:client`
   - `pnpm run build:web`
3. Simulação de ciclo de vida completo: Cadastro -> Criação de Tenant Pessoal -> Consumo de Tokens -> Bloqueio por Quota -> Checkout Stripe -> Ativação Automática via Webhook.

### Etapa 11 — Documento de Auditoria Final e Go/No-Go [APROVAÇÃO]
1. Publicação do relatório oficial `docs/roadmap/pre-launch-audit-final.md`.
2. Validação da matriz de critérios para o Go-Live.
3. Registro de comandos de rollback e plano de contingência para as 48 horas da campanha.

---

## 4. Matriz de Riscos & Planos de Contingência

| Risco Mapeado | Probabilidade | Impacto | Ação de Mitigação Preventiva |
|---|---|---|---|
| **Pico de requisições esgotar saldo da API externa** | Média | Alto | Monitoramento de saldo pré-pago no painel DeepSeek/OpenRouter com alertas de webhook para recarga automática. |
| **Abuso massivo de Free Trial por bots** | Alta | Crítico | Rate limiting por IP no cadastro, bloqueio de e-mails temporários e tenant isolado com cota de 1M tokens. |
| **Indisponibilidade momentânea do Supabase** | Baixa | Alto | RPC com fail-closed para proteção de receita; health check `/api/healthz` para chaveamento de tráfego. |
| **Oscilação de latência da API DeepSeek** | Média | Médio | Fallback transparente para o gateway do OpenRouter sem interrupção para o usuário final. |
| **Tentativa de bypass de RLS no banco** | Baixa | Crítico | Todas as funções de cota e credenciais operam com `SECURITY DEFINER` restritas estritamente ao `service_role`. |

---

## 5. Checklist de Definição de Pronto (Definition of Done)

- [ ] Tenant Onboarding configurado para gerar tenants individuais por usuário.
- [ ] Admin → LLM Providers exibindo os provedores disponíveis (do Settings) com controle ativo/inativo por plano, sem recadastro de chave.
- [ ] Runtime LLM resolvendo credenciais pelo cofre local (Settings → Models) sem persistência de segredos no banco nem em disco.
- [ ] `check_tenant_quota` bloqueando ativamente em `session.create` e `session.prompt` ao estourar limites.
- [ ] Webhook do Stripe processando pagamentos em modo fail-closed e atualizando `current_period_end` e limites.
- [ ] Seletor de modelos visível apenas para `admin` e `owner`.
- [ ] Rota `/api/healthz` operacional para monitoramento externo.
- [ ] Todos os testes automatizados verdes e 3 builds de produção (`host`, `client`, `web`) compilados com código 0.
- [ ] Documento de auditoria final assinado antes do disparo de tráfego.
