# Plano de Rebranding e i18n dos Plugins (dsh-mcp-connector, dsh-genui, dsh-automation)

## 1. Resumo Executivo

Esta auditoria analisa a presença de textos e metadados em língua chinesa nos três plugins externos integrados ao CopyMonster:
1. `dsh-mcp-connector` (v0.2.79)
2. `@michengai/dsh-automation` (v1.0.10)
3. `@changfenhuang/dsh-genui` (v0.14.0) *(nota: grafia oficial no npm é `@changfenhuang/dsh-genui`)*

### Volume de Strings em Chinês por Plugin e Camada

| Plugin | Camada A (Hardcoded Bundle) | Camada B (API / Catálogo Remoto) | Camada C (i18n Nativo / Locales) |
| :--- | :--- | :--- | :--- |
| **`dsh-mcp-connector`** | **1.164 ocorrências**<br>• `ui/index.html`: 889 (640 únicas)<br>• `lib/client.js`: 275 (241 únicas) | **~100+ campos de texto** no catálogo remoto (jsdelivr/github) e local (`catalog/catalog.json`) | **Inexistente** (plugin não possui arquitetura de i18n; 100% hardcoded) |
| **`@michengai/dsh-automation`** | **11 ocorrências** (8 únicas)<br>• `lib/client.js`: 11 | Nenhuma (opera em dados locais/agendamentos) | **Parcial / Mínimo** (`locale/en.json` e `locale/zh.json` contêm apenas metadados de manifesto) |
| **`@changfenhuang/dsh-genui`** | **642 ocorrências** (507 únicas)<br>• Dicionário `zh.ts` compilado dentro do bundle | Nenhuma (dados gerados pelo modelo/agente) | **Completo (EN / ZH)** (`src/client/i18n/en.ts` canônico com centenas de chaves; sem suporte nativo a PT) |

### Esforço Estimado
* **Camada A:** **Médio** (~1 dia). Para `dsh-automation`, são apenas 8 termos (esforço trivial). Para `dsh-mcp-connector`, exige expandir o dicionário de substituição de `scripts/apply-dsh-plugins-rebrand.mjs` com ~600 termos adicionais e cobrir `ui/index.html` e `lib/client.js`.
* **Camada B:** **Médio / Baixo** (~0,5 a 1 dia). Interceptação ou espelhamento estático do catálogo em inglês.
* **Camada C:** **Médio** (~1 dia). Implementação de dicionário `pt` para o GenUI e amarração no DSH locale bridge.

### Recomendação Estratégica
* **Fase 1 (Imediata - Recomendada):** Traduzir 100% da **Camada A** (interface dos 3 plugins para o inglês base) e estender o `apply-dsh-plugins-rebrand.mjs` com substituições estáticas para o catálogo bundled de conectores da **Camada B** (traduzindo cartões como Qichacha, Wind, Baidu Maps e PKULaw para inglês).
* **Fase 2:** Integrar a **Camada C** (dicionário PT no GenUI e fallback elegante).
* **Camada B Dinâmica (LLM):** Não recomendada para produção imediata devido a latência e instabilidade; preferir catálogo estático traduzido ou proxy local.

---

## 2. Auditoria Detalhada por Camada

### Camada A — Textos Hardcoded no Bundle

#### 1. `dsh-mcp-connector`
O plugin foi construído como um iframe autônomo servido por `ui/index.html` com suporte em `lib/client.js`.
* **`ui/index.html`:** Contém 889 ocorrências (640 trechos únicos).
  * Exemplos de strings visíveis:
    * `"发现旧企查查 MCP 授权"` (Found legacy Qichacha MCP authorization)
    * `"可从旧企查查 OAuth 插件复制已有授权"` (Copy existing authorization from legacy Qichacha OAuth plugin)
    * `"确认把旧企查查 OAuth 授权复制到 MCP连接器？原插件与原凭据会保留；验证新连接后再手动停用旧插件。"`
    * `"启动命令"` (Launch command)
    * `"两层配合后无论值里有什么"` (Parameter description note)
    * `"连接状态与故障处理"` (Connection status and troubleshooting)
    * `"暂无已上架的连接器"` (No published connectors available)
* **`lib/client.js`:** Contém 275 ocorrências (241 trechos únicos).
  * Exemplos de strings:
    * `"控制侧边栏入口和快捷打开方式"` (Sidebar and shortcut launcher settings)
    * `"连接器设置"` (Connector settings)
    * `"正在回滚"` (Rolling back)
    * `"已回滚"` (Rolled back)
    * `"检查更新"` (Check for updates)
    * `"只依赖稳定的"` (Depend only on stable releases)

O arquivo `scripts/apply-dsh-plugins-rebrand.mjs` já possui as tabelas `MCP_UI_REPLACEMENTS` e `MCP_CLIENT_REPLACEMENTS`, mas elas cobrem apenas uma fração (~150 termos). É necessário expandir para cobrir o restante do vocabulário da UI.

#### 2. `@michengai/dsh-automation`
* **`lib/client.js`:** Possui apenas 11 ocorrências de caracteres CJK, concentradas em 8 termos de interface em duas linhas:
  * Linha 3: `新会话` (New session), `新建任务` (New task), `重命名` (Rename), `删除工作区` (Delete workspace), `删除` (Delete).
  * Linha 179: `设置` (Settings), `账号` (Account), `账户` (Account).
* O restante do plugin já consome tokens em inglês e o tema CopyMonster aplicado no commit `0d299edd80`.

#### 3. `@changfenhuang/dsh-genui`
* **`lib/client.js`:** 642 ocorrências (507 únicas).
* Essas strings são quase exclusivamente o espelho compilado do arquivo `src/client/i18n/zh.ts` e rótulos de fallback de componentes.
* Como o GenUI possui sistema de i18n, essas strings em chinês só aparecem para o usuário se o idioma ativo for resolvido para `zh`.

---

### Camada B — Textos de API Externa (Catálogo MCP)

#### URLs do Registry Remoto
No arquivo `lib/constants.js` de `dsh-mcp-connector`:
* **URL Primária:** `https://cdn.jsdelivr.net/gh/duhu2000/dsh-mcp-connector-registry@main/catalog.json`
* **URL de Fallback:** `https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector-registry/main/catalog.json`

#### Carregamento e Prioridade (`lib/catalog.js` e `lib/index.js`)
A resolução do catálogo obedece à seguinte ordem:
$$	ext{Local overrides} > 	ext{config.connectors} > 	ext{Remote registry (jsdelivr/github)} > 	ext{Bundled catalog (catalog/catalog.json)}$$

#### Formato dos Dados do Catálogo
Os descritores contêm campos visíveis nos cards e popups de detalhes:
```json
{
  "id": "qcc-company",
  "name": "企查查·企业工商",
  "vendor": "企查查 Qichacha",
  "category": "企业数据",
  "summary": "一站式企业工商 / 股权 / 经营信息查询",
  "description": "覆盖工商注册、股东、实际控制人、对外投资、经营异常、行政处罚等企业全景数据...",
  "tags": ["工商", "风控", "尽调", "获客"],
  "promptVariables": [
    { "name": "company", "label": "企业名称", "default": "小米科技有限责任公司" },
    { "name": "person", "label": "人员姓名", "default": "雷军" }
  ]
}
```

#### Conectores Atuais no Catálogo
1. `qcc-company`: 企查查 (Qichacha Corporate & Risk Intelligence)
2. `wind-financial`: 万得金融数据 (Wind Financial Data)
3. `pkulaw-legal`: 北大法宝·法律法规 (PKULaw Chinese Legal & Case Search)
4. `baidu-map`: 百度地图 (Baidu Maps Places & Geocoding)
5. `exa-search`: Exa AI Search (já em inglês)

#### Viabilidade de Interceptação da Camada B
* **Opção B.1 — Patch no Catálogo Bundled + Registry URL Override (Altamente Viável e Leve):**
  Redirecionar no postinstall a URL em `lib/constants.js` para um arquivo estático localizado em repositório próprio (ou desabilitar o fetch remoto forçando o uso do catálogo local bundled traduzido).
* **Opção B.2 — Interceptação em Tempo de Execução via RPC/Host:**
  Modificar o manipulador `api.catalog()` no backend do plugin (`lib/index.js`) para traduzir em memória os campos descritivos (`name`, `summary`, `description`, `category`, `tags`, `promptVariables`) usando um dicionário estático EN/PT.
* **Opção B.3 — Tradução Dinâmica via LLM:**
  Possível tecnicamente, mas desaconselhada: introduziria latência perceptível (2s a 5s) na abertura da aba MCP, consumo desnecessário de tokens e risco de inconsistência nas variáveis de template (`promptVariables`).

---

### Camada C — i18n Nativo dos Plugins

#### 1. `dsh-mcp-connector`
* **Situação:** Não possui suporte nativo a i18n.
* **Diagnóstico:** Sem arquivos em `locale/` ou `i18n/`. A interface depende inteiramente da substituição textual no bundle (Camada A).

#### 2. `@michengai/dsh-automation`
* **Situação:** Suporte a i18n embrionário.
* **Arquivos:** `locale/en.json` e `locale/zh.json`.
* **Conteúdo:** Apenas metadados do manifesto:
  ```json
  // locale/en.json
  { "meta": { "title": "Automation", "description": "Schedule and manage coding tasks in isolated sessions." } }
  ```
* **Diagnóstico:** A UI interna não consome esses arquivos para seus botões/menus. As poucas strings existentes estão no bundle.

#### 3. `@changfenhuang/dsh-genui`
* **Situação:** Arquitetura de i18n completa e estruturada.
* **Arquivos:**
  * `src/client/i18n/en.ts` (dicionário canônico inglês)
  * `src/client/i18n/zh.ts` (dicionário chinês estrito)
  * `src/client/i18n/runtime.ts` e `index.ts` (mecanismo de sincronização reativa com `useSyncExternalStore` e ponte com host DSH via `bridgeHostLocale`).
* **Comportamento Atual:**
  * O runtime define `LOCALE_IDS = [en, zh]`.
  * Se o idioma do host/navegador for `pt` ou `pt-BR`, a função `normalizeLocale(pt)` retorna `undefined` e o runtime assume o `FALLBACK_LOCALE` (`en`).
  * Portanto, o GenUI **já exibe inglês** por padrão para usuários fora do idioma chinês.

---

## 3. Solução Proposta

### Para Camada A (Textos Hardcoded)
1. **Expandir `scripts/apply-dsh-plugins-rebrand.mjs`:**
   * Adicionar as 8 substituições de `dsh-automation` (`新会话` → `New Session`, `新建任务` → `New Task`, `重命名` → `Rename`, `删除工作区` → `Delete Workspace`, `设置` → `Settings`, `账号`/`账户` → `Account`).
   * Adicionar ~600 termos mapeados na auditoria para `ui/index.html` e `lib/client.js` de `dsh-mcp-connector`.
2. **Garantir a execução contínua:**
   * Integrar a execução do script no ciclo de `postinstall` dos perfis DSH.

### Para Camada B (Catálogo MCP)
1. **Dicionário Estático de Conectores:**
   * Criar um mapeamento bilíngue (EN / PT) para os conectores do catálogo padrão:
     * `企查查·企业工商` → `Qichacha Business Search` (ou `Qichacha Dados Empresariais`)
     * `万得金融数据` → `Wind Financial Data` (ou `Wind Dados Financeiros`)
     * `北大法宝·法律法规` → `PKULaw Legal Database` (ou `PKULaw Base Jurídica`)
     * `百度地图` → `Baidu Maps`
2. **Aplicação no Script de Rebrand:**
   * Traduzir diretamente o arquivo `catalog/catalog.json` do pacote `dsh-mcp-connector`.
   * Em `lib/constants.js`, neutralizar ou redirecionar a URL do registry remoto para evitar que o download remoto substitua o catálogo local traduzido por versões em chinês não traduzidas.

### Para Camada C (i18n Nativo)
1. **GenUI:**
   * Adicionar `pt` à lista de locales suportados se desejado (`src/client/i18n/pt.ts`).
   * Enquanto o suporte a PT não for implementado, o fallback canônico para `en` garante que nenhum texto em chinês apareça para usuários em inglês ou português.
2. **Automation:**
   * Traduzir as strings residuais de `lib/client.js` via script da Camada A.

---

## 4. Análise de Riscos e Mitigações

| Risco | Impacto | Mitigação |
| :--- | :--- | :--- |
| **Sobrescrita em atualizações (`npm install` / `pnpm update`)** | Alto | O script `apply-dsh-plugins-rebrand.mjs` deve rodar como hook de `postinstall` em `profiles/web/package.json`. |
| **Registry remoto do MCP Connector sobrescrever traduções locais** | Alto | O registry remoto baixa em runtime novos JSONs. Mitigação: apontar a constante em `lib/constants.js` para espelho local/estático ou interceptar a mescla em `lib/catalog.js`. |
| **Regressões visuais ou quebras de sintaxe no bundle JS** | Médio | Testes automatizados de integridade sintática pós-transformação e verificação com `node scripts/apply-dsh-plugins-rebrand.mjs --check`. |
| **Tradução via LLM em runtime quebrar UI ou demorar** | Médio | Não utilizar LLM síncrono para renderizar o catálogo; utilizar dicionário estático determinístico. |

---

## 5. Checklist de Aceitação

- [ ] Cards do catálogo MCP exibem títulos e resumos em inglês (`Qichacha`, `Wind Financial`, `Baidu Maps`, etc.).
- [ ] Modal/Popup de detalhes do MCP exibe descrições e parâmetros em inglês.
- [ ] Banners de migração e avisos no topo do MCP Connector exibem textos em inglês (sem caracteres chineses).
- [ ] Menu e botões de `dsh-automation` (`New Task`, `Settings`, etc.) exibem textos em inglês.
- [ ] GenUI renderiza 100% em inglês (painel, templates, conquistas e erros) quando o sistema estiver em EN ou PT.
- [ ] Nenhuma quebra de layout, CSS ou regressão visual na paleta CopyMonster (`cm-theme.css`).

---

## 6. Ordem de Implementação Recomendada

```
+-------------------------------------------------------+
| 1. Camada A (Automation + MCP Interface)              |
|    - Esforço: Baixo a Médio                           |
|    - Impacto: Imediato na navegação e nos painéis     |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
| 2. Camada B (Catálogo de Conectores MCP)              |
|    - Esforço: Baixo (catálogo estático traduzido)     |
|    - Impacto: Elimina o chinês dos cards e popups     |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
| 3. Camada C (Aprimoramento de i18n PT para GenUI)     |
|    - Esforço: Médio                                   |
|    - Impacto: Internacionalização nativa completa     |
+-------------------------------------------------------+
```

A priorização inicia pelas Camadas A e B, eliminando 100% da percepção de caracteres chineses para os usuários finais do CopyMonster de forma determinística e sem dependência de serviços externos.
