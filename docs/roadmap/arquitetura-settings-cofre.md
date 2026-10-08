# Decisão de Arquitetura — Settings como Cofre, Admin como Controle de Acesso

**Documento:** `docs/roadmap/arquitetura-settings-cofre.md`

**Status:** DECISÃO REGISTRADA — reescopo da Etapa 7 do plano de produção.

**Data:** 2026-10-08

**Base:** `master` @ `70663b9888`

**Plano afetado:** [`plano-producao-llm-providers-billing-trial.md`](./plano-producao-llm-providers-billing-trial.md)

## Contexto

O Admin → LLM Providers exibia "Not configured" para todos os provedores, sugerindo que as chaves haviam se perdido. A investigação mostrou o contrário: o **Settings → Models** já contém todas as chaves funcionais, com indicador verde. O sintoma era apenas a UI antiga do Admin usando `has_api_key` (coluna `api_key_encrypted`) como critério de "configurado".

## Decisão

1. **Settings → Models (`.credentials.yaml`) é o COFRE de chaves.** Fonte única de verdade. Nada é recadastrado no Admin.
2. **Admin → LLM Providers é PAINEL DE CONTROLE DE ACESSO.** Lista os provedores disponíveis, permite ativar/desativar por plano e não pede chave.
3. **Runtime** resolve a chave pelo seam `ctx.credentials` (cofre local). O Admin apenas determina **quem pode usar** cada provedor (`allowed_plans`, `is_active`).

### Papéis

| Camada | Papel | Fonte |
|---|---|---|
| Settings → Models | Cofre de chaves | `/root/.dsh/.credentials.yaml` (`refs`) |
| Admin → LLM Providers | Controle de acesso por plano | tabela `public.llm_providers` (metadados, sem chave) |
| Runtime (composite) | Resolve chave do cofre | `ctx.credentials` → `credentials-local` |

## Estado evidenciado

### Cofre local (`/root/.dsh/.credentials.yaml`)

8 referências de chave presentes (`refs`), valores nunca lidos/logados:

`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `FREELLM_API_KEY`, `AGENTROUTER_API_KEY`, `BAI_API_KEY`, `APX_API_KEY`, `TOKENHARBOR_API_KEY`.

### Perfis de provedor no `settings.yaml` (`llm-pi-ai.providers`)

| Chave | displayName | baseURL | apiKeyEnv (Settings) |
|---|---|---|---|
| `freellm` | Free-llm | `https://api.fortunadigital.me/v1` | `FREELLM_API_KEY` |
| `agentrouter` | AgentRouter | `https://agentrouter.org/v1` | `AGENTROUTER_API_KEY` |
| `openrouter` | (OpenRouter) | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `nvidia` | (Nvidia) | `https://integrate.api.nvidia.com/v1` | `NVIDIA_API_KEY` |
| `bai` | B.AI | `https://api.b.ai/v1/chat/completions` | `BAI_API_KEY` |
| `apx` | Apmix | `https://api.apmix.ai/v1` | `APX_API_KEY` |
| `tokenharbor` | Harbor | `https://tokenharbor.ai//v1` | `TOKENHARBOR_API_KEY` |

O provedor **DeepSeek** não aparece em `llm-pi-ai.providers`: usa o adapter nativo `llm-deepseek`, cuja rota é `deepseek-official` e cujo `apiKeyEnv` padrão é `DEEPSEEK_API_KEY`.

### Banco (`public.llm_providers`)

4 linhas legadas (`Anthropic`, `DeepSeek`, `Google`, `OpenAI`), todas com `api_key_encrypted IS NULL`, `provider_route`/`api_key_env` nulos. **Nenhuma** dessas linhas corresponde aos provedores do cofre.

## Achado crítico — o composite NÃO delega ao cofre quando `api_key_env` está setado

O `@deepseek-ai/dsh-host-llm-credentials-supabase` é o provider raiz de `credentials`. Ele lista em `managed` toda referência declarada no catálogo (`api_key_env`) e, para uma referência gerenciada sem chave no Supabase, retorna `undefined` **sem cair para o cofre local**:

- `packages/host/llm-credentials-supabase/src/index.ts:138-145` — `resolve`: se `managed.has(ref)` e não há valor Supabase, retorna `undefined`.
- `packages/host/llm-credentials-supabase/tests/provider.spec.ts:109-115` — teste explícito: *"fails closed for a managed reference with no key and does not fall back"*.

**Consequência:** cadastrar as linhas de metadados com `api_key_env = DEEPSEEK_API_KEY` (etc.) e sem `api_key` faz o composite tratar essas referências como "gerenciadas sem chave" e **quebrar a resolução** das chaves do cofre de hoje para amanhã. Como as linhas atuais têm `api_key_env` nulo, o composite delega tudo ao cofre local — por isso as chaves do Settings funcionam agora.

**Portanto, o reescopo da Etapa 7 depende de uma das duas correções:**

- **Opção A (mínima):** as linhas de metadados **não persistem `api_key_env`**; guardam apenas `provider_route` (ex.: `deepseek-official`, `openrouter`, `apx`), `is_active` e `allowed_plans`. O adapter resolve a chave pelo `apiKeyEnv` do próprio `settings.yaml`. Nenhuma mudança de código no composite.
- **Opção B (explícita, recomendada se `api_key_env` precisar existir no banco):** alterar `resolve`/`describe` do composite para delegar ao cofre local quando não houver valor Supabase, e atualizar o teste `provider.spec.ts:109` para o novo contrato.

Sem essa decisão, a Etapa 7 permanece bloqueada para escrita no banco.

## Reescopo da Etapa 7

1. Ler os provedores do `.credentials.yaml` e do `settings.yaml` **sem logar valores**.
2. Cadastrar em `public.llm_providers` **apenas metadados** (sem `api_key`): `name`, `provider_type`, `base_url`, `provider_route`, `is_active = true`, `allowed_plans = ['starter','pro','legend']`.
3. Tratar `api_key_env` conforme a opção A ou B acima.
4. Preservar o `admin_save_llm_provider` da migration 035: `p_api_key` continua aceito, mas pode ser vazio (Admin não é cofre).
5. Alinhar `provider_route` ao nome de rota que o runtime usa no failover (`deepseek-official` para o primário; `openrouter` para o fallback, conforme `packages/bundle/copymonster/cordis.patch.yml:48-53`).

### Correções de dados no `settings.yaml` (fora do banco)

- `bai.baseURL = https://api.b.ai/v1/chat/completions` contém o sufixo de endpoint; um `baseURL` de perfil deve ser a raiz (`.../v1`).
- `tokenharbor.baseURL = https://tokenharbor.ai//v1` contém barra dupla.

## UI Admin (futuro — Etapa 8 ou pós-lançamento)

Reformular `apps/web/src/pages/admin/tabs/AdminLLMProvidersTab.tsx`:

- Listar provedores disponíveis (lidos do Settings via API do host), não recadastrar.
- Card: nome, fonte ("Settings → Models" ou "Não configurado"), toggle Ativo/Inativo, checkboxes Starter/Pro/Legend.
- Remover o campo de API Key do formulário; o Admin não é cofre.

## Regras

1. Nunca logar, imprimir ou commitar valores de chave.
2. Aplicação de SQL no banco somente via psql e com aprovação.
3. Isolamento de tenant e gate de cota permanecem fail-closed.
