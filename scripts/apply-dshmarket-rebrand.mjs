/**
 * Rebrand the installed dshmarket plugin for CopyMonster.
 *
 * Rewrites the plugin's shipped UI copy (client bundle, locale source, host
 * diagnostics) and adds CopyMonster palette overrides scoped to the market's
 * own root. Product ids, package names, environment variables, and file paths
 * are left untouched: `\bDSH\b` does not match `DSH_HOME`, `DSH_GITHUB_TOKEN`,
 * `DSHM_GITHUB_PROXY`, or `__DSH_*` globals.
 *
 * Safe to run repeatedly: brand strings and the CSS marker are checked before
 * each write, and absent files are skipped.
 *
 * Usage:
 *   node scripts/apply-dshmarket-rebrand.mjs [--plugin-root <dir>] [--check]
 *   DSHMARKET_PLUGIN_ROOT=<dir> node scripts/apply-dshmarket-rebrand.mjs
 *
 * Profile postinstall, from `<DSH_HOME>/profiles/web/package.json`:
 *   "postinstall": "node ../../../copymonster-launch/scripts/apply-dshmarket-rebrand.mjs"
 * The relative path assumes the profile and repository share the same parent.
 */

import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative as relativePath, resolve } from 'node:path';
import { homedir } from 'node:os';

const CSS_MARKER = '/* copymonster-rebrand */';

/**
 * CopyMonster palette, mapped onto the `--dsw-alias-*` tokens the market's
 * client bundle and host primitives already read. `--cm-*` is defined by
 * `apps/web/src/cm-theme.css` for both light and dark themes, so the same
 * rules cover both without duplicating color literals here.
 */
const PALETTE = [
  '--dsw-alias-brand-primary:var(--cm-primary,#967d45)',
  '--dsw-alias-brand-primary-new-colorprimary-new-color:var(--cm-primary,#967d45)',
  '--dsw-alias-state-business-primary:var(--cm-primary,#967d45)',
  '--dsw-alias-button-primary-fill:var(--cm-primary,#967d45)',
  '--dsw-alias-button-primary-hover:color-mix(in srgb,var(--cm-primary,#967d45) 86%,#000)',
  '--dsw-alias-label-primary-foreground:var(--cm-primary-foreground,#fff)',
  '--dsw-alias-link:var(--cm-primary,#967d45)',
  '--dsw-alias-bg-layer-1:var(--cm-card,#faf9f5)',
  '--dsw-alias-bg-layer-2:var(--cm-card,#faf9f5)',
  '--dsw-alias-bg-layer-3:var(--cm-popover,#fff)',
  '--dsw-alias-label-primary:var(--cm-card-foreground,#181611)',
  '--dsw-alias-label-secondary:var(--cm-muted-foreground,#83827d)',
  '--dsw-alias-label-tertiary:var(--cm-muted-foreground,#83827d)',
  '--dsw-alias-border-l1:var(--cm-border,#dad9d4)',
  '--dsw-alias-border-l2:var(--cm-border,#dad9d4)',
  '--dsw-alias-border-l3:var(--cm-border,#dad9d4)',
].join(';');

const replacements = [
  ['Plugin Market', 'CopyMonster Market'],
  ['DeepSeek Harness', 'CopyMonster'],
];

/** Matches the standalone product name only, never `DSH_*` or `__DSH_*`. */
const DSH = /\bDSH\b/g;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function isFile(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function pluginRoot() {
  const explicit = argValue('--plugin-root') ?? process.env.DSHMARKET_PLUGIN_ROOT;
  if (explicit) return resolve(explicit);
  const local = resolve(process.cwd(), 'node_modules/dshmarket');
  if (await isFile(local)) return local;
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles/web/node_modules/dshmarket');
}

async function listFiles(root, directory, extension) {
  if (!await isFile(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path, extension));
    else if (entry.name.endsWith(extension)) files.push(relativePath(root, path));
  }
  return files;
}

function rebrandText(text) {
  let next = text;
  for (const [from, to] of replacements) next = next.split(from).join(to);
  return next.replace(DSH, 'CopyMonster');
}

/**
 * Add the palette to the market's CSS string inside the built client bundle.
 * The scoped root class is read from the bundle itself because the CSS-module
 * hash changes between dshmarket releases.
 *
 * @param text - Built `client/client.js`.
 * @returns The file text with one scoped rule set, or the input when the
 *   bundle no longer carries the expected CSS string.
 */
function injectBundleCss(text) {
  if (text.includes(CSS_MARKER)) return text;
  const root = /\.([A-Za-z0-9_-]+_root)\{/.exec(text)?.[1];
  if (root === undefined) return text;
  const anchor = '\t\tconst tagId = "dshmarket/Market.module.css";';
  const anchorIndex = text.indexOf(anchor);
  if (anchorIndex === -1) return text;
  const close = text.lastIndexOf('";', anchorIndex);
  if (close === -1) return text;
  const css = `${CSS_MARKER}.${root}{${PALETTE}}`;
  return text.slice(0, close) + css + text.slice(close);
}

async function rewrite(path, relative, transform, checkOnly, state) {
  const original = await readFile(path, 'utf8');
  const text = transform(original);
  if (text === original) return;
  state.changed += 1;
  if (checkOnly) {
    console.error(`outdated: ${relative}`);
    return;
  }
  await writeFile(path, text);
  console.log(`updated: ${relative}`);
}

const root = await pluginRoot();
if (!await isFile(join(root, 'package.json'))) {
  throw new Error(`dshmarket was not found at ${root}`);
}

const checkOnly = process.argv.includes('--check');
const state = { changed: 0 };

const files = [
  'package.json',
  'client/client.js',
  'src/client/locales.ts',
  'src/client/Market.module.css',
  ...await listFiles(root, join(root, 'lib'), '.js'),
];

for (const relative of files) {
  const path = join(root, relative);
  if (!await isFile(path)) continue;
  if (relative === 'src/client/Market.module.css') {
    await rewrite(path, relative, text => text.includes(CSS_MARKER)
      ? text
      : `${text.trimEnd()}\n${CSS_MARKER}.root{${PALETTE}}\n`, checkOnly, state);
    continue;
  }
  await rewrite(path, relative, text => {
    const branded = rebrandText(text);
    return relative === 'client/client.js' ? injectBundleCss(branded) : branded;
  }, checkOnly, state);
}

if (checkOnly && state.changed > 0) {
  process.exitCode = 1;
} else if (state.changed === 0) {
  console.log(`CopyMonster market rebrand already applied under ${root}`);
} else {
  console.log(`CopyMonster market rebrand applied under ${root}`);
}
