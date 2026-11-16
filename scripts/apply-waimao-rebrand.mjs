/**
 * Translate the dsh-waimao web pages into CopyMonster's eight languages.
 *
 * `dsh-waimao` ships its five loopback pages (`/waimao/leads`, `crm`, `review`,
 * `templates`, `settings`) with Chinese copy baked into the HTML templates and
 * `<html lang="zh-CN">`. The package declares itself zero-dependency and has no
 * locale seam, so this script updates `dsh/pages.js` in place: it injects a copy
 * table plus a small runtime that follows `?lang=` or the browser language, and
 * translates the text nodes, placeholders, titles, and aria labels.
 *
 * Entries are whole phrases, longest first, so a term is never translated inside
 * a longer sentence it belongs to.
 *
 * Protected: route paths, element ids, CSS class names, API payload keys, agent
 * tool names, and the settings keys the config API reads. Only displayed text
 * changes.
 *
 * Safe to run repeatedly: a file already carrying the table is left alone, and
 * an absent package is skipped.
 *
 * Usage:
 *   node scripts/apply-waimao-rebrand.mjs [--check]
 *   DSH_PLUGIN_ROOT=<profile-node_modules> node scripts/apply-waimao-rebrand.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** The package this script localizes. */
const PACKAGE = 'dsh-waimao';

/**
 * Every user-visible Chinese phrase on the five pages, with its translation.
 *
 * The table is applied longest first, so `谷歌获客` wins over `获客` and
 * `开始搜索` wins over `搜索`. A language without an entry reads English.
 */
const COPY = {
  // ---- titles and hero lines --------------------------------------------
  '谷歌获客 · 三层搜索 + 线索加工': {
    en: 'Google lead search · 3-layer search + enrichment',
    pt: 'Busca no Google · pesquisa em 3 camadas + enriquecimento',
    es: 'Búsqueda en Google · búsqueda en 3 capas + enriquecimiento',
    fr: 'Recherche Google · recherche en 3 couches + enrichissement',
    de: 'Google-Leadsuche · 3-stufige Suche + Anreicherung',
    ru: 'Поиск в Google · 3-уровневый поиск + обогащение',
    ja: 'Google リード検索 · 3 層検索 + リード加工',
  },
  '谷歌获客': {
    en: 'Google lead search', pt: 'Busca no Google', es: 'Búsqueda en Google',
    fr: 'Recherche Google', de: 'Google-Leadsuche', ru: 'Поиск в Google', ja: 'Google リード検索',
  },
  '按产品词和市场搜买家 → 提取联系方式 → 滤掉同行平台 → 存入 CRM。': {
    en: 'Search buyers by product term and market → extract contacts → filter out competitors and marketplaces → save to the CRM.',
    pt: 'Busque compradores por termo de produto e mercado → extraia contatos → filtre concorrentes e marketplaces → salve no CRM.',
    es: 'Busca compradores por término de producto y mercado → extrae contactos → filtra competidores y marketplaces → guarda en el CRM.',
    fr: 'Recherchez des acheteurs par terme produit et marché → extrayez les contacts → écartez concurrents et places de marché → enregistrez dans le CRM.',
    de: 'Käufer nach Produktbegriff und Markt suchen → Kontakte extrahieren → Wettbewerber und Marktplätze herausfiltern → im CRM speichern.',
    ru: 'Ищите покупателей по продукту и рынку → извлекайте контакты → отсеивайте конкурентов и маркетплейсы → сохраняйте в CRM.',
    ja: '製品名と市場で買い手を検索 → 連絡先を抽出 → 同業者・マーケットプレイスを除外 → CRM に保存します。',
  },
  'CRM 管线': { en: 'CRM pipeline', pt: 'Pipeline do CRM', es: 'Embudo del CRM', fr: 'Pipeline CRM', de: 'CRM-Pipeline', ru: 'Пайплайн CRM', ja: 'CRM パイプライン' },
  '管线': { en: 'Pipeline', pt: 'Pipeline', es: 'Embudo', fr: 'Pipeline', de: 'Pipeline', ru: 'Пайплайн', ja: 'パイプライン' },
  '新线索 → 已评估 → 已触达 → 已回复 → 已报价 → 成交/流失': {
    en: 'New → Qualified → Contacted → Replied → Quoted → Won/Lost',
    pt: 'Novo → Qualificado → Contatado → Respondido → Cotado → Ganho/Perdido',
    es: 'Nuevo → Cualificado → Contactado → Respondido → Cotizado → Ganado/Perdido',
    fr: 'Nouveau → Qualifié → Contacté → Répondu → Devisé → Gagné/Perdu',
    de: 'Neu → Qualifiziert → Kontaktiert → Geantwortet → Angeboten → Gewonnen/Verloren',
    ru: 'Новый → Оценён → Связались → Ответили → Предложение → Выигран/Потерян',
    ja: '新規 → 評価済み → 接触済み → 返信あり → 見積提出 → 受注/失注',
  },
  '客服审核台': { en: 'Customer review desk', pt: 'Central de revisão', es: 'Mesa de revisión', fr: 'Poste de révision', de: 'Kundenprüfung', ru: 'Проверка сообщений', ja: 'カスタマーレビュー' },
  '买家消息先进队列 · AI 起草 · 人工确认才发送': {
    en: 'Buyer messages queue up · AI drafts · sent only after a human confirms',
    pt: 'As mensagens dos compradores entram na fila · a IA redige · só sai após confirmação humana',
    es: 'Los mensajes de compradores entran en cola · la IA redacta · se envía solo tras confirmación humana',
    fr: 'Les messages des acheteurs sont mis en file · l’IA rédige · envoi après confirmation humaine',
    de: 'Käufernachrichten landen in der Warteschlange · die KI entwirft · Versand erst nach menschlicher Bestätigung',
    ru: 'Сообщения покупателей попадают в очередь · ИИ готовит черновик · отправка после подтверждения человеком',
    ja: '買い手のメッセージはキューに入り · AI が下書き · 人が確認してから送信します',
  },
  '邮件与报价模板': { en: 'Email and quote templates', pt: 'Modelos de e-mail e cotação', es: 'Plantillas de correo y cotización', fr: 'Modèles d’e-mail et de devis', de: 'E-Mail- und Angebotsvorlagen', ru: 'Шаблоны писем и предложений', ja: 'メールと見積のテンプレート' },
  '模板': { en: 'Templates', pt: 'Modelos', es: 'Plantillas', fr: 'Modèles', de: 'Vorlagen', ru: 'Шаблоны', ja: 'テンプレート' },
  '设置': { en: 'Settings', pt: 'Configurações', es: 'Ajustes', fr: 'Paramètres', de: 'Einstellungen', ru: 'Настройки', ja: '設定' },
  '审核台': { en: 'Review', pt: 'Revisão', es: 'Revisión', fr: 'Révision', de: 'Prüfung', ru: 'Проверка', ja: 'レビュー' },
  '获客': { en: 'Leads', pt: 'Leads', es: 'Leads', fr: 'Prospects', de: 'Leads', ru: 'Лиды', ja: 'リード' },

  // ---- leads page --------------------------------------------------------
  '搜索公式：': { en: 'Search formula: ', pt: 'Fórmula de busca: ', es: 'Fórmula de búsqueda: ', fr: 'Formule de recherche : ', de: 'Suchformel: ', ru: 'Формула поиска: ', ja: '検索式: ' },
  '欧美市场加 LinkedIn 层走邮件，亚非拉市场走 WhatsApp': {
    en: 'Western markets add the LinkedIn layer and use email; Asia, Africa, and Latin America use WhatsApp',
    pt: 'Mercados ocidentais somam a camada LinkedIn e usam e-mail; Ásia, África e América Latina usam WhatsApp',
    es: 'Los mercados occidentales añaden la capa LinkedIn y usan correo; Asia, África y Latinoamérica usan WhatsApp',
    fr: 'Les marchés occidentaux ajoutent la couche LinkedIn et utilisent l’e-mail ; l’Asie, l’Afrique et l’Amérique latine utilisent WhatsApp',
    de: 'Westliche Märkte nutzen zusätzlich die LinkedIn-Ebene und E-Mail; Asien, Afrika und Lateinamerika nutzen WhatsApp',
    ru: 'Западные рынки добавляют уровень LinkedIn и используют почту; Азия, Африка и Латинская Америка — WhatsApp',
    ja: '欧米市場は LinkedIn 層を追加してメールを使い、アジア・アフリカ・中南米は WhatsApp を使います',
  },
  '开始搜索': { en: 'Start search', pt: 'Iniciar busca', es: 'Iniciar búsqueda', fr: 'Lancer la recherche', de: 'Suche starten', ru: 'Начать поиск', ja: '検索を開始' },
  '搜索中': { en: 'Searching', pt: 'Pesquisando', es: 'Buscando', fr: 'Recherche en cours', de: 'Suche läuft', ru: 'Поиск', ja: '検索中' },
  '搜索失败': { en: 'Search failed', pt: 'A busca falhou', es: 'La búsqueda falló', fr: 'La recherche a échoué', de: 'Suche fehlgeschlagen', ru: 'Поиск не удался', ja: '検索に失敗しました' },
  '搜索完成：': { en: 'Search finished: ', pt: 'Busca concluída: ', es: 'Búsqueda finalizada: ', fr: 'Recherche terminée : ', de: 'Suche abgeschlossen: ', ru: 'Поиск завершён: ', ja: '検索完了: ' },
  ' 条结果': { en: ' results', pt: ' resultados', es: ' resultados', fr: ' résultats', de: ' Ergebnisse', ru: ' результатов', ja: ' 件' },
  '逐层搜索中…': { en: 'Searching layer by layer…', pt: 'Pesquisando camada por camada…', es: 'Buscando capa por capa…', fr: 'Recherche couche par couche…', de: 'Suche Ebene für Ebene…', ru: 'Поиск по уровням…', ja: '層ごとに検索中…' },
  '引擎失败自动切换（failover 链）': {
    en: 'Switches engines automatically when one fails (failover chain)',
    pt: 'Troca de motor automaticamente quando um falha (cadeia de failover)',
    es: 'Cambia de motor automáticamente si uno falla (cadena de failover)',
    fr: 'Change de moteur automatiquement en cas d’échec (chaîne de bascule)',
    de: 'Wechselt bei Fehlschlag automatisch den Anbieter (Failover-Kette)',
    ru: 'Автоматически переключает движок при сбое (цепочка failover)',
    ja: 'エンジンが失敗すると自動で切り替えます（フェイルオーバー）',
  },
  '产品关键词（英文）': { en: 'Product keyword (English)', pt: 'Palavra-chave do produto (inglês)', es: 'Palabra clave del producto (inglés)', fr: 'Mot-clé produit (anglais)', de: 'Produktschlüsselwort (Englisch)', ru: 'Ключевое слово продукта (англ.)', ja: '製品キーワード（英語）' },
  '目标市场': { en: 'Target market', pt: 'Mercado-alvo', es: 'Mercado objetivo', fr: 'Marché cible', de: 'Zielmarkt', ru: 'Целевой рынок', ja: 'ターゲット市場' },
  '搜索层级': { en: 'Search layers', pt: 'Camadas de busca', es: 'Capas de búsqueda', fr: 'Couches de recherche', de: 'Suchebenen', ru: 'Уровни поиска', ja: '検索層' },
  '三层全叠加（最精）': { en: 'All three layers (most precise)', pt: 'As três camadas (mais preciso)', es: 'Las tres capas (más preciso)', fr: 'Les trois couches (le plus précis)', de: 'Alle drei Ebenen (präziseste)', ru: 'Все три уровня (точнее всего)', ja: '3 層すべて（最も精度重視）' },
  '基础+采购信号': { en: 'Base + buying signals', pt: 'Base + sinais de compra', es: 'Base + señales de compra', fr: 'Base + signaux d’achat', de: 'Basis + Kaufsignale', ru: 'База + сигналы покупки', ja: '基本 + 購買シグナル' },
  '第1层·基础搜索': { en: 'Layer 1 · base search', pt: 'Camada 1 · busca básica', es: 'Capa 1 · búsqueda base', fr: 'Couche 1 · recherche de base', de: 'Ebene 1 · Basissuche', ru: 'Уровень 1 · базовый поиск', ja: '第 1 層 · 基本検索' },
  '第2层·LinkedIn 定位': { en: 'Layer 2 · LinkedIn targeting', pt: 'Camada 2 · segmentação LinkedIn', es: 'Capa 2 · segmentación LinkedIn', fr: 'Couche 2 · ciblage LinkedIn', de: 'Ebene 2 · LinkedIn-Targeting', ru: 'Уровень 2 · таргетинг LinkedIn', ja: '第 2 層 · LinkedIn ターゲティング' },
  '第3层·采购信号': { en: 'Layer 3 · buying signals', pt: 'Camada 3 · sinais de compra', es: 'Capa 3 · señales de compra', fr: 'Couche 3 · signaux d’achat', de: 'Ebene 3 · Kaufsignale', ru: 'Уровень 3 · сигналы покупки', ja: '第 3 層 · 購買シグナル' },
  '每层条数': { en: 'Results per layer', pt: 'Resultados por camada', es: 'Resultados por capa', fr: 'Résultats par couche', de: 'Ergebnisse je Ebene', ru: 'Результатов на уровень', ja: '各層の件数' },
  '引擎': { en: 'Engine', pt: 'Motor', es: 'Motor', fr: 'Moteur', de: 'Suchanbieter', ru: 'Движок', ja: 'エンジン' },
  '自动(failover)': { en: 'Auto (failover)', pt: 'Automático (failover)', es: 'Automático (failover)', fr: 'Automatique (bascule)', de: 'Automatisch (Failover)', ru: 'Авто (failover)', ja: '自動（フェイルオーバー）' },
  '仅生成公式': { en: 'Formula only', pt: 'Somente fórmula', es: 'Solo fórmula', fr: 'Formule seulement', de: 'Nur Formel', ru: 'Только формула', ja: '検索式のみ' },
  '线索加工': { en: 'Lead enrichment', pt: 'Enriquecimento de leads', es: 'Enriquecimiento de leads', fr: 'Enrichissement des prospects', de: 'Lead-Anreicherung', ru: 'Обогащение лидов', ja: 'リード加工' },
  '提取联系方式，滤掉同行，评分后入库': {
    en: 'Extract contacts, filter out competitors, score, then save',
    pt: 'Extraia contatos, filtre concorrentes, pontue e salve',
    es: 'Extrae contactos, filtra competidores, puntúa y guarda',
    fr: 'Extrayez les contacts, écartez les concurrents, notez puis enregistrez',
    de: 'Kontakte extrahieren, Wettbewerber filtern, bewerten, dann speichern',
    ru: 'Извлеките контакты, отфильтруйте конкурентов, оцените и сохраните',
    ja: '連絡先を抽出し、同業者を除外し、スコアを付けて保存します',
  },
  'AI 评分': { en: 'AI scoring', pt: 'Pontuação por IA', es: 'Puntuación por IA', fr: 'Notation par IA', de: 'KI-Bewertung', ru: 'Оценка ИИ', ja: 'AI スコアリング' },
  '抓取网页提取联系方式': {
    en: 'Fetch pages to extract contacts',
    pt: 'Buscar páginas para extrair contatos',
    es: 'Rastrear páginas para extraer contactos',
    fr: 'Récupérer les pages pour extraire les contacts',
    de: 'Seiten abrufen, um Kontakte zu extrahieren',
    ru: 'Загружать страницы для извлечения контактов',
    ja: 'ページを取得して連絡先を抽出',
  },
  '提取 + 过滤 + 评分 + 入库': {
    en: 'Extract + filter + score + save',
    pt: 'Extrair + filtrar + pontuar + salvar',
    es: 'Extraer + filtrar + puntuar + guardar',
    fr: 'Extraire + filtrer + noter + enregistrer',
    de: 'Extrahieren + filtern + bewerten + speichern',
    ru: 'Извлечь + фильтровать + оценить + сохранить',
    ja: '抽出 + 絞り込み + スコア + 保存',
  },
  '加工中': { en: 'Enriching', pt: 'Enriquecendo', es: 'Enriqueciendo', fr: 'Enrichissement', de: 'Anreicherung läuft', ru: 'Обогащение', ja: '加工中' },
  '排除项（同行/平台）不会入库': {
    en: 'Excluded entries (competitors, marketplaces) are not saved',
    pt: 'Itens excluídos (concorrentes, marketplaces) não são salvos',
    es: 'Las entradas excluidas (competidores, marketplaces) no se guardan',
    fr: 'Les entrées exclues (concurrents, places de marché) ne sont pas enregistrées',
    de: 'Ausgeschlossene Einträge (Wettbewerber, Marktplätze) werden nicht gespeichert',
    ru: 'Исключённые записи (конкуренты, маркетплейсы) не сохраняются',
    ja: '除外対象（同業者・マーケットプレイス）は保存されません',
  },
  '请输入产品关键词': { en: 'Enter a product keyword', pt: 'Informe uma palavra-chave do produto', es: 'Introduce una palabra clave del producto', fr: 'Saisissez un mot-clé produit', de: 'Geben Sie ein Produktschlüsselwort ein', ru: 'Введите ключевое слово продукта', ja: '製品キーワードを入力してください' },
  '先跑一次搜索': { en: 'Run a search first', pt: 'Faça uma busca primeiro', es: 'Ejecuta una búsqueda primero', fr: 'Lancez d’abord une recherche', de: 'Starten Sie zuerst eine Suche', ru: 'Сначала запустите поиск', ja: '先に検索を実行してください' },
  '加工完成，': { en: 'Enrichment done, ', pt: 'Enriquecimento concluído, ', es: 'Enriquecimiento finalizado, ', fr: 'Enrichissement terminé, ', de: 'Anreicherung fertig, ', ru: 'Обогащение завершено, ', ja: '加工完了、' },
  ' 条入库': { en: ' saved', pt: ' salvos', es: ' guardados', fr: ' enregistrés', de: ' gespeichert', ru: ' сохранено', ja: ' 件を保存' },
  '本层无结果': { en: 'No results in this layer', pt: 'Sem resultados nesta camada', es: 'Sin resultados en esta capa', fr: 'Aucun résultat dans cette couche', de: 'Keine Ergebnisse in dieser Ebene', ru: 'На этом уровне нет результатов', ja: 'この層に結果はありません' },
  '去重后结果': { en: 'Deduplicated results', pt: 'Resultados sem duplicatas', es: 'Resultados sin duplicados', fr: 'Résultats dédoublonnés', de: 'Ergebnisse ohne Duplikate', ru: 'Результатов без дублей', ja: '重複除去後の件数' },
  '执行层数': { en: 'Layers run', pt: 'Camadas executadas', es: 'Capas ejecutadas', fr: 'Couches exécutées', de: 'Ausgeführte Ebenen', ru: 'Выполнено уровней', ja: '実行した層' },
  '市场': { en: 'Market', pt: 'Mercado', es: 'Mercado', fr: 'Marché', de: 'Markt', ru: 'Рынок', ja: '市場' },
  '引擎切换: ': { en: 'Engine switch: ', pt: 'Troca de motor: ', es: 'Cambio de motor: ', fr: 'Changement de moteur : ', de: 'Anbieterwechsel: ', ru: 'Смена движка: ', ja: 'エンジン切替: ' },
  '第': { en: 'Layer ', pt: 'Camada ', es: 'Capa ', fr: 'Couche ', de: 'Ebene ', ru: 'Уровень ', ja: '第' },
  '层 · ': { en: ' · ', pt: ' · ', es: ' · ', fr: ' · ', de: ' · ', ru: ' · ', ja: ' 層 · ' },
  '错误: ': { en: 'Error: ', pt: 'Erro: ', es: 'Error: ', fr: 'Erreur : ', de: 'Fehler: ', ru: 'Ошибка: ', ja: 'エラー: ' },
  '对口': { en: 'Good fit', pt: 'Bom encaixe', es: 'Buen encaje', fr: 'Bon profil', de: 'Passt gut', ru: 'Подходит', ja: '適合' },
  '沾边': { en: 'Partial fit', pt: 'Encaixe parcial', es: 'Encaje parcial', fr: 'Profil partiel', de: 'Teilweise passend', ru: 'Частично', ja: '一部適合' },
  '不对口': { en: 'Poor fit', pt: 'Encaixe ruim', es: 'Mal encaje', fr: 'Mauvais profil', de: 'Passt nicht', ru: 'Не подходит', ja: '不適合' },
  'CRM合并': { en: 'Merged in CRM', pt: 'Mesclado no CRM', es: 'Fusionado en CRM', fr: 'Fusionné au CRM', de: 'Im CRM zusammengeführt', ru: 'Объединено в CRM', ja: 'CRM で統合' },
  '已入库': { en: 'Saved', pt: 'Salvo', es: 'Guardado', fr: 'Enregistré', de: 'Gespeichert', ru: 'Сохранено', ja: '保存済み' },
  '未提取到联系方式': { en: 'No contacts found', pt: 'Nenhum contato encontrado', es: 'No se encontraron contactos', fr: 'Aucun contact trouvé', de: 'Keine Kontakte gefunden', ru: 'Контакты не найдены', ja: '連絡先が見つかりません' },
  '已复制 ': { en: 'Copied ', pt: 'Copiado ', es: 'Copiado ', fr: 'Copié ', de: 'Kopiert: ', ru: 'Скопировано ', ja: 'コピーしました ' },
  ' 条链接': { en: ' links', pt: ' links', es: ' enlaces', fr: ' liens', de: ' Links', ru: ' ссылок', ja: ' 件のリンク' },

  // ---- CRM page ----------------------------------------------------------
  '管线分布': { en: 'Pipeline breakdown', pt: 'Distribuição do pipeline', es: 'Distribución del embudo', fr: 'Répartition du pipeline', de: 'Pipeline-Verteilung', ru: 'Распределение пайплайна', ja: 'パイプラインの内訳' },
  '转化漏斗': { en: 'Conversion funnel', pt: 'Funil de conversão', es: 'Embudo de conversión', fr: 'Entonnoir de conversion', de: 'Conversion-Funnel', ru: 'Воронка конверсии', ja: 'コンバージョンファネル' },
  '分层 × 回复率': { en: 'Tier × reply rate', pt: 'Nível × taxa de resposta', es: 'Nivel × tasa de respuesta', fr: 'Niveau × taux de réponse', de: 'Stufe × Antwortrate', ru: 'Уровень × доля ответов', ja: '階層 × 返信率' },
  '触达量': { en: 'Outreach volume', pt: 'Volume de contato', es: 'Volumen de contacto', fr: 'Volume de contact', de: 'Kontaktvolumen', ru: 'Объём обращений', ja: '接触量' },
  '审计日志推导': { en: 'derived from the audit log', pt: 'derivado do log de auditoria', es: 'derivado del registro de auditoría', fr: 'dérivé du journal d’audit', de: 'aus dem Prüfprotokoll abgeleitet', ru: 'по журналу аудита', ja: '監査ログから算出' },
  '线索库': { en: 'Lead library', pt: 'Biblioteca de leads', es: 'Biblioteca de leads', fr: 'Bibliothèque de prospects', de: 'Lead-Bibliothek', ru: 'База лидов', ja: 'リード一覧' },
  '看板卡片可拖拽换阶段 · 勾选可批量操作': {
    en: 'Drag board cards to change stage · select rows for bulk actions',
    pt: 'Arraste os cartões do quadro para mudar de etapa · selecione linhas para ações em massa',
    es: 'Arrastra las tarjetas del tablero para cambiar de etapa · selecciona filas para acciones masivas',
    fr: 'Glissez les cartes du tableau pour changer d’étape · sélectionnez des lignes pour agir en masse',
    de: 'Board-Karten ziehen, um die Phase zu ändern · Zeilen für Sammelaktionen auswählen',
    ru: 'Перетаскивайте карточки доски, чтобы сменить этап · отмечайте строки для массовых действий',
    ja: 'ボードのカードをドラッグして段階を変更 · 行を選んで一括操作できます',
  },
  '搜索 公司/域名/邮箱/WA…': {
    en: 'Search company / domain / email / WhatsApp…',
    pt: 'Buscar empresa / domínio / e-mail / WhatsApp…',
    es: 'Buscar empresa / dominio / correo / WhatsApp…',
    fr: 'Rechercher société / domaine / e-mail / WhatsApp…',
    de: 'Firma / Domain / E-Mail / WhatsApp suchen…',
    ru: 'Искать компанию / домен / почту / WhatsApp…',
    ja: '会社 / ドメイン / メール / WhatsApp を検索…',
  },
  '全部分层': { en: 'All tiers', pt: 'Todos os níveis', es: 'Todos los niveles', fr: 'Tous les niveaux', de: 'Alle Stufen', ru: 'Все уровни', ja: 'すべての階層' },
  '极高': { en: 'Very high', pt: 'Muito alto', es: 'Muy alto', fr: 'Très élevé', de: 'Sehr hoch', ru: 'Очень высокий', ja: '極高' },
  '高': { en: 'High', pt: 'Alto', es: 'Alto', fr: 'Élevé', de: 'Hoch', ru: 'Высокий', ja: '高' },
  '中': { en: 'Medium', pt: 'Médio', es: 'Medio', fr: 'Moyen', de: 'Mittel', ru: 'Средний', ja: '中' },
  '低': { en: 'Low', pt: 'Baixo', es: 'Bajo', fr: 'Faible', de: 'Niedrig', ru: 'Низкий', ja: '低' },
  '看板': { en: 'Board', pt: 'Quadro', es: 'Tablero', fr: 'Tableau', de: 'Board', ru: 'Доска', ja: 'ボード' },
  '列表': { en: 'List', pt: 'Lista', es: 'Lista', fr: 'Liste', de: 'Liste', ru: 'Список', ja: 'リスト' },
  '导出 CSV': { en: 'Export CSV', pt: 'Exportar CSV', es: 'Exportar CSV', fr: 'Exporter CSV', de: 'CSV exportieren', ru: 'Экспорт CSV', ja: 'CSV を書き出す' },
  '导出 vCard': { en: 'Export vCard', pt: 'Exportar vCard', es: 'Exportar vCard', fr: 'Exporter vCard', de: 'vCard exportieren', ru: 'Экспорт vCard', ja: 'vCard を書き出す' },
  '定价计算器': { en: 'Price calculator', pt: 'Calculadora de preços', es: 'Calculadora de precios', fr: 'Calculateur de prix', de: 'Preisrechner', ru: 'Калькулятор цен', ja: '価格計算ツール' },
  '导入': { en: 'Import', pt: 'Importar', es: 'Importar', fr: 'Importer', de: 'Importieren', ru: 'Импорт', ja: 'インポート' },
  '已选': { en: 'Selected', pt: 'Selecionados', es: 'Seleccionados', fr: 'Sélectionnés', de: 'Ausgewählt', ru: 'Выбрано', ja: '選択中' },
  ' 条': { en: ' ', pt: ' ', es: ' ', fr: ' ', de: ' ', ja: ' 件' },
  '改状态为…': { en: 'Change status to…', pt: 'Alterar status para…', es: 'Cambiar estado a…', fr: 'Changer le statut en…', de: 'Status ändern auf…', ru: 'Изменить статус на…', ja: 'ステータスを変更…' },
  '新线索': { en: 'New', pt: 'Novo', es: 'Nuevo', fr: 'Nouveau', de: 'Neu', ru: 'Новый', ja: '新規' },
  '已评估': { en: 'Qualified', pt: 'Qualificado', es: 'Cualificado', fr: 'Qualifié', de: 'Qualifiziert', ru: 'Оценён', ja: '評価済み' },
  '已触达': { en: 'Contacted', pt: 'Contatado', es: 'Contactado', fr: 'Contacté', de: 'Kontaktiert', ru: 'Связались', ja: '接触済み' },
  '已回复': { en: 'Replied', pt: 'Respondido', es: 'Respondido', fr: 'Répondu', de: 'Geantwortet', ru: 'Ответили', ja: '返信あり' },
  '已报价': { en: 'Quoted', pt: 'Cotado', es: 'Cotizado', fr: 'Devisé', de: 'Angeboten', ru: 'Предложение', ja: '見積提出' },
  '已成交': { en: 'Won', pt: 'Ganho', es: 'Ganado', fr: 'Gagné', de: 'Gewonnen', ru: 'Выигран', ja: '受注' },
  '已流失': { en: 'Lost', pt: 'Perdido', es: 'Perdido', fr: 'Perdu', de: 'Verloren', ru: 'Потерян', ja: '失注' },
  '应用': { en: 'Apply', pt: 'Aplicar', es: 'Aplicar', fr: 'Appliquer', de: 'Anwenden', ru: 'Применить', ja: '適用' },
  '停止序列': { en: 'Stop sequence', pt: 'Parar sequência', es: 'Detener secuencia', fr: 'Arrêter la séquence', de: 'Sequenz stoppen', ru: 'Остановить серию', ja: 'シーケンス停止' },
  '取消选择': { en: 'Clear selection', pt: 'Limpar seleção', es: 'Limpiar selección', fr: 'Effacer la sélection', de: 'Auswahl aufheben', ru: 'Снять выбор', ja: '選択を解除' },
  '详情': { en: 'Details', pt: 'Detalhes', es: 'Detalles', fr: 'Détails', de: 'Details', ru: 'Подробности', ja: '詳細' },
  '回复率': { en: 'Reply rate', pt: 'Taxa de resposta', es: 'Tasa de respuesta', fr: 'Taux de réponse', de: 'Antwortrate', ru: 'Доля ответов', ja: '返信率' },
  '成交': { en: 'Won', pt: 'Ganho', es: 'Ganado', fr: 'Gagné', de: 'Gewonnen', ru: 'Выигран', ja: '受注' },
  '触达': { en: 'Contacted', pt: 'Contatados', es: 'Contactados', fr: 'Contactés', de: 'Kontaktiert', ru: 'Обращения', ja: '接触' },
  '回复': { en: 'Replies', pt: 'Respostas', es: 'Respuestas', fr: 'Réponses', de: 'Antworten', ru: 'Ответы', ja: '返信' },
  '报价': { en: 'Quoted', pt: 'Cotações', es: 'Cotizaciones', fr: 'Devis', de: 'Angebote', ru: 'Предложения', ja: '見積' },
  '线索': { en: 'Leads', pt: 'Leads', es: 'Leads', fr: 'Prospects', de: 'Leads', ru: 'Лиды', ja: 'リード' },
  '暂无线索': { en: 'No leads yet', pt: 'Ainda sem leads', es: 'Aún sin leads', fr: 'Aucun prospect', de: 'Noch keine Leads', ru: 'Лидов пока нет', ja: 'リードはまだありません' },
  '暂无触达数据': { en: 'No outreach data yet', pt: 'Ainda sem dados de contato', es: 'Aún sin datos de contacto', fr: 'Aucune donnée de contact', de: 'Noch keine Kontaktdaten', ru: 'Данных об обращениях нет', ja: '接触データはまだありません' },
  '空': { en: 'Empty', pt: 'Vazio', es: 'Vacío', fr: 'Vide', de: 'Leer', ru: 'Пусто', ja: '空' },
  '成交，恭喜': { en: 'Won, congratulations', pt: 'Ganho, parabéns', es: 'Ganado, enhorabuena', fr: 'Gagné, félicitations', de: 'Gewonnen, herzlichen Glückwunsch', ru: 'Выигран, поздравляем', ja: '受注、おめでとうございます' },
  '导入完成：新增 ': { en: 'Import done: ', pt: 'Importação concluída: ', es: 'Importación finalizada: ', fr: 'Import terminé : ', de: 'Import fertig: ', ru: 'Импорт завершён: ', ja: 'インポート完了: ' },
  '，合并 ': { en: ' added, ', pt: ' adicionados, ', es: ' añadidos, ', fr: ' ajoutés, ', de: ' neu, ', ru: ' новых, ', ja: ' 件追加、' },
  '批量完成 ': { en: 'Bulk action done: ', pt: 'Ação em massa concluída: ', es: 'Acción masiva finalizada: ', fr: 'Action groupée terminée : ', de: 'Sammelaktion fertig: ', ru: 'Массовое действие готово: ', ja: '一括操作完了: ' },
  '已保存': { en: 'Saved', pt: 'Salvo', es: 'Guardado', fr: 'Enregistré', de: 'Gespeichert', ru: 'Сохранено', ja: '保存しました' },
  '保存中…': { en: 'Saving…', pt: 'Salvando…', es: 'Guardando…', fr: 'Enregistrement…', de: 'Speichern…', ru: 'Сохранение…', ja: '保存中…' },
  '保存全部': { en: 'Save all', pt: 'Salvar tudo', es: 'Guardar todo', fr: 'Tout enregistrer', de: 'Alle speichern', ru: 'Сохранить всё', ja: 'すべて保存' },
  '已保存 ✓': { en: 'Saved ✓', pt: 'Salvo ✓', es: 'Guardado ✓', fr: 'Enregistré ✓', de: 'Gespeichert ✓', ru: 'Сохранено ✓', ja: '保存しました ✓' },
  '加载中…': { en: 'Loading…', pt: 'Carregando…', es: 'Cargando…', fr: 'Chargement…', de: 'Laden…', ru: 'Загрузка…', ja: '読み込み中…' },
  '序列已启动 Day0/3/7/14': {
    en: 'Sequence started · Day 0/3/7/14',
    pt: 'Sequência iniciada · Dia 0/3/7/14',
    es: 'Secuencia iniciada · Día 0/3/7/14',
    fr: 'Séquence démarrée · Jour 0/3/7/14',
    de: 'Sequenz gestartet · Tag 0/3/7/14',
    ru: 'Серия запущена · День 0/3/7/14',
    ja: 'シーケンス開始 · Day 0/3/7/14',
  },

  // ---- review page -------------------------------------------------------
  '先写回复（可先 AI 草稿）': {
    en: 'Write a reply first (AI draft available)',
    pt: 'Escreva uma resposta primeiro (rascunho de IA disponível)',
    es: 'Escribe una respuesta primero (hay borrador de IA)',
    fr: 'Rédigez d’abord une réponse (brouillon IA disponible)',
    de: 'Zuerst eine Antwort schreiben (KI-Entwurf verfügbar)',
    ru: 'Сначала напишите ответ (есть черновик ИИ)',
    ja: '先に返信を書いてください（AI 下書き可）',
  },
  '草稿已存盘': { en: 'Draft saved', pt: 'Rascunho salvo', es: 'Borrador guardado', fr: 'Brouillon enregistré', de: 'Entwurf gespeichert', ru: 'Черновик сохранён', ja: '下書きを保存しました' },
  '已发送': { en: 'Sent', pt: 'Enviado', es: 'Enviado', fr: 'Envoyé', de: 'Gesendet', ru: 'Отправлено', ja: '送信済み' },
  '队列为空。 Evolution webhook → /waimao/webhook/evolution?token=…，或让智能体调用 wa_sync 拉取。': {
    en: 'Queue is empty. Point the Evolution webhook at /waimao/webhook/evolution?token=…, or ask the agent to call wa_sync.',
    pt: 'A fila está vazia. Aponte o webhook do Evolution para /waimao/webhook/evolution?token=…, ou peça ao agente para chamar wa_sync.',
    es: 'La cola está vacía. Apunta el webhook de Evolution a /waimao/webhook/evolution?token=…, o pide al agente que llame a wa_sync.',
    fr: 'La file est vide. Pointez le webhook Evolution vers /waimao/webhook/evolution?token=…, ou demandez à l’agent d’appeler wa_sync.',
    de: 'Die Warteschlange ist leer. Richten Sie den Evolution-Webhook auf /waimao/webhook/evolution?token=…, oder lassen Sie den Agenten wa_sync aufrufen.',
    ru: 'Очередь пуста. Направьте вебхук Evolution на /waimao/webhook/evolution?token=… или попросите агента вызвать wa_sync.',
    ja: 'キューは空です。Evolution の webhook を /waimao/webhook/evolution?token=… に向けるか、エージェントに wa_sync を呼ばせてください。',
  },

  // ---- settings page -----------------------------------------------------
  '配置写入 ~/.waimao/config.json · 密钥只写不读 · 每个区块可单独测试连通': {
    en: 'Configuration is written to ~/.waimao/config.json · Secrets are write-only · Each section can be tested on its own',
    pt: 'A configuração é gravada em ~/.waimao/config.json · Segredos são somente escrita · Cada seção pode ser testada isoladamente',
    es: 'La configuración se guarda en ~/.waimao/config.json · Los secretos son solo escritura · Cada sección se prueba por separado',
    fr: 'La configuration est écrite dans ~/.waimao/config.json · Les secrets sont en écriture seule · Chaque section se teste séparément',
    de: 'Die Konfiguration wird in ~/.waimao/config.json geschrieben · Geheimnisse sind nur schreibbar · Jeder Abschnitt ist einzeln testbar',
    ru: 'Конфигурация записывается в ~/.waimao/config.json · Секреты только для записи · Каждый раздел проверяется отдельно',
    ja: '設定は ~/.waimao/config.json に書き込まれます · シークレットは書き込み専用 · 各セクションを個別にテストできます',
  },
  '测试连通': { en: 'Test connection', pt: 'Testar conexão', es: 'Probar conexión', fr: 'Tester la connexion', de: 'Verbindung testen', ru: 'Проверить связь', ja: '接続テスト' },
  '测试中': { en: 'Testing', pt: 'Testando', es: 'Probando', fr: 'Test en cours', de: 'Test läuft', ru: 'Проверка', ja: 'テスト中' },
  '请求中': { en: 'Requesting', pt: 'Solicitando', es: 'Solicitando', fr: 'Demande en cours', de: 'Anfrage läuft', ru: 'Запрос', ja: '要求中' },
  '连通 ✓': { en: 'connected ✓', pt: 'conectado ✓', es: 'conectado ✓', fr: 'connecté ✓', de: 'verbunden ✓', ru: 'подключено ✓', ja: '接続済み ✓' },
  ' 连接失败': { en: 'connection failed', pt: 'falha na conexão', es: 'falló la conexión', fr: 'échec de la connexion', de: 'Verbindung fehlgeschlagen', ru: 'ошибка подключения', ja: '接続に失敗しました' },
  '失败': { en: 'failed', pt: 'falhou', es: 'falló', fr: 'échec', de: 'fehlgeschlagen', ru: 'ошибка', ja: '失敗' },
  '扫码接入 WhatsApp': { en: 'Connect WhatsApp by QR', pt: 'Conectar WhatsApp por QR', es: 'Conectar WhatsApp por QR', fr: 'Connecter WhatsApp par QR', de: 'WhatsApp per QR verbinden', ru: 'Подключить WhatsApp по QR', ja: 'QR で WhatsApp を接続' },
  '已连接': { en: 'Connected', pt: 'Conectado', es: 'Conectado', fr: 'Connecté', de: 'Verbunden', ru: 'Подключено', ja: '接続済み' },
  '等待扫码': { en: 'Waiting for scan', pt: 'Aguardando leitura', es: 'Esperando escaneo', fr: 'En attente du scan', de: 'Warte auf Scan', ru: 'Ожидание сканирования', ja: 'スキャンを待っています' },
  'WhatsApp 已连接': { en: 'WhatsApp connected', pt: 'WhatsApp conectado', es: 'WhatsApp conectado', fr: 'WhatsApp connecté', de: 'WhatsApp verbunden', ru: 'WhatsApp подключён', ja: 'WhatsApp を接続しました' },
  '配对码: ': { en: 'Pairing code: ', pt: 'Código de pareamento: ', es: 'Código de emparejamiento: ', fr: 'Code d’appairage : ', de: 'Kopplungscode: ', ru: 'Код сопряжения: ', ja: 'ペアリングコード: ' },
  'WhatsApp → 设置 → 已关联的设备 → 关联设备': {
    en: 'WhatsApp → Settings → Linked devices → Link a device',
    pt: 'WhatsApp → Configurações → Dispositivos conectados → Conectar dispositivo',
    es: 'WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo',
    fr: 'WhatsApp → Paramètres → Appareils connectés → Connecter un appareil',
    de: 'WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät verknüpfen',
    ru: 'WhatsApp → Настройки → Связанные устройства → Привязать устройство',
    ja: 'WhatsApp → 設定 → リンク済みの端末 → 端末をリンク',
  },
  '已设置，留空保持不变': {
    en: 'Already set; leave blank to keep',
    pt: 'Já definido; deixe em branco para manter',
    es: 'Ya definido; déjalo vacío para mantenerlo',
    fr: 'Déjà défini ; laissez vide pour conserver',
    de: 'Bereits gesetzt; leer lassen zum Behalten',
    ru: 'Уже задано; оставьте пустым, чтобы сохранить',
    ja: '設定済み。空欄のままにすると維持されます',
  },

  // ---- settings: section titles -----------------------------------------
  'ICP 画像': { en: 'ICP profile', pt: 'Perfil de ICP', es: 'Perfil de ICP', fr: 'Profil ICP', de: 'ICP-Profil', ru: 'Профиль ICP', ja: 'ICP プロファイル' },
  'SERP 搜索': { en: 'SERP search', pt: 'Busca SERP', es: 'Búsqueda SERP', fr: 'Recherche SERP', de: 'SERP-Suche', ru: 'Поиск SERP', ja: 'SERP 検索' },
  'SMTP 发信': { en: 'SMTP sending', pt: 'Envio SMTP', es: 'Envío SMTP', fr: 'Envoi SMTP', de: 'SMTP-Versand', ru: 'Отправка SMTP', ja: 'SMTP 送信' },
  'IMAP 回复检测': { en: 'IMAP reply detection', pt: 'Detecção de respostas IMAP', es: 'Detección de respuestas IMAP', fr: 'Détection des réponses IMAP', de: 'IMAP-Antworten', ru: 'Проверка ответов IMAP', ja: 'IMAP 返信検出' },
  '打开/点击追踪': { en: 'Open/click tracking', pt: 'Rastreamento de abertura/clique', es: 'Seguimiento de apertura/clic', fr: 'Suivi des ouvertures/clics', de: 'Öffnungs-/Klick-Tracking', ru: 'Отслеживание открытий/кликов', ja: '開封・クリック追跡' },
  '邮箱预热': { en: 'Mailbox warmup', pt: 'Aquecimento de caixa', es: 'Calentamiento de buzón', fr: 'Réchauffement de boîte', de: 'Postfach-Aufwärmung', ru: 'Прогрев почты', ja: 'メールボックス预热' },
  '定时任务': { en: 'Scheduled jobs', pt: 'Tarefas agendadas', es: 'Tareas programadas', fr: 'Tâches planifiées', de: 'Geplante Aufgaben', ru: 'Запланированные задачи', ja: '定期タスク' },
  '群发频控': { en: 'Broadcast limits', pt: 'Limites de disparo', es: 'Límites de envío masivo', fr: 'Limites d’envoi groupé', de: 'Versandlimits', ru: 'Лимиты рассылки', ja: '一斉送信の制限' },
  '模型': { en: 'Model', pt: 'Modelo', es: 'Modelo', fr: 'Modèle', de: 'Modell', ru: 'Модель', ja: 'モデル' },
  '代理 (http://127.0.0.1:7890)': { en: 'Proxy (http://127.0.0.1:7890)', pt: 'Proxy (http://127.0.0.1:7890)', es: 'Proxy (http://127.0.0.1:7890)', fr: 'Proxy (http://127.0.0.1:7890)', de: 'Proxy (http://127.0.0.1:7890)', ru: 'Прокси (http://127.0.0.1:7890)', ja: 'プロキシ (http://127.0.0.1:7890)' },
  '公网入口 (反代到 127.0.0.1:3080)': {
    en: 'Public entry (reverse-proxied to 127.0.0.1:3080)',
    pt: 'Entrada pública (via proxy reverso para 127.0.0.1:3080)',
    es: 'Entrada pública (con proxy inverso a 127.0.0.1:3080)',
    fr: 'Entrée publique (proxy inverse vers 127.0.0.1:3080)',
    de: 'Öffentlicher Einstieg (Reverse-Proxy auf 127.0.0.1:3080)',
    ru: 'Публичный вход (через прокси на 127.0.0.1:3080)',
    ja: '公開エントリ（127.0.0.1:3080 へリバースプロキシ）',
  },
  '我方产品（一句英文，如 professional hair dryers 1800-2400W）': {
    en: 'Our product (one English sentence, e.g. professional hair dryers 1800-2400W)',
    pt: 'Nosso produto (uma frase em inglês, ex.: professional hair dryers 1800-2400W)',
    es: 'Nuestro producto (una frase en inglés, ej.: professional hair dryers 1800-2400W)',
    fr: 'Notre produit (une phrase en anglais, ex. : professional hair dryers 1800-2400W)',
    de: 'Unser Produkt (ein englischer Satz, z. B. professional hair dryers 1800-2400W)',
    ru: 'Наш продукт (одно предложение по-английски, напр. professional hair dryers 1800-2400W)',
    ja: '自社製品（英語で一文、例: professional hair dryers 1800-2400W）',
  },
  '对口买家类型（英文，如 wholesalers, beauty supply distributors）': {
    en: 'Target buyer type (English, e.g. wholesalers, beauty supply distributors)',
    pt: 'Tipo de comprador (em inglês, ex.: wholesalers, beauty supply distributors)',
    es: 'Tipo de comprador (en inglés, ej.: wholesalers, beauty supply distributors)',
    fr: 'Type d’acheteur (en anglais, ex. : wholesalers, beauty supply distributors)',
    de: 'Zielkundentyp (Englisch, z. B. wholesalers, beauty supply distributors)',
    ru: 'Тип покупателя (по-английски, напр. wholesalers, beauty supply distributors)',
    ja: '対象バイヤー種別（英語、例: wholesalers, beauty supply distributors）',
  },
  '每日真实发送上限-全局（新域名建议 20-30，0=不限制）': {
    en: 'Daily real-send cap, global (20-30 for a new domain; 0 = unlimited)',
    pt: 'Limite diário real de envio, global (20-30 para domínio novo; 0 = sem limite)',
    es: 'Límite diario real de envío, global (20-30 para dominio nuevo; 0 = sin límite)',
    fr: 'Plafond d’envoi réel quotidien, global (20-30 pour un domaine neuf ; 0 = illimité)',
    de: 'Tägliches Echtversand-Limit, global (20-30 für eine neue Domain; 0 = unbegrenzt)',
    ru: 'Дневной лимит реальной отправки, общий (20-30 для нового домена; 0 = без лимита)',
    ja: '1 日の実送信上限（全体。新規ドメインは 20-30 推奨、0 = 無制限）',
  },
  '每邮箱每日总上限（业务+预热合计，Instantly 式硬顶，0=不限制）': {
    en: 'Daily per-mailbox cap (business + warmup, Instantly-style hard cap; 0 = unlimited)',
    pt: 'Limite diário por caixa (negócio + aquecimento, teto rígido estilo Instantly; 0 = sem limite)',
    es: 'Límite diario por buzón (negocio + calentamiento, tope duro estilo Instantly; 0 = sin límite)',
    fr: 'Plafond quotidien par boîte (prospection + réchauffement, plafond strict type Instantly ; 0 = illimité)',
    de: 'Tageslimit je Postfach (Geschäft + Aufwärmung, harte Obergrenze wie bei Instantly; 0 = unbegrenzt)',
    ru: 'Дневной лимит на ящик (работа + прогрев, жёсткий предел как в Instantly; 0 = без лимита)',
    ja: 'メールボックスあたりの 1 日上限（業務 + 预热の合計、Instantly 方式の上限、0 = 無制限）',
  },
  '首触冷邮件免审批（绕过 SOP 审批门，自担风险）': {
    en: 'Skip approval for first-touch cold email (bypasses the SOP gate; your risk)',
    pt: 'Ignorar aprovação no primeiro contato frio (contorna o portão SOP; risco seu)',
    es: 'Omitir aprobación en el primer correo en frío (omite la puerta SOP; bajo tu riesgo)',
    fr: 'Ignorer l’approbation du premier e-mail à froid (contourne le seuil SOP ; à vos risques)',
    de: 'Genehmigung für die erste Kaltmail überspringen (umgeht das SOP-Gate; auf eigenes Risiko)',
    ru: 'Пропускать согласование для первого холодного письма (обходит этап SOP; на ваш риск)',
    ja: '初回コールドメールの承認を省略（SOP ゲートを迂回、自己責任）',
  },
  '纯文本模式（不注入追踪，投递率更好）': {
    en: 'Plain-text mode (no tracking injected, better deliverability)',
    pt: 'Modo texto puro (sem rastreamento, melhor entregabilidade)',
    es: 'Modo texto plano (sin seguimiento, mejor entregabilidad)',
    fr: 'Mode texte brut (sans suivi, meilleure délivrabilité)',
    de: 'Nur-Text-Modus (kein Tracking, bessere Zustellbarkeit)',
    ru: 'Режим обычного текста (без отслеживания, лучше доставляемость)',
    ja: 'テキストのみ（トラッキングなし、配信率が向上）',
  },
  '密码/授权码': { en: 'Password / app password', pt: 'Senha / senha de app', es: 'Contraseña / contraseña de app', fr: 'Mot de passe / mot de passe d’application', de: 'Passwort / App-Passwort', ru: 'Пароль / пароль приложения', ja: 'パスワード / アプリパスワード' },
  '目标市场': { en: 'Target market', pt: 'Mercado-alvo', es: 'Mercado objetivo', fr: 'Marché cible', de: 'Zielmarkt', ru: 'Целевой рынок', ja: 'ターゲット市場' },
  '服务器': { en: 'Server', pt: 'Servidor', es: 'Servidor', fr: 'Serveur', de: 'Server', ru: 'Сервер', ja: 'サーバー' },
  '端口': { en: 'Port', pt: 'Porta', es: 'Puerto', fr: 'Port', de: 'Port', ru: 'Порт', ja: 'ポート' },
  '账号': { en: 'Account', pt: 'Conta', es: 'Cuenta', fr: 'Compte', de: 'Konto', ru: 'Учётная запись', ja: 'アカウント' },
  '发件人': { en: 'From address', pt: 'Remetente', es: 'Remitente', fr: 'Expéditeur', de: 'Absender', ru: 'Отправитель', ja: '差出人' },
  '发件人名': { en: 'From name', pt: 'Nome do remetente', es: 'Nombre del remitente', fr: 'Nom de l’expéditeur', de: 'Absendername', ru: 'Имя отправителя', ja: '差出人名' },
  '每层条数': { en: 'Results per layer', pt: 'Resultados por camada', es: 'Resultados por capa', fr: 'Résultats par couche', de: 'Ergebnisse je Ebene', ru: 'Результатов на уровень', ja: '各層の件数' },
  '首选引擎': { en: 'Primary engine', pt: 'Motor principal', es: 'Motor principal', fr: 'Moteur principal', de: 'Primärer Anbieter', ru: 'Основной движок', ja: '優先エンジン' },
  '邮箱夹': { en: 'Mailbox folder', pt: 'Pasta da caixa', es: 'Carpeta del buzón', fr: 'Dossier de la boîte', de: 'Postfachordner', ru: 'Папка ящика', ja: 'メールフォルダ' },
  '实例名': { en: 'Instance name', pt: 'Nome da instância', es: 'Nombre de la instancia', fr: 'Nom de l’instance', de: 'Instanzname', ru: 'Имя экземпляра', ja: 'インスタンス名' },
  '启用': { en: 'Enable', pt: 'Ativar', es: 'Activar', fr: 'Activer', de: 'Aktivieren', ru: 'Включить', ja: '有効' },
  '总开关': { en: 'Master switch', pt: 'Interruptor geral', es: 'Interruptor general', fr: 'Interrupteur général', de: 'Hauptschalter', ru: 'Главный выключатель', ja: 'マスタースイッチ' },
  '总闸': { en: 'Master gate', pt: 'Trava geral', es: 'Bloqueo general', fr: 'Verrou général', de: 'Hauptsperre', ru: 'Главный предохранитель', ja: 'マスターゲート' },
  'WA 总闸': { en: 'WhatsApp master gate', pt: 'Trava geral do WhatsApp', es: 'Bloqueo general de WhatsApp', fr: 'Verrou général WhatsApp', de: 'WhatsApp-Hauptsperre', ru: 'Главный предохранитель WhatsApp', ja: 'WhatsApp マスターゲート' },
  '每日上限': { en: 'Daily cap', pt: 'Limite diário', es: 'Límite diario', fr: 'Plafond quotidien', de: 'Tageslimit', ru: 'Дневной лимит', ja: '1 日の上限' },
  '最小间隔(秒)': { en: 'Min interval (s)', pt: 'Intervalo mín. (s)', es: 'Intervalo mín. (s)', fr: 'Intervalle min. (s)', de: 'Mindestintervall (s)', ru: 'Мин. интервал (с)', ja: '最小間隔（秒）' },
  '最大间隔(秒)': { en: 'Max interval (s)', pt: 'Intervalo máx. (s)', es: 'Intervalo máx. (s)', fr: 'Intervalle max. (s)', de: 'Höchstintervall (s)', ru: 'Макс. интервал (с)', ja: '最大間隔（秒）' },
  '序列检查(分钟)': { en: 'Sequence check (min)', pt: 'Verificação de sequência (min)', es: 'Comprobación de secuencia (min)', fr: 'Vérification des séquences (min)', de: 'Sequenzprüfung (min)', ru: 'Проверка серий (мин)', ja: 'シーケンス確認（分）' },
  '回复扫描(分钟)': { en: 'Reply scan (min)', pt: 'Varredura de respostas (min)', es: 'Escaneo de respuestas (min)', fr: 'Analyse des réponses (min)', de: 'Antwort-Scan (min)', ru: 'Сканирование ответов (мин)', ja: '返信スキャン（分）' },
  '官网监控(小时)': { en: 'Website monitor (hours)', pt: 'Monitor do site (horas)', es: 'Monitor del sitio (horas)', fr: 'Suivi du site (heures)', de: 'Website-Überwachung (Std.)', ru: 'Мониторинг сайта (ч)', ja: 'サイト監視（時間）' },
  '日报时间(HH:mm)': { en: 'Daily report time (HH:mm)', pt: 'Hora do relatório diário (HH:mm)', es: 'Hora del informe diario (HH:mm)', fr: 'Heure du rapport quotidien (HH:mm)', de: 'Zeit des Tagesberichts (HH:mm)', ru: 'Время дневного отчёта (ЧЧ:мм)', ja: '日次レポート時刻（HH:mm）' },
  '停跟进天数': { en: 'Stop follow-up after (days)', pt: 'Parar follow-up após (dias)', es: 'Detener seguimiento tras (días)', fr: 'Arrêt du suivi après (jours)', de: 'Follow-up stoppen nach (Tagen)', ru: 'Прекратить follow-up через (дней)', ja: 'フォロー停止までの日数' },
  '轮询(分钟)': { en: 'Poll (min)', pt: 'Consulta (min)', es: 'Consulta (min)', fr: 'Interrogation (min)', de: 'Abfrage (min)', ru: 'Опрос (мин)', ja: 'ポーリング（分）' },
  '爬坡封顶(封/天)': { en: 'Ramp cap (per day)', pt: 'Teto de rampa (por dia)', es: 'Tope de rampa (por día)', fr: 'Plafond de montée (par jour)', de: 'Rampenlimit (pro Tag)', ru: 'Потолок разгона (в день)', ja: 'ランプ上限（通/日）' },
  '点击签名密钥': { en: 'Click signing key', pt: 'Chave de assinatura de clique', es: 'Clave de firma de clic', fr: 'Clé de signature des clics', de: 'Klick-Signaturschlüssel', ru: 'Ключ подписи кликов', ja: 'クリック署名キー' },
  '推线索进 Instantly 活动用）': { en: 'used to push leads into Instantly campaigns)', pt: 'usada para enviar leads a campanhas do Instantly)', es: 'se usa para enviar leads a campañas de Instantly)', fr: 'sert à pousser les prospects vers Instantly)', de: 'für den Import in Instantly-Kampagnen)', ru: 'для отправки лидов в кампании Instantly)', ja: 'Instantly キャンペーンへの投入用）' },
  '关': { en: 'Off', pt: 'Desligado', es: 'Apagado', fr: 'Désactivé', de: 'Aus', ru: 'Выкл.', ja: 'オフ' },
  '开': { en: 'On', pt: 'Ligado', es: 'Encendido', fr: 'Activé', de: 'An', ru: 'Вкл.', ja: 'オン' },
  'true（安全，只预览）': { en: 'true (safe, preview only)', pt: 'true (seguro, só prévia)', es: 'true (seguro, solo vista previa)', fr: 'true (sûr, aperçu seulement)', de: 'true (sicher, nur Vorschau)', ru: 'true (безопасно, только просмотр)', ja: 'true（安全、プレビューのみ）' },
  'false（真实发送）': { en: 'false (real send)', pt: 'false (envio real)', es: 'false (envío real)', fr: 'false (envoi réel)', de: 'false (echter Versand)', ru: 'false (реальная отправка)', ja: 'false（実際に送信）' },
  'true（安全，只记录）': { en: 'true (safe, log only)', pt: 'true (seguro, só registra)', es: 'true (seguro, solo registra)', fr: 'true (sûr, journalisation seule)', de: 'true (sicher, nur protokollieren)', ru: 'true (безопасно, только запись)', ja: 'true（安全、記録のみ）' },
  'false（解除）': { en: 'false (lifted)', pt: 'false (liberado)', es: 'false (liberado)', fr: 'false (levé)', de: 'false (aufgehoben)', ru: 'false (снято)', ja: 'false（解除）' },
  'false（默认，需审批）': { en: 'false (default, approval required)', pt: 'false (padrão, exige aprovação)', es: 'false (por defecto, requiere aprobación)', fr: 'false (par défaut, approbation requise)', de: 'false (Standard, Genehmigung nötig)', ru: 'false (по умолчанию, нужна проверка)', ja: 'false（既定、承認が必要）' },
  'DuckDuckGo(免key)': { en: 'DuckDuckGo (no key)', pt: 'DuckDuckGo (sem chave)', es: 'DuckDuckGo (sin clave)', fr: 'DuckDuckGo (sans clé)', de: 'DuckDuckGo (ohne Schlüssel)', ru: 'DuckDuckGo (без ключа)', ja: 'DuckDuckGo（キー不要）' },

  // ---- templates page ----------------------------------------------------
  '还没有模板。对话里让智能体调 template_save，或点「新建模板」。': {
    en: 'No templates yet. Ask the agent to call template_save in the conversation, or click “New template”.',
    pt: 'Ainda não há modelos. Peça ao agente para chamar template_save na conversa, ou clique em “Novo modelo”.',
    es: 'Aún no hay plantillas. Pide al agente que llame a template_save en la conversación, o haz clic en “Nueva plantilla”.',
    fr: 'Aucun modèle pour l’instant. Demandez à l’agent d’appeler template_save dans la conversation, ou cliquez sur « Nouveau modèle ».',
    de: 'Noch keine Vorlagen. Bitten Sie den Agenten, template_save im Gespräch aufzurufen, oder klicken Sie auf „Neue Vorlage“.',
    ru: 'Шаблонов пока нет. Попросите агента вызвать template_save в разговоре или нажмите «Новый шаблон».',
    ja: 'テンプレートはまだありません。会話でエージェントに template_save を呼ばせるか、「テンプレートを作成」をクリックしてください。',
  },
  '新建模板': { en: 'New template', pt: 'Novo modelo', es: 'Nueva plantilla', fr: 'Nouveau modèle', de: 'Neue Vorlage', ru: 'Новый шаблон', ja: 'テンプレートを作成' },
  '邮件模板供 email_compose 直接复用 · 报价条款是 quote_pdf / proforma_pdf 的缺省值': {
    en: 'Email templates are reused directly by email_compose · Quote terms are the defaults for quote_pdf / proforma_pdf',
    pt: 'Os modelos de e-mail são reaproveitados por email_compose · Os termos da cotação são os padrões de quote_pdf / proforma_pdf',
    es: 'Las plantillas de correo las reutiliza email_compose · Los términos de cotización son los valores por defecto de quote_pdf / proforma_pdf',
    fr: 'Les modèles d’e-mail sont réutilisés par email_compose · Les conditions de devis sont les valeurs par défaut de quote_pdf / proforma_pdf',
    de: 'E-Mail-Vorlagen werden von email_compose wiederverwendet · Angebotsbedingungen sind die Standardwerte für quote_pdf / proforma_pdf',
    ru: 'Шаблоны писем используются email_compose · Условия предложения — значения по умолчанию для quote_pdf / proforma_pdf',
    ja: 'メールテンプレートは email_compose がそのまま再利用します · 見積条件は quote_pdf / proforma_pdf の既定値です',
  },
  '邮件模板': { en: 'Email templates', pt: 'Modelos de e-mail', es: 'Plantillas de correo', fr: 'Modèles d’e-mail', de: 'E-Mail-Vorlagen', ru: 'Шаблоны писем', ja: 'メールテンプレート' },
  '报价默认条款': { en: 'Default quote terms', pt: 'Termos padrão da cotação', es: 'Términos por defecto de cotización', fr: 'Conditions de devis par défaut', de: 'Standard-Angebotsbedingungen', ru: 'Условия предложения по умолчанию', ja: '見積の既定条件' },
  'quote_pdf / proforma_pdf 参数没传时用这里的价值': {
    en: 'Used when quote_pdf / proforma_pdf get no explicit argument',
    pt: 'Usado quando quote_pdf / proforma_pdf não recebem argumento explícito',
    es: 'Se usa cuando quote_pdf / proforma_pdf no reciben un argumento explícito',
    fr: 'Utilisé quand quote_pdf / proforma_pdf ne reçoivent pas d’argument explicite',
    de: 'Wird verwendet, wenn quote_pdf / proforma_pdf kein Argument erhalten',
    ru: 'Используется, если quote_pdf / proforma_pdf не получили аргумент',
    ja: 'quote_pdf / proforma_pdf に引数がないときに使われます',
  },
  '币种': { en: 'Currency', pt: 'Moeda', es: 'Moneda', fr: 'Devise', de: 'Währung', ru: 'Валюта', ja: '通貨' },
  '付款方式': { en: 'Payment terms', pt: 'Condições de pagamento', es: 'Condiciones de pago', fr: 'Conditions de paiement', de: 'Zahlungsbedingungen', ru: 'Условия оплаты', ja: '支払条件' },
  '交期': { en: 'Lead time', pt: 'Prazo de entrega', es: 'Plazo de entrega', fr: 'Délai de livraison', de: 'Lieferzeit', ru: 'Срок поставки', ja: '納期' },
  '报价有效期': { en: 'Quote validity', pt: 'Validade da cotação', es: 'Validez de la cotización', fr: 'Validité du devis', de: 'Gültigkeit des Angebots', ru: 'Срок действия предложения', ja: '見積有効期限' },
  '收款银行': { en: 'Bank', pt: 'Banco', es: 'Banco', fr: 'Banque', de: 'Bank', ru: 'Банк', ja: '銀行' },
  '银行账号': { en: 'Account number', pt: 'Número da conta', es: 'Número de cuenta', fr: 'Numéro de compte', de: 'Kontonummer', ru: 'Номер счёта', ja: '口座番号' },
  '收款人（Beneficiary）': { en: 'Beneficiary', pt: 'Beneficiário', es: 'Beneficiario', fr: 'Bénéficiaire', de: 'Begünstigter', ru: 'Получатель', ja: '受取人' },
  '报价单备注（每份 PDF 末尾都会带）': {
    en: 'Quote notes (appended to every PDF)',
    pt: 'Observações da cotação (anexadas a cada PDF)',
    es: 'Notas de la cotización (se añaden a cada PDF)',
    fr: 'Notes du devis (ajoutées à chaque PDF)',
    de: 'Angebotsnotizen (an jedes PDF angehängt)',
    ru: 'Примечания к предложению (в каждом PDF)',
    ja: '見積メモ（各 PDF の末尾に付きます）',
  },
  '保存报价条款': { en: 'Save quote terms', pt: 'Salvar termos da cotação', es: 'Guardar términos de cotización', fr: 'Enregistrer les conditions', de: 'Angebotsbedingungen speichern', ru: 'Сохранить условия', ja: '見積条件を保存' },
  '删除这个模板？': { en: 'Delete this template?', pt: 'Excluir este modelo?', es: '¿Eliminar esta plantilla?', fr: 'Supprimer ce modèle ?', de: 'Diese Vorlage löschen?', ru: 'Удалить этот шаблон?', ja: 'このテンプレートを削除しますか？' },
  '新建邮件模板': { en: 'New email template', pt: 'Novo modelo de e-mail', es: 'Nueva plantilla de correo', fr: 'Nouveau modèle d’e-mail', de: 'Neue E-Mail-Vorlage', ru: 'Новый шаблон письма', ja: 'メールテンプレートを作成' },
  '模板名（唯一）': { en: 'Template name (unique)', pt: 'Nome do modelo (único)', es: 'Nombre de la plantilla (único)', fr: 'Nom du modèle (unique)', de: 'Vorlagenname (eindeutig)', ru: 'Имя шаблона (уникальное)', ja: 'テンプレート名（一意）' },
  '语言': { en: 'Language', pt: 'Idioma', es: 'Idioma', fr: 'Langue', de: 'Sprache', ru: 'Язык', ja: '言語' },
  '主题': { en: 'Subject', pt: 'Assunto', es: 'Asunto', fr: 'Objet', de: 'Betreff', ru: 'Тема', ja: '件名' },
  '正文': { en: 'Body', pt: 'Corpo', es: 'Cuerpo', fr: 'Corps', de: 'Text', ru: 'Текст', ja: '本文' },
  '名字、主题、正文都要填': { en: 'Name, subject, and body are all required', pt: 'Nome, assunto e corpo são obrigatórios', es: 'Nombre, asunto y cuerpo son obligatorios', fr: 'Le nom, l’objet et le corps sont obligatoires', de: 'Name, Betreff und Text sind erforderlich', ru: 'Имя, тема и текст обязательны', ja: '名前・件名・本文はすべて必須です' },
  '用于 ': { en: 'Used ', pt: 'Usado ', es: 'Usado ', fr: 'Utilisé ', de: 'Verwendet: ', ru: 'Использован ', ja: '使用回数 ' },
  ' 次 · 更新 ': { en: ' times · updated ', pt: ' vezes · atualizado ', es: ' veces · actualizado ', fr: ' fois · mis à jour ', de: ' Mal · aktualisiert: ', ru: ' раз · обновлён ', ja: ' 回 · 更新 ' },
  '已删除': { en: 'Deleted', pt: 'Excluído', es: 'Eliminado', fr: 'Supprimé', de: 'Gelöscht', ru: 'Удалено', ja: '削除しました' },
  '模板已保存': { en: 'Template saved', pt: 'Modelo salvo', es: 'Plantilla guardada', fr: 'Modèle enregistré', de: 'Vorlage gespeichert', ru: 'Шаблон сохранён', ja: 'テンプレートを保存しました' },
  '报价条款已保存': { en: 'Quote terms saved', pt: 'Termos da cotação salvos', es: 'Términos de cotización guardados', fr: 'Conditions de devis enregistrées', de: 'Angebotsbedingungen gespeichert', ru: 'Условия предложения сохранены', ja: '見積条件を保存しました' },
  '保存': { en: 'Save', pt: 'Salvar', es: 'Guardar', fr: 'Enregistrer', de: 'Speichern', ru: 'Сохранить', ja: '保存' },
  '取消': { en: 'Cancel', pt: 'Cancelar', es: 'Cancelar', fr: 'Annuler', de: 'Abbrechen', ru: 'Отмена', ja: 'キャンセル' },
  '删除': { en: 'Delete', pt: 'Excluir', es: 'Eliminar', fr: 'Supprimer', de: 'Löschen', ru: 'Удалить', ja: '削除' },
  '确认': { en: 'Confirm', pt: 'Confirmar', es: 'Confirmar', fr: 'Confirmer', de: 'Bestätigen', ru: 'Подтвердить', ja: '確認' },
  '搜索': { en: 'Search', pt: 'Pesquisar', es: 'Buscar', fr: 'Rechercher', de: 'Suchen', ru: 'Поиск', ja: '検索' },
  '统计': { en: 'Stats', pt: 'Estatísticas', es: 'Estadísticas', fr: 'Statistiques', de: 'Statistik', ru: 'Статистика', ja: '統計' },
  '配置': { en: 'Config', pt: 'Configuração', es: 'Configuración', fr: 'Configuration', de: 'Konfiguration', ru: 'Конфигурация', ja: '設定' },
  '客服': { en: 'Support', pt: 'Suporte', es: 'Soporte', fr: 'Support', de: 'Support', ru: 'Поддержка', ja: 'サポート' },
  '看板/列表': { en: 'Board/List', pt: 'Quadro/Lista', es: 'Tablero/Lista', fr: 'Tableau/Liste', de: 'Board/Liste', ru: 'Доска/Список', ja: 'ボード/リスト' },
  '邮件/报价': { en: 'Email/Quote', pt: 'E-mail/Cotação', es: 'Correo/Cotización', fr: 'E-mail/Devis', de: 'E-Mail/Angebot', ru: 'Почта/Предложение', ja: 'メール/見積' },
  '跳转到… (获客/管线/审核/设置)': {
    en: 'Jump to… (Leads/Pipeline/Review/Settings)',
    pt: 'Ir para… (Leads/Pipeline/Revisão/Configurações)',
    es: 'Ir a… (Leads/Embudo/Revisión/Ajustes)',
    fr: 'Aller à… (Prospects/Pipeline/Révision/Paramètres)',
    de: 'Springen zu… (Leads/Pipeline/Prüfung/Einstellungen)',
    ru: 'Перейти… (Лиды/Пайплайн/Проверка/Настройки)',
    ja: '移動…（リード/パイプライン/レビュー/設定）',
  },
  '抑制列表': { en: 'Suppression list', pt: 'Lista de supressão', es: 'Lista de supresión', fr: 'Liste de suppression', de: 'Sperrliste', ru: 'Список подавления', ja: '抑制リスト' },
  '邮件真实发送': { en: 'Emails actually sent', pt: 'E-mails realmente enviados', es: 'Correos realmente enviados', fr: 'E-mails réellement envoyés', de: 'Tatsächlich gesendete E-Mails', ru: 'Реально отправлено писем', ja: '実際のメール送信数' },
  '发送': { en: 'Sent', pt: 'Enviados', es: 'Enviados', fr: 'Envoyés', de: 'Gesendet', ru: 'Отправлено', ja: '送信' },
  '打开(去重/天)': { en: 'Opens (unique/day)', pt: 'Aberturas (únicas/dia)', es: 'Aperturas (únicas/día)', fr: 'Ouvertures (uniques/jour)', de: 'Öffnungen (eindeutig/Tag)', ru: 'Открытий (уникальных/день)', ja: '開封（重複除外/日）' },
  '效果统计': { en: 'Performance', pt: 'Desempenho', es: 'Rendimiento', fr: 'Performance', de: 'Leistung', ru: 'Эффективность', ja: '実績' },
  '生成失败': { en: 'Generation failed', pt: 'Falha ao gerar', es: 'Falló la generación', fr: 'Échec de la génération', de: 'Erzeugung fehlgeschlagen', ru: 'Не удалось создать', ja: '生成に失敗しました' },
  '出厂成本': { en: 'Factory cost', pt: 'Custo de fábrica', es: 'Coste de fábrica', fr: 'Coût d’usine', de: 'Werkskosten', ru: 'Заводская стоимость', ja: '工場原価' },
  '国内运费': { en: 'Inland freight', pt: 'Frete interno', es: 'Flete interno', fr: 'Fret intérieur', de: 'Inlandsfracht', ru: 'Внутренняя доставка', ja: '国内運賃' },
  '港口/报关费': { en: 'Port/customs fees', pt: 'Taxas de porto/alfândega', es: 'Tasas de puerto/aduanas', fr: 'Frais de port/douane', de: 'Hafen-/Zollgebühren', ru: 'Порт/таможня', ja: '港・通関費用' },
  '海运费': { en: 'Ocean freight', pt: 'Frete marítimo', es: 'Flete marítimo', fr: 'Fret maritime', de: 'Seefracht', ru: 'Морская доставка', ja: '海上運賃' },
  '保险率%': { en: 'Insurance %', pt: 'Seguro %', es: 'Seguro %', fr: 'Assurance %', de: 'Versicherung %', ru: 'Страховка %', ja: '保険率 %' },
  '关税+增值税%(基于CIF)': { en: 'Duty + VAT % (CIF basis)', pt: 'Imposto + IVA % (base CIF)', es: 'Arancel + IVA % (base CIF)', fr: 'Droits + TVA % (base CIF)', de: 'Zoll + MwSt. % (CIF-Basis)', ru: 'Пошлина + НДС % (база CIF)', ja: '関税 + VAT %（CIF 基準）' },
  '目的港清关费': { en: 'Destination customs clearance', pt: 'Desembaraço no destino', es: 'Despacho en destino', fr: 'Dédouanement à destination', de: 'Zollabfertigung am Zielort', ru: 'Таможня в порту назначения', ja: '仕向港の通関費用' },
  '目的地运费': { en: 'Destination freight', pt: 'Frete no destino', es: 'Flete en destino', fr: 'Fret à destination', de: 'Fracht am Zielort', ru: 'Доставка до пункта назначения', ja: '仕向地の運賃' },
  '利润率%': { en: 'Margin %', pt: 'Margem %', es: 'Margen %', fr: 'Marge %', de: 'Marge %', ru: 'Маржа %', ja: '利益率 %' },

  // ---- code panels -------------------------------------------------------
  '正确': { en: 'Correct', pt: 'Correto', es: 'Correcto', fr: 'Correct', de: 'Korrekt', ru: 'Верно', ja: '正しい' },
  '跳转到… (获客/管线/审核/设置)': {
    en: 'Jump to… (Leads/Pipeline/Review/Settings)',
    pt: 'Ir para… (Leads/Pipeline/Revisão/Configurações)',
    es: 'Ir a… (Leads/Embudo/Revisión/Ajustes)',
    fr: 'Aller à… (Prospects/Pipeline/Révision/Paramètres)',
    de: 'Springen zu… (Leads/Pipeline/Prüfung/Einstellungen)',
    ru: 'Перейти… (Лиды/Пайплайн/Проверка/Настройки)',
    ja: '移動…（リード/パイプライン/レビュー/設定）',
  },
  '搜索公式：': { en: 'Search formula: ', pt: 'Fórmula de busca: ', es: 'Fórmula de búsqueda: ', fr: 'Formule de recherche : ', de: 'Suchformel: ', ru: 'Формула поиска: ', ja: '検索式: ' },
  '产品词': { en: 'product term', pt: 'termo do produto', es: 'término del producto', fr: 'terme produit', de: 'Produktbegriff', ru: 'ключевое слово', ja: '製品名' },
  '区号': { en: 'country code', pt: 'código do país', es: 'código de país', fr: 'indicatif pays', de: 'Ländervorwahl', ru: 'код страны', ja: '国番号' },
  '刷新': { en: 'Refresh', pt: 'Atualizar', es: 'Actualizar', fr: 'Actualiser', de: 'Aktualisieren', ru: 'Обновить', ja: '更新' },
  '解除': { en: 'lifted', pt: 'liberado', es: 'liberado', fr: 'levé', de: 'aufgehoben', ru: 'снято', ja: '解除' },
  '获取联系方式': { en: 'Fetch contacts', pt: 'Obter contatos', es: 'Obtener contactos', fr: 'Obtenir les contacts', de: 'Kontakte holen', ru: 'Получить контакты', ja: '連絡先を取得' },
  '回复检测': { en: 'Reply detection', pt: 'Detecção de respostas', es: 'Detección de respuestas', fr: 'Détection des réponses', de: 'Antworterkennung', ru: 'Определение ответов', ja: '返信検出' },
  '发信': { en: 'Sending', pt: 'Envio', es: 'Envío', fr: 'Envoi', de: 'Versand', ru: 'Отправка', ja: '送信' },
  '主体': { en: 'Body', pt: 'Corpo', es: 'Cuerpo', fr: 'Corps', de: 'Text', ru: 'Текст', ja: '本文' },
  '失败': { en: 'failed', pt: 'falhou', es: 'falló', fr: 'échec', de: 'fehlgeschlagen', ru: 'ошибка', ja: '失敗' },
  '错误': { en: 'Error', pt: 'Erro', es: 'Error', fr: 'Erreur', de: 'Fehler', ru: 'Ошибка', ja: 'エラー' },
};

/**
 * The runtime that picks a language and swaps the copy in the browser.
 *
 * Server-rendered labels stay Chinese until this runs; it replaces them from
 * the table above, so one static page serves every language without a build.
 * @returns {string} the serialized copy table.
 */
function runtimeTable() {
  return JSON.stringify(Object.entries(COPY));
}

/**
 * Build the localization block injected into `COMMON_HEAD`.
 * @param {string} table - the serialized copy table.
 * @returns {string} the script that applies the table.
 */
function localizationBlock(table) {
  return `<script>(function(){
var TABLE=${table};
function base(x){return String(x||'').toLowerCase().split(/[-_]/)[0];}
try{var q=new URLSearchParams(location.search).get('lang');if(q)localStorage.setItem('waimao-lang',base(q));}catch(e){}
var lang='en';
try{lang=base(localStorage.getItem('waimao-lang')||navigator.language||'en');}catch(e){}
if(lang==='zh'){document.documentElement.lang='zh';return;}
var pick={};
for(var i=0;i<TABLE.length;i++){var zh=TABLE[i][0],row=TABLE[i][1];pick[zh]=row[lang]||row.en||zh;}
document.documentElement.lang=lang;
var pair=Object.keys(pick).sort(function(a,b){return b.length-a.length});
function tr(s){var out=String(s==null?'':s);for(var i=0;i<pair.length;i++){var k=pair[i];if(out.indexOf(k)>=0)out=out.split(k).join(pick[k]);}return out;}
function walk(n){if(n.nodeType===3){var v=tr(n.nodeValue);if(v!==n.nodeValue)n.nodeValue=v;return;}if(n.nodeType!==1)return;if(n.tagName==='SCRIPT'||n.tagName==='STYLE')return;
var a=['placeholder','title','aria-label'];for(var i=0;i<a.length;i++){var g=n.getAttribute&&n.getAttribute(a[i]);if(g){var t=tr(g);if(t!==g)n.setAttribute(a[i],t);}}
for(var c=n.firstChild;c;c=c.nextSibling)walk(c);}
document.addEventListener('DOMContentLoaded',function(){walk(document.body);
if(typeof MutationObserver==='function'){var mo=new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var m=ms[i];for(var j=0;j<m.addedNodes.length;j++)walk(m.addedNodes[j]);}});mo.observe(document.body,{childList:true,subtree:true});}
});
})();</script>`;
}

/**
 * Rewrite `dsh/pages.js` for every shipped language.
 * @param {string} text - the package source.
 * @returns {string} the localized source.
 */
function localizePages(text) {
  if (text.includes('waimao-lang')) return text;
  let next = text;

  const head = '`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +';
  if (!next.includes(head)) throw new Error('pages: COMMON_HEAD document shell not found');
  next = next.replace(head, () => '`<!doctype html><html lang="en"><head><meta charset="utf-8">` +');

  const sharedJs = '`</nav>` +\n  SHARED_JS;';
  if (!next.includes(sharedJs)) throw new Error('pages: COMMON_HEAD script anchor not found');
  next = next.replace(sharedJs, () => '`</nav>` +\n  LOCALIZE_JS +\n  SHARED_JS;');

  const footer = 'const FOOTER = `</div></body></html>`;';
  if (!next.includes(footer)) throw new Error('pages: FOOTER anchor not found');
  const block = localizationBlock(runtimeTable());
  next = next.replace(footer, () => `${footer}

/** Client copy for every shipped language, applied before the page renders. */
const LOCALIZE_JS = \`${block}\`;`);

  return next;
}

const plugins = [
  {
    name: PACKAGE,
    files: [{ relative: 'dsh/pages.js', transform: localizePages }],
  },
];

/**
 * Read a file, reporting absence as `undefined` rather than failing.
 * @param {string} path
 * @returns {Promise<string | undefined>}
 */
async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * The installed package directory for a plugin.
 * @param {string} packageName
 * @returns {string}
 */
function pluginRoot(packageName) {
  const explicit = argValue('--plugin-root') ?? process.env.DSH_PLUGIN_ROOT;
  if (explicit) return join(resolve(explicit), packageName);
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles/web/node_modules', packageName);
}

/**
 * The value of a `--flag value` argument, when present.
 * @param {string} flag
 * @returns {string | undefined}
 */
function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const checkOnly = process.argv.includes('--check');
let checked = 0;
let changed = 0;

// A direct invocation localizes the profile; an import only exposes the table.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  for (const plugin of plugins) {
    const root = pluginRoot(plugin.name);
    const manifest = await readOptional(join(root, 'package.json'));
    if (manifest === undefined) {
      console.warn(`skipped: ${plugin.name} is not installed at ${root}`);
      continue;
    }
    for (const file of plugin.files) {
      const path = join(root, file.relative);
      const original = await readOptional(path);
      if (original === undefined) continue;
      checked += 1;
      const text = file.transform(original);
      if (text === original) continue;
      changed += 1;
      if (checkOnly) {
        console.error(`outdated: ${plugin.name}/${file.relative}`);
        continue;
      }
      await writeFile(path, text);
      console.log(`updated: ${plugin.name}/${file.relative}`);
    }
  }

  if (changed === 0) {
    console.log(`waimao localization already applied (${checked} files checked)`);
  } else if (checkOnly) {
    console.error(`${changed} of ${checked} files need the waimao localization`);
    process.exitCode = 1;
  } else {
    console.log(`waimao localization applied (${changed} of ${checked} files)`);
  }
}

export { COPY, localizePages };
