#!/usr/bin/env node
/**
 * apply-copymonster-locales-rebrand.mjs
 *
 * Automated rebranding script for CopyMonster locales.
 * Applies consistent CopyMonster branding across all locale files.
 * Run after any upstream merge to prevent regressions.
 *
 * Usage: node scripts/apply-copymonster-locales-rebrand.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());

// Phase 1: Hero translations (8 languages)
const HERO_TRANSLATIONS = {
  zh: { 'hero.headline': '文案、漏斗与发售', 'hero.preview': '新' },
  en: { 'hero.headline': 'Copy, Funnels & Launches', 'hero.preview': 'New' },
  ja: { 'hero.headline': 'コピー、ファネル＆ローンチ', 'hero.preview': 'New' },
  es: { 'hero.headline': 'Copy, Embudos y Lanzamientos', 'hero.preview': 'Nuevo' },
  fr: { 'hero.headline': "Copy, Tunnels & Lancements", 'hero.preview': 'Nouveau' },
  de: { 'hero.headline': 'Copy, Funnels & Launches', 'hero.preview': 'Neu' },
  ru: { 'hero.headline': 'Копирайтинг, воронки и запуски', 'hero.preview': 'Новое' },
  pt: { 'hero.headline': 'Copy, Funis e Lançamentos', 'hero.preview': 'Novo' },
};

// Phase 2: brand.localBuild (7 languages - zh/en already correct)
const BRAND_LOCALBUILD = {
  pt: 'CopyMonster',
  es: 'CopyMonster',
  fr: 'CopyMonster',
  de: 'CopyMonster',
  ja: 'CopyMonster',
  ru: 'CopyMonster',
  zh: 'CopyMonster',
};

// Phase 2: error.sessionInUse (8 languages)
const ERROR_SESSION_IN_USE = {
  zh: '当前会话已被占用，可能是其他正在运行的 CopyMonster 导致的（如其他 CopyMonster web、桌面端），请退出其他正在运行的 CopyMonster 后重试。',
  en: 'This session is already in use, possibly by another running CopyMonster instance (such as CopyMonster web or the desktop app). Quit other running CopyMonster instances and try again.',
  ja: 'このセッションはすでに使用中です。別の実行中のCopyMonsterインスタンス（CopyMonster webやデスクトップアプリなど）が使用している可能性があります。他のCopyMonsterインスタンスを終了して再試行してください。',
  es: 'Esta sesión ya está en uso, posiblemente por otra instancia de CopyMonster en ejecución (como CopyMonster web o la aplicación de escritorio). Salga de otras instancias de CopyMonster en ejecución y vuelva a intentarlo.',
  fr: "Cette session est déjà utilisée, éventuellement par une autre instance CopyMonster en cours d'exécution (telle que CopyMonster Web ou l'application de bureau). Quittez les autres instances CopyMonster en cours d'exécution et réessayez.",
  de: 'Diese Sitzung wird bereits verwendet, möglicherweise von einer anderen laufenden CopyMonster-Instanz (z. B. CopyMonster Web oder der Desktop-App). Beenden Sie andere laufende CopyMonster-Instanzen und versuchen Sie es erneut.',
  ru: 'Этот сеанс уже используется, возможно, другим работающим экземпляром CopyMonster (например, веб-сайтом CopyMonster или настольным приложением). Закройте другие работающие экземпляры CopyMonster и повторите попытку.',
  pt: 'Esta sessão já está em uso, possivelmente por outra instância CopyMonster em execução (como CopyMonster web ou aplicativo de desktop). Saia de outras instâncias CopyMonster em execução e tente novamente.',
};

// Phase 2: message.failure keys (7 languages - zh/en already correct)
const CHAT_FAILURE_KEYS = {
  ja: {
    'message.failure.accountSignedOut': 'CopyMonsterからログアウトしたため停止しました。',
    'message.failure.interrupted': 'このターンが完了する前にCopyMonsterプロセスが終了したため（強制終了、クラッシュ、シャットダウン中のタイムアウトなど）、CopyMonsterの再起動時にターンは閉じられました。未完了のツール呼び出しの結果は不明です。',
    'message.failure.accountSignInRequired': 'CopyMonsterにログインし、リクエスト先がアカウント認証に対応していることを確認してください。',
  },
  es: {
    'message.failure.accountSignedOut': 'Se detuvo porque cerró sesión en CopyMonster.',
    'message.failure.interrupted': 'El proceso CopyMonster salió antes de que terminara este turno (por ejemplo, se detuvo, se estrelló o se agotó el tiempo de espera mientras se apagaba), por lo que el turno se cerró cuando se reinició CopyMonster. Las llamadas a herramientas inacabadas tienen resultados desconocidos.',
    'message.failure.accountSignInRequired': 'Inicie sesión en CopyMonster y asegúrese de que el destino de la solicitud admita la autenticación de la cuenta.',
  },
  fr: {
    'message.failure.accountSignedOut': 'Arrêté car vous vous êtes déconnecté de CopyMonster.',
    'message.failure.interrupted': "Le processus CopyMonster s'est terminé avant la fin de ce tour (par exemple, il a été arrêté, s'est écrasé ou a expiré lors de l'arrêt), de sorte que le tour a été fermé lorsque CopyMonster a redémarré. Les appels d'outils inachevés ont des résultats inconnus.",
    'message.failure.accountSignInRequired': "Connectez-vous à CopyMonster et assurez-vous que la destination de la demande prend en charge l'authentification du compte.",
  },
  de: {
    'message.failure.accountSignedOut': 'Gestoppt, weil Sie sich von CopyMonster abgemeldet haben.',
    'message.failure.interrupted': 'Der CopyMonster-Prozess wurde beendet, bevor dieser Zug beendet war (z. B. wurde er beendet, stürzte ab oder es kam zu einer Zeitüberschreitung beim Herunterfahren), sodass der Zug geschlossen wurde, als CopyMonster neu gestartet wurde. Unvollendete Werkzeugaufrufe haben unbekannte Ergebnisse.',
    'message.failure.accountSignInRequired': 'Melden Sie sich bei CopyMonster an und stellen Sie sicher, dass das Anforderungsziel die Kontoauthentifizierung unterstützt.',
  },
  ru: {
    'message.failure.accountSignedOut': 'Остановлено, поскольку вы вышли из CopyMonster.',
    'message.failure.interrupted': 'Процесс CopyMonster завершился до завершения этого хода (например, был завершен, произошел сбой или истекло время ожидания при завершении работы), поэтому ход был закрыт при перезапуске CopyMonster. Незавершенные вызовы инструментов имеют неизвестные результаты.',
    'message.failure.accountSignInRequired': 'Войдите в CopyMonster и убедитесь, что пункт назначения запроса поддерживает аутентификацию учетной записи.',
  },
  pt: {
    'message.failure.accountSignedOut': 'Interrompido porque você saiu da sua conta CopyMonster.',
    'message.failure.interrupted': 'O processo CopyMonster foi encerrado antes do término deste turno (por exemplo, ele foi eliminado, travou ou expirou durante o desligamento), portanto, o turno foi encerrado quando CopyMonster foi reiniciado. Chamadas de ferramentas inacabadas têm resultados desconhecidos.',
    'message.failure.accountSignInRequired': 'Faça login no CopyMonster e verifique se o destino da solicitação suporta autenticação de conta.',
  },
};

// File paths to update
const FILES = {
  'ui-conversation': 'packages/client/ui-conversation/src/client/locales.ts',
  'locale': 'packages/client/locale/src/locales',
  'ui-chat': 'packages/client/ui-chat/src/client/locale.ts',
  'ui-settings-account': 'packages/client/ui-settings-account/src/client/locales.ts',
  'ui-settings-account-onboarding': 'packages/client/ui-settings-account/src/client/locales/onboarding.ts',
  'ui-settings-models': 'packages/client/ui-settings-models/src/client/locales.ts',
  'ui-plugin-manager': 'packages/client/ui-plugin-manager/src/client/locales.ts',
  'ui-agent-preset': 'packages/client/ui-agent-preset/src/client/locales.ts',
  'ui-sidebar-browser': 'packages/client/ui-sidebar-browser/src/client/locales.ts',
  'web-en': 'apps/web/src/locales/en.ts',
  'web-zh': 'apps/web/src/locales/zh.ts',
  'web-pt': 'apps/web/src/locales/pt.ts',
};

function updateLocaleFile(filePath, updates) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  for (const [key, value] of Object.entries(updates)) {
    // Match both single and double quoted keys, with various spacing
    const patterns = [
      `'${key}': '[^']*'`,  // single quoted value
      `"${key}": "[^"]*"`,  // double quoted value
    ];

    for (const pattern of patterns) {
      const regex = new RegExp(pattern);
      const replacement = `'${key}': '${value}'`;
      if (regex.test(content)) {
        content = content.replace(regex, replacement);
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ Updated ${path.relative(ROOT, filePath)}`);
  }
  return changed;
}

function updateAllLocales() {
  console.log('=== CopyMonster Locale Rebranding ===\n');

  // 1. Update ui-conversation locales (Hero + error.sessionInUse)
  console.log('1. Updating ui-conversation locales...');
  const uiConvPath = FILES['ui-conversation'];
  let content = fs.readFileSync(uiConvPath, 'utf-8');
  let changed = false;

  for (const [lang, hero] of Object.entries(HERO_TRANSLATIONS)) {
    for (const [key, value] of Object.entries(hero)) {
      const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
      const replacement = `'${key}': '${value}'`;
      if (pattern.test(content)) {
        content = content.replace(pattern, replacement);
        changed = true;
      }
    }
  }

  // error.sessionInUse
  for (const [lang, value] of Object.entries(ERROR_SESSION_IN_USE)) {
    const pattern = /'error\.sessionInUse':\s*'[^']*'/;
    // We need to find the right language block - this is complex
    // Instead, let's do a targeted replacement per language block
  }

  if (changed) {
    fs.writeFileSync(uiConvPath, content, 'utf-8');
    console.log(`  ✓ Updated ${path.relative(ROOT, uiConvPath)}`);
  }

  // For complex multi-language files, we'll use a more targeted approach
  // Let's read the file and do language-specific replacements
  applyUiConversationLocales();
  applyLocaleLocales();
  applyUiChatLocales();
  applyUiSettingsAccountLocales();
  applyUiSettingsModelsLocales();
  applyUiPluginManagerLocales();
  applyUiAgentPresetLocales();
  applyUiSidebarBrowserLocales();
  applyWebLocales();

  console.log('\n=== Done ===');
}

function applyUiConversationLocales() {
  const filePath = FILES['ui-conversation'];
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  // Hero translations - match each language block
  const langBlocks = {
    zh: { start: "export const zh = {", end: "} satisfies Record<string, string>" },
    en: { start: "export const en = {", end: "} satisfies Record<ConversationKey, string>" },
    ja: { start: "export const ja = {", end: "} satisfies Record<keyof typeof en, string>" },
    es: { start: "export const es = {", end: "} satisfies Record<keyof typeof en, string>" },
    fr: { start: "export const fr = {", end: "} satisfies Record<keyof typeof en, string>" },
    de: { start: "export const de = {", end: "} satisfies Record<keyof typeof en, string>" },
    ru: { start: "export const ru = {", end: "} satisfies Record<keyof typeof en, string>" },
    pt: { start: "export const pt = {", end: "} satisfies Record<keyof typeof en, string>" },
  };

  for (const [lang, block] of Object.entries(langBlocks)) {
    const hero = HERO_TRANSLATIONS[lang];
    const startIdx = content.indexOf(block.start);
    if (startIdx === -1) continue;

    // Find the end of this language block (next export const or end of file)
    let searchStart = startIdx;
    let endIdx = content.indexOf(block.end, searchStart);
    if (endIdx === -1) endIdx = content.length;

    // Replace hero.headline and hero.preview within this block
    let blockContent = content.slice(searchStart, endIdx + block.end.length);

    for (const [key, value] of Object.entries(hero)) {
      const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
      const replacement = `'${key}': '${value}'`;
      if (pattern.test(blockContent)) {
        const newBlockContent = blockContent.replace(pattern, replacement);
        content = content.slice(0, searchStart) + newBlockContent + content.slice(endIdx + block.end.length);
        changed = true;
        blockContent = newBlockContent; // Update for next replacement
      }
    }

    // error.sessionInUse
    const errorValue = ERROR_SESSION_IN_USE[lang];
    const errorPattern = /'error\.sessionInUse':\s*'[^']*'/;
    if (errorPattern.test(blockContent)) {
      const newBlockContent = blockContent.replace(errorPattern, `'error.sessionInUse': '${errorValue}'`);
      content = content.slice(0, searchStart) + newBlockContent + content.slice(endIdx + block.end.length);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
  }
}

function applyLocaleLocales() {
  const dir = FILES['locale'];
  const langs = ['pt', 'es', 'fr', 'de', 'ja', 'ru', 'zh'];
  for (const lang of langs) {
    const filePath = path.join(dir, `${lang}.ts`);
    if (!fs.existsSync(filePath)) continue;
    let content = fs.readFileSync(filePath, 'utf-8');
    const value = BRAND_LOCALBUILD[lang];
    const pattern = /'brand\.localBuild':\s*'[^']*'/;
    if (pattern.test(content)) {
      content = content.replace(pattern, `'brand.localBuild': '${value}'`);
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
    }
  }
}

function applyUiChatLocales() {
  const filePath = FILES['ui-chat'];
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  const langBlocks = {
    en: { start: "export const en = {", end: "} satisfies Record<ChatKey, string>" },
    ja: { start: "export const ja = {", end: "} satisfies Record<keyof typeof en, string>" },
    es: { start: "export const es = {", end: "} satisfies Record<keyof typeof en, string>" },
    fr: { start: "export const fr = {", end: "} satisfies Record<keyof typeof en, string>" },
    de: { start: "export const de = {", end: "} satisfies Record<keyof typeof en, string>" },
    ru: { start: "export const ru = {", end: "} satisfies Record<keyof typeof en, string>" },
    pt: { start: "export const pt = {", end: "} satisfies Record<keyof typeof en, string>" },
  };

  for (const [lang, block] of Object.entries(langBlocks)) {
    const keys = CHAT_FAILURE_KEYS[lang];
    if (!keys) continue; // zh already correct

    const startIdx = content.indexOf(block.start);
    if (startIdx === -1) continue;

    let blockContent = content.slice(startIdx);
    const endIdx = blockContent.indexOf(block.end);
    if (endIdx === -1) continue;
    blockContent = blockContent.slice(0, endIdx + block.end.length);

    let newBlockContent = blockContent;
    for (const [key, value] of Object.entries(keys)) {
      const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
      if (pattern.test(newBlockContent)) {
        newBlockContent = newBlockContent.replace(pattern, `'${key}': '${value}'`);
        changed = true;
      }
    }

    if (newBlockContent !== blockContent) {
      content = content.slice(0, startIdx) + newBlockContent + content.slice(startIdx + blockContent.length);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
  }
}

function applyUiSettingsAccountLocales() {
  // Main locales.ts
  const filePath = FILES['ui-settings-account'];
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  const updates = {
    'loginDescription': 'Sign in to your CopyMonster account or add an API Key to get started. Your projects and files are stored locally.',
    'backToHarness': 'Back to CopyMonster',
    'signedIn': 'Signed in to CopyMonster',
    'settingsSignedOutTitle': 'You are not signed in to CopyMonster',
    'settingsSignedOutDescription': 'Sign in to CopyMonster to get your dedicated API Key',
    'signInDescription': 'Use your CopyMonster account to get started.',
    'quotaDescription': 'CopyMonster cannot start a new task with this account when no balance is available. Would you like to top up? You can also top up later in Settings → Account.',
  };

  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
    if (pattern.test(content)) {
      content = content.replace(pattern, `'${key}': '${value}'`);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
  }

  // Onboarding locales
  const onboardingPath = FILES['ui-settings-account-onboarding'];
  content = fs.readFileSync(onboardingPath, 'utf-8');
  changed = false;

  const onboardingUpdates = {
    'onboardingBrand': 'CopyMonster',
    'onboardingIntroduction': 'CopyMonster works in a local folder and uses tools to read and write files on your computer. It can help you research and organize information, create documents and spreadsheets, write code, troubleshoot issues, and more.',
    'onboardingProcessDescription': 'This only changes how progress is shown, not what CopyMonster can do.',
    'onboardingNoCreditDescription': "CopyMonster can't start new tasks without credits. You can add them later in Settings → Account.",
    'onboardingSkipDescription': 'You can change how progress, performance, and usage are displayed, or enable Coding Tools, anytime in Settings → General.',
  };

  for (const [key, value] of Object.entries(onboardingUpdates)) {
    const pattern = new RegExp(`onboardingBrand:\\s*'[^']*'|onboardingIntroduction:\\s*'[^']*'|onboardingProcessDescription:\\s*'[^']*'|onboardingNoCreditDescription:\\s*'[^']*'|onboardingSkipDescription:\\s*'[^']*'`);
    const keyPattern = new RegExp(`${key}:\\s*'[^']*'`);
    if (keyPattern.test(content)) {
      content = content.replace(keyPattern, `${key}: '${value}'`);
      changed = true;
    }
  }

  // Also update other languages in onboarding
  const otherLangs = ['ja', 'es', 'fr', 'de', 'ru', 'pt', 'zh'];
  for (const lang of otherLangs) {
    const langBlockStart = lang === 'zh' ? "export const onboardingZh = {" : `export const onboarding${lang.charAt(0).toUpperCase() + lang.slice(1)} = {`;
    const startIdx = content.indexOf(langBlockStart);
    if (startIdx === -1) continue;

    // Find block end
    let braceCount = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    let blockContent = content.slice(startIdx, endIdx);
    const brandPattern = /onboardingBrand:\s*'[^']*'/;
    const introPattern = /onboardingIntroduction:\s*'[^']*'/;
    const processPattern = /onboardingProcessDescription:\s*'[^']*'/;
    const creditPattern = /onboardingNoCreditDescription:\s*'[^']*'/;

    if (brandPattern.test(blockContent)) blockContent = blockContent.replace(brandPattern, `onboardingBrand: 'CopyMonster'`);
    if (introPattern.test(blockContent)) blockContent = blockContent.replace(introPattern, `onboardingIntroduction: 'CopyMonster works in a local folder and uses tools to read and write files on your computer. It can help you research and organize information, create documents and spreadsheets, write code, troubleshoot issues, and more.'`);
    if (processPattern.test(blockContent)) blockContent = blockContent.replace(processPattern, `onboardingProcessDescription: 'This only changes how progress is shown, not what CopyMonster can do.'`);
    if (creditPattern.test(blockContent)) blockContent = blockContent.replace(creditPattern, `onboardingNoCreditDescription: "CopyMonster can't start new tasks without credits. You can add them later in Settings → Account."`);

    if (blockContent !== content.slice(startIdx, endIdx)) {
      content = content.slice(0, startIdx) + blockContent + content.slice(endIdx);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(onboardingPath, content, 'utf-8');
    console.log(`  ✓ ${path.relative(ROOT, onboardingPath)}`);
  }
}

function applyUiSettingsModelsLocales() {
  const filePath = FILES['ui-settings-models'];
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  // Update welcomeBody and onboardingDescription in all non-en/zh locales
  const langBlocks = {
    ja: { start: "export const ja = {", end: "} satisfies Record<keyof typeof en, string>" },
    es: { start: "export const es = {", end: "} satisfies Record<keyof typeof en, string>" },
    fr: { start: "export const fr = {", end: "} satisfies Record<keyof typeof en, string>" },
    de: { start: "export const de = {", end: "} satisfies Record<keyof typeof en, string>" },
    ru: { start: "export const ru = {", end: "} satisfies Record<keyof typeof en, string>" },
    pt: { start: "export const pt = {", end: "} satisfies Record<keyof typeof en, string>" },
  };

  const welcomeBody = `CopyMonster 0.1 remains in testing. Many areas still need improvement, and we welcome feedback from everyone using the platform. Core features and APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of great copywriting with you, building on open, reusable, and composable infrastructure. Thank you for joining the CopyMonster early testers.`;
  const onboardingDesc = 'Configure o provedor CopyMonster oficial para começar a compilar.';

  for (const [lang, block] of Object.entries(langBlocks)) {
    const startIdx = content.indexOf(block.start);
    if (startIdx === -1) continue;

    let blockContent = content.slice(startIdx);
    const endIdx = blockContent.indexOf(block.end);
    if (endIdx === -1) continue;
    blockContent = blockContent.slice(0, endIdx + block.end.length);

    let newBlockContent = blockContent;
    const welcomePattern = /welcomeBody:\s*'[^']*'/s;
    const onboardPattern = /onboardingDescription:\s*'[^']*'/;

    if (welcomePattern.test(newBlockContent)) {
      newBlockContent = newBlockContent.replace(welcomePattern, `welcomeBody: '${welcomeBody.replace(/'/g, "\\'")}'`);
      changed = true;
    }
    if (onboardPattern.test(newBlockContent)) {
      const desc = lang === 'pt' ? 'Configure o provedor CopyMonster oficial para começar a compilar.' : 'Configure el proveedor oficial CopyMonster para comenzar a construir.';
      newBlockContent = newBlockContent.replace(onboardPattern, `onboardingDescription: '${desc}'`);
      changed = true;
    }

    if (newBlockContent !== blockContent) {
      content = content.slice(0, startIdx) + newBlockContent + content.slice(startIdx + blockContent.length);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
  }
}

function applyUiPluginManagerLocales() {
  const filePath = FILES['ui-plugin-manager'];
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  const updates = {
    'restartNotice': 'Restart CopyMonster to apply the change. {reason}',
    'installGuideSafety': 'Install only plugins you trust: they run with your permissions and can damage CopyMonster or leak your data.',
    'installDoneRestart': 'Installed; restart CopyMonster to load it. {reason}',
  };

  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
    if (pattern.test(content)) {
      content = content.replace(pattern, `'${key}': '${value}'`);
      changed = true;
    }
  }

  // Other languages - this file has inline translations, need to update each
  const langBlocks = {
    ja: { start: "export const ja = {", end: "} satisfies Record<keyof typeof en, string>" },
    es: { start: "export const es = {", end: "} satisfies Record<keyof typeof en, string>" },
    fr: { start: "export const fr = {", end: "} satisfies Record<keyof typeof en, string>" },
    de: { start: "export const de = {", end: "} satisfies Record<keyof typeof en, string>" },
    ru: { start: "export const ru = {", end: "} satisfies Record<keyof typeof en, string>" },
    pt: { start: "export const pt = {", end: "} satisfies Record<keyof typeof en, string>" },
    zh: { start: "export const zh = {", end: "} satisfies Record<string, string>" },
  };

  const translations = {
    ja: {
      restartNotice: '変更を適用するには CopyMonster を再起動してください。{reason}',
      installGuideSafety: '信頼できるプラグインのみをインストールしてください。プラグインはあなたの権限で動作し、CopyMonsterを破壊したりデータを漏洩させたりする可能性があります。',
      installDoneRestart: 'インストール済みです。読み込むにはCopyMonsterを再起動してください。{reason}',
    },
    es: {
      restartNotice: 'Reinicie CopyMonster para aplicar el cambio. {reason}',
      installGuideSafety: 'Instale sólo complementos en los que confíe: se ejecutan con sus permisos y pueden dañar CopyMonster o filtrar sus datos.',
      installDoneRestart: 'Instalado; reinicie CopyMonster para cargarlo. {reason}',
    },
    fr: {
      restartNotice: 'Redémarrez CopyMonster pour appliquer la modification. {reason}',
      installGuideSafety: "Installez uniquement les plugins en qui vous avez confiance : ils s'exécutent avec vos autorisations et peuvent endommager CopyMonster ou divulguer vos données.",
      installDoneRestart: 'Installé ; redémarrez CopyMonster pour le charger. {reason}',
    },
    de: {
      restartNotice: 'Starten Sie CopyMonster neu, um die Änderung zu übernehmen. {reason}',
      installGuideSafety: 'Installieren Sie nur Plugins, denen Sie vertrauen: Sie werden mit Ihren Berechtigungen ausgeführt und können CopyMonster beschädigen oder Ihre Daten preisgeben.',
      installDoneRestart: 'Installiert; Starten Sie CopyMonster neu, um es zu laden. {reason}',
    },
    ru: {
      restartNotice: 'Перезапустите CopyMonster, чтобы применить изменения. {reason}',
      installGuideSafety: 'Устанавливайте только те плагины, которым вы доверяете: они запускаются с вашими разрешениями и могут повредить CopyMonster или привести к утечке ваших данных.',
      installDoneRestart: 'Установлен; перезапустите CopyMonster, чтобы загрузить его. {reason}',
    },
    pt: {
      restartNotice: 'Reinicie CopyMonster para aplicar a alteração. {reason}',
      installGuideSafety: 'Instale apenas plug-ins em que você confia: eles são executados com suas permissões e podem danificar CopyMonster ou vazar seus dados.',
      installDoneRestart: 'Instalado; reinicie CopyMonster para carregá-lo. {reason}',
    },
    zh: {
      restartNotice: '请重启 CopyMonster 使更改生效。{reason}',
      installGuideSafety: '请确认插件来源可信。插件在本机以你的权限运行，来源不明的插件可能损坏 CopyMonster，或读取和泄露你的数据。',
      installDoneRestart: '已安装，请重启 CopyMonster 加载它。{reason}',
    },
  };

  for (const [lang, block] of Object.entries(langBlocks)) {
    const trans = translations[lang];
    if (!trans) continue;

    const startIdx = content.indexOf(block.start);
    if (startIdx === -1) continue;

    let blockContent = content.slice(startIdx);
    const endIdx = blockContent.indexOf(block.end);
    if (endIdx === -1) continue;
    blockContent = blockContent.slice(0, endIdx + block.end.length);

    let newBlockContent = blockContent;
    for (const [key, value] of Object.entries(trans)) {
      const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
      if (pattern.test(newBlockContent)) {
        newBlockContent = newBlockContent.replace(pattern, `'${key}': '${value}'`);
        changed = true;
      }
    }

    if (newBlockContent !== blockContent) {
      content = content.slice(0, startIdx) + newBlockContent + content.slice(startIdx + blockContent.length);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
  }
}

function applyUiAgentPresetLocales() {
  const filePath = FILES['ui-agent-preset'];
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  const updates = {
    'sectionIntro': 'Choose the agent\'s tools and how it works. Use Standard mode for everyday tasks, or Creator mode to add capabilities to CopyMonster.',
    'presetCordisDescription': 'Customize CopyMonster through conversation. Let the agent write plugins that add features or UI, or combine tools and prompts to create your own mode.',
    'createPluginDescription': 'Enter Creator mode and make your own CopyMonster plugin',
  };

  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`${key}:\\s*'[^']*'`);
    if (pattern.test(content)) {
      content = content.replace(pattern, `${key}: '${value}'`);
      changed = true;
    }
  }

  // Other languages
  const langBlocks = {
    zh: { start: "export const zh: Record<AgentPresetSettingsKey, string> = {", end: "}" },
    ja: { start: "export const ja = {", end: "} satisfies Record<keyof typeof en, string>" },
    es: { start: "export const es = {", end: "} satisfies Record<keyof typeof en, string>" },
    fr: { start: "export const fr = {", end: "} satisfies Record<keyof typeof en, string>" },
    de: { start: "export const de = {", end: "} satisfies Record<keyof typeof en, string>" },
    ru: { start: "export const ru = {", end: "} satisfies Record<keyof typeof en, string>" },
    pt: { start: "export const pt = {", end: "} satisfies Record<keyof typeof en, string>" },
  };

  const translations = {
    zh: {
      sectionIntro: '选择 Agent 的工具和工作方式。日常任务用「标准模式」，扩展 CopyMonster 的能力用「创造模式」。',
      presetCordisDescription: '用对话定制 CopyMonster：让 Agent 编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。',
      createPluginDescription: '进入创造模式，制作属于你的 CopyMonster 插件',
    },
    ja: {
      sectionIntro: 'エージェントのツールと動作を選択します。日々のタスクには標準モードを、CopyMonster に機能を追加するにはクリエイターモードを使用してください。',
      presetCordisDescription: '会話を通じて CopyMonster をカスタマイズします。機能や UI を追加するプラグインをエージェントに書かせたり、ツールとプロンプトを組み合わせて独自のモードを作成したりできます。',
      createPluginDescription: 'クリエイターモードに入り、独自の CopyMonster プラグインを作成',
    },
    es: {
      sectionIntro: 'Elija las herramientas del agente y cómo funciona. Utilice el modo Estándar para las tareas diarias o el modo Creador para agregar capacidades a CopyMonster.',
      presetCordisDescription: 'Personaliza CopyMonster a través de la conversación. Deje que el agente escriba complementos que agreguen funciones o interfaz de usuario, o combine herramientas e indicaciones para crear su propio modo.',
      createPluginDescription: 'Ingrese al modo Creador y cree su propio complemento CopyMonster',
    },
    fr: {
      sectionIntro: 'Choisissez les outils de l\'agent et son fonctionnement. Utilisez le mode Standard pour les tâches quotidiennes ou le mode Créateur pour ajouter des fonctionnalités à CopyMonster.',
      presetCordisDescription: 'Personnalisez CopyMonster via la conversation. Laissez l\'agent écrire des plugins qui ajoutent des fonctionnalités ou une interface utilisateur, ou combinez des outils et des invites pour créer votre propre mode.',
      createPluginDescription: 'Entrez en mode Créateur et créez votre propre plugin CopyMonster',
    },
    de: {
      sectionIntro: 'Wählen Sie die Tools des Agenten und deren Funktionsweise aus. Verwenden Sie den Standardmodus für alltägliche Aufgaben oder den Creator-Modus, um CopyMonster Funktionen hinzuzufügen.',
      presetCordisDescription: 'Passen Sie CopyMonster durch Gespräche an. Lassen Sie den Agenten Plugins schreiben, die Funktionen oder Benutzeroberflächen hinzufügen, oder kombinieren Sie Tools und Eingabeaufforderungen, um Ihren eigenen Modus zu erstellen.',
      createPluginDescription: 'Wechseln Sie in den Erstellermodus und erstellen Sie Ihr eigenes CopyMonster-Plugin',
    },
    ru: {
      sectionIntro: 'Выбирайте инструменты агента и то, как они работают. Используйте стандартный режим для повседневных задач или режим Creator, чтобы расширить возможности CopyMonster.',
      presetCordisDescription: 'Настройте CopyMonster через разговор. Позвольте агенту писать плагины, которые добавляют функции или пользовательский интерфейс, или комбинируйте инструменты и подсказки для создания собственного режима.',
      createPluginDescription: 'Войдите в режим Creator и создайте свой собственный плагин CopyMonster.',
    },
    pt: {
      sectionIntro: 'Escolha as ferramentas do agente e como funciona. Use o modo Padrão para tarefas diárias ou o modo Criador para adicionar recursos ao CopyMonster.',
      presetCordisDescription: 'Personalize CopyMonster por meio de conversa. Deixe o agente escrever plug-ins que adicionem recursos ou UI, ou combine ferramentas e prompts para criar seu próprio modo.',
      createPluginDescription: 'Entre no modo Criador e crie seu próprio plug-in CopyMonster',
    },
  };

  for (const [lang, block] of Object.entries(langBlocks)) {
    const trans = translations[lang];
    if (!trans) continue;

    const startIdx = content.indexOf(block.start);
    if (startIdx === -1) continue;

    let blockContent = content.slice(startIdx);
    const endIdx = blockContent.indexOf(block.end);
    if (endIdx === -1) continue;
    blockContent = blockContent.slice(0, endIdx + block.end.length);

    let newBlockContent = blockContent;
    for (const [key, value] of Object.entries(trans)) {
      const pattern = new RegExp(`${key}:\\s*'[^']*'`);
      if (pattern.test(newBlockContent)) {
        newBlockContent = newBlockContent.replace(pattern, `${key}: '${value}'`);
        changed = true;
      }
    }

    if (newBlockContent !== blockContent) {
      content = content.slice(0, startIdx) + newBlockContent + content.slice(startIdx + blockContent.length);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
  }
}

function applyUiSidebarBrowserLocales() {
  const filePath = FILES['ui-sidebar-browser'];
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  const updates = {
    'error.application-origin': 'The embedded browser cannot open the CopyMonster application itself.',
  };

  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
    if (pattern.test(content)) {
      content = content.replace(pattern, `'${key}': '${value}'`);
      changed = true;
    }
  }

  // Other languages
  const langBlocks = {
    ja: { start: "export const ja = {", end: "} satisfies Record<keyof typeof en, string>" },
    es: { start: "export const es = {", end: "} satisfies Record<keyof typeof en, string>" },
    fr: { start: "export const fr = {", end: "} satisfies Record<keyof typeof en, string>" },
    de: { start: "export const de = {", end: "} satisfies Record<keyof typeof en, string>" },
    ru: { start: "export const ru = {", end: "} satisfies Record<keyof typeof en, string>" },
    pt: { start: "export const pt = {", end: "} satisfies Record<keyof typeof en, string>" },
    zh: { start: "export const zh = {", end: "} satisfies Record<string, string>" },
  };

  const translations = {
    ja: { 'error.application-origin': '埋め込みブラウザはCopyMonsterアプリ自体を開けません。' },
    es: { 'error.application-origin': 'El navegador integrado no puede abrir la aplicación CopyMonster.' },
    fr: { 'error.application-origin': "Le navigateur intégré ne peut pas ouvrir l'application CopyMonster elle-même." },
    de: { 'error.application-origin': 'Der eingebettete Browser kann die CopyMonster-Anwendung selbst nicht öffnen.' },
    ru: { 'error.application-origin': 'Встроенный браузер не может открыть само приложение CopyMonster.' },
    pt: { 'error.application-origin': 'O navegador incorporado não pode abrir o aplicativo CopyMonster sozinho.' },
    zh: { 'error.application-origin': '不能在嵌入浏览器中打开 CopyMonster 应用自身。' },
  };

  for (const [lang, block] of Object.entries(langBlocks)) {
    const trans = translations[lang];
    if (!trans) continue;

    const startIdx = content.indexOf(block.start);
    if (startIdx === -1) continue;

    let blockContent = content.slice(startIdx);
    const endIdx = blockContent.indexOf(block.end);
    if (endIdx === -1) continue;
    blockContent = blockContent.slice(0, endIdx + block.end.length);

    let newBlockContent = blockContent;
    for (const [key, value] of Object.entries(trans)) {
      const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
      if (pattern.test(newBlockContent)) {
        newBlockContent = newBlockContent.replace(pattern, `'${key}': '${value}'`);
        changed = true;
      }
    }

    if (newBlockContent !== blockContent) {
      content = content.slice(0, startIdx) + newBlockContent + content.slice(startIdx + blockContent.length);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
  }
}

function applyWebLocales() {
  // web en.ts
  const enPath = FILES['web-en'];
  let content = fs.readFileSync(enPath, 'utf-8');
  const enUpdates = {
    'auth.error.initTitle': 'Error initializing CopyMonster',
  };
  let changed = false;
  for (const [key, value] of Object.entries(enUpdates)) {
    const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
    if (pattern.test(content)) {
      content = content.replace(pattern, `'${key}': '${value}'`);
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(enPath, content, 'utf-8');
  console.log(`  ✓ ${path.relative(ROOT, enPath)}`);

  // web zh.ts
  const zhPath = FILES['web-zh'];
  content = fs.readFileSync(zhPath, 'utf-8');
  const zhUpdates = {
    'auth.error.initTitle': '初始化 CopyMonster 出错',
  };
  changed = false;
  for (const [key, value] of Object.entries(zhUpdates)) {
    const pattern = new RegExp(`'${key}':\\s*'[^']*'`);
    if (pattern.test(content)) {
      content = content.replace(pattern, `'${key}': '${value}'`);
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(zhPath, content, 'utf-8');
  console.log(`  ✓ ${path.relative(ROOT, zhPath)}`);
}

function main() {
  applyUiConversationLocales();
  applyLocaleLocales();
  applyUiChatLocales();
  applyUiSettingsAccountLocales();
  applyUiSettingsModelsLocales();
  applyUiPluginManagerLocales();
  applyUiAgentPresetLocales();
  applyUiSidebarBrowserLocales();
  applyWebLocales();
  console.log('\n=== Done ===');
}

main();