/**
 * Extend the installed UI plugins to CopyMonster's eight languages.
 *
 * CopyMonster ships `en`, `pt`, `zh`, `es`, `fr`, `de`, `ru`, and `ja`.
 * `@nagi-ovo/dsh-visualize` and `dsh-plugin-smooth-stream` ship fewer
 * dictionaries, so this script adds the missing ones and maps every locale id
 * onto its base language tag instead of falling back to Chinese.
 *
 * Protected: key names, placeholder tokens (`{name}`), and every English
 * string (other languages read the English copy as their final fallback).
 *
 * Safe to run repeatedly: a file already carrying the dictionaries is left
 * alone, and absent files are skipped.
 *
 * Usage:
 *   node scripts/apply-localization-rebrand.mjs [--check]
 *   DSH_PLUGIN_ROOT=<profile-node_modules> node scripts/apply-localization-rebrand.mjs
 *
 * Profile postinstall, from `<DSH_HOME>/profiles/web/package.json`:
 *   "postinstall": "... && node ../../../copymonster-launch/scripts/apply-localization-rebrand.mjs"
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** Every language CopyMonster ships, in the order the app lists them. */
const SHIPPED_LANGUAGES = ['en', 'pt', 'zh', 'es', 'fr', 'de', 'ru', 'ja'];

/**
 * The base language tag of a host locale id.
 * @param {string} id
 * @returns {string} the base tag, lowercased.
 */
function baseLanguage(id) {
  return id.toLowerCase().split(/[-_]/u)[0];
}

/**
 * Whether a locale id belongs to a shipped language.
 * @param {string} id
 * @returns {boolean}
 */
function shipsLanguage(id) {
  return SHIPPED_LANGUAGES.includes(baseLanguage(id));
}

// ---------------------------------------------------------------------------
// @nagi-ovo/dsh-visualize
// ---------------------------------------------------------------------------

/**
 * The English and Chinese card-header copy appended to their package dictionaries.
 *
 * The package ships these card headers as literals inside `VisualizeCard` and
 * `StreamingPreview`; they move into the dictionaries so every shipped
 * language renders them.
 */
const VISUALIZE_CARD_KEYS = `\t\t\tcardRendering: "Visualize · rendering…",
\t\t\tcardError: "Visualize · ",
\t\t\tcardStreaming: "Visualize · streaming preview",
\t\t\tcardComposing: "Visualize · composing…",
\t\t\tcardStreamingTitle: "Visualization streaming preview"`;

const VISUALIZE_CARD_KEYS_ZH = `\t\t\tcardRendering: "可视化 · 渲染中…",
\t\t\tcardError: "可视化 · ",
\t\t\tcardStreaming: "可视化 · 流式预览",
\t\t\tcardComposing: "可视化 · 生成中…",
\t\t\tcardStreamingTitle: "可视化流式预览"`;

/**
 * The card copy lookup the translated headers call.
 *
 * `apply` records the host's locale service in `activeLocaleService`, so the
 * card headers follow the same language as the settings page.
 */
const VISUALIZE_CARD_LOOKUP = `\t\t/**
\t\t* The host's active locale id, read from the locale service registered by
\t\t* {@link apply}; undefined before the plugin starts or without a locale service.
\t\t* @returns the active id, or undefined.
\t\t*/
\t\tfunction hostLocaleId() {
\t\t\treturn activeLocaleService === void 0 ? undefined : activeLocaleService.getSnapshot().active;
\t\t}
\t\t/** The card header copy for the current page language. */
\t\tfunction cardText() {
\t\t\tconst active = hostLocaleId();
\t\t\treturn DICTIONARIES[active === void 0 ? documentLang() : settingsLang(active)];
\t\t}
\t\t/** The locale service the card copy follows; set once the plugin applies. */
\t\tlet activeLocaleService;`;

/**
 * The full copy table for `dsh-visualize`.
 *
 * The English dictionary is the key source in the package, so translations are
 * appended as complete dictionaries written through the same template.
 */
const VISUALIZE_DICTIONARIES = `\t\t/** Portuguese (Brazil) copy. */
\t\tconst PT = {
\t\t\tstyleHeading: "Estilo do cartão",
\t\t\tstyleIntro: "Novos cartões usam este estilo. Cartões já presentes na conversa mantêm o estilo com que foram criados.",
\t\t\t"style.whale": "Baleia",
\t\t\t"style.whale.desc": "Combina com a interface do dsh",
\t\t\t"style.editorial": "Editorial",
\t\t\t"style.editorial.desc": "Manchete traz a conclusão, uma linha de história",
\t\t\t"style.paper": "Artigo",
\t\t\t"style.paper.desc": "Como uma figura em um artigo",
\t\t\t"style.sketch": "Rascunho",
\t\t\t"style.sketch.desc": "Feito à mão, como um quadro branco",
\t\t\t"style.terminal": "Terminal",
\t\t\t"style.terminal.desc": "Monoespaçado, como um terminal",
\t\t\tdefaultTag: "Padrão",
\t\t\tsaving: "Salvando…",
\t\t\tsaved: "Salvo. O próximo cartão usará {style}.",
\t\t\tsaveFailed: "Não foi possível salvar o estilo. Tente novamente.",
\t\t\treadOnly: "Este perfil não pode ser editado por aqui.",
\t\t\toverridden: "Definido no seu perfil",
\t\t\treset: "Usar o padrão",
\t\t\tunavailableTitle: "Este dsh não pode alterar o estilo do cartão por aqui",
\t\t\tunavailableBody: "Defina em {path} em vez disso:",
\t\t\tpreviewTitle: "Cadastros subiram 18% nesta semana",
\t\t\tpreviewNote: "Cadastros semanais, últimas 8 semanas",
\t\t\tfilesHeading: "Arquivos de estilo personalizados",
\t\t\tfilesIntro: "Notas que o modelo lê depois do estilo embutido, como cores ou palavras a preferir. O arquivo do espaço de trabalho é lido por último. Cada arquivo conta até {max} bytes.",
\t\t\tglobalFile: "Todos os espaços de trabalho",
\t\t\tworkspaceFile: "Espaço de trabalho",
\t\t\tworkspacePick: "Espaço de trabalho",
\t\t\tfileExists: "Existe",
\t\t\tfileMissing: "Não criado",
\t\t\tfileBlocked: "Este caminho é um link ou não é um arquivo regular, então não pode ser editado por aqui.",
\t\t\tbytes: "{bytes} / {max} bytes",
\t\t\ttooLarge: "Excede o limite de {max} bytes em {over} bytes.",
\t\t\tsaveFile: "Salvar",
\t\t\tfileSaved: "Salvo. Aplica-se a partir do próximo carregamento da skill.",
\t\t\tfileRemoved: "Salvo vazio, então o arquivo foi removido.",
\t\t\tfileSaveFailed: "Não foi possível salvar o arquivo: {reason}",
\t\t\tfilesUnavailable: "Este dsh não pode editar os arquivos por aqui. Edite-os diretamente:",
\t\t\tfilesLoading: "Carregando arquivos de estilo…",
\t\t\tplaceholder: "Por exemplo: use verde-azulado no destaque, rotule os eixos em português.",
\t\t\tcardRendering: "Visualizar · renderizando…",
\t\t\tcardError: "Visualizar · ",
\t\t\tcardStreaming: "Visualizar · prévia em fluxo",
\t\t\tcardComposing: "Visualizar · compondo…",
\t\t\tcardStreamingTitle: "Prévia em fluxo da visualização"
\t\t};
\t\t/** Spanish copy. */
\t\tconst ES = {
\t\t\tstyleHeading: "Estilo de la tarjeta",
\t\t\tstyleIntro: "Las tarjetas nuevas usan este estilo. Las tarjetas ya presentes en la conversación mantienen el estilo con el que se crearon.",
\t\t\t"style.whale": "Ballena",
\t\t\t"style.whale.desc": "Coincide con la interfaz de dsh",
\t\t\t"style.editorial": "Editorial",
\t\t\t"style.editorial.desc": "El titular expone la conclusión, una línea de relato",
\t\t\t"style.paper": "Artículo",
\t\t\t"style.paper.desc": "Como una figura de un artículo",
\t\t\t"style.sketch": "Boceto",
\t\t\t"style.sketch.desc": "Dibujado a mano, como una pizarra",
\t\t\t"style.terminal": "Terminal",
\t\t\t"style.terminal.desc": "Monoespaciado, como una terminal",
\t\t\tdefaultTag: "Predeterminado",
\t\t\tsaving: "Guardando…",
\t\t\tsaved: "Guardado. La próxima tarjeta usará {style}.",
\t\t\tsaveFailed: "No se pudo guardar el estilo. Inténtalo de nuevo.",
\t\t\treadOnly: "Este perfil no se puede editar desde aquí.",
\t\t\toverridden: "Definido en tu perfil",
\t\t\treset: "Usar el predeterminado",
\t\t\tunavailableTitle: "Este dsh no puede cambiar el estilo de la tarjeta desde aquí",
\t\t\tunavailableBody: "Defínelo en {path} en su lugar:",
\t\t\tpreviewTitle: "Registros subieron 18% esta semana",
\t\t\tpreviewNote: "Registros semanales, últimas 8 semanas",
\t\t\tfilesHeading: "Archivos de estilo personalizados",
\t\t\tfilesIntro: "Notas que el modelo lee después del estilo integrado, como colores o palabras preferidas. El archivo del espacio de trabajo se lee al final. Cada archivo cuenta hasta {max} bytes.",
\t\t\tglobalFile: "Todos los espacios de trabajo",
\t\t\tworkspaceFile: "Espacio de trabajo",
\t\t\tworkspacePick: "Espacio de trabajo",
\t\t\tfileExists: "Existe",
\t\t\tfileMissing: "No creado",
\t\t\tfileBlocked: "Esta ruta es un enlace o no es un archivo regular, así que no se puede editar desde aquí.",
\t\t\tbytes: "{bytes} / {max} bytes",
\t\t\ttooLarge: "Supera el límite de {max} bytes por {over} bytes.",
\t\t\tsaveFile: "Guardar",
\t\t\tfileSaved: "Guardado. Se aplicará en la próxima carga de la skill.",
\t\t\tfileRemoved: "Guardado vacío, así que el archivo se eliminó.",
\t\t\tfileSaveFailed: "No se pudo guardar el archivo: {reason}",
\t\t\tfilesUnavailable: "Este dsh no puede editar los archivos desde aquí. Edítalos directamente:",
\t\t\tfilesLoading: "Cargando archivos de estilo…",
\t\t\tplaceholder: "Por ejemplo: usa verde azulado en el acento, etiqueta los ejes en español.",
\t\t\tcardRendering: "Visualizar · renderizando…",
\t\t\tcardError: "Visualizar · ",
\t\t\tcardStreaming: "Visualizar · vista previa en flujo",
\t\t\tcardComposing: "Visualizar · componiendo…",
\t\t\tcardStreamingTitle: "Vista previa en flujo de la visualización"
\t\t};
\t\t/** French copy. */
\t\tconst FR = {
\t\t\tstyleHeading: "Style de la carte",
\t\t\tstyleIntro: "Les nouvelles cartes utilisent ce style. Les cartes déjà présentes dans la conversation conservent le style avec lequel elles ont été créées.",
\t\t\t"style.whale": "Baleine",
\t\t\t"style.whale.desc": "S'accorde avec l'interface dsh",
\t\t\t"style.editorial": "Éditorial",
\t\t\t"style.editorial.desc": "Le titre énonce la conclusion, une ligne de récit",
\t\t\t"style.paper": "Article",
\t\t\t"style.paper.desc": "Comme une figure dans un article",
\t\t\t"style.sketch": "Croquis",
\t\t\t"style.sketch.desc": "Dessiné à la main, comme un tableau blanc",
\t\t\t"style.terminal": "Terminal",
\t\t\t"style.terminal.desc": "Monospace, comme un terminal",
\t\t\tdefaultTag: "Par défaut",
\t\t\tsaving: "Enregistrement…",
\t\t\tsaved: "Enregistré. La prochaine carte utilisera {style}.",
\t\t\tsaveFailed: "Impossible d'enregistrer le style. Réessayez.",
\t\t\treadOnly: "Ce profil ne peut pas être modifié d'ici.",
\t\t\toverridden: "Défini dans votre profil",
\t\t\treset: "Utiliser la valeur par défaut",
\t\t\tunavailableTitle: "Ce dsh ne peut pas modifier le style de la carte d'ici",
\t\t\tunavailableBody: "Définissez-le dans {path} à la place :",
\t\t\tpreviewTitle: "Inscriptions en hausse de 18 % cette semaine",
\t\t\tpreviewNote: "Inscriptions hebdomadaires, 8 dernières semaines",
\t\t\tfilesHeading: "Fichiers de style personnalisés",
\t\t\tfilesIntro: "Notes que le modèle lit après le style intégré, comme les couleurs ou les mots à privilégier. Le fichier de l'espace de travail est lu en dernier. Chaque fichier compte jusqu'à {max} octets.",
\t\t\tglobalFile: "Tous les espaces de travail",
\t\t\tworkspaceFile: "Espace de travail",
\t\t\tworkspacePick: "Espace de travail",
\t\t\tfileExists: "Existe",
\t\t\tfileMissing: "Non créé",
\t\t\tfileBlocked: "Ce chemin est un lien ou n'est pas un fichier normal, il ne peut donc pas être modifié d'ici.",
\t\t\tbytes: "{bytes} / {max} octets",
\t\t\ttooLarge: "Dépasse la limite de {max} octets de {over} octets.",
\t\t\tsaveFile: "Enregistrer",
\t\t\tfileSaved: "Enregistré. Il s'appliquera à partir du prochain chargement de la skill.",
\t\t\tfileRemoved: "Enregistré vide, le fichier a donc été supprimé.",
\t\t\tfileSaveFailed: "Impossible d'enregistrer le fichier : {reason}",
\t\t\tfilesUnavailable: "Ce dsh ne peut pas modifier les fichiers d'ici. Modifiez-les directement :",
\t\t\tfilesLoading: "Chargement des fichiers de style…",
\t\t\tplaceholder: "Par exemple : utilisez du vert sarcelle pour la couleur d'accent, étiquetez les axes en français.",
\t\t\tcardRendering: "Visualiser · rendu…",
\t\t\tcardError: "Visualiser · ",
\t\t\tcardStreaming: "Visualiser · aperçu en flux",
\t\t\tcardComposing: "Visualiser · composition…",
\t\t\tcardStreamingTitle: "Aperçu en flux de la visualisation"
\t\t};
\t\t/** German copy. */
\t\tconst DE = {
\t\t\tstyleHeading: "Kartenstil",
\t\t\tstyleIntro: "Neue Karten verwenden diesen Stil. Karten, die bereits in der Unterhaltung sind, behalten den Stil, in dem sie erstellt wurden.",
\t\t\t"style.whale": "Wal",
\t\t\t"style.whale.desc": "Passt zur dsh-Oberfläche",
\t\t\t"style.editorial": "Redaktionell",
\t\t\t"style.editorial.desc": "Die Überschrift nennt das Ergebnis, eine Story-Zeile",
\t\t\t"style.paper": "Artikel",
\t\t\t"style.paper.desc": "Wie eine Abbildung in einem Artikel",
\t\t\t"style.sketch": "Skizze",
\t\t\t"style.sketch.desc": "Handgezeichnet, wie an einem Whiteboard",
\t\t\t"style.terminal": "Terminal",
\t\t\t"style.terminal.desc": "Nichtproportional, wie ein Terminal",
\t\t\tdefaultTag: "Standard",
\t\t\tsaving: "Speichern…",
\t\t\tsaved: "Gespeichert. Die nächste Karte verwendet {style}.",
\t\t\tsaveFailed: "Der Stil konnte nicht gespeichert werden. Versuchen Sie es erneut.",
\t\t\treadOnly: "Dieses Profil kann von hier aus nicht bearbeitet werden.",
\t\t\toverridden: "In Ihrem Profil festgelegt",
\t\t\treset: "Standard verwenden",
\t\t\tunavailableTitle: "Dieses dsh kann den Kartenstil nicht von hier aus ändern",
\t\t\tunavailableBody: "Legen Sie ihn stattdessen in {path} fest:",
\t\t\tpreviewTitle: "Anmeldungen diese Woche um 18 % gestiegen",
\t\t\tpreviewNote: "Wöchentliche Anmeldungen, letzte 8 Wochen",
\t\t\tfilesHeading: "Eigene Stildateien",
\t\t\tfilesIntro: "Hinweise, die das Modell nach dem eingebauten Stil liest, etwa bevorzugte Farben oder Formulierungen. Die Datei des Arbeitsbereichs wird zuletzt gelesen. Jede Datei zählt bis zu {max} Bytes.",
\t\t\tglobalFile: "Alle Arbeitsbereiche",
\t\t\tworkspaceFile: "Arbeitsbereich",
\t\t\tworkspacePick: "Arbeitsbereich",
\t\t\tfileExists: "Vorhanden",
\t\t\tfileMissing: "Nicht angelegt",
\t\t\tfileBlocked: "Dieser Pfad ist ein Link oder keine reguläre Datei, daher kann er von hier aus nicht bearbeitet werden.",
\t\t\tbytes: "{bytes} / {max} Bytes",
\t\t\ttooLarge: "Überschreitet das Limit von {max} Bytes um {over} Bytes.",
\t\t\tsaveFile: "Speichern",
\t\t\tfileSaved: "Gespeichert. Es gilt ab dem nächsten Laden der Skill.",
\t\t\tfileRemoved: "Leer gespeichert, daher wurde die Datei entfernt.",
\t\t\tfileSaveFailed: "Die Datei konnte nicht gespeichert werden: {reason}",
\t\t\tfilesUnavailable: "Dieses dsh kann die Dateien nicht von hier aus bearbeiten. Bearbeiten Sie sie direkt:",
\t\t\tfilesLoading: "Stildateien werden geladen…",
\t\t\tplaceholder: "Zum Beispiel: Verwenden Sie Türkis für die Akzentfarbe, beschriften Sie Achsen auf Deutsch.",
\t\t\tcardRendering: "Visualisieren · Darstellung…",
\t\t\tcardError: "Visualisieren · ",
\t\t\tcardStreaming: "Visualisieren · Streaming-Vorschau",
\t\t\tcardComposing: "Visualisieren · Zusammenstellen…",
\t\t\tcardStreamingTitle: "Streaming-Vorschau der Visualisierung"
\t\t};
\t\t/** Russian copy. */
\t\tconst RU = {
\t\t\tstyleHeading: "Стиль карточки",
\t\t\tstyleIntro: "Новые карточки используют этот стиль. Карточки, уже присутствующие в разговоре, сохраняют стиль, в котором они были созданы.",
\t\t\t"style.whale": "Кит",
\t\t\t"style.whale.desc": "Соответствует интерфейсу dsh",
\t\t\t"style.editorial": "Редакционный",
\t\t\t"style.editorial.desc": "Заголовок передаёт вывод, одна сюжетная строка",
\t\t\t"style.paper": "Статья",
\t\t\t"style.paper.desc": "Как рисунок в статье",
\t\t\t"style.sketch": "Набросок",
\t\t\t"style.sketch.desc": "Нарисовано от руки, как на доске",
\t\t\t"style.terminal": "Терминал",
\t\t\t"style.terminal.desc": "Моноширинный, как в терминале",
\t\t\tdefaultTag: "По умолчанию",
\t\t\tsaving: "Сохранение…",
\t\t\tsaved: "Сохранено. Следующая карточка будет использовать {style}.",
\t\t\tsaveFailed: "Не удалось сохранить стиль. Попробуйте снова.",
\t\t\treadOnly: "Этот профиль нельзя редактировать отсюда.",
\t\t\toverridden: "Задано в вашем профиле",
\t\t\treset: "Использовать значение по умолчанию",
\t\t\tunavailableTitle: "Этот dsh не может изменить стиль карточки отсюда",
\t\t\tunavailableBody: "Задайте его в {path} вместо этого:",
\t\t\tpreviewTitle: "Регистрации выросли на 18% за эту неделю",
\t\t\tpreviewNote: "Еженедельные регистрации, последние 8 недель",
\t\t\tfilesHeading: "Пользовательские файлы стиля",
\t\t\tfilesIntro: "Заметки, которые модель читает после встроенного стиля, например предпочитаемые цвета или формулировки. Файл рабочей области читается последним. Каждый файл учитывается до {max} байт.",
\t\t\tglobalFile: "Все рабочие области",
\t\t\tworkspaceFile: "Рабочая область",
\t\t\tworkspacePick: "Рабочая область",
\t\t\tfileExists: "Существует",
\t\t\tfileMissing: "Не создан",
\t\t\tfileBlocked: "Этот путь является ссылкой или не является обычным файлом, поэтому его нельзя редактировать отсюда.",
\t\t\tbytes: "{bytes} / {max} байт",
\t\t\ttooLarge: "Превышает лимит {max} байт на {over} байт.",
\t\t\tsaveFile: "Сохранить",
\t\t\tfileSaved: "Сохранено. Применится со следующей загрузки skill.",
\t\t\tfileRemoved: "Сохранено пустым, поэтому файл удалён.",
\t\t\tfileSaveFailed: "Не удалось сохранить файл: {reason}",
\t\t\tfilesUnavailable: "Этот dsh не может редактировать файлы отсюда. Отредактируйте их напрямую:",
\t\t\tfilesLoading: "Загрузка файлов стиля…",
\t\t\tplaceholder: "Например: используйте бирюзовый для акцента, подписывайте оси по-русски.",
\t\t\tcardRendering: "Визуализация · отрисовка…",
\t\t\tcardError: "Визуализация · ",
\t\t\tcardStreaming: "Визуализация · потоковый предпросмотр",
\t\t\tcardComposing: "Визуализация · сборка…",
\t\t\tcardStreamingTitle: "Потоковый предпросмотр визуализации"
\t\t};
\t\t/** Japanese copy. */
\t\tconst JA = {
\t\t\tstyleHeading: "カードスタイル",
\t\t\tstyleIntro: "新しいカードはこのスタイルを使用します。会話にすでにあるカードは、作成時のスタイルを保ちます。",
\t\t\t"style.whale": "ホエール",
\t\t\t"style.whale.desc": "dsh のインターフェースに合わせる",
\t\t\t"style.editorial": "エディトリアル",
\t\t\t"style.editorial.desc": "見出しが結論を示す、一本のストーリーライン",
\t\t\t"style.paper": "論文",
\t\t\t"style.paper.desc": "論文の図のような見た目",
\t\t\t"style.sketch": "スケッチ",
\t\t\t"style.sketch.desc": "ホワイトボードのような手描き",
\t\t\t"style.terminal": "ターミナル",
\t\t\t"style.terminal.desc": "ターミナルのような等幅フォント",
\t\t\tdefaultTag: "デフォルト",
\t\t\tsaving: "保存中…",
\t\t\tsaved: "保存しました。次回のカードは {style} を使用します。",
\t\t\tsaveFailed: "スタイルを保存できませんでした。もう一度お試しください。",
\t\t\treadOnly: "このプロファイルはここから編集できません。",
\t\t\toverridden: "プロファイルで設定済み",
\t\t\treset: "デフォルトを使用",
\t\t\tunavailableTitle: "この dsh ではカードスタイルをここから変更できません",
\t\t\tunavailableBody: "代わりに {path} で設定してください：",
\t\t\tpreviewTitle: "今週の登録数が18%増加",
\t\t\tpreviewNote: "週次の登録数、直近8週間",
\t\t\tfilesHeading: "カスタムスタイルファイル",
\t\t\tfilesIntro: "モデルが組み込みスタイルの後に読むメモです。優先する色や言い回しなど。ワークスペースのファイルが最後に読まれます。各ファイルは最大 {max} バイトまで有効です。",
\t\t\tglobalFile: "すべてのワークスペース",
\t\t\tworkspaceFile: "ワークスペース",
\t\t\tworkspacePick: "ワークスペース",
\t\t\tfileExists: "存在します",
\t\t\tfileMissing: "未作成",
\t\t\tfileBlocked: "このパスはリンクか通常のファイルではないため、ここからは編集できません。",
\t\t\tbytes: "{bytes} / {max} バイト",
\t\t\ttooLarge: "{max} バイトの上限を {over} バイト超過しています。",
\t\t\tsaveFile: "保存",
\t\t\tfileSaved: "保存しました。次回の skill ロードから適用されます。",
\t\t\tfileRemoved: "空で保存されたため、ファイルを削除しました。",
\t\t\tfileSaveFailed: "ファイルを保存できませんでした：{reason}",
\t\t\tfilesUnavailable: "この dsh ではここからファイルを編集できません。直接編集してください：",
\t\t\tfilesLoading: "スタイルファイルを読み込み中…",
\t\t\tplaceholder: "例：アクセントに青緑を使う、軸ラベルは日本語で。",
\t\t\tcardRendering: "可視化 · レンダリング中…",
\t\t\tcardError: "可視化 · ",
\t\t\tcardStreaming: "可視化 · ストリーミングプレビュー",
\t\t\tcardComposing: "可視化 · 生成中…",
\t\t\tcardStreamingTitle: "可視化のストリーミングプレビュー"
\t\t};
\t\t/** Every shipped dictionary, by language. */
\t\tconst DICTIONARIES = {
\t\t\ten: EN,
\t\t\tzh: ZH,
\t\t\tpt: PT,
\t\t\tes: ES,
\t\t\tfr: FR,
\t\t\tde: DE,
\t\t\tru: RU,
\t\t\tja: JA
\t\t};`;

/**
 * Replace the language gate and translator selection of the shared bundle.
 * @param {string} text - the client bundle.
 * @returns {string} the localized bundle.
 */
function localizeVisualize(text) {
  if (text.includes('const DICTIONARIES = {')) {
    // Dictionaries already present; only a later card-header addition still needs its edits.
    return addVisualizeCardCopy(text);
  }
  let next = text;

  const gate = `\t\t/**
\t\t* Map a host locale id to the page's language.
\t\t* @param active - the host's active locale id, if known.
\t\t* @returns English only for an \`en\` locale; everything else reads Chinese.
\t\t*/
\t\tfunction settingsLang(active) {
\t\t\treturn active !== void 0 && active.toLowerCase().startsWith("en") ? "en" : "zh";
\t\t}`;
  const newGate = `\t\t/**
\t\t* Map a host locale id to the page's language.
\t\t* @param active - the host's active locale id, if known.
\t\t* @returns the matched shipped language; an unknown or absent locale reads Chinese.
\t\t*/
\t\tfunction settingsLang(active) {
\t\t\tif (active === void 0) return "zh";
\t\t\tconst base = active.toLowerCase().split(/[-_]/u)[0];
\t\t\tif (base === "en" || base === "zh" || base === "pt" || base === "es" || base === "fr" || base === "de" || base === "ru" || base === "ja") return base;
\t\t\treturn "zh";
\t\t}`;
  if (!next.includes(gate)) throw new Error('visualize: settingsLang gate not found');
  next = next.replace(gate, () => `${VISUALIZE_CARD_LOOKUP}
${VISUALIZE_DICTIONARIES}
${newGate}`);

  const oldTranslator = `\t\tfunction translator(lang) {
\t\t\tconst dict = lang === "en" ? EN : ZH;`;
  if (!next.includes(oldTranslator)) throw new Error('visualize: translator selection not found');
  next = next.replace(oldTranslator, () => `\t\tfunction translator(lang) {
\t\t\tconst dict = DICTIONARIES[lang];`);

  const sectionId = `\t\t/** Section id in the settings dialog. */
\t\tconst SECTION_ID = "dsh-visualize";`;
  if (!next.includes(sectionId)) throw new Error('visualize: section id anchor not found');
  next = next.replace(sectionId, () => `${sectionId}
\t\t/** The section label the settings dialog shows, by page language. */
\t\tconst SECTION_LABELS = {
\t\t\ten: "Visualize",
\t\t\tzh: "可视化",
\t\t\tpt: "Visualizar",
\t\t\tes: "Visualizar",
\t\t\tfr: "Visualiser",
\t\t\tde: "Visualisieren",
\t\t\tru: "Визуализация",
\t\t\tja: "可視化"
\t\t};`);

  const oldLabel = '\t\t\t\t\tlabel: () => lang() === "en" ? "Visualize" : "可视化",';
  if (!next.includes(oldLabel)) throw new Error('visualize: section label not found');
  next = next.replace(oldLabel, () => '\t\t\t\t\tlabel: () => SECTION_LABELS[lang()],');

  return addVisualizeCardCopy(next);
}

/**
 * Move the two card headers out of their components and into the dictionaries,
 * so every shipped language renders them.
 * @param {string} text - the localized bundle.
 * @returns {string} the bundle with translated card headers.
 */
function addVisualizeCardCopy(text) {
  let next = text;

  const enTail = '\t\t\tplaceholder: "For example: use teal for the accent, label axes in English."\n\t\t};';
  if (next.includes(enTail)) next = next.replace(enTail, () => `\t\t\tplaceholder: "For example: use teal for the accent, label axes in English.",
${VISUALIZE_CARD_KEYS}
\t\t};`);

  const zhTail = '\t\t\tplaceholder: "例如：强调色用青绿色，坐标轴标签用英文。"\n\t\t};';
  if (next.includes(zhTail)) next = next.replace(zhTail, () => `\t\t\tplaceholder: "例如：强调色用青绿色，坐标轴标签用英文。",
${VISUALIZE_CARD_KEYS_ZH}
\t\t};`);

  const replacements = [
    ['children: "Visualize · rendering…"', 'children: cardText().cardRendering'],
    ['children: ["Visualize · ", firstResultLine(block.content)]', 'children: [cardText().cardError, firstResultLine(block.content)]'],
    ['children: hasContent ? "Visualize · streaming preview" : "Visualize · composing…"', 'children: hasContent ? cardText().cardStreaming : cardText().cardComposing'],
    ['title: "Visualization streaming preview"', 'title: cardText().cardStreamingTitle'],
  ];
  for (const [from, to] of replacements) next = next.split(from).join(to);

  const applyHead = '\t\tfunction apply(ctx) {\n\t\t\tctx.slots.inject("tool.call.toolview", () => ctx.slots.register({';
  if (next.includes(applyHead)) {
    next = next.replace(applyHead, () => `\t\tfunction apply(ctx) {
\t\t\tconst locale = localeOf(ctx);
\t\t\tif (locale !== void 0) activeLocaleService = locale;
\t\t\tctx.slots.inject("tool.call.toolview", () => ctx.slots.register({`);
  }

  return next;
}

// ---------------------------------------------------------------------------
// dsh-plugin-smooth-stream
// ---------------------------------------------------------------------------

/** The settings copy `dsh-plugin-smooth-stream` adds to its registered namespace. */
const SMOOTH_STREAM_COPY = `      pt: {
        nav: 'Smooth Stream',
        reveal: 'Animação de entrada',
        duration: 'Duração da animação',
        batch: 'Tamanho do lote',
        batchUnit: 'caracteres',
        batchHint: 'Quanto texto se acumula antes de um lote de parágrafo aparecer. Menor parece mais ao vivo; maior lê mais calmo.',
        follow: 'Rolagem suave acompanhando durante o streaming',
        replay: 'Repetir prévia',
        reset: 'Restaurar padrões',
        'opt.fade': 'Desvanecer', 'opt.rise': 'Elevar', 'opt.dissolve': 'Dissolver',
        'opt.wipe': 'Deslizar', 'opt.focus': 'Focar', 'opt.glow': 'Brilhar',
        'opt.iris': 'Íris', 'opt.soak': 'Absorver',
        enabled: 'Ativar Smooth Stream', enabledHint: 'Desligado devolve a renderização à visualização embutida — útil para comparar.',
        perStyleHint: 'Duração e tamanho do lote são lembrados por estilo de animação; os padrões são ajustados por estilo.'
      },
      es: {
        nav: 'Smooth Stream',
        reveal: 'Animación de entrada',
        duration: 'Duración de la animación',
        batch: 'Tamaño del lote',
        batchUnit: 'caracteres',
        batchHint: 'Cuánto texto se acumula antes de que aparezca un lote de párrafo. Menor se siente más en vivo; mayor se lee más tranquilo.',
        follow: 'Desplazamiento suave de seguimiento durante el streaming',
        replay: 'Repetir vista previa',
        reset: 'Restaurar valores predeterminados',
        'opt.fade': 'Fundido', 'opt.rise': 'Elevar', 'opt.dissolve': 'Disolver',
        'opt.wipe': 'Deslizar', 'opt.focus': 'Enfocar', 'opt.glow': 'Brillar',
        'opt.iris': 'Iris', 'opt.soak': 'Absorber',
        enabled: 'Activar Smooth Stream', enabledHint: 'Desactivado devuelve el renderizado a la vista integrada — útil para comparar.',
        perStyleHint: 'La duración y el tamaño del lote se recuerdan por estilo de animación; los valores predeterminados se ajustan por estilo.'
      },
      fr: {
        nav: 'Smooth Stream',
        reveal: "Animation d'apparition",
        duration: "Durée de l'animation",
        batch: 'Taille du lot',
        batchUnit: 'caractères',
        batchHint: "Combien de texte s'accumule avant qu'un lot de paragraphe apparaisse. Plus petit paraît plus vivant ; plus grand se lit plus calmement.",
        follow: 'Défilement fluide qui suit pendant le streaming',
        replay: "Rejouer l'aperçu",
        reset: 'Rétablir les valeurs par défaut',
        'opt.fade': 'Fondu', 'opt.rise': 'Montée', 'opt.dissolve': 'Dissolution',
        'opt.wipe': 'Balayage', 'opt.focus': 'Mise au point', 'opt.glow': 'Éclat',
        'opt.iris': 'Iris', 'opt.soak': 'Absorption',
        enabled: 'Activer Smooth Stream', enabledHint: "Désactivé, le rendu revient à la vue intégrée — pratique pour comparer.",
        perStyleHint: "La durée et la taille du lot sont mémorisées par style d'animation ; les valeurs par défaut sont réglées par style."
      },
      de: {
        nav: 'Smooth Stream',
        reveal: 'Einblendanimation',
        duration: 'Animationsdauer',
        batch: 'Stapelgröße',
        batchUnit: 'Zeichen',
        batchHint: 'Wie viel Text sich ansammelt, bevor ein Absatzstapel erscheint. Kleiner wirkt lebendiger; größer liest sich ruhiger.',
        follow: 'Sanftes Scrollbegleiten während des Streamings',
        replay: 'Vorschau wiederholen',
        reset: 'Auf Standard zurücksetzen',
        'opt.fade': 'Einblenden', 'opt.rise': 'Aufsteigen', 'opt.dissolve': 'Auflösen',
        'opt.wipe': 'Wischen', 'opt.focus': 'Fokus', 'opt.glow': 'Glühen',
        'opt.iris': 'Iris', 'opt.soak': 'Durchtränken',
        enabled: 'Smooth Stream aktivieren', enabledHint: 'Aus gibt das Rendering an die eingebaute Ansicht zurück — praktisch zum Vergleichen.',
        perStyleHint: 'Dauer und Stapelgröße werden je Animationsstil gespeichert; die Standardwerte sind je Stil abgestimmt.'
      },
      ru: {
        nav: 'Smooth Stream',
        reveal: 'Анимация появления',
        duration: 'Длительность анимации',
        batch: 'Размер пакета',
        batchUnit: 'символов',
        batchHint: 'Сколько текста накапливается, прежде чем появится пакет абзаца. Меньше ощущается живее; больше читается спокойнее.',
        follow: 'Плавное следование прокруткой во время стриминга',
        replay: 'Повторить предпросмотр',
        reset: 'Сбросить к значениям по умолчанию',
        'opt.fade': 'Растворение', 'opt.rise': 'Подъём', 'opt.dissolve': 'Рассеивание',
        'opt.wipe': 'Смахивание', 'opt.focus': 'Фокус', 'opt.glow': 'Свечение',
        'opt.iris': 'Ирис', 'opt.soak': 'Впитывание',
        enabled: 'Включить Smooth Stream', enabledHint: 'Выключено возвращает отрисовку встроенному представлению — удобно для сравнения.',
        perStyleHint: 'Длительность и размер пакета запоминаются отдельно для каждого стиля анимации; значения по умолчанию настроены под стиль.'
      },
      ja: {
        nav: 'Smooth Stream',
        reveal: '登場アニメーション',
        duration: 'アニメーションの長さ',
        batch: 'バッチサイズ',
        batchUnit: '文字',
        batchHint: '段落バッチが表示されるまでにどれだけテキストをためるか。小さいほどライブ感があり、大きいほど落ち着いて読めます。',
        follow: 'ストリーミング中のスムーズなスクロール追従',
        replay: 'プレビューを再生',
        reset: 'デフォルトに戻す',
        'opt.fade': 'フェード', 'opt.rise': 'ライズ', 'opt.dissolve': 'ディゾルブ',
        'opt.wipe': 'ワイプ', 'opt.focus': 'フォーカス', 'opt.glow': 'グロー',
        'opt.iris': 'アイリス', 'opt.soak': '染み込み',
        enabled: 'Smooth Stream を有効化', enabledHint: 'オフにすると組み込み表示に戻ります — 比較に便利です。',
        perStyleHint: '長さとバッチサイズはアニメーションスタイルごとに記憶され、デフォルトは各スタイルに合わせて調整されています。'
      }
    };`;

/**
 * Extend the Smooth Stream dictionaries and use the host's language before
 * the locale service binds its own translate function.
 * @param {string} text - the client bundle.
 * @returns {string} the localized bundle.
 */
function localizeSmoothStream(text) {
  if (text.includes("pt: {\n        nav: 'Smooth Stream',")) return text;
  let next = text;

  const zhEnd = `        enabled: '启用 Smooth Stream', enabledHint: '关闭后恢复内置渲染，方便对比效果。',
        perStyleHint: '时长与分批大小按动画风格分别记忆，默认值已按各风格调校。'
      }
    };`;
  if (!next.includes(zhEnd)) throw new Error('smooth-stream: dictionary end not found');
  next = next.replace(zhEnd, () => `        enabled: '启用 Smooth Stream', enabledHint: '关闭后恢复内置渲染，方便对比效果。',
        perStyleHint: '时长与分批大小按动画风格分别记忆，默认值已按各风格调校。'
      },
${SMOOTH_STREAM_COPY}`);

  const translate = `    let t = function (key) { return I18N.en[key] || key; };`;
  if (!next.includes(translate)) throw new Error('smooth-stream: translate default not found');
  next = next.replace(translate, () => `${translate}
    const hostLang = (function () {
      try {
        const loc = ctx.get('locale');
        return loc && loc.getSnapshot ? loc.getSnapshot().active : undefined;
      } catch (e) { return undefined; }
    })();
    if (hostLang && typeof hostLang === 'string') {
      const base = hostLang.toLowerCase().split(/[-_]/)[0];
      if (I18N[base]) t = function (key) { return I18N[base][key] || I18N.en[key] || key; };
    }`);

  return next;
}

const plugins = [
  {
    name: '@nagi-ovo/dsh-visualize',
    files: [
      { relative: 'lib/client.js', transform: localizeVisualize },
      { relative: 'src/client/settings-locale.ts', transform: null },
      { relative: 'src/client/settings.tsx', transform: null },
    ],
  },
  {
    name: 'dsh-plugin-smooth-stream',
    files: [
      { relative: 'lib/client.js', transform: localizeSmoothStream },
    ],
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

for (const plugin of plugins) {
  const root = pluginRoot(plugin.name);
  const manifest = await readOptional(join(root, 'package.json'));
  if (manifest === undefined) {
    console.warn(`skipped: ${plugin.name} is not installed at ${root}`);
    continue;
  }
  for (const file of plugin.files) {
    if (file.transform === null) continue;
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
  console.log(`Plugin localization already applied (${checked} files checked)`);
} else if (checkOnly) {
  console.error(`${changed} of ${checked} files need the plugin localization`);
  process.exitCode = 1;
} else {
  console.log(`Plugin localization applied (${changed} of ${checked} files)`);
}
