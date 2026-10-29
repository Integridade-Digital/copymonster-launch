# Plano de Rebranding Visual e Internacionalização Completa — CopyMonster

## 1. Diagnóstico Executivo Pós-Upstream

Após a sincronização (*merge upstream*) com o repositório base (`deepseek-ai/deepseek-harness`), a aplicação incorporou novas atualizações de internacionalização e módulos de suporte a múltiplos idiomas (`de`, `en`, `es`, `fr`, `ja`, `pt`, `ru`, `zh`). 

Embora o idioma em inglês (`en`) tenha recebido previamente customizações da marca **CopyMonster**, o merge upstream introduziu regressões visuais nos demais idiomas:
1. **Regressão no Hero da Página Inicial (Empty State / New Chat)**:
   - Em inglês (`en`), o título exibe corretamente **"Copy, Funnels & Launches"** com o badge **"New"**.
   - Em todos os outros 7 idiomas (`pt`, `es`, `fr`, `de`, `ja`, `ru`, `zh`), o texto reverteu para o lema oficial do DeepSeek (*"Into the Unknown"* / *"Para o desconhecido"* / *"Hacia lo desconocido"* / *"Dans l'inconnu"* / etc.) com badges genéricos de pré-visualização.
2. **Resquícios de Marca DSH e DeepSeek em Mensagens Visíveis ao Usuário**:
   - Títulos de abas e cabeçalhos fallback exibindo *"Versão local do DSH"* (`brand.localBuild`).
   - Mensagens de erro de sessão, desconexão de conta e reinicialização de processos citando explicitamente *"DSH"* e *"DeepSeek"*.
   - Telas de onboarding, boas-vindas dos modelos e modais de configuração contendo descrições institucionais da DeepSeek.
3. **Desacoplamento entre o Shell SaaS (`apps/web/`) e o Core i18n (`packages/client/locale/`)**:
   - O wrapper web (`apps/web/src/locales/`) implementava apenas dicionários em `en` e `zh`, sem suporte completo a `pt` para as telas de Login, Cadastro, Planos, Perfil e Meu DNA.
4. **Paleta de Cores e Identidade Visual**:
   - Necessidade de assegurar que os tokens proprietários `--cm-*` (dourado/ocre `#967d45` e superfícies quentes `#faf9f5` / `#262624`) prevaleçam estritamente sobre quaisquer cores legadas ou azuis institucionais herdados do upstream.

---

## 2. Mapeamento Camada por Camada

A higienização e o rebranding visual do CopyMonster devem atuar de forma cirúrgica em quatro camadas, respeitando o princípio de **nunca quebrar contratos técnicos de API ou nomes de modelos que o backend e os administradores necessitam identificar**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Camada 1: Dicionários Core i18n (packages/client/**/locales*.ts)      │
│  - Hero da Home (8 idiomas)                                            │
│  - Identidade de Produto (brand.localBuild, diálogos, erros de sessão) │
├────────────────────────────────────────────────────────────────────────┤
│ Camada 2: Frontend Wrapper & Shell SaaS (apps/web/)                    │
│  - Dicionário pt.ts para telas de Auth, Planos, DNA e Erros             │
│  - Metadados, títulos de página e ErrorBoundary amigável               │
├────────────────────────────────────────────────────────────────────────┤
│ Camada 3: Identidade Visual e Paleta de Cores (--cm-* e Tokens)        │
│  - Injeção da paleta ocre/dourada nos tokens de marca do client core   │
│  - Blindagem dos assets (/brand.png, /brand-text.png, ícones de marca) │
├────────────────────────────────────────────────────────────────────────┤
│ Camada 4: Automação Anti-Regressão Upstream (Scripts & Gates)          │
│  - Script de patch pós-install e regra de verificação contínua         │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Camada 1: Dicionários de Tradução / i18n nos Pacotes Client

#### 1.1. Hero da Página Inicial (`packages/client/ui-conversation/src/client/locales.ts`)
O componente `EmptyHero.tsx` renderiza o título da tela inicial via `t('hero.headline')` e o badge via `t('hero.preview')`.

**Tabela de Padronização para os 8 Idiomas:**

| Idioma | Código | Situação Atual (Upstream DSH) | Nova Tradução Oficial CopyMonster | Badge (`hero.preview`) |
| :--- | :--- | :--- | :--- | :--- |
| **Inglês** | `en` | `Copy, Funnels & Launches` | `Copy, Funnels & Launches` *(Manter)* | `New` |
| **Português** | `pt` | *Para o desconhecido* | **`Copy, Funis e Lançamentos`** | **`Novo`** |
| **Espanhol** | `es` | *Hacia lo desconocido* | **`Copy, Embudos y Lanzamientos`** | **`Nuevo`** |
| **Francês** | `fr` | *Dans l'inconnu* | **`Copy, Tunnels & Lancements`** | **`Nouveau`** |
| **Alemão** | `de` | *Ins Unbekannte* | **`Copy, Funnels & Launches`** | **`Neu`** |
| **Japonês** | `ja` | *未知への挑戦* | **`コピー、ファネル＆ローンチ`** | **`New`** |
| **Russo** | `ru` | *В неизвестность* | **`Копирайтинг, воронки и запуски`** | **`Новое`** |
| **Chinês** | `zh` | *探索未至之境* | **`文案、漏斗与发售`** | **`新`** |

*Nota:* O botão adjacente `hero.chooseWorkspace` deve ser mantido de acordo com cada idioma (ex.: em PT: *"Escolha o espaço de trabalho"*).

---

#### 1.2. Identidade de Produto Global (`packages/client/locale/src/locales/*.ts`)
A chave `brand.localBuild` é utilizada como fallback de título da aplicação em `AppFrame.tsx`:
- `packages/client/locale/src/locales/en.ts`: `'brand.localBuild': 'CopyMonster'` *(OK)*
- `packages/client/locale/src/locales/pt.ts`: `'brand.localBuild': 'Versão local do DSH'` ➔ **`'brand.localBuild': 'CopyMonster'`**
- `packages/client/locale/src/locales/es.ts`: `'brand.localBuild': 'Compilación local de DSH'` ➔ **`'brand.localBuild': 'CopyMonster'`**
- `packages/client/locale/src/locales/fr.ts`: `'brand.localBuild': 'Version locale de DSH'` ➔ **`'brand.localBuild': 'CopyMonster'`**
- `packages/client/locale/src/locales/de.ts`: `'brand.localBuild': 'Lokaler DSH-Build'` ➔ **`'brand.localBuild': 'CopyMonster'`**
- `packages/client/locale/src/locales/ja.ts`: `'brand.localBuild': 'DSHローカルビルド'` ➔ **`'brand.localBuild': 'CopyMonster'`**
- `packages/client/locale/src/locales/ru.ts`: `'brand.localBuild': 'Локальная сборка DSH'` ➔ **`'brand.localBuild': 'CopyMonster'`**
- `packages/client/locale/src/locales/zh.ts`: `'brand.localBuild': 'DSH 本地构建'` ➔ **`'brand.localBuild': 'CopyMonster'`**

---

#### 1.3. Mensagens de Notificação, Falhas e Diálogos Visíveis

| Pacote e Arquivo | Chave / Contexto | Texto Upstream (DSH) | Substituição CopyMonster |
| :--- | :--- | :--- | :--- |
| `packages/client/ui-conversation/src/client/locales.ts` | `error.sessionInUse` | *"outra instância DSH em execução (como dsh web...)"* | *"outra instância do CopyMonster em execução"* |
| `packages/client/ui-chat/src/client/locale.ts` | `message.failure.accountSignedOut` | *"Interrompido porque você saiu de DeepSeek."* | *"Interrompido porque você saiu da sua conta CopyMonster."* |
| `packages/client/ui-chat/src/client/locale.ts` | `message.failure.interrupted` | *"O processo DSH foi encerrado antes..."* | *"O processo CopyMonster foi reiniciado..."* |
| `packages/client/ui-chat/src/client/locale.ts` | `message.failure.accountSignInRequired` | *"Faça login em DeepSeek..."* | *"Faça login no CopyMonster..."* |
| `packages/client/ui-settings-account/src/client/locales.ts` | `onboardingBrand`, `loginTitle` | *"DeepSeek Harness"*, *"Conta DeepSeek"* | *"CopyMonster"*, *"Conta CopyMonster"* |
| `packages/client/ui-settings-models/src/client/locales.ts` | `welcomeBody` | Discurso institucional sobre a versão prévia do DeepSeek Harness | Apresentação focada no CopyMonster e na geração de copys de alta conversão |
| `packages/client/ui-plugin-manager/src/client/locales.ts` | Avisos de segurança e restart | *"Reinicie DSH"*, *"danificar DeepSeek Harness"* | *"Reinicie o CopyMonster"*, *"danificar o CopyMonster"* |
| `packages/client/ui-agent-preset/src/client/locales.ts` | Guias e descrições | *"Um plug-in adiciona recursos a DSH"* | *"Uma extensão adiciona recursos ao CopyMonster"* |
| `packages/client/ui-sidebar-browser/src/client/locales.ts` | Restrição de navegação | *"O navegador incorporado não pode abrir o aplicativo DSH"* | *"O navegador integrado não pode abrir o CopyMonster diretamente"* |

*Importante:* Preservar nomes técnicos quando referirem-se estritamente ao provedor de IA oficial (ex.: opção de API "DeepSeek Official" no cofre de credenciais de administradores), mas alterar tudo o que for voltado à identidade do software e da plataforma.

---

### Camada 2: Frontend Wrapper e Shell SaaS (`apps/web/`)

1. **Criação do Dicionário `pt.ts` em `apps/web/src/locales/`**:
   - Atualmente, `apps/web/src/locales/` possui apenas `en.ts` e `zh.ts`.
   - Implementar `apps/web/src/locales/pt.ts` cobrindo 100% das chaves:
     - Telas de Autenticação (`auth.*`, `login.*`, `register.*`, `resetPassword.*`).
     - Modais e Menus SaaS (`profile.*`, `plans.*`, `admin.*`, `dna.*`).
     - Alertas, feedbacks e botões comuns (`common.*`).
   - Atualizar `apps/web/src/locales/index.ts` para registrar `pt` e selecioná-lo automaticamente quando o navegador estiver em Português (`navigator.language.startsWith('pt')`).

2. **Metadados e PWA (`apps/web/index.html` e `manifest.webmanifest`)**:
   - `index.html`:
     - `<title>CopyMonster — Copy, Funnels & Launches</title>`
     - Meta description: *"Copywriting and launch funnels for experts, mentors, and info-product creators."*
   - `manifest.webmanifest`:
     - `"name": "CopyMonster"`
     - `"short_name": "CopyMonster"`
     - `"theme_color": "#967d45"`
     - `"background_color": "#faf9f5"`

3. **Sanitização de Erros e Error Boundary (`apps/web/src/main.tsx`)**:
   - Manter ativo o filtro `SENSITIVE_ERROR_PATTERNS` que intercepta e mascara exceções contendo caminhos internos (`@deepseek-ai/*`, `/packages/*`, `/tmp/*`), garantindo que nenhuma falha de runtime exponha a base upstream ao usuário.

---

### Camada 3: Identidade Visual e Paleta de Cores (`--cm-*` Tokens)

A identidade visual do CopyMonster é definida por sua paleta sofisticada em tons de ouro/ocre e superfícies quentes:

#### 3.1. Paleta Canônica (`apps/web/src/cm-theme.css`)
```css
:root {
  /* Marca CopyMonster Primária */
  --cm-primary: #967d45;
  --cm-primary-hover: #836d3b;
  --cm-primary-active: #6e5c32;
  
  /* Superfícies e Fundos (Tema Claro) */
  --cm-background: #faf9f5;
  --cm-card: #faf9f5;
  --cm-card-subtle: #f4f2ec;
  --cm-border: #dad9d4;
  --cm-foreground: #1c1b18;
  --cm-muted-foreground: #73726c;
}

/* Tema Escuro */
body[data-ds-dark-theme] {
  --cm-background: #262624;
  --cm-card: #181611;
  --cm-card-subtle: #1f1d16;
  --cm-border: #383428;
  --cm-foreground: #ede8dc;
  --cm-muted-foreground: #a69f8e;
}
```

#### 3.2. Mapeamento de Tokens do Plataform Engine (`packages/client/ui-theme/`)
No upstream, a interface base consome tokens da família `--dsw-static-deepseek-*` e `--dsw-alias-brand-*`.
- **Regra de Estilo:** Em `packages/client/ui-theme/src/styles/design-platform.css`, os valores hexadecimais de `--dsw-static-deepseek-100` a `900` já foram remapeados para a escala ocre do CopyMonster (ex.: `--dsw-static-deepseek-500: rgb(216, 174, 95)`).
- **Ação de Auditoria:**
  1. Verificar componentes que possam ter herdado classes com azul direto (`#1890ff`, `#3b82f6`, `--dsw-static-blue-*`).
  2. Assegurar que botões de foco, badges (`css.previewBadge` em `EmptyHero`), links e indicadores de estado utilizem `--cm-primary` ou a escala âmbar/ouro remapeada.

#### 3.3. Assets e Marcas Gráficas
- **Ícone e Logo no Hero (`EmptyHero.tsx`)**: O componente já foi desacoplado para renderizar `<img src="/brand.png" />`. Garantir que nenhum SVG inline antigo do mascote da DeepSeek seja reintroduzido como fallback.
- **Barra Lateral (`SidebarRoot.tsx`)**: O slot `sidebar.brand.mark` deve continuar utilizando `<FishLogo size={24} />` que aponta para `/brand.png`.
- **Wordmark (`BrandWordmark.tsx`)**: Deve compor `/brand.png` e `/brand-text.png` com proporção áurea e alinhamento tipográfico.

---

### Camada 4: Automação e Proteção Anti-Regressão Upstream

Para garantir que futuras atualizações (`git pull` ou `git merge upstream`) não sobrescrevam novamente as traduções do CopyMonster, adotaremos a seguinte estratégia automatizada:

1. **Script de Rebranding Automatizado de Locales**:
   - Criação do script `scripts/apply-copymonster-locales-rebrand.mjs`.
   - O script lê os arquivos de dicionário e aplica as substituições das chaves institucionais e do hero em todos os idiomas programaticamente.
   - Adição do script ao pipeline de `postinstall` no `package.json` (executado junto com `apply-dsh-plugins-rebrand.mjs`).

2. **Gate de Auditoria e Verificação (`pnpm run check:branding`)**:
   - Criação de um verificador leve que realiza varredura no código compilado do client buscando textos proibidos em interfaces visíveis (`"探索未至之境"`, `"Para o desconhecido"`, `"Versão local do DSH"`).
   - Se qualquer texto for detectado, o gate falha com alerta descritivo indicando o arquivo e a linha a ser corrigida.

3. **Diretrizes de Preservação no Git**:
   - Registro das regras no documento de governança `docs/roadmap/fork-preservation.md`.

---

## 3. Plano de Execução Passo a Passo

### Fase 1: Correção Imediata do Hero da Home (Todos os Idiomas)
1. Abrir `packages/client/ui-conversation/src/client/locales.ts`.
2. Atualizar as chaves `'hero.headline'` e `'hero.preview'` nos 8 blocos de idioma:
   - `zh`: Headline `"文案、漏斗与发售"`, Preview `"新"`
   - `en`: Headline `"Copy, Funnels & Launches"`, Preview `"New"`
   - `ja`: Headline `"コピー、ファネル＆ローンチ"`, Preview `"New"`
   - `es`: Headline `"Copy, Embudos y Lanzamientos"`, Preview `"Nuevo"`
   - `fr`: Headline `"Copy, Tunnels & Lancements"`, Preview `"Nouveau"`
   - `de`: Headline `"Copy, Funnels & Launches"`, Preview `"Neu"`
   - `ru`: Headline `"Копирайтинг, воронки и запуски"`, Preview `"Новое"`
   - `pt`: Headline `"Copy, Funis e Lançamentos"`, Preview `"Novo"`
3. Testar a renderização do `EmptyHero` alternando o idioma nas configurações.

### Fase 2: Harmonização dos Dicionários do Client Core
1. Modificar a chave `'brand.localBuild'` para `'CopyMonster'` em todos os arquivos de `packages/client/locale/src/locales/`:
   - `pt.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`, `ru.ts`, `zh.ts`.
2. Substituir referências a "DSH" em mensagens de erro críticas:
   - `packages/client/ui-conversation/src/client/locales.ts` (`error.sessionInUse`).
   - `packages/client/ui-chat/src/client/locale.ts` (`message.failure.*`).
3. Ajustar textos institucionais em:
   - `packages/client/ui-settings-account/src/client/locales.ts`
   - `packages/client/ui-settings-models/src/client/locales.ts`
   - `packages/client/ui-plugin-manager/src/client/locales.ts`

### Fase 3: Internacionalização do Wrapper SaaS (`apps/web/`)
1. Criar `apps/web/src/locales/pt.ts` espelhando todas as chaves de `apps/web/src/locales/en.ts`.
2. Atualizar `apps/web/src/locales/index.ts` para importar e exportar `pt`, integrando a detecção automática de idioma do navegador.
3. Validar se o modal de login, cadastro, tela de planos e modal "Meu DNA" exibem textos nativos em Português.

### Fase 4: Auditoria de Cores e Estilos dos Componentes
1. Revisar o CSS do Hero (`packages/client/ui-conversation/src/client/skeleton/EmptyHero.module.css`).
2. Garantir que o badge `.previewBadge` receba a cor da marca CopyMonster (`--cm-primary` / `--dsw-static-deepseek-500`).
3. Garantir que a animação de hover do logo utilize o asset de marca sem distorção.

### Fase 5: Implementação dos Scripts de Automação Anti-Regressão
1. Desenvolver `scripts/apply-copymonster-locales-rebrand.mjs`.
2. Configurar o comando no `package.json`:
   ```json
   "rebrand:locales": "node scripts/apply-copymonster-locales-rebrand.mjs",
   "check:branding": "node scripts/check-branding.mjs"
   ```
3. Testar a idempotência: rodar o script e garantir que o `git diff` permaneça limpo após a primeira aplicação.

---

## 4. Matriz de Testes e Critérios de Aceite

| Verificação | Cenário de Teste | Critério de Sucesso |
| :--- | :--- | :--- |
| **Hero em Português** | Alterar idioma para Português em Configurações > Geral > Idioma. | A tela inicial exibe **"Copy, Funis e Lançamentos"** com o badge **"Novo"**. Nenhuma menção a "Para o desconhecido". |
| **Hero em Espanhol** | Alterar idioma para Espanhol. | Exibe **"Copy, Embudos y Lanzamientos"** com o badge **"Nuevo"**. |
| **Hero em Inglês** | Idioma em Inglês. | Mantém **"Copy, Funnels & Launches"** com o badge **"New"**. |
| **Título da Janela** | Abrir o navegador em modo anônimo sem título customizado no env. | A aba do navegador exibe **"CopyMonster"**, nunca "Versão local do DSH". |
| **Paleta de Cores** | Inspecionar elementos do Hero, Sidebar e Modais via DevTools. | Elementos de destaque utilizam tons de dourado/ocre (`#967d45` / `#d8ae5f`) e fundos quentes. Zero ocorrências de azul DeepSeek. |
| **Sessão / Erros** | Desconectar sessão ou forçar reinicialização do serviço. | Mensagens de erro orientam o usuário a recarregar o CopyMonster sem menção a termos do DSH. |
| **Gates de Build** | Executar `pnpm run build:web` e testes unitários do client. | Todos os pacotes compilam com sucesso sem quebra de referências de tipos ou chaves de tradução. |

---

## 5. Resumo e Próximos Passos Imediatos

Com a aprovação deste plano:
1. Os arquivos de dicionário da Camada 1 serão editados diretamente para corrigir o Hero e as chaves de marca.
2. O arquivo `pt.ts` do wrapper SaaS (`apps/web/`) será implementado para fechar o ciclo de experiência 100% em Português.
3. O script automatizado será registrado no pipeline para proteger o projeto contra qualquer futuro *upstream pull*.
