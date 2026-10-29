#!/usr/bin/env node
/**
 * check-branding.mjs
 *
 * Gate to verify CopyMonster branding consistency in user-visible strings.
 * Only scans locale dictionaries and UI component strings.
 * Ignores technical identifiers, documentation, comments, and test files.
 *
 * Usage: node scripts/check-branding.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());

// Prohibited terms in USER-VISIBLE strings only
const PROHIBITED = [
  // DeepSeek slogans (upstream Hero text)
  { term: '探索未至之境', note: 'Use "文案、漏斗与发售" (zh)' },
  { term: 'Para o desconhecido', note: 'Use "Copy, Funis e Lançamentos" (pt)' },
  { term: 'Hacia lo desconocido', note: 'Use "Copy, Embudos y Lanzamientos" (es)' },
  { term: "Dans l'inconnu", note: 'Use "Copy, Tunnels & Lancements" (fr)' },
  { term: 'Ins Unbekannte', note: 'Use "Copy, Funnels & Launches" (de)' },
  { term: '未知への挑戦', note: 'Use "コピー、ファネル＆ローンチ" (ja)' },
  { term: 'В неизвестность', note: 'Use "Копирайтинг, воронки и запуски" (ru)' },

  // DSH brand.localBuild fallbacks
  { term: 'Versão local do DSH', note: 'Use "CopyMonster" (pt)' },
  { term: 'Compilación local de DSH', note: 'Use "CopyMonster" (es)' },
  { term: 'Version locale de DSH', note: 'Use "CopyMonster" (fr)' },
  { term: 'Lokaler DSH-Build', note: 'Use "CopyMonster" (de)' },
  { term: 'DSHローカルビルド', note: 'Use "CopyMonster" (ja)' },
  { term: 'Локальная сборка DSH', note: 'Use "CopyMonster" (ru)' },
  { term: 'DSH 本地构建', note: 'Use "CopyMonster" (zh)' },

  // Error messages referencing DSH
  { term: 'running DSH instance', note: 'Use "running CopyMonster instance"' },
  { term: 'instância DSH em execução', note: 'Use "instância CopyMonster em execução" (pt)' },
  { term: 'instancia de DSH en ejecución', note: 'Use "instancia de CopyMonster en ejecución" (es)' },
  { term: 'instance DSH en cours', note: 'Use "instance CopyMonster en cours" (fr)' },
  { term: 'laufende DSH-Instanz', note: 'Use "laufende CopyMonster-Instanz" (de)' },
  { term: 'DSH インスタンス', note: 'Use "CopyMonster インスタンス" (ja)' },
  { term: 'работающим экземпляром DSH', note: 'Use "работающим экземпляром CopyMonster" (ru)' },

  // Account/sign-in messages
  { term: 'signed out of DeepSeek', note: 'Use "signed out of CopyMonster"' },
  { term: 'saiu de DeepSeek', note: 'Use "saiu da sua conta CopyMonster" (pt)' },
  { term: 'cerró sesión en DeepSeek', note: 'Use "cerró sesión en CopyMonster" (es)' },
  { term: 'déconnecté de DeepSeek', note: 'Use "déconnecté de CopyMonster" (fr)' },
  { term: 'von DeepSeek abgemeldet', note: 'Use "von CopyMonster abgemeldet" (de)' },
  { term: 'DeepSeekからログアウト', note: 'Use "CopyMonsterからログアウト" (ja)' },
  { term: 'вышли из DeepSeek', note: 'Use "вышли из CopyMonster" (ru)' },
  { term: '退出 DeepSeek', note: 'Use "退出 CopyMonster" (zh)' },

  { term: 'sign in to DeepSeek', note: 'Use "sign in to CopyMonster"' },
  { term: 'faça login em DeepSeek', note: 'Use "faça login no CopyMonster" (pt)' },
  { term: 'iniciar sesión en DeepSeek', note: 'Use "iniciar sesión en CopyMonster" (es)' },
  { term: 'connectez-vous à DeepSeek', note: 'Use "connectez-vous à CopyMonster" (fr)' },
  { term: 'melden Sie sich bei DeepSeek an', note: 'Use "melden Sie sich bei CopyMonster an" (de)' },
  { term: 'DeepSeekにログイン', note: 'Use "CopyMonsterにログイン" (ja)' },
  { term: 'войдите в DeepSeek', note: 'Use "войдите в CopyMonster" (ru)' },
  { term: '登录 DeepSeek', note: 'Use "登录 CopyMonster" (zh)' },

  // Onboarding brand references
  { term: 'DeepSeek Harness 会以本地文件夹', note: 'Use "CopyMonster 会以本地文件夹" (zh)' },
  { term: 'DeepSeek Harness works in a local folder', note: 'Use "CopyMonster works in a local folder" (en)' },
  { term: 'DeepSeek Harness はローカルフォルダ', note: 'Use "CopyMonster はローカルフォルダ" (ja)' },
  { term: 'DeepSeek Harness funciona en una carpeta local', note: 'Use "CopyMonster funciona en una carpeta local" (es)' },
  { term: 'DeepSeek Harness fonctionne dans un dossier local', note: 'Use "CopyMonster fonctionne dans un dossier local" (fr)' },
  { term: 'DeepSeek Harness arbeitet in einem lokalen Ordner', note: 'Use "CopyMonster arbeitet in einem lokalen Ordner" (de)' },
  { term: 'DeepSeek Harness работает в локальной папке', note: 'Use "CopyMonster работает в локальной папке" (ru)' },
  { term: 'DeepSeek Harness funciona em uma pasta local', note: 'Use "CopyMonster funciona em uma pasta local" (pt)' },

  // Plugin manager restart/install messages
  { term: '重启 DSH', note: 'Use "重启 CopyMonster" (zh)' },
  { term: 'Restart DSH', note: 'Use "Restart CopyMonster" (en)' },
  { term: 'DSH を再起動', note: 'Use "CopyMonster を再起動" (ja)' },
  { term: 'Reinicie DSH', note: 'Use "Reinicie CopyMonster" (es/pt)' },
  { term: 'Redémarrez DSH', note: 'Use "Redémarrez CopyMonster" (fr)' },
  { term: 'Starten Sie DSH neu', note: 'Use "Starten Sie CopyMonster neu" (de)' },
  { term: 'Перезапустите DSH', note: 'Use "Перезапустите CopyMonster" (ru)' },

  { term: 'damage DeepSeek Harness', note: 'Use "damage CopyMonster"' },
  { term: '破坏 DeepSeek Harness', note: 'Use "破坏 CopyMonster" (zh)' },
  { term: 'DeepSeek Harnessを破壊', note: 'Use "CopyMonsterを破壊" (ja)' },
  { term: 'dañar DeepSeek Harness', note: 'Use "dañar CopyMonster" (es)' },
  { term: 'endommager DeepSeek Harness', note: 'Use "endommager CopyMonster" (fr)' },
  { term: 'DeepSeek Harness beschädigen', note: 'Use "CopyMonster beschädigen" (de)' },
  { term: 'повредить DeepSeek Harness', note: 'Use "повредить CopyMonster" (ru)' },
  { term: 'danificar DeepSeek Harness', note: 'Use "danificar CopyMonster" (pt)' },

  // Settings models welcome body
  { term: 'DeepSeek Harness 0.2', note: 'Use "CopyMonster 0.1" in welcome body' },
  { term: 'DeepSeek Harness 0.1', note: 'Use "CopyMonster 0.1" in welcome body (if not already)' },

  // Agent preset
  { term: 'add capabilities to DSH', note: 'Use "add capabilities to CopyMonster"' },
  { term: 'extender las capacidades de DSH', note: 'Use "extender las capacidades de CopyMonster" (es)' },
  { term: 'ajouter des fonctionnalités à DSH', note: 'Use "ajouter des fonctionnalités à CopyMonster" (fr)' },
  { term: 'DSH Funktionen hinzuzufügen', note: 'Use "CopyMonster Funktionen hinzuzufügen" (de)' },
  { term: 'расширить возможности DSH', note: 'Use "расширить возможности CopyMonster" (ru)' },
  { term: 'adicionar recursos ao DSH', note: 'Use "adicionar recursos ao CopyMonster" (pt)' },
  { term: '扩展 DSH 的能力', note: 'Use "扩展 CopyMonster 的能力" (zh)' },
  { term: 'DSH に機能を追加', note: 'Use "CopyMonster に機能を追加" (ja)' },

  { term: 'your own DSH plugin', note: 'Use "your own CopyMonster plugin"' },
  { term: 'su propio complemento DSH', note: 'Use "su propio complemento CopyMonster" (es)' },
  { term: 'votre propre plugin DSH', note: 'Use "votre propre plugin CopyMonster" (fr)' },
  { term: 'Ihr eigenes DSH-Plugin', note: 'Use "Ihr eigenes CopyMonster-Plugin" (de)' },
  { term: 'свой собственный плагин DSH', note: 'Use "свой собственный плагин CopyMonster" (ru)' },
  { term: 'seu próprio plug-in DSH', note: 'Use "seu próprio plug-in CopyMonster" (pt)' },
  { term: '你的 DSH 插件', note: 'Use "你的 CopyMonster 插件" (zh)' },
  { term: '独自の DSH プラグイン', note: 'Use "独自の CopyMonster プラグイン" (ja)' },

  // Sidebar browser
  { term: 'DSH 应用', note: 'Use "CopyMonster 应用" (zh)' },
  { term: 'DSH application', note: 'Use "CopyMonster application" (en)' },
  { term: 'DSHアプリ', note: 'Use "CopyMonsterアプリ" (ja)' },
  { term: 'aplicación DSH', note: 'Use "aplicación CopyMonster" (es)' },
  { term: 'application DSH', note: 'Use "application CopyMonster" (fr)' },
  { term: 'DSH-Anwendung', note: 'Use "CopyMonster-Anwendung" (de)' },
  { term: 'приложение DSH', note: 'Use "приложение CopyMonster" (ru)' },
  { term: 'aplicativo DSH', note: 'Use "aplicativo CopyMonster" (pt)' },
];

// Files to scan: ONLY locale dictionaries and UI components with user-visible strings
const SCAN_PATHS = [
  'packages/client/ui-conversation/src/client/locales.ts',
  'packages/client/locale/src/locales',
  'packages/client/ui-chat/src/client/locale.ts',
  'packages/client/ui-settings-account/src/client/locales.ts',
  'packages/client/ui-settings-account/src/client/locales/onboarding.ts',
  'packages/client/ui-settings-models/src/client/locales.ts',
  'packages/client/ui-plugin-manager/src/client/locales.ts',
  'packages/client/ui-agent-preset/src/client/locales.ts',
  'packages/client/ui-sidebar-browser/src/client/locales.ts',
  'apps/web/src/locales',
];

function collectFiles(paths) {
  const files = [];
  for (const p of paths) {
    const fullPath = path.join(ROOT, p);
    if (!fs.existsSync(fullPath)) continue;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(fullPath);
      for (const entry of entries) {
        const ext = path.extname(entry);
        if (['.ts', '.tsx'].includes(ext)) {
          files.push(path.join(fullPath, entry));
        }
      }
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function isInCommentBlock(lines, lineIdx) {
  // Simple check: if we're inside a /* ... */ block
  let inBlock = false;
  for (let i = 0; i <= lineIdx; i++) {
    const line = lines[i];
    if (line.includes('/*') && !line.includes('*/')) inBlock = true;
    if (line.includes('*/')) inBlock = false;
  }
  return inBlock;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments
    if (isCommentLine(line) || isInCommentBlock(lines, i)) continue;

    for (const { term, note } of PROHIBITED) {
      if (line.includes(term)) {
        violations.push({
          file: path.relative(ROOT, filePath),
          line: i + 1,
          term,
          note,
          context: line.trim().slice(0, 120),
        });
      }
    }
  }
  return violations;
}

function main() {
  console.log('=== CopyMonster Branding Check ===\n');

  const files = collectFiles(SCAN_PATHS);
  console.log(`Scanning ${files.length} locale/UI files...\n`);

  let totalViolations = 0;
  const violationsByFile = {};

  for (const file of files) {
    const violations = scanFile(file);
    if (violations.length > 0) {
      violationsByFile[file] = violations;
      totalViolations += violations.length;
    }
  }

  if (totalViolations === 0) {
    console.log('✅ No branding violations found in user-visible strings.');
    process.exit(0);
  }

  console.log(`❌ Found ${totalViolations} branding violation(s) in ${Object.keys(violationsByFile).length} file(s):\n`);

  for (const [file, violations] of Object.entries(violationsByFile)) {
    console.log(`📄 ${file}`);
    for (const v of violations) {
      console.log(`   Line ${v.line}: "${v.term}"`);
      console.log(`   → ${v.note}`);
      console.log(`   Context: ${v.context}`);
      console.log('');
    }
  }

  console.log(`\nTotal: ${totalViolations} violation(s)`);
  console.log('\nRun `node scripts/apply-copymonster-locales-rebrand.mjs` to auto-fix locale files.');
  process.exit(1);
}

main();