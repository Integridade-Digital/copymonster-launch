/**
 * Rebrand and localize the installed delivery plugins for CopyMonster.
 *
 * The MCP Connector ships a Chinese-first iframe UI; GenUI and Automation ship
 * English base copy with product-brand references. This script translates the
 * MCP Connector's interface chrome to English and replaces user-visible
 * `DSH` / `DeepSeek Harness` references with CopyMonster in all three plugins.
 *
 * Protected: package names, API paths, config keys, tool names, catalog data,
 * Chinese host diagnostics used by the MCP regex matchers, and the GenUI /
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

/** MCP Connector's user-visible interface copy, longest first at apply time. */
const MCP_UI_REPLACEMENTS = [
  ['MCP连接器', 'MCP Connector'],
  ['刷新连接器目录', 'Refresh connector catalog'],
  ['市场分类导航', 'Market category navigation'],
  ['搜索工具名称或描述…', 'Search tool name or description…'],
  ['搜索连接器…', 'Search connectors…'],
  ['试试这样用', 'Try it like this'],
  ['工具详情', 'Tool details'],
  ['搜索当前范围内已启用连接的工具缓存；不会执行工具。最近发现成功不代表每次调用均可成功。',
    'Searches the tool cache of enabled connections in the current scope; it does not execute tools. A recent discovery does not guarantee every call succeeds.'],
  ['连接策略', 'Connection policy'],
  ['撤销最近变更', 'Undo last change'],
  ['回滚上次范围变更', 'Roll back last scope change'],
  ['配置备份', 'Configuration backup'],
  ['检测企查查旧授权', 'Check for legacy Qichacha authorization'],
  ['刷新工具视图', 'Refresh tool view'],
  ['刷新连接器目录', 'Refresh connector catalog'],
  ['连接状态与故障处理', 'Connection status and troubleshooting'],
  ['高级：首次连接前设置本地参数（可选）', 'Advanced: set local arguments before the first connection (optional)'],
  ['本地参数 JSON', 'Local arguments JSON'],
  ['暂无已上架的连接器', 'No published connectors'],
  ['正在生成脱敏配置并读取本机快照…', 'Generating redacted configuration and reading local snapshots…'],
  ['没有匹配当前搜索条件的连接器', 'No connectors match the current search'],
  ['没有匹配当前筛选条件的连接器', 'No connectors match the current filters'],
  ['还没有本机配置快照。连接、配置、导入、启停和断开前会自动创建，也可立即手动创建。',
    'No local configuration snapshot yet. One is created automatically before connect, configure, import, enable/disable, and disconnect; you can also create one now.'],
  ['在线链接 + 本机文件同时启用', 'Online link and local file both enabled'],
  ['市场分类', 'Market categories'],
  ['按分类筛选', 'Filter by category'],
  ['发现旧企查查 MCP 授权', 'Legacy Qichacha MCP authorization found'],
  ['关闭详情', 'Close details'],
  ['关闭 MCP连接器', 'Close MCP Connector'],
  ['关闭后只隐藏入口，不影响已连接的 MCP Server 和工具。', 'Closing only hides the entry; connected MCP servers and tools are unaffected.'],
  ['在侧边栏显示 MCP连接器', 'Show MCP Connector in the sidebar'],
  ['展开 MCP连接器设置', 'Expand MCP Connector settings'],
  ['入口已隐藏，仍可从这里打开 MCP连接器。', 'The entry is hidden; you can still open MCP Connector here.'],
  ['侧边栏入口当前显示。', 'The sidebar entry is visible.'],
  ['一键更新到', 'One-click update to'],
  ['GitHub Release 已发布，等待 npm 同步后即可更新', 'GitHub Release published; update after npm syncs'],
  ['尚未完成版本检查', 'Version check not completed'],
  ['上次检查：', 'Last checked: '],
  ['下载后版本未变化', 'Version unchanged after download'],
  ['下载版本与预期不一致', 'Downloaded version does not match'],
  ['正在同步', 'Syncing'],
  ['刷新生效', 'Refresh to apply'],
  ['复制升级命令', 'Copy upgrade command'],
  ['回滚失败', 'Rollback failed'],
  ['回滚', 'Roll back'],
  ['解析本机文件', 'Resolve local file'],
  ['在线链接', 'Online link'],
  ['本机文件', 'Local file'],
  ['传输方式', 'Transport'],
  ['鉴权方式', 'Authentication'],
  ['无鉴权', 'No authentication'],
  ['连接显示名', 'Connection display name'],
  ['仅保存在本机', 'Stored locally only'],
  ['启动命令', 'Start command'],
  ['工作目录', 'Working directory'],
  ['环境变量', 'Environment variables'],
  ['参数（JSON 数组）', 'Arguments (JSON array)'],
  ['环境变量（JSON 对象）', 'Environment variables (JSON object)'],
  ['连接范围', 'Connection scope'],
  ['所有项目（全局）', 'All projects (global)'],
  ['按会话启用（实验）', 'Enable per session (experimental)'],
  ['始终注入', 'Always inject'],
  ['工具注入模式', 'Tool injection mode'],
  ['可用性确认', 'Availability check'],
  ['建议：无需操作', 'Advice: no action needed'],
  ['最近成功', 'Last success'],
  ['作用域', 'Scope'],
  ['重新连接', 'Reconnect'],
  ['重新发现工具', 'Rediscover tools'],
  ['重新配置凭据', 'Reconfigure credentials'],
  ['录入凭据并连接', 'Enter credentials and connect'],
  ['补充本地解析', 'Complete local setup'],
  ['升级一键授权', 'Upgrade one-click authorization'],
  ['连接后试用', 'Connect to try'],
  ['连接后使用', 'Connect to use'],
  ['填写并发送', 'Fill and send'],
  ['需重新授权', 'Reauthorization required'],
  ['自动重试中', 'Retrying automatically'],
  ['连接异常', 'Connection error'],
  ['部分异常', 'Partial error'],
  ['部分服务可用', 'Some services available'],
  ['状态未知', 'Unknown status'],
  ['已配置', 'Configured'],
  ['已连接', 'Connected'],
  ['已停用', 'Disabled'],
  ['已禁用', 'Disabled'],
  ['已允许', 'Allowed'],
  ['已安装', 'Installed'],
  ['<span class="tool-deprecated">已弃用</span>', '<span class="tool-deprecated">Deprecated</span>'],
  ['暂无描述', 'No description'],
  ['暂无可用工具', 'No tools available'],
  ['暂无工具', 'No tools'],
  ['没有匹配工具。请调整关键词或筛选；也可展开连接状态检查是否尚未发现或读取失败。',
    'No matching tools. Adjust the keyword or filters, or expand connection status to check whether discovery has completed or failed.'],
  ['当前范围没有已启用连接。请先添加连接，或选择对应工作区。',
    'No enabled connections in the current scope. Add a connection first or select the matching workspace.'],
  ['还没有连接任何 MCP · 到「市场」里连接一个吧', 'No MCP connections yet · connect one from Market'],
  ['当前筛选下没有连接。', 'No connections match the current filters.'],
  ['正在读取缓存…', 'Reading cache…'],
  ['正在读取可用工具及描述…', 'Reading available tools and descriptions…'],
  ['正在发现', 'Discovering'],
  ['加载失败', 'Load failed'],
  ['加载中…', 'Loading…'],
  ['加载中...', 'Loading…'],
  ['清除筛选', 'Clear filters'],
  ['清除本地参数', 'Clear local arguments'],
  ['恢复市场参数', 'Restore market arguments'],
  ['编辑配置', 'Edit configuration'],
  ['本地参数', 'Local arguments'],
  ['保存显示名', 'Save display name'],
  ['格式化 JSON', 'Format JSON'],
  ['校验并导入', 'Validate and import'],
  ['验证并安装', 'Validate and install'],
  ['导入 JSON', 'Import JSON'],
  ['手动配置', 'Manual setup'],
  ['市场卡片', 'Market card'],
  ['预览并应用', 'Preview and apply'],
  ['确认连接', 'Confirm connection'],
  ['确认应用', 'Confirm apply'],
  ['确认恢复', 'Confirm restore'],
  ['立即创建', 'Create now'],
  ['参数详情', 'Parameter details'],
  ['数组元素', 'Array items'],
  ['展开结构', 'Expand structure'],
  ['收起', 'Collapse'],
  ['展开', 'Expand'],
  ['再显示', 'Show more'],
  ['剩余', 'remaining'],
  ['上一页', 'Previous'],
  ['下一页', 'Next'],
  ['查看全部', 'View all'],
  ['换一批', 'Refresh prompts'],
  ['去试试', 'Try it'],
  ['参与贡献', 'Contribute'],
  ['提交连接器', 'Submit a connector'],
  ['支持', 'Support'],
  ['市场', 'Market'],
  ['工具', 'Tools'],
  ['详情', 'Details'],
  ['连接', 'Connect'],
  ['配置', 'Configure'],
  ['关闭', 'Close'],
  ['取消', 'Cancel'],
  ['确认', 'Confirm'],
  ['删除', 'Delete'],
  ['移除', 'Remove'],
  ['编辑', 'Edit'],
  ['重命名', 'Rename'],
  ['断开连接', 'Disconnect'],
  ['断开', 'Disconnect'],
  ['停用', 'Disable'],
  ['启用', 'Enable'],
  ['保存', 'Save'],
  ['搜索', 'Search'],
  ['刷新', 'Refresh'],
  ['必填', 'Required'],
  ['可选', 'Optional'],
  ['全部状态', 'All statuses'],
  ['全部连接', 'All connections'],
  ['全部服务', 'All services'],
  ['全部', 'All'],
  ['个服务', 'servers'],
  ['个工具', 'tools'],
  ['条连接', 'connections'],
  ['个连接器', 'connectors'],
  ['个 Server', 'servers'],
  ['正在生成脱敏配置并读取本机快照', 'Generating redacted configuration and reading local snapshots'],
  ['连接顺利？如果 MCP连接器对你有帮助，欢迎支持或一起改进。',
    'Smooth connection? If MCP Connector helps, consider supporting or improving it.'],
  ['凭据仅保存在本机，不会写入市场目录。', 'Credentials are stored locally and never written to the market catalog.'],
  ['配置和凭据仅保存在 DSH 本机。', 'Configuration and credentials are stored on this CopyMonster installation only.'],
  ['仅保存在 DSH 本机。', 'Stored on this CopyMonster installation only.'],
  ['默认使用 DSH 当前目录', 'Defaults to the CopyMonster working directory'],
  ['请检查 DSH 服务和反向代理日志', 'Check the CopyMonster service and reverse-proxy logs'],
  ['请重新登录 DSH 后重试', 'Sign in to CopyMonster again and retry'],
  ['请检查 DSH 可信访问地址及反向代理 Host/Origin 配置，不要关闭安全校验',
    'Check the CopyMonster trusted hosts and reverse-proxy Host/Origin settings; do not disable security checks'],
  ['DSH 对话服务尚未就绪，请稍后重试', 'The CopyMonster conversation service is not ready yet; retry shortly'],
  ['DSH 主机', 'CopyMonster host'],
  ['DSH 本机', 'this CopyMonster installation'],
  ['DSH 服务', 'CopyMonster service'],
  ['DSH 当前目录', 'CopyMonster working directory'],
  ['DSH 后重试', 'CopyMonster and retry'],
  ['DSH 可信访问地址', 'CopyMonster trusted hosts'],
  ['添加连接', 'Add Connection'],
  ['连接器', 'connector'],
  ['效率工具', 'Productivity'],
  ['通用工具', 'General'],
  ['开发工具', 'Developer'],
  ['工具清单', 'tool list'],
  ['工具参数', 'tool parameters'],
  ['工具状态', 'tool status'],
  ['工具策略', 'tool policy'],
  ['工具前缀', 'tool prefix'],
  ['工具名称', 'tool name'],
  ['工具缓存', 'tool cache'],
  ['工具注入', 'tool injection'],
  ['工具注册', 'tool registration'],
  ['工具可见性', 'tool visibility'],
  ['只读工具', 'read-only tools'],
  ['业务工具', 'business tools'],
  ['可用工具', 'available tools'],
  ['工具发现', 'tool discovery'],
  ['工具调用', 'tool call'],
  ['未连接', 'Not connected'],
  ['连接当前不可用', 'Connections are currently unavailable'],
  ['按会话启用', 'Enable per session'],
  ['连接后', 'after connecting'],
  ['连接不存在', 'Connection not found'],
  ['添加 MCP 连接', 'Add MCP connection'],
  ['单连接 JSON', 'Single connection JSON'],
  ['正在连接…', 'Connecting…'],
  ['连接配置不能为空', 'Connection configuration cannot be empty'],
  ['确认断开该连接', 'Disconnect this connection?'],
  ['确认断开', 'Confirm disconnect'],
  ['连接配置', 'Connection configuration'],
  ['连接名称', 'Connection name'],
  ['连接记录', 'connection record'],
  ['连接信息', 'connection information'],
  ['连接测试', 'connection test'],
  ['连接失败', 'Connection failed'],
  ['连接成功', 'Connected'],
  ['连接超时', 'Connection timed out'],
  ['连接不可用', 'Connection unavailable'],
  ['保存并重连', 'Save and reconnect'],
  ['仅保存在', 'Stored only in'],
  ['配置快照', 'configuration snapshot'],
  ['配置错误', 'configuration error'],
  ['脱敏配置', 'redacted configuration'],
  ['连接配置', 'connection configuration'],
  ['本地配置', 'local configuration'],
  ['配置文件', 'configuration file'],
  ['重新配置', 'reconfigure'],
  ['配置不能为空', 'configuration cannot be empty'],
  ['配置与凭据', 'configuration and credentials'],
  ['请确认', 'Confirm'],
  ['状态尚未确认', 'Status not confirmed'],
  ['风险已确认', 'Risk acknowledged'],
  ['恢复策略历史', 'Restore policy history'],
  ['恢复快照', 'Restore snapshot'],
  ['恢复中', 'Restoring'],
  ['发送', 'Send'],
  ['正在发送…', 'Sending…'],
  ['已带入新会话', 'Added to the new session'],
  ['打开新会话失败，请重试', 'Could not open a new session; try again'],
  ['打开新会话超时，请重试', 'Opening a new session timed out; try again'],
  ['当前项目', 'Current project'],
  ['项目', 'Project'],
  ['暂无可用 Workspace', 'No workspace available'],
  ['请选择一个 Workspace，再使用项目范围', 'Select a workspace before using project scope'],
  ['请求失败', 'Request failed'],
  ['请求超时', 'Request timed out'],
  ['秒', 'seconds'],
  ['请检查服务状态和 Host 日志后重试', 'check the service status and host logs, then retry'],
  ['无法连接 MCP 连接器服务：', 'Cannot reach the MCP Connector service: '],
  ['请输入', 'Enter '],
  ['精选', 'Featured'],
  ['共', 'Total'],
  ['推荐', 'Recommended'],
  ['其他', 'Other'],
  ['全局', 'Global'],
  ['应用', 'Apply'],
  ['未知错误', 'Unknown error'],
  ['尚无记录', 'No records yet'],
  ['处理中…', 'Working…'],
  ['任意类型', 'Any type'],
  ['数据采集', 'Data collection'],
  ['远程服务', 'Remote service'],
  ['继承上级', 'Inherit from parent'],
  ['法律合规', 'Legal & compliance'],
  ['金融投资', 'Financial investment'],
  ['办公协作', 'Office collaboration'],
  ['设计创意', 'Design & creative'],
  ['企业数据', 'Enterprise data'],
  ['调研分析', 'Research & analysis'],
  ['尚未发现', 'Not discovered yet'],
  ['本地运行', 'Runs locally'],
  ['金融数据', 'Financial data'],
  ['授权已失效', 'Authorization expired'],
  ['规则拟拒绝', 'Rule would deny'],
  ['迁移旧授权', 'Migrate legacy authorization'],
  ['凭据已失效', 'Credentials expired'],
  ['规则拟允许', 'Rule would allow'],
  ['本地 CLI', 'Local CLI'],
  ['填写查询参数', 'Fill in query parameters'],
  ['🔄 重新检查', '🔄 Re-check'],
  ['🔐 重新授权', '🔐 Reauthorize'],
  ['最近发现失败', 'Last discovery failed'],
  ['最近发现成功', 'Last discovery succeeded'],
  ['应用治理策略', 'Apply governance policy'],
  ['正在预览影响…', 'Previewing impact…'],
  ['按服务要求授权', 'Authorize as required by the service'],
  ['正在原子恢复…', 'Restoring atomically…'],
  ['正在应用范围…', 'Applying scope…'],
  ['提供方：待核实', 'Provider: unverified'],
  ['正在校验并更新…', 'Validating and updating…'],
  ['正在创建新会话…', 'Creating a new session…'],
  ['Bearer 凭据', 'Bearer credentials'],
  ['添加连接方式', 'Add connection method'],
  ['Prompt 不能为空', 'Prompt cannot be empty'],
  ['暂无预设 Prompt', 'No preset prompts'],
  ['正在后台发现工具', 'Discovering tools in the background'],
  ['请粘贴 MCP JSON', 'Paste MCP JSON'],
  ['官方 CLI OAuth', 'Official CLI OAuth'],
  ['参数必须是 JSON 数组', 'Arguments must be a JSON array'],
  ['恢复配置快照', 'Restore configuration snapshot'],
  ['当前桥接仅提供只读工具', 'This bridge currently provides read-only tools'],
  ['未缓存输入参数 schema', 'Input parameter schema is not cached'],
  [' · 缓存已超过 24 小时', ' · cache older than 24 hours'],
  ['已复制脱敏配置', 'Redacted configuration copied'],
  ['正在验证凭据与连接…', 'Validating credentials and connection…'],
  [' · schema 已安全裁剪', ' · schema safely truncated'],
  ['连接后查看工具', 'View tools after connecting'],
  ['工具状态尚未确认', 'Tool status not confirmed'],
  ['名称与 URL 必填', 'Name and URL are required'],
  ['权限以授权页和工具策略为准', 'Permissions follow the authorization page and tool policy'],
  ['工具参数 · ', 'Tool parameters · '],
  ['本地 Agent · Local file', 'Local agent · Local file'],
  ['远程 Agent · Online link文档', 'Remote agent · Online link'],
  ['连接不存在，请刷新后重试', 'Connection not found; refresh and try again'],
  ['连接器描述 URL 必填', 'Connector description and URL are required'],
  ['工具清单尚未观察', 'Tool list not observed yet'],
  ['请填写：', 'Fill in: '],
  ['按会话模式不会断开，只会默认隐藏业务工具 schema', 'Session mode does not disconnect; it only hides business tool schemas by default'],
  ['前往 ', 'Get it from '],
  [' 官网获取', ' website'],
  ['确认断开该连接？OAuth 授权会被撤销。', 'Disconnect this connection? OAuth authorization will be revoked.'],
  ['鉴权失败已暂停后台重试，请到已安装页更新凭据或重新授权。', 'Authentication failed; background retries are paused. Update credentials or reauthorize from Installed.'],
  ['连接配置不是合法 JSON', 'Connection configuration is not valid JSON'],
  ['待补充 ', 'Pending: '],
  ['请检查引号、逗号，并确认顶层是 mcpServers 或 connections。', 'Check quotes and commas, and confirm the top level is mcpServers or connections.'],
  ['本机连接的工具发现与参数详情；不会执行工具。', 'Tool discovery and parameter details for local connections; tools are not executed.'],
  ['额外 Headers（可选 JSON）', 'Extra Headers (optional JSON)'],
  ['Streamable HTTP（兼容 SSE）', 'Streamable HTTP (SSE compatible)'],
  ['匹配 ', 'Matched '],
  [' · 已渲染 ', ' · rendered '],
  ['确认断开「', 'Disconnect "'],
  ['」的连接？OAuth 授权会被撤销。', '"? OAuth authorization will be revoked.'],
  ['请核对鉴权方式、Token/API Key 是否有效以及 Header 名。', 'Check the authentication method, Token/API key validity, and Header name.'],
  ['公网地址必须使用 HTTPS；HTTP 只允许回环地址，或经显式确认的私有 IP 字面量。', 'Public addresses must use HTTPS; HTTP is allowed only for loopback or an explicitly acknowledged private IP literal.'],
  ['如目标是可信的局域网私有 IP，请勾选明文 HTTP 风险确认；请勿对公网或不可信服务开启。', 'If the target is a trusted LAN private IP, acknowledge the plaintext HTTP risk; do not enable this for public or untrusted services.'],
  ['确认恢复 revision=', 'Restore policy content at revision='],
  [' 的策略内容？', '?'],
  ['本机配置快照（最多 20 个）', 'Local configuration snapshots (max 20)'],
  ['连接后可读取服务端工具清单', 'Connect to read the server tool list'],
  ['局域网 HTTP 风险已确认', 'LAN HTTP risk acknowledged'],
  ['凭据仅保存在本机，不会写入市场目录或对话。', 'Credentials are stored locally and never written to the market catalog or conversation.'],
  ['检测到 ', 'Found '],
  [' 组可迁移授权。确认复制到 MCP Connector？原插件与原凭据会保留。', ' authorization set(s) to migrate. Copy to MCP Connector? The original plugin and credentials are retained.'],
  ['确认恢复？恢复过程中任一 Server 失败会整体回滚。', 'Confirm restore? If any server fails during restore, the whole change rolls back.'],
  ['实时读取失败：', 'Live read failed: '],
  ['；以下为最后成功缓存。', '; showing the last successful cache.'],
  [' 个', ''],
  [' 条', ''],
];

/** MCP Connector's settings-card and update copy (applied after branding). */
const MCP_CLIENT_REPLACEMENTS = [
  ['插件版本检查 API 不可用', 'Plugin version check API unavailable'],
  ['插件版本检查 API 请求失败：请检查网络、CopyMonster 服务和反向代理连接',
    'Plugin version check API request failed: check the network, CopyMonster service, and reverse proxy'],
  ['：响应格式不正确，请检查登录状态、反向代理和插件版本兼容性',
    ': invalid response; check the session, reverse proxy, and plugin version compatibility'],
  ['（HTTP 401）：请重新登录 CopyMonster 后重试', ' (HTTP 401): sign in to CopyMonster again and retry'],
  ['（HTTP 403）：请检查 CopyMonster 可信访问地址及反向代理 Host/Origin 配置，不要关闭安全校验',
    ' (HTTP 403): check the CopyMonster trusted hosts and reverse-proxy Host/Origin settings; do not disable security checks'],
  ['（HTTP 404）：请检查插件路由是否加载，以及反向代理是否转发 /mcp-connector/api',
    ' (HTTP 404): check that the plugin routes loaded and the reverse proxy forwards /mcp-connector/api'],
  ['（HTTP ${status}）：请检查 CopyMonster 服务和反向代理日志',
    ' (HTTP ${status}): check the CopyMonster service and reverse-proxy logs'],
  [' 更新接口版本不兼容', ' update API version is incompatible'],
  [' 未返回更新任务编号', ' did not return an update task id'],
  [' 不支持回滚', ' does not support rollback'],
  [' 不支持重启', ' does not support restart'],
  ['更新任务排队中…', 'Update queued…'],
  ['正在更新 ${percent}%', 'Updating ${percent}%'],
  ['正在更新：${phase}', 'Updating: ${phase}'],
  ['正在更新…', 'Updating…'],
  ['有任务正在运行，请结束后重试', 'A task is running; finish it and retry'],
  ['插件市场正在处理其他任务', 'The plugin market is handling another task'],
  ['新版本处于发布安全等待期（约 24 小时）', 'The new version is in its release safety window (~24 hours)'],
  ['镜像尚未同步完整安装包', 'The mirror has not synced the full package yet'],
  ['下载后版本未变化', 'Version unchanged after download'],
  ['已阻止版本降级', 'Version downgrade blocked'],
  ['下载版本与预期不一致', 'Downloaded version does not match'],
  ['更新服务未返回有效版本', 'The update service did not return a valid version'],
  ['更新超时', 'Update timed out'],
  ['更新请求被拒绝', 'Update request rejected'],
  ['无法执行本次更新', 'Could not perform this update'],
  ['更新失败', 'Update failed'],
  ['更新服务报告成功，但未返回有效的已安装版本',
    'The update service reported success but did not return a valid installed version'],
  ['正在启动更新…', 'Starting update…'],
  ['暂时无法读取进度，正在重试', 'Could not read progress; retrying'],
  ['立即更新（跳过等待）', 'Update now (skip wait)'],
  ['强制重试', 'Force retry'],
  ['重试更新', 'Retry update'],
  ['检测到异常版本，正在自动回滚…', 'Abnormal version detected; rolling back automatically…'],
  ['已回滚', 'Rolled back'],
  ['已阻止异常版本并回滚', 'Abnormal version blocked and rolled back'],
  ['正在回滚…', 'Rolling back…'],
  ['重试回滚', 'Retry rollback'],
  ['回滚失败', 'Rollback failed'],
  ['回滚', 'Roll back'],
  ['更新服务调用失败', 'Update service call failed'],
  ['查看更新方式', 'View update method'],
  ['正在准备更新…', 'Preparing update…'],
  ['一键更新到 v${providerUpdateCheck.latestVersion}', 'One-click update to v${providerUpdateCheck.latestVersion}'],
  ['v${activationPendingVersion} 已安装，重启后生效', 'v${activationPendingVersion} installed; restart to apply'],
  ['正在重启…', 'Restarting…'],
  ['立即重启', 'Restart now'],
  ['请重启 CopyMonster Desktop', 'Restart CopyMonster Desktop'],
  ['请重启 CopyMonster', 'Restart CopyMonster'],
  ['刷新生效', 'Refresh to apply'],
  ['已复制', 'Copied'],
  ['复制升级命令', 'Copy upgrade command'],
  ['无法写入剪贴板，请点击上方命令全选后手动复制',
    'Could not write to the clipboard; select the command above and copy it manually'],
  ['查看 npm', 'View npm'],
  ['正在检查插件版本', 'Checking plugin version'],
  ['当前版本 v${versionStatus.installedVersion}', 'Current version v${versionStatus.installedVersion}'],
  ['尚未完成版本检查', 'Version check not completed'],
  ['正在检查更新…', 'Checking for updates…'],
  ['检查更新', 'Check for updates'],
  ['暂时无法确认 npm 最新版本，请重试', 'Could not confirm the latest npm version; try again'],
  ['GitHub Release 已发布，等待 npm 同步后即可更新', 'GitHub Release published; update after npm syncs'],
  ['v${versionStatus.release.version} 正在同步', 'v${versionStatus.release.version} syncing'],
  ['返回会话', 'Back to conversation'],
  ['MCP连接器', 'MCP Connector'],
  ['控制侧边栏入口和快捷打开方式。', 'Controls the sidebar entry and quick-open behavior.'],
  ['在侧边栏显示 MCP连接器', 'Show MCP Connector in the sidebar'],
  ['关闭后只隐藏入口，不影响已连接的 MCP Server 和工具。',
    'Closing only hides the entry; connected MCP servers and tools are unaffected.'],
  ['侧边栏入口当前显示。', 'The sidebar entry is visible.'],
  ['入口已隐藏，仍可从这里打开 MCP连接器。', 'The entry is hidden; you can still open MCP Connector here.'],
  ['当前设置页只读。', 'This settings page is read-only.'],
  ['正在保存…', 'Saving…'],
  ['设置未保存，请重试。', 'Settings were not saved; try again.'],
  ['恢复默认', 'Restore defaults'],
  ['打开 MCP连接器', 'Open MCP Connector'],
  ['展开 MCP连接器设置', 'Expand MCP Connector settings'],
  ['收起 MCP连接器设置', 'Collapse MCP Connector settings'],
  ['Prompt 不能为空', 'Prompt cannot be empty'],
  ['请先选择一个工作空间，再使用示例 Prompt', 'Select a workspace before using a sample prompt'],
  ['CopyMonster 对话服务尚未就绪，请稍后重试',
    'The CopyMonster conversation service is not ready yet; retry shortly'],
  ['无效的 Prompt 请求', 'Invalid prompt request'],
  ['已带入新会话', 'Added to the new session'],
  ['关闭 MCP连接器', 'Close MCP Connector'],
];

/** Automation's package description carries a Chinese half next to its English half. */
const AUTOMATION_PACKAGE_REPLACEMENTS = [
  ['CopyMonster Automation — 在独立 CopyMonster Session 中按计划执行和管理编码任务 · Schedule and manage coding tasks in isolated CopyMonster sessions',
    'CopyMonster Automation — Schedule and manage coding tasks in isolated CopyMonster sessions'],
];

/** Brand names shared by all three plugins. */
const BRAND_REPLACEMENTS = [
  ['DeepSeek Harness', 'CopyMonster'],
  ['DeepSeekHarness', 'CopyMonster'],
  ['DeepSeek-Harness', 'CopyMonster'],
];

/** Matches the standalone product name only, never `DSH_*`, `__DSH_*`, or lowercase ids. */
const DSH = /\bDSH\b/g;

/** Chinese fragments inside MCP matcher regexes; translating them would break host diagnostics. */
const PROTECTED_MCP_FRAGMENTS = [
  '已弃用|已废弃|不再推荐',
  'CLI|OAuth|待授权|管理员|本地 MCP',
  '401|403|token|凭据|api.?key',
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

function translateAutomationPackage(text) {
  let next = text;
  for (const [from, to] of AUTOMATION_PACKAGE_REPLACEMENTS) next = next.split(from).join(to);
  return next;
}

function translateMcpClient(text) {
  let next = text;
  const ordered = [...MCP_CLIENT_REPLACEMENTS].sort((left, right) => right[0].length - left[0].length);
  for (const [from, to] of ordered) next = next.split(from).join(to);
  return next;
}

function translateMcp(text) {
  let next = text;
  const protectedFragments = [];
  for (const [index, fragment] of PROTECTED_MCP_FRAGMENTS.entries()) {
    if (!next.includes(fragment)) continue;
    const token = `__COPYMONSTER_PROTECTED_MCP_${index}__`;
    protectedFragments.push([token, fragment]);
    next = next.split(fragment).join(token);
  }
  const ordered = [...MCP_UI_REPLACEMENTS].sort((left, right) => right[0].length - left[0].length);
  // Some phrases become matchable only after a shorter component is translated
  // (for example `本地 Agent · 本地文件` -> `本地 Agent · Local file`). Re-apply
  // until stable so `--check` reflects a single settled pass.
  for (let pass = 0; pass < 4; pass += 1) {
    const before = next;
    for (const [from, to] of ordered) next = next.split(from).join(to);
    if (next === before) break;
  }
  for (const [token, fragment] of protectedFragments) next = next.split(token).join(fragment);
  for (const fragment of PROTECTED_MCP_FRAGMENTS) {
    if (!next.includes(fragment)) {
      throw new Error(`MCP translation would remove a protected matcher fragment: ${fragment}`);
    }
  }
  return rebrand(next);
}

const plugins = [
  {
    name: 'dsh-mcp-connector',
    files: [
      { relative: 'ui/index.html', transform: translateMcp },
      { relative: 'lib/client.js', transform: text => translateMcpClient(rebrand(text)) },
      { relative: 'package.json', transform: rebrand },
    ],
  },
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
      { relative: 'lib/client.js', transform: rebrand },
      { relative: 'locale/en.json', transform: rebrand },
      { relative: 'locale/zh.json', transform: rebrand },
      { relative: 'package.json', transform: text => translateAutomationPackage(rebrand(text)) },
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
