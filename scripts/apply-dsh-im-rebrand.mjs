/**
 * Rebrand the installed @xmanrui/dsh-im plugin for CopyMonster.
 *
 * Applies only the CopyMonster brand names to the plugin source and shipped
 * client/host bundles. Interface copy stays in the plugin's English base so
 * the app's language selection keeps working. Safe to run repeatedly: absent
 * originals are treated as already applied.
 *
 * Usage:
 *   node scripts/apply-dsh-im-rebrand.mjs [--plugin-root <dir>] [--check]
 *   DSH_IM_PLUGIN_ROOT=<dir> node scripts/apply-dsh-im-rebrand.mjs
 *
 * Profile postinstall, from `<DSH_HOME>/profiles/web/package.json`:
 *   "postinstall": "node ../../../copymonster-launch/scripts/apply-dsh-im-rebrand.mjs"
 * The relative path assumes the profile and repository share the same parent.
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const replacements = [
  // Brand every visible channel label, help text, and reply prefix. Provider
  // ids and model names stay lowercase ("deepseek-chat") and are not touched.
  ['DeepSeek Harness', 'CopyMonster'],
  ['DeepSeekHarness', 'CopyMonster'],
  ['DeepSeek-Harness', 'CopyMonster'],
  ['@@ DSH', '@@ CM'],
  ['🤖 DSH', '🤖 CM'],
  ['Harness Host', 'CopyMonster Host'],
  ['Connecting DeepSeek Harness', 'Connecting CopyMonster'],
  ['DSH-IM update', 'CopyMonster IM update'],
  ['Only DSH-IM will be updated', 'Only CopyMonster IM will be updated'],
  ['Harness in WeChat', 'CopyMonster in WeChat'],
  ['DSH management API', 'CopyMonster management API'],
  ['Harness Host is not ready', 'CopyMonster Host is not ready'],
  ['No registered Workspaces still exist on the current Harness Host.',
    'No registered Workspaces still exist on the current CopyMonster Host.'],
  ['Workspaces on the current Harness Host ({count}):',
    'Workspaces on the current CopyMonster Host ({count}):'],
  ['WeChat was authorized, but the Harness Host trust check rejected a non-loopback request. Please check the harnessBaseUrl and trustedHosts configuration.',
    'WeChat was authorized, but the CopyMonster Host trust check rejected a non-loopback request. Please check the harnessBaseUrl and trustedHosts configuration.'],
  ['The QR code is issued by Tencent WeChat iLink. After you scan and confirm, account credentials are written directly to the Harness Host and are never exposed to the browser.',
    'The QR code is issued by Tencent WeChat iLink. After you scan and confirm, account credentials are written directly to the CopyMonster Host and are never exposed to the browser.'],
  ['Authorization is completed on DingTalk’s official page. The account must belong to an organization and be allowed to create bots. Credentials are written directly to the Harness Host.',
    'Authorization is completed on DingTalk’s official page. The account must belong to an organization and be allowed to create bots. Credentials are written directly to the CopyMonster Host.'],
  ['Tencent will create or connect a QQ bot and securely deliver its credentials to the local Harness Host.',
    'Tencent will create or connect a QQ bot and securely deliver its credentials to the local CopyMonster Host.'],
  ['WeCom will create an AI bot and securely deliver its credentials to the local Harness Host.',
    'WeCom will create an AI bot and securely deliver its credentials to the local CopyMonster Host.'],
  ['DSH-IM 主', 'CopyMonster IM 主'],
  ['DSH-IM \\u4E3B', 'CopyMonster IM \\u4E3B'],
  ['"dim-brandName" }, "DSH-IM"', '"dim-brandName" }, "CopyMonster IM"'],
  ["'dim-brandName' }, 'DSH-IM'", "'dim-brandName' }, 'CopyMonster IM'"],
];

const files = [
  'plugin-src/client/i18n.js',
  'plugin-src/client/index.js',
  'plugin-src/client/channels/dingtalk/index.js',
  'plugin-src/client/channels/email/index.js',
  'plugin-src/client/channels/feishu/index.js',
  'plugin-src/client/channels/imessage/index.js',
  'plugin-src/client/channels/qq/index.js',
  'plugin-src/client/channels/shared/token-channel.js',
  'plugin-src/client/channels/wecom-app/index.js',
  'plugin-src/client/channels/wecom/index.js',
  'plugin-src/client/channels/weixin/index.js',
  'plugin-src/client/channels/whatsapp/index.js',
  'plugin-src/host/delivery-rpc.mjs',
  'plugin-src/host/channels/feishu/connection-supervisor.mjs',
  'src/channels/dingtalk/dingtalk-bridge.mjs',
  'src/channels/discord/discord-runtime.mjs',
  'src/channels/feishu/feishu-channel.mjs',
  'src/channels/feishu/feishu-runtime.mjs',
  'src/channels/feishu/multi-bot-controller.mjs',
  'src/channels/feishu/plugin-controller.mjs',
  'src/channels/imessage/imessage-api.mjs',
  'src/channels/matrix/matrix-api.mjs',
  'src/channels/office/office-job-executor.mjs',
  'src/channels/qq/qq-bridge.mjs',
  'src/channels/qq/qq-menu.mjs',
  'src/channels/shared/agent-preset.mjs',
  'src/channels/shared/connection-test.mjs',
  'src/channels/shared/harness-approval.mjs',
  'src/channels/shared/harness-question.mjs',
  'src/channels/shared/i18n-en/dingtalk.mjs',
  'src/channels/shared/i18n-en/feishu.mjs',
  'src/channels/shared/i18n-en/office.mjs',
  'src/channels/shared/i18n-en/qq.mjs',
  'src/channels/shared/i18n-en/shared-a.mjs',
  'src/channels/shared/i18n-en/shared-b.mjs',
  'src/channels/shared/i18n-en/shared-c.mjs',
  'src/channels/shared/i18n-en/wecom-app.mjs',
  'src/channels/shared/i18n-en/wecom.mjs',
  'src/channels/shared/i18n-en/weixin.mjs',
  'src/channels/shared/i18n-en/diagnostics.mjs',
  'src/channels/shared/message-failure.mjs',
  'src/channels/shared/text-harness-bridge.mjs',
  'src/channels/shared/workspace-command.mjs',
  'src/channels/slack/manifest.mjs',
  'src/channels/slack/slack-api.mjs',
  'src/channels/wecom-app/wecom-app-bridge.mjs',
  'src/channels/wecom/wecom-bridge.mjs',
  'src/channels/weixin/weixin-bridge.mjs',
  'src/channels/weixin/connection-error.en.mjs',
  'src/channels/whatsapp/whatsapp-web-session.mjs',
  'lib/client.js',
  'lib/index.js',
];

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
  const explicit = argValue('--plugin-root') ?? process.env.DSH_IM_PLUGIN_ROOT;
  if (explicit) return resolve(explicit);
  const local = resolve(process.cwd(), 'node_modules/@xmanrui/dsh-im');
  if (await isFile(local)) return local;
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles/web/node_modules/@xmanrui/dsh-im');
}

const root = await pluginRoot();
if (!await isFile(join(root, 'package.json'))) {
  throw new Error(`@xmanrui/dsh-im was not found at ${root}`);
}

const checkOnly = process.argv.includes('--check');
let changed = 0;
for (const file of files) {
  const path = join(root, file);
  if (!await isFile(path)) continue;
  const original = await readFile(path, 'utf8');
  let text = original;
  for (const [from, to] of replacements) {
    if (text.includes(to) && !text.includes(from)) continue;
    text = text.split(from).join(to);
  }
  if (text === original) continue;
  changed += 1;
  if (checkOnly) {
    console.error(`outdated: ${file}`);
    continue;
  }
  await writeFile(path, text);
  console.log(`updated: ${file}`);
}

if (checkOnly && changed > 0) {
  process.exitCode = 1;
} else if (changed === 0) {
  console.log(`CopyMonster rebrand already applied under ${root}`);
} else {
  console.log(`CopyMonster rebrand applied under ${root}`);
}
