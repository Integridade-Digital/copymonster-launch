/**
 * Rebrand and localize the installed delivery plugins for CopyMonster.
 *
 * Vercel MCP ships a Chinese-first interface; GenUI, Automation, Mail, and
 * Preview ship English base copy with product-brand references. This script
 * translates the Vercel MCP panel and agent tools to English, maps each
 * plugin's default colors onto the CopyMonster `--cm-*` tokens, and replaces
 * user-visible `DSH` / `DeepSeek Harness` references with CopyMonster.
 *
 * Protected: package names, API paths, config keys, tool names, and the GenUI /
 * Automation Chinese locale dictionaries (they remain available for Chinese
 * users; the app's English locale selects the English dictionaries).
 *
 * Safe to run repeatedly: already-translated copy is left alone and absent
 * files are skipped.
 *
 * Usage:
 *   node scripts/apply-dsh-plugins-rebrand.mjs [--check]
 *   DSH_PLUGIN_ROOT=<profile-node_modules> node scripts/apply-dsh-plugins-rebrand.mjs
 *
 * Profile postinstall, from `<DSH_HOME>/profiles/web/package.json`:
 *   "postinstall": "... && node ../../../copymonster-launch/scripts/apply-dsh-plugins-rebrand.mjs"
 * The relative path assumes the profile and repository share the same parent.
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** Automation's package description carries a Chinese half next to its English half. */
const AUTOMATION_PACKAGE_REPLACEMENTS = [
  ['CopyMonster Automation — 在独立 CopyMonster Session 中按计划执行和管理编码任务 · Schedule and manage coding tasks in isolated CopyMonster sessions',
    'CopyMonster Automation — Schedule and manage coding tasks in isolated CopyMonster sessions'],
];

/** Automation client UI and command matching strings, longest first. */
const AUTOMATION_CLIENT_REPLACEMENTS = [
  ["删除工作区", "Delete Workspace"],
  ["新建任务", "New Task"],
  ["新会话", "New Session"],
  ["重命名", "Rename"],
  ["设置", "Settings"],
  ["账号", "Account"],
  ["账户", "Account"],
  ["删除", "Delete"],
];

/** CopyMonster palette bridge for the Scheduled tasks panel.
 *
 * The Automation client runs in the host document, so it resolves `--cm-*` from `apps/web/src/cm-theme.css`
 * directly. Its own stylesheet reads DSH design tokens (`--dsw-alias-*`) and
 * hardcodes the indigo hover/accent surfaces, so this block remaps those tokens
 * inside the panel's subtrees and replaces the indigo literals with token mixes.
 * antd surfaces and the primary seed come from `ConfigProvider` theme tokens
 * patched in `applyAutomationTheme`, which also reaches portaled modals and
 * selects that live outside these subtrees. */
const AUTOMATION_THEME_CSS = `
/* data-cm-automation-theme:start */
.dsh-st-shell,
.dsh-st-shell-rail,
.dsh-st-n,
.dsh-st-overview,
.dsh-st-form,
.dsh-st-prompt-card,
.dsh-st-skill-menu {
  --dsw-alias-bg-layer-1: var(--cm-popover);
  --dsw-alias-bg-layer-2: var(--cm-card);
  --dsw-alias-bg-layer-3: var(--cm-popover);
  --dsw-alias-border-l2: var(--cm-border);
  --dsw-alias-border-l4: var(--cm-border);
  --dsw-alias-border-inverted: var(--cm-border);
  --dsw-alias-label-primary: var(--cm-card-foreground);
  --dsw-alias-label-secondary: var(--cm-muted-foreground);
  --dsw-alias-label-tertiary: var(--cm-muted-foreground);
  --dsw-alias-label-caption: var(--cm-muted-foreground);
  --dsw-alias-link: var(--cm-primary);
  --dsw-alias-brand-primary: var(--cm-primary);
  --dsw-alias-button-elevated-fill: var(--cm-card);
  --dsw-alias-interactive-bg-hover: var(--cm-accent);
  --dsw-alias-state-business-primary: var(--cm-primary);
  --dsw-alias-state-business-tertiary: color-mix(in srgb, var(--cm-primary) 14%, transparent);
  --dsw-alias-state-error-primary: var(--cm-destructive);
  --dsw-alias-state-success-primary: var(--cm-success);
  --ant-color-primary: var(--cm-primary);
  --ant-color-primary-hover: color-mix(in srgb, var(--cm-primary) 86%, var(--cm-background));
  --ant-color-primary-active: color-mix(in srgb, var(--cm-primary) 74%, var(--cm-background));
  --ant-color-primary-text: var(--cm-primary);
  --ant-color-primary-text-hover: var(--cm-primary);
  --ant-color-primary-text-active: var(--cm-primary);
  --ant-color-link: var(--cm-primary);
  --ant-color-text: var(--cm-foreground);
  --ant-color-text-light-solid: var(--cm-primary-foreground);
  --ant-color-border: var(--cm-border);
  --ant-button-primary-color: var(--cm-primary-foreground);
  --ant-tabs-item-color: var(--cm-muted-foreground);
  --ant-tabs-item-selected-color: var(--cm-primary);
  --ant-tabs-ink-bar-color: var(--cm-primary);
}
.dsh-st-shell [class*="css-var-"],
.dsh-st-shell-rail [class*="css-var-"],
.dsh-st-n [class*="css-var-"],
.dsh-st-overview [class*="css-var-"],
.dsh-st-form [class*="css-var-"],
.dsh-st-prompt-card [class*="css-var-"] {
  --ant-color-primary: var(--cm-primary);
  --ant-color-primary-hover: color-mix(in srgb, var(--cm-primary) 86%, var(--cm-background));
  --ant-color-primary-active: color-mix(in srgb, var(--cm-primary) 74%, var(--cm-background));
  --ant-color-primary-text: var(--cm-primary);
  --ant-color-primary-text-hover: var(--cm-primary);
  --ant-color-primary-text-active: var(--cm-primary);
  --ant-color-link: var(--cm-primary);
  --ant-color-text: var(--cm-foreground);
  --ant-color-text-light-solid: var(--cm-primary-foreground);
  --ant-color-border: var(--cm-border);
  --ant-button-primary-color: var(--cm-primary-foreground);
  --ant-tabs-item-color: var(--cm-muted-foreground);
  --ant-tabs-item-selected-color: var(--cm-primary);
  --ant-tabs-ink-bar-color: var(--cm-primary);
}
.dsh-st-shell,
.dsh-st-n,
.dsh-st-overview { color: var(--cm-foreground); }
.dsh-st-card,
.dsh-st-empty,
.dsh-st-example,
.dsh-st-banner,
.dsh-st-prompt-card,
.dsh-st-overview-row {
  border-color: var(--cm-border);
  background: var(--cm-card);
  color: var(--cm-card-foreground);
}
.dsh-st-card:hover,
.dsh-st-example:hover,
.dsh-st-overview-row:hover {
  border-color: color-mix(in srgb, var(--cm-primary) 45%, transparent);
}
.dsh-st-chip,
.dsh-st-skill-token {
  background: color-mix(in srgb, var(--cm-primary) 14%, transparent);
  color: var(--cm-primary);
}
.dsh-st-tabs,
.dsh-st-shell-tabs { border-bottom-color: var(--cm-border); }
.dsh-st-settings-tabs .ant-tabs-tab-btn { color: var(--cm-muted-foreground); }
.dsh-st-settings-tabs .ant-tabs-tab-active .ant-tabs-tab-btn { color: var(--cm-primary); }
.dsh-st-settings-tabs .ant-tabs-ink-bar { background: var(--cm-primary); }
.dsh-st-top h1,
.dsh-st-card h3,
.dsh-st-empty h3 { color: var(--cm-card-foreground); }
.dsh-st-card p,
.dsh-st-empty p,
.dsh-st-example p,
.dsh-st-card-foot,
.dsh-st-muted,
.dsh-st-banner { color: var(--cm-muted-foreground); }
.dsh-st-error { color: var(--cm-destructive); }
.dsh-st-n-hover {
  border-color: var(--cm-border);
  background: var(--cm-popover);
  color: var(--cm-card-foreground);
}
.dsh-st-overview-row:not(.is-paused) .dsh-st-overview-next strong { color: var(--cm-success); }
.dsh-st-n-danger-button { color: var(--cm-destructive) !important; }
.dsh-st-n-danger-button:hover {
  background: color-mix(in srgb, var(--cm-destructive) 12%, transparent) !important;
}
.dsh-st-add-workspace.ant-btn,
.ant-select-dropdown .dsh-st-add-workspace.ant-btn,
.ant-select-dropdown .dsh-st-add-workspace.ant-btn span,
.ant-select-dropdown .dsh-st-add-workspace.ant-btn .ant-btn-icon,
.dsh-st-add-workspace.ant-btn svg {
  --ant-btn-text-color: var(--cm-primary);
  --ant-btn-text-color-hover: var(--cm-primary);
  --ant-btn-text-color-active: var(--cm-primary);
  color: var(--cm-primary) !important;
}
.dsh-st-add-workspace.ant-btn:not(:disabled):hover,
.dsh-st-add-workspace.ant-btn:not(:disabled):active,
.ant-select-dropdown .dsh-st-add-workspace.ant-btn:hover { color: var(--cm-primary) !important; }
/* data-cm-automation-theme:end */
`;

/** antd seed and surface tokens resolved from the CopyMonster palette.
 *
 * antd derives hover, active, and border tones from these seeds at runtime,
 * so the helper resolves each variable to the concrete color
 * `getComputedStyle` reports before antd builds its palette. The tokens apply
 * to every antd component under the automation `ConfigProvider`, including
 * modals and selects that React portals render outside the `.dsh-st-*`
 * subtrees covered by {@link AUTOMATION_THEME_CSS}. */
const AUTOMATION_ANTD_TOKEN_SOURCES = {
  colorPrimary: '--cm-primary',
  colorLink: '--cm-primary',
  colorTextLightSolid: '--cm-primary-foreground',
  colorBgBase: '--cm-background',
  colorBgLayout: '--cm-background',
  colorBgContainer: '--cm-card',
  colorBgElevated: '--cm-popover',
  colorBgSpotlight: '--cm-popover',
  colorText: '--cm-foreground',
  colorTextHeading: '--cm-card-foreground',
  colorTextSecondary: '--cm-muted-foreground',
  colorTextTertiary: '--cm-muted-foreground',
  colorTextQuaternary: '--cm-muted-foreground',
  colorBorder: '--cm-border',
  colorBorderSecondary: '--cm-border',
  colorFill: '--cm-accent',
  colorFillSecondary: '--cm-accent',
  colorFillTertiary: '--cm-accent',
  colorFillQuaternary: '--cm-accent',
  controlItemBgHover: '--cm-accent',
  controlItemBgActive: '--cm-accent',
};

/** Minified helper appended next to the plugin's `oH` token reader. */
const AUTOMATION_ANTD_TOKEN_HELPER = `function oC(){let e={${
  Object.entries(AUTOMATION_ANTD_TOKEN_SOURCES)
    .map(([token, variable]) => `${token}:${JSON.stringify(variable)}`)
    .join(',')
}},t={};for(let o in e){let n=oH(e[o]);n!==""&&(t[o]=n)}return t}`;

/** dsh-vercel-mcp settings panel copy; longest entries are applied first. */
const VERCEL_CLIENT_REPLACEMENTS = [
  ['已在新标签页打开 Vercel 授权页。登录并点击允许后会自动跳回本机完成；若停留在回调地址，复制地址栏 URL（或其中的 code）粘贴到下方完成。', 'Opened the Vercel authorization page in a new tab. After signing in and clicking Allow it returns here automatically; if it stops at the callback address, copy the URL (or its code) below to finish.'],
  ['确定清除 Vercel MCP 的全部凭据吗？MCP 工具将注销，之后需要重新授权。', 'Clear all Vercel MCP credentials? The MCP tools will be unregistered and authorization will be required again.'],
  ['未授权 — 点击「开始授权」并在 Vercel 登录页完成授权后，MCP 工具即可用。', 'Not authorized — click Authorize and complete sign-in on the Vercel page to enable the MCP tools.'],
  ['通过官方 OAuth 连接 mcp.vercel.com，授权后 Vercel API 工具以 mcp__vercel__* 形式在会话中可用 （部署、项目、域名、环境变量、DNS 记录、部署代码等）。令牌存 ', 'Connects to mcp.vercel.com through official OAuth. After authorization, Vercel API tools are available in sessions as mcp__vercel__* (deployments, projects, domains, environment variables, DNS records, deployment code, and more). Token stored at '],
  ['授权后若未自动完成，粘贴回调地址或 code', 'If authorization does not complete automatically, paste the callback URL or code'],
  ['已发现的 MCP 工具（', 'Discovered MCP tools ('],
  ['（权限 0600）。', ' (mode 0600).'],
  ['加载中…', 'Loading…'],
  ['读取状态失败: ', 'Could not read status: '],
  ['操作失败: ', 'Action failed: '],
  ['开始授权失败', 'Could not start authorization'],
  ['连接成功。', 'Connection successful.'],
  ['网络请求失败: ', 'Network request failed: '],
  ['刷新令牌', 'Refresh token'],
  ['测试连接', 'Test connection'],
  ['清除凭据', 'Clear credentials'],
  ['完成授权', 'Finish authorization'],
  ['开始授权', 'Authorize'],
  ['已连接', 'connected'],
  ['未连接', 'disconnected'],
  ['）：', '): '],
  ['已取消。', 'Cancelled.'],
  ['`已授权 · 令牌更新于 ${view.tokenUpdatedAt} · MCP ${connected} · 工具 ${view.toolCount} 个`', '`Authorized · token updated ${view.tokenUpdatedAt} · MCP ${connected} · ${view.toolCount} tools`'],
  ['join("、")', 'join(", ")'],
];

/** dsh-vercel-mcp host copy: tools, OAuth messages, and the callback page. */
const VERCEL_HOST_REPLACEMENTS = [
  ['本机已安装 dsh-vercel-mcp 插件（Vercel MCP 连接）：通过官方 OAuth 授权后，Vercel 官方 MCP 服务器（mcp.vercel.com）的工具以 mcp__vercel__* 形式可用，覆盖部署、项目、域名、环境变量、DNS 记录、部署代码等 Vercel 平台操作。授权流程：vercel_mcp_oauth_start 获取授权链接 → 用户浏览器登录 Vercel 并授权 → 自动回调完成（也可把回调地址里的 code 交给 vercel_mcp_oauth_finish）。vercel_mcp_status 查看连接状态（不回显令牌），vercel_mcp_test 测试连接并列出工具。令牌存 ~/.dsh/dsh-vercel-mcp.json（权限 0600）。也可在 Web 设置页「Vercel MCP」面板中授权与测试。用户提到「Vercel / MCP / 部署 / 查项目」时即指本插件，请据此协作。', 'dsh-vercel-mcp is installed (Vercel MCP connection): after official OAuth authorization, the tools of the Vercel official MCP server (mcp.vercel.com) are available as mcp__vercel__*, covering Vercel platform operations such as deployments, projects, domains, environment variables, DNS records, and deployment code. Authorization flow: vercel_mcp_oauth_start returns the authorization link → the user signs in to Vercel in a browser and authorizes → the callback completes automatically (you can also pass the callback code to vercel_mcp_oauth_finish). vercel_mcp_status shows connection state (never the token); vercel_mcp_test tests the connection and lists tools. The token is stored at ~/.dsh/dsh-vercel-mcp.json (mode 0600). You can also authorize and test in the Web Settings page Vercel MCP panel. When the user mentions Vercel / MCP / deployment / listing projects, they mean this plugin; collaborate accordingly.'],
  ['清除 Vercel MCP 的全部凭据（OAuth 令牌与客户端注册）并断开连接，MCP 工具随之注销。需要用户确认后执行。', 'Clears all Vercel MCP credentials (OAuth token and client registration) and disconnects, unregistering the MCP tools. Requires user confirmation.'],
  ['查看 dsh-vercel-mcp 插件状态：是否已 OAuth 授权、令牌最近更新时间、MCP 是否已连接、已注册的 Vercel 工具数量。不会泄露任何密钥。', 'Shows the dsh-vercel-mcp plugin status: whether OAuth is authorized, the token update time, whether MCP is connected, and the number of registered Vercel tools. Never reveals any secret.'],
  ['开始 Vercel MCP 的 OAuth 授权流程：返回授权链接（authorizeUrl），让用户用浏览器打开并登录 Vercel 授权。授权完成后自动回调本机完成。', 'Starts the Vercel MCP OAuth authorization flow: returns the authorization link (authorizeUrl) for the user to open in a browser and sign in to Vercel. The callback completes automatically on this machine.'],
  ['手动完成 Vercel MCP 授权：把授权后浏览器地址栏里的 code 参数（或完整回调 URL）传给本工具，完成令牌交换。用于浏览器未能自动回调的情况。', 'Completes Vercel MCP authorization manually: pass the code parameter (or the full callback URL) from the browser address bar to finish the token exchange. Use when the browser cannot complete the automatic callback.'],
  ['测试 Vercel MCP 连接：确认授权有效并列出服务器当前提供的全部工具名（如 mcp__vercel__* 的前身工具名）。', 'Tests the Vercel MCP connection: confirms the authorization is valid and lists all tools the server currently provides (for example the mcp__vercel__* tool names).'],
  ['授权成功：Vercel MCP 令牌已保存，MCP 工具已就绪。', 'Authorization successful: the Vercel MCP token is saved and the MCP tools are ready.'],
  ['Vercel MCP 授权已完成，令牌已保存。现在可以关闭此页面，回到 DSH 设置面板或继续对话。', 'Vercel MCP authorization is complete and the token is saved. You can close this page and return to the CopyMonster Settings panel or continue the conversation.'],
  ['state 校验未通过（授权流程可能已过期或重复）。请重新点击「开始授权」。', 'State validation failed (the authorization flow may have expired or been repeated). Click Authorize again.'],
  ['已有一个待完成的 Vercel 授权流程，请先完成或等待它过期。', 'A Vercel authorization flow is already pending; finish it or wait for it to expire.'],
  ['没有活动的 OAuth provider（服务重启后请先测试连接以触发刷新）。', 'No active OAuth provider (after a service restart, test the connection to trigger a refresh).'],
  ['没有待完成的授权流程：请先点击「开始授权」。', 'No pending authorization flow: click Authorize first.'],
  ['请在浏览器中打开以下链接完成 Vercel 授权（打开后登录并点击允许）：', 'Open the following link in your browser to authorize Vercel (then sign in and click Allow): '],
  ['完整的授权回调 URL（自动提取 code）', 'The full authorization callback URL (extracts the code automatically)'],
  ['尚未授权：请用 vercel_mcp_oauth_start 开始授权。', 'Not authorized: use vercel_mcp_oauth_start to begin authorization.'],
  ['尚未授权：请先点击「开始授权」。', 'Not authorized: click Authorize first.'],
  ['缺少 code（或无法从 redirectUrl 提取 code）。', 'Missing code (or could not extract the code from redirectUrl).'],
  ['缺少 code（或无法从 redirectUrl 提取 code）', 'Missing code (or could not extract the code from redirectUrl)'],
  ['Vercel 返回错误：', 'Vercel returned an error: '],
  ['。请重试或使用手动粘贴 code 的方式。', '. Retry or use the manual code paste option.'],
  ['授权流程已被取消。', 'The authorization flow was cancelled.'],
  ['授权未完成（未知状态）。', 'Authorization did not finish (unknown state).'],
  ['令牌交换失败：', 'Token exchange failed: '],
  ['令牌刷新成功。', 'Token refreshed successfully.'],
  ['刷新未完成。', 'Refresh did not finish.'],
  ['刷新失败：', 'Refresh failed: '],
  ['测试失败：', 'Test failed: '],
  ['开始授权失败：', 'Could not start authorization: '],
  ['连接成功：Vercel MCP 提供 ', 'Connection successful: Vercel MCP provides '],
  ['连接成功，发现 ', 'Connection successful; found '],
  [' 个 Vercel MCP 工具。', ' Vercel MCP tools.'],
  ['已清除 Vercel MCP 的令牌与客户端注册。', 'Cleared the Vercel MCP token and client registration.'],
  ['已清除 Vercel MCP 的全部凭据，MCP 工具已注销。', 'Cleared all Vercel MCP credentials; the MCP tools are unregistered.'],
  ['Vercel MCP 未连接。', 'Vercel MCP is not connected.'],
  ['回调请求来自非本机地址，已拒绝。', 'The callback request came from a non-local address and was rejected.'],
  ['回调中没有 code 参数。', 'The callback has no code parameter.'],
  ['可直接使用 mcp__vercel__* 工具。', 'You can use the mcp__vercel__* tools directly.'],
  ['请用 vercel_mcp_oauth_start 开始授权。', 'Use vercel_mcp_oauth_start to begin authorization.'],
  ['授权回调 URL 中的 code 参数值', 'The code parameter value from the authorization callback URL'],
  ['已授权（令牌更新于 ', 'Authorized (token updated '],
  ['dsh-vercel-mcp：', 'dsh-vercel-mcp: '],
  ['"）"', '")"'],
  ['"已注册工具 " + ctx.supervisor.toolCount() + " 个"', '"Registered tools " + ctx.supervisor.toolCount()'],
  ['].join("；") + "。" + (view.authorized', '].join("; ") + ". " + (view.authorized'],
  ['已授权', 'Authorized'],
  ['未授权', 'Not authorized'],
  ['已连接', 'connected'],
  ['未连接', 'disconnected'],
  ['授权失败', 'Authorization failed'],
  ['授权成功', 'Authorization successful'],
  ['端点 ', 'Endpoint '],
  ['配置路径 ', 'Config path '],
  [' 个工具。', ' tools.'],
  [' 示例：', ' Examples: '],
  ['state 校验未通过', 'state validation failed'],
  ['join("、")', 'join(", ")'],
];

/** Public authority the reverse proxy presents to the plugin route fences. */
const COPYMONSTER_AUTHORITY = 'app.copymonster.co';

/** dsh-mail's hardcoded trust fence must admit the CopyMonster proxy authority. */
const MAIL_HOST_REPLACEMENTS = [
  ["trustedHosts: ['llm.tzekos.eu']", `trustedHosts: ['${COPYMONSTER_AUTHORITY}', 'localhost', '127.0.0.1']`],
];

/** dsh-vercel-mcp's loopback fence rejects the proxy's public Host header. */
const VERCEL_HOST_FENCE_REPLACEMENTS = [
  [
    'hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;',
    `hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]" && hostUrl.hostname !== "${COPYMONSTER_AUTHORITY}") return false;`,
  ],
  [
    'return hostUrl.hostname === "127.0.0.1" || hostUrl.hostname === "localhost" || hostUrl.hostname === "[::1]";',
    `return hostUrl.hostname === "127.0.0.1" || hostUrl.hostname === "localhost" || hostUrl.hostname === "[::1]" || hostUrl.hostname === "${COPYMONSTER_AUTHORITY}";`,
  ],
];

/** CopyMonster tokens for the dsh-vercel-mcp settings panel inline styles.
 * Geometry is normalized at host scope in apps/web/src/cm-theme.css ([data-settings-section="vercel-mcp"])
 * using var(--cm-radius-lg) and var(--cm-padding-card); color palette tokens are replaced inline below. */
const VERCEL_THEME_REPLACEMENTS = [
  ['border: "1px solid rgba(128,128,128,0.3)"', 'border: "1px solid var(--cm-border)"'],
  ['border: "1px solid rgba(128,128,128,0.35)"', 'border: "1px solid var(--cm-input)"'],
  ['border: "1px solid rgba(128,128,128,0.4)"', 'border: "1px solid var(--cm-primary)"'],
  ['background: "rgba(128,128,128,0.08)"', 'background: "var(--cm-muted)"'],
  ['background: "rgba(128,128,128,0.14)",\n\t\t\t\tcolor: "inherit"', 'background: "var(--cm-primary)",\n\t\t\t\tcolor: "var(--cm-primary-foreground)"'],
  ['color: "#c9763a"', 'color: "var(--cm-primary)"'],
];

/** CopyMonster tokens for the dsh-preview-plugin toolbar and status bar. */
const PREVIEW_THEME_REPLACEMENTS = [
  ['background: "#1e293b"', 'background: "var(--cm-card)"'],
  ['borderBottom: "1px solid #334155"', 'borderBottom: "1px solid var(--cm-border)"'],
  ['border: "1px solid #475569"', 'border: "1px solid var(--cm-input)"'],
  ['background: "#0f172a"', 'background: "var(--cm-background)"'],
  ['color: "#e2e8f0"', 'color: "var(--cm-foreground)"'],
  ['color: "#94a3b8"', 'color: "var(--cm-muted-foreground)"'],
  ['background: "#3b82f6", color: "white"', 'background: "var(--cm-primary)", color: "var(--cm-primary-foreground)"'],
  ['background: "#475569", color: "white"', 'background: "var(--cm-secondary)", color: "var(--cm-secondary-foreground)"'],
  ['color: "#64748b"', 'color: "var(--cm-muted-foreground)"'],
  ['background: "#22c55e"', 'background: "var(--cm-success)"'],
  ['color: "#475569"', 'color: "var(--cm-muted-foreground)"'],
  ['background: "#7f1d1d", color: "#fecaca"', 'background: "var(--cm-destructive)", color: "var(--cm-destructive-foreground)"'],
  ['background: "#78350f", color: "#fde68a"', 'background: "var(--cm-accent)", color: "var(--cm-accent-foreground)"'],
];

/** CopyMonster tokens for the dsh-mail sidebar tab stylesheet. */
const MAIL_THEME_REPLACEMENTS = [
  ['--ok:var(--dsw-alias-state-success-primary,#2e9e5b)', '--ok:var(--cm-success,#2e9e5b)'],
  ['--bad:var(--dsw-alias-state-error-primary,#cf3b3b)', '--bad:var(--cm-destructive,#cf3b3b)'],
  ['--brand:var(--dsw-alias-brand-primary,#4d6bfe)', '--brand:var(--cm-primary,#4d6bfe)'],
  ['--ink:var(--dsw-alias-label-primary,inherit)', '--ink:var(--cm-foreground,inherit)'],
  ['--ink2:var(--dsw-alias-label-secondary,inherit)', '--ink2:var(--cm-muted-foreground,inherit)'],
  ['--ink3:var(--dsw-alias-label-tertiary,inherit)', '--ink3:var(--cm-muted-foreground,inherit)'],
  ['--line:var(--dsw-alias-border-l2,rgba(128,128,128,.28))', '--line:var(--cm-border,rgba(128,128,128,.28))'],
  ['--line1:var(--dsw-alias-border-l1,rgba(128,128,128,.18))', '--line1:var(--cm-border,rgba(128,128,128,.18))'],
  ['--l1:var(--dsw-alias-bg-layer-1,transparent)', '--l1:var(--cm-card,transparent)'],
  ['--l2:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.07))', '--l2:var(--cm-muted,rgba(128,128,128,.07))'],
  ['--hov:var(--dsh-alias-interactive-bg-hover,rgba(128,128,128,.12))', '--hov:var(--cm-accent,rgba(128,128,128,.12))'],
  ['background:var(--dsw-alias-button-primary-fill,var(--brand));color:#fff;font-weight:600', 'background:var(--cm-primary,var(--brand));color:var(--cm-primary-foreground);font-weight:600'],
  ['.mlx-in:focus{outline:2px solid var(--brand);outline-offset:-1px}', '.mlx-in:focus{outline:2px solid var(--cm-ring,var(--brand));outline-offset:-1px}'],
];

/** Visible dsh-better-sidebar labels; package ids and module keys stay unchanged. */
const BETTER_SIDEBAR_UI_REPLACEMENTS = [
  ['DSH-better-sidebar', 'CopyMonster Sidebar'],
];

/** Brand names shared by every delivery plugin. */
const BRAND_REPLACEMENTS = [
  ['DeepSeek Harness', 'CopyMonster'],
  ['DeepSeekHarness', 'CopyMonster'],
  ['DeepSeek-Harness', 'CopyMonster'],
];

/** Matches the standalone product name only, never `DSH_*`, `__DSH_*`, or lowercase ids. */
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

async function pluginRoot(packageName) {
  const explicit = argValue('--plugin-root') ?? process.env.DSH_PLUGIN_ROOT;
  if (explicit) return join(resolve(explicit), packageName);
  const local = resolve(process.cwd(), 'node_modules', packageName);
  if (await isFile(join(local, 'package.json'))) return local;
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles/web/node_modules', packageName);
}

function rebrand(text) {
  let next = text;
  for (const [from, to] of BRAND_REPLACEMENTS) next = next.split(from).join(to);
  return next.replace(DSH, 'CopyMonster');
}

/** Apply exact replacements longest-first so a short entry cannot split a longer phrase. */
function applyReplacementTable(text, table) {
  let next = text;
  const ordered = [...table].sort((left, right) => right[0].length - left[0].length);
  for (const [from, to] of ordered) next = next.split(from).join(to);
  return next;
}

function translateMailClient(text) {
  return rebrand(applyReplacementTable(text, MAIL_THEME_REPLACEMENTS));
}

function translateMailHost(text) {
  return rebrand(applyReplacementTable(text, MAIL_HOST_REPLACEMENTS));
}

function translateVercelClient(text) {
  const translated = applyReplacementTable(text, VERCEL_CLIENT_REPLACEMENTS);
  return rebrand(applyReplacementTable(translated, VERCEL_THEME_REPLACEMENTS));
}

function translateVercelHost(text) {
  let translated = applyReplacementTable(text, VERCEL_HOST_REPLACEMENTS);
  translated = applyReplacementTable(translated, VERCEL_HOST_FENCE_REPLACEMENTS);
  return rebrand(translated.replace('html lang=\\"zh-CN\\"', 'html lang=\\"en\\"'));
}

function translatePreviewClient(text) {
  return rebrand(applyReplacementTable(text, PREVIEW_THEME_REPLACEMENTS));
}

function translateBetterSidebar(text) {
  return rebrand(applyReplacementTable(text, BETTER_SIDEBAR_UI_REPLACEMENTS));
}

function markAutomationModelField(text) {
  if (text.includes('"data-field":"model"')) return text;
  return text.replace(
    /(className:"dsh-st-picker-field")(,children:\[\(0,\w+\.jsxs?\)\("span",\{children:e\("form\.fieldModel"\)\}\))/,
    '$1,"data-field":"model"$2',
  );
}

function translateAutomationPackage(text) {
  let next = text;
  for (const [from, to] of AUTOMATION_PACKAGE_REPLACEMENTS) next = next.split(from).join(to);
  return next;
}

function translateAutomationClient(text) {
  let next = text;
  for (const [from, to] of AUTOMATION_CLIENT_REPLACEMENTS) next = next.split(from).join(to);
  return next;
}

function applyAutomationTheme(text) {
  let next = text;
  next = next.replace(
    'n=oH("--dsw-alias-link");',
    'n=oH("--cm-primary")||oH("--dsw-alias-link"),c=oH("--cm-primary");',
  );
  const helperStart = next.indexOf('function oC(){');
  if (helperStart !== -1) {
    const helperEnd = next.indexOf('function Rn(', helperStart);
    if (helperEnd !== -1) {
      next = next.slice(0, helperStart) + AUTOMATION_ANTD_TOKEN_HELPER + next.slice(helperEnd);
    }
  } else {
    const tokenReaderEnd = 'getComputedStyle(document.documentElement).getPropertyValue(e).trim()}';
    const anchor = next.indexOf(tokenReaderEnd);
    if (anchor !== -1) {
      const end = anchor + tokenReaderEnd.length;
      next = next.slice(0, end) + AUTOMATION_ANTD_TOKEN_HELPER + next.slice(end);
    }
  }
  if (!next.includes('...oC()')) {
    const primaryOnly = '...c===""?{}:{colorPrimary:c}}';
    const linkOnly = '...n===""?{}:{token:{colorLink:n,colorLinkHover:n,colorLinkActive:n}}';
    if (next.includes(primaryOnly)) {
      next = next.replace(primaryOnly, '...c===""?{}:{colorPrimary:c,...oC()}}');
    } else {
      next = next.replace(
        linkOnly,
        '...n===""?{}:{token:{colorLink:n,colorLinkHover:n,colorLinkActive:n,...c===""?{}:{colorPrimary:c,...oC()}}}',
      );
    }
  }
  const start = '/* data-cm-automation-theme:start */';
  const end = '/* data-cm-automation-theme:end */';
  const blockStart = next.indexOf(start);
  if (blockStart !== -1) {
    const blockEnd = next.indexOf(end, blockStart);
    if (blockEnd !== -1) {
      const before = next.slice(0, blockStart);
      const after = next.slice(blockEnd + end.length);
      const css = AUTOMATION_THEME_CSS.trim();
      const cssStart = css.indexOf(start);
      return before + css.slice(cssStart) + after;
    }
  }
  const cssAnchor = next.indexOf(',HO=`');
  if (cssAnchor === -1) return next;
  const cssEnd = next.indexOf('`;function WO()', cssAnchor);
  if (cssEnd === -1) return next;
  return next.slice(0, cssEnd) + AUTOMATION_THEME_CSS + next.slice(cssEnd);
}

const plugins = [
  {
    name: '@changfenhuang/dsh-genui',
    files: [
      { relative: 'lib/client.js', transform: rebrand },
      { relative: 'src/client/i18n/en.ts', transform: rebrand },
      { relative: 'package.json', transform: rebrand },
    ],
  },
  {
    name: '@michengai/dsh-automation',
    files: [
      { relative: 'lib/client.js', transform: text => applyAutomationTheme(markAutomationModelField(translateAutomationClient(rebrand(text)))) },
      { relative: 'locale/en.json', transform: rebrand },
      { relative: 'locale/zh.json', transform: rebrand },
      { relative: 'package.json', transform: text => translateAutomationPackage(rebrand(text)) },
    ],
  },
  {
    name: 'dsh-mail',
    files: [
      { relative: 'lib/client.js', transform: translateMailClient },
      { relative: 'lib/index.js', transform: translateMailHost },
      { relative: 'package.json', transform: rebrand },
    ],
  },
  {
    name: 'dsh-vercel-mcp',
    files: [
      { relative: 'lib/client.js', transform: translateVercelClient },
      { relative: 'lib/index.js', transform: translateVercelHost },
      { relative: 'package.json', transform: rebrand },
    ],
  },
  {
    name: 'dsh-preview-plugin',
    files: [
      { relative: 'lib/client.js', transform: translatePreviewClient },
      { relative: 'lib/index.js', transform: rebrand },
      { relative: 'package.json', transform: rebrand },
    ],
  },
  {
    name: 'dsh-better-sidebar',
    files: [
      { relative: 'lib/client.js', transform: translateBetterSidebar },
      { relative: 'lib/client-registry.js', transform: translateBetterSidebar },
      { relative: 'lib/client-editor.js', transform: translateBetterSidebar },
      { relative: 'lib/client-mermaid.js', transform: translateBetterSidebar },
      { relative: 'lib/client-terminal.js', transform: translateBetterSidebar },
      { relative: 'lib/index.js', transform: rebrand },
      { relative: 'package.json', transform: rebrand },
    ],
  },
];

const checkOnly = process.argv.includes('--check');
let checked = 0;
let changed = 0;

for (const plugin of plugins) {
  const root = await pluginRoot(plugin.name);
  if (!await isFile(join(root, 'package.json'))) {
    console.warn(`skipped: ${plugin.name} is not installed at ${root}`);
    continue;
  }
  for (const file of plugin.files) {
    const path = join(root, file.relative);
    if (!await isFile(path)) continue;
    checked += 1;
    const original = await readFile(path, 'utf8');
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
  console.log(`Delivery plugin rebrand already applied (${checked} files checked)`);
} else if (checkOnly) {
  console.error(`${changed} of ${checked} files need the delivery plugin rebrand`);
  process.exitCode = 1;
} else {
  console.log(`Delivery plugin rebrand applied (${changed} of ${checked} files)`);
}
