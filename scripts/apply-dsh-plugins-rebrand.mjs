/**
 * Rebrand and localize the installed delivery plugins for CopyMonster.
 *
 * The MCP Connector ships a Chinese-first iframe UI; GenUI and Automation ship
 * English base copy with product-brand references. This script translates the
 * MCP Connector's interface chrome and bundled catalog to English and replaces
 * user-visible `DSH` / `DeepSeek Harness` references with CopyMonster in all
 * three plugins. It also disables the remote MCP catalog so the translated
 * bundled catalog is authoritative.
 *
 * Protected: package names, API paths, config keys, tool names, Chinese host
 * diagnostics used by the MCP regex matchers, and the GenUI / Automation
 * Chinese locale dictionaries (they remain available for Chinese users; the
 * app's English locale selects the English dictionaries).
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

import { readFileSync } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** Exact English replacements for the bundled MCP connector catalog. */
const MCP_CATALOG_I18N = JSON.parse(
  readFileSync(new URL('./dsh-mcp-catalog-i18n.json', import.meta.url), 'utf8'),
);

/** MCP Connector's user-visible interface copy, longest first at apply time. */
const MCP_UI_REPLACEMENTS = [
  ['结构较大，请查看原始 Schema。', 'Structure is large; please inspect raw schema.'],
  ['允许任意输入', 'Accepts any input'],
  ['不允许任何输入', 'Does not accept input'],
  ['暂无参数定义。', 'No parameter definitions.'],
  ['禁止输入', 'Input not permitted'],
  ['未声明', 'Undeclared'],
  ['暂无说明', 'No description'],
  ['摘要已截断，请查看原始 Schema 中的其余字段。', 'Summary truncated; please inspect raw schema for remaining fields.'],
  ['包含引用或组合约束，摘要不代表完整规则，请同时查看原始 Schema。', 'Contains references or composite constraints; summary does not represent full rules, please inspect raw schema.'],
  ['<th>参数</th><th>类型</th><th>要求</th><th>说明与约束</th>', '<th>Parameter</th><th>Type</th><th>Requirement</th><th>Description & constraints</th>'],
  ['<th>参数</th>', '<th>Parameter</th>'],
  ['<th>类型</th>', '<th>Type</th>'],
  ['<th>要求</th>', '<th>Requirement</th>'],
  ['<th>说明与约束</th>', '<th>Description & constraints</th>'],
  ['<p class="hint">类型：', '<p class="hint">Type: '],
  ['；无可Expand的具名参数，请查看原始 Schema。', '; no named parameters to expand, please inspect raw schema.'],
  ['；无可展开的具名参数，请查看原始 Schema。', '; no named parameters to expand, please inspect raw schema.'],
  ['原始 Schema（安全缓存）', 'Raw schema (safe cache)'],
  ['最后成功缓存', 'Last successful cache'],
  ['已超过 24 小时', 'over 24 hours'],
  ['· 显示 ', '· Showing '],
  ['没有匹配“', 'No tools match "'],
  ['”的Tools', '"'],
  ['”的工具', '"'],
  ['Host 已完成 stdio 初始化，但该 Server 当前没有可展示的Tools。', 'Host completed stdio initialization, but this server has no tools to display.'],
  ['Host 已完成 stdio 初始化，但该 Server 当前没有可展示的工具。', 'Host completed stdio initialization, but this server has no tools to display.'],
  ['未命名Tools', 'Unnamed tool'],
  ['未命名工具', 'Unnamed tool'],
  ['当前 Host 未观察到该Tools，不能报告为Disabled或健康', 'Current host has not observed this tool; cannot report as disabled or healthy'],
  ['当前 Host 未观察到该工具，不能报告为已停用或健康', 'Current host has not observed this tool; cannot report as disabled or healthy'],
  ['未观察 · ', 'Unobserved · '],
  ['Host 强制执行', 'Host enforced'],
  ['Host 能力不足', 'Host unsupported'],
  ["['allow', '允许']", "['allow', 'Allow']"],
  ["['deny', '拒绝']", "['deny', 'Deny']"],
  ['Server 策略', 'Server policy'],
  ['Tool 策略', 'Tool policy'],
  ['tools的名称或描述…', 'tool names or descriptions…'],
  ['工具的名称或描述…', 'tool names or descriptions…'],
  ['包含运行于 DSH 主机的服务；授权和权限要求请查看详情', 'Contains services running on DSH host; see details for authorization and permissions'],
  ['包含运行于 CopyMonster host的服务；授权和权限要求请查看Details', 'Contains services running on CopyMonster host; see details for authorization and permissions'],
  ['查看 ${esc(d.name)} 详情', 'View ${esc(d.name)} details'],
  ['查看 ${esc(d.name)} Details', 'View ${esc(d.name)} details'],
  ['提供方：', 'Provider: '],
  ['运行于 CopyMonster host', 'Runs on CopyMonster host'],
  ['运行于 DSH 主机', 'Runs on CopyMonster host'],
  ['按Connect筛选', 'Filter by connection'],
  ['按连接筛选', 'Filter by connection'],
  ['<label>服务<select', '<label>Service<select'],
  ['aria-label="按服务筛选"', 'aria-label="Filter by service"'],
  ['<label>发现状态<select', '<label>Discovery status<select'],
  ['aria-label="按发现状态筛选"', 'aria-label="Filter by discovery status"'],
  ['· 缓存 ${c.toolCount} 个工具', '· Cached ${c.toolCount} tools'],
  ['· 缓存 ${c.toolCount} tools', '· Cached ${c.toolCount} tools'],
  ['最近发现：', 'Recently discovered: '],
  ['最后成功：', 'Last success: '],
  ['· 缓存超过 24 小时', '· Cache older than 24 hours'],
  ['· 缓存清单已截断', '· Cached list truncated'],
  ['<br>建议：', '<br>Suggestion: '],
  ['建议：', 'Suggestion: '],
  ['下次后台发现不早于：', 'Next background discovery no earlier than: '],
  ['（页面保持Connect时）', '(while page remains connected)'],
  ['（页面保持连接时）', '(while page remains connected)'],
  ['>检查Connect</button>', '>Check connection</button>'],
  ['>检查连接</button>', '>Check connection</button>'],
  ['<div class="hint">来源：', '<div class="hint">Source: '],
  ['暂无描述', 'No description'],
  ['<summary>连接状态与故障处理（', '<summary>Connection status and troubleshooting ('],
  ['可从旧企查查 OAuth 插件Copy已有授权', 'Can copy existing authorization from legacy Qichacha plugin'],
  ['可从旧企查查 OAuth 插件复制已有授权', 'Can copy existing authorization from legacy Qichacha plugin'],
  ['扫描企查查旧 OAuth 插件；不会Delete旧插件或原凭据', 'Scan legacy Qichacha OAuth plugin; does not delete legacy plugin or credentials'],
  ['扫描企查查旧 OAuth 插件；不会删除旧插件或原凭据', 'Scan legacy Qichacha OAuth plugin; does not delete legacy plugin or credentials'],
  ['可安全Copy ${pendingMigration} 组授权到 MCP Connector；不会Delete旧插件或原凭据。', 'Safely copy ${pendingMigration} authorization set(s) to MCP Connector; legacy plugin and credentials are preserved.'],
  ['不会Delete旧插件或原凭据', 'legacy plugin and credentials are preserved'],
  ['不会删除旧插件或原凭据', 'legacy plugin and credentials are preserved'],
  ['>迁移</button>', '>Migrate</button>'],
  ['迁移旧授权', 'Migrate legacy authorization'],
  ['OAuth 授权', 'OAuth authorization'],
  ['本地运行', 'Runs locally'],
  ['本地 CLI', 'Local CLI'],
  ['浏览连接器目录', 'Browse connector catalog'],
  ['浏览连接器', 'Browse connectors'],
  ['＋ 添加连接', '+ Add connection'],
  ['全部分类', 'All categories'],
  ['热门推荐', 'Popular'],
  ['最新上架', 'Recently added'],
  ['检查连接', 'Check connection'],
  ['返回市场', 'Back to Market'],
  ['社区入口', 'Community'],
  ['官方文档', 'Official docs'],
  ['地图', 'Maps'],
  ['💬 去试试', '💬 Try it'],
  ['下载', 'Download'],
  ['复制', 'Copy'],
  ['恢复', 'Restore'],
  ['范围', 'Scope'],
  ['保存本地参数', 'Save local arguments'],
  ['带入新会话', 'Add to new session'],
  ['连接 ${servers.length} 个 Server', 'Connect ${servers.length} servers'],
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
  ['可选择任一 Workspace；项目范围只在该 Workspace 的 Agent 中可见。全局范围由所有 Workspace 继承，范围绑定不保存或复制凭据。',
    'Select any workspace; project scope is visible only in that workspace\'s agents. Global scope is inherited by all workspaces; scope binding does not save or copy credentials.'],
  ['策略', 'policy'],
  ['未知', 'Unknown'],
  ['最后成功', 'Last success'],
  ['法律数据', 'Legal data'],
  ['MCP连接器社区入口', 'MCP Connector community'],
  ['可安全复制 ${pendingMigration} 组授权到 MCP连接器；不会删除旧插件或原凭据。',
    'Safely copy ${pendingMigration} authorization set(s) to MCP Connector; the legacy plugin and credentials are preserved.'],
  ['按会话模式不会断开连接，只会默认隐藏业务工具 schema',
    'Session mode does not disconnect; it only hides business tool schemas by default'],
  ['重新建立 Host 侧条目并复检：不改配置、凭据、范围或注入模式',
    'Rebuild the host entry and recheck: configuration, credentials, scope, and injection mode are unchanged'],
  ['请检查网络、端点是否可达以及 MCP URL 是否完整。',
    'Check the network, endpoint reachability, and that the MCP URL is complete.'],
  ['凭据仅保存在 DSH 本机，不会写入市场目录或对话。',
    'Credentials are stored on this CopyMonster installation only and are never written to the market catalog or conversation.'],
  ['一次配置 ${servers.length} 个 MCP Server', 'Configure ${servers.length} MCP server(s) at once'],
  ['以下 Server 共用同一份 ${esc(credentialName)}；凭据仅保存在本机，不会写入市场目录。',
    'The servers below share one ${esc(credentialName)}; credentials are stored locally only and never written to the market catalog.'],
  ['当前 Host 未观察到该工具，不能报告为已禁用或健康',
    'Current host has not observed this tool; cannot report as disabled or healthy'],
  ['关闭社区入口', 'Close community entry'],
  ['本次不再显示', "Don't show again"],
  ['当前：', 'Current: '],
  ['当前连接不会中断；', 'The current connection is not interrupted; '],
  ['远程入口解析公网可访问的 URL；本地入口读取对话中上传、粘贴或指定路径的文件并自动提交解析，需 Node.js 20+。',
    'The remote entry resolves publicly reachable URLs; the local entry reads files uploaded, pasted, or specified by path in the conversation and submits them for parsing. Requires Node.js 20+.'],
  ['企业尚未开放 CLI 或您无法取得授权？可以取消，等待管理员处理，无需反复登录或重启。一键授权也不能绕过企业政策。本版本不会自动发起登录；工具注册不代表已获得全部业务权限。',
    'Has your organization not enabled the CLI, or can you not obtain authorization? You can cancel and wait for an administrator; no repeated sign-in or restart is needed. One-click authorization cannot bypass company policy. This version does not start sign-in automatically; tool registration does not mean all business permissions have been granted.'],
  ['选择连接影响范围', 'Choose the connection scope'],
  ['连接配置与凭据仍只保存一份；项目范围会由 Host 在工具可见性和执行层强制隔离。',
    'Connection configuration and credentials are still stored once; project scope is enforced by the host at the tool-visibility and execution layers.'],
  ['留空使用市场参数（已有连接保留原覆盖）。argsAppend 追加命令参数，env 合并环境变量，cwd 设置工作目录；仅保存在本机。可用于指定浏览器路径或代理。参数可能扩大本地访问权限，请仅填写可信内容；启动失败时保留表单供修改重试。',
    'Leave empty to use the market arguments (existing connections keep their overrides). argsAppend appends command arguments, env merges environment variables, and cwd sets the working directory; stored locally only. Use it to specify a browser path or proxy. Arguments may expand local access; enter only trusted content. If startup fails, the form is kept for edits and retry.'],
  ['变更前会预览受影响的 Server 和已知工具；连接配置、OAuth Grant 和凭据不会被复制。',
    'You will preview the affected servers and known tools before the change; connection configuration, OAuth grants, and credentials are not copied.'],
  ['变更方式', 'Change method'],
  ['移动（替换现有范围）', 'Move (replace existing scope)'],
  ['复制（保留现有范围）', 'Copy (keep existing scope)'],
  ['市场连接器名称由目录维护', 'Market connector names are maintained by the catalog'],
  ['修改连接显示名', 'Edit connection display name'],
  ['只修改页面显示名', 'Only the display name changes'],
  ['、工具前缀、作用范围和凭据均保持不变。', ', tool prefix, scope, and credentials remain unchanged.'],
  ['serverName（工具前缀，不可修改）', 'serverName (tool prefix, read-only)'],
  ['安全编辑标准化 JSON', 'Safely edit normalized JSON'],
  [' 是连接身份，不可修改；原始排版、注释和字段别名不会被还原。',
    ' is the connection identity and cannot be changed; original formatting, comments, and field aliases are not restored.'],
  [' 表示敏感值继续留在本机，可直接保留，或替换为新值；删除字段表示清除该项。',
    ' keeps a sensitive value on this machine, either unchanged or replaced with a new value; removing a field clears that entry.'],
  ['提交前会先验证新配置并创建快照。任何校验、启动或保存失败都会保留原连接；连接 key、作用范围与启停状态不变。',
    'The new configuration is validated and a snapshot is created before submission. Any validation, startup, or save failure keeps the original connection; the connection key, scope, and enabled state remain unchanged.'],
  ['仅覆盖本机，无需修改市场目录', 'Local overrides only; the market catalog is not modified'],
  [' 追加到市场参数末尾；', ' is appended to the end of the market arguments; '],
  [' 合并环境变量；', ' merges environment variables; '],
  [' 设置工作目录。命令、连接身份与市场默认值保持不变。参数可能扩大本地访问权限，请仅填写可信内容。',
    ' sets the working directory. The command, connection identity, and market defaults remain unchanged. Arguments may expand local access; enter only trusted content.'],
  [' 保留本机已有值；删除字段清除该项覆盖。保存会创建快照并重新加载已启用连接，停用连接保持停用；不代表工具调用已验收。',
    ' keeps the existing local value; removing a field clears that override. Saving creates a snapshot and reloads enabled connections; disabled connections stay disabled. This does not verify tool calls.'],
  ['粘贴 MCP JSON', 'Paste MCP JSON'],
  ['支持 <code>mcpServers</code> 的 Streamable HTTP、SSE 与 stdio（command/args/env/cwd），配置和凭据仅保存在 DSH 本机。私有 IP 明文 HTTP 必须在对应条目显式设置 ',
    'Supports Streamable HTTP, SSE, and stdio (command/args/env/cwd) for <code>mcpServers</code>. Configuration and credentials are stored on this CopyMonster installation only. Plaintext HTTP for private IPs requires '],
  ['粘贴厂商提供的 ConnectorDescriptor JSON 地址。安装成功后会作为卡片显示在本机「市场」。',
    'Paste the ConnectorDescriptor JSON URL provided by the vendor. After a successful install it appears as a card in the local Market.'],
  ['公共市场如何上架', 'How to publish to the public market'],
  ['向 <code>dsh-mcp-connector</code> registry 提交无 Token/API Key 的描述 JSON；Schema、URL、MCP 和 OAuth 探针通过后才会分发给所有用户。真正一键 OAuth 需厂商支持 Authorization Code + PKCE、标准元数据和动态客户端注册。',
    'Submit a description JSON without a token/API key to the <code>dsh-mcp-connector</code> registry; it is distributed to all users only after the schema, URL, MCP, and OAuth probes pass. True one-click OAuth requires the vendor to support Authorization Code + PKCE, standard metadata, and dynamic client registration.'],
  ['连接器描述 URL（必填）', 'Connector description URL (required)'],
  ['适合私有、内网或暂未上架的 MCP Server。凭据只写入 DSH 本机 storage domain。',
    'For private, intranet, or not-yet-published MCP servers. Credentials are written only to the CopyMonster local storage domain.'],
  ['名称（必填）', 'Name (required)'],
  ['传输方式', 'Transport'],
  ['（兼容 SSE）', ' (SSE compatible)'],
  ['stdio（本地进程）', 'stdio (local process)'],
  ['我确认这是可信的局域网私有 IP，并接受 HTTP 传输可被同网段监听或篡改的风险。',
    'I confirm this is a trusted LAN private IP and accept that HTTP traffic can be intercepted or modified on the same network segment.'],
  ['仅放行 10/8、172.16/12、192.168/16 和 IPv6 ULA 字面量；域名、公网 HTTP、链路本地与云元数据地址仍会被拒绝。',
    'Only 10/8, 172.16/12, 192.168/16, and IPv6 ULA literals are allowed; domain names, public HTTP, link-local, and cloud metadata addresses are still rejected.'],
  ['stdio 会在本机启动进程；请只使用可信命令和软件包。环境变量不会写入市场目录。',
    'stdio starts a process on this machine; use only trusted commands and packages. Environment variables are not written to the market catalog.'],
  [' · 可移除 ${item.absentCount} 条变更后新增连接',
    ' · removable: ${item.absentCount} connection(s) added after the change'],
  [' · OAuth 需重新授权', ' · OAuth reauthorization required'],
  ['可携带脱敏导出', 'Portable redacted export'],
  ['Token、API Key、Header/env 值、stdio 参数、本地路径与 OAuth Grant 均不会导出；占位符需在目标本机重填，OAuth 需重新授权。',
    'Tokens, API keys, header/env values, stdio arguments, local paths, and OAuth grants are not exported; placeholders must be refilled on the target machine, and OAuth must be reauthorized.'],
  ['脱敏 JSON', 'Redacted JSON'],
  ['发送前补全参数，内容只用于本次新会话，不会写回连接器目录。',
    'Fill in the parameters before sending; the content is used only for this new session and is not written back to the connector catalog.'],
  ['清除本机追加参数、环境变量和工作目录覆盖；已启用连接将重新加载。',
    'Clear local appended arguments, environment variables, and working-directory overrides; enabled connections will reload.'],
  ['正在更新本地参数…', 'Updating local arguments…'],
  ['JSON 格式化失败', 'JSON formatting failed'],
  ['连接显示名不能为空', 'Connection display name cannot be empty'],
  ['变更连接范围', 'Change connection scope'],
  ['复制到', 'copy to'],
  ['移动到', 'move to'],
  ['所选范围？', 'the selected scope?'],
  ['确认将全部连接范围恢复到', 'Restore all connection scopes to'],
  ['按会话启用不会断开 MCP 连接，但会在所有会话中默认隐藏该连接的业务工具。\\n\\n之后需要在对话中明确选择工具才会临时激活，最长 30 分钟。确认继续？',
    'Session mode does not disconnect the MCP connection, but hides that connection\'s business tools by default in all sessions.\\n\\nYou must explicitly select a tool in the conversation to activate it temporarily, for up to 30 minutes. Continue?'],
  ['请按 Ctrl/Cmd+C 复制脱敏配置', 'Press Ctrl/Cmd+C to copy the redacted configuration'],
  ['名称与启动命令必填', 'Name and start command are required'],
  ['环境变量必须是 JSON 对象', 'Environment variables must be a JSON object'],
  ['额外 Headers 不是合法 JSON', 'Extra headers are not valid JSON'],
  ['MCP JSON 不合法', 'Invalid MCP JSON'],
  ['确认把旧企查查 OAuth 授权复制到 MCP连接器？原插件与原凭据会保留；验证新连接后再手动停用旧插件。',
    'Copy the legacy Qichacha OAuth authorization to MCP Connector? The original plugin and credentials are retained; disable the legacy plugin manually after verifying the new connection.'],
  ['迁移', 'Migrate'],
  ['检测到 ${ids.length} 组可迁移授权。确认复制到 MCP连接器？原插件与原凭据会保留。',
    'Found ${ids.length} authorization set(s) that can be migrated. Copy to MCP Connector? The original plugin and credentials are retained.'],
  ['当前连接异常', 'Current connection error'],
  ['请在 DSH Desktop 中使用「发送到新会话」', 'Use "Send to new session" in CopyMonster Desktop'],
  ['。', '.'],
  ['，', ','],
  ['；', ';'],
  ['：', ':'],
  ['（', '('],
  ['）', ')'],
  ['「', '"'],
  ['」', '"'],
  ['、', ','],
  ['！', '!'],
  ['？', '?'],
  ['“', '"'],
  ['”', '"'],
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
  ['更新服务将插件从 v${before.normalized} 降级到 v${installed.normalized}',
    'The update service downgraded the plugin from v${before.normalized} to v${installed.normalized}'],
  ['预期安装 v${expected.normalized}，更新服务实际安装了 v${installed.normalized}',
    'Expected v${expected.normalized}, but the update service installed v${installed.normalized}'],
  ['当前 CopyMonster 版本没有可用的工作区会话创建能力，请升级 CopyMonster 后重试',
    'The current CopyMonster version cannot create workspace sessions; upgrade CopyMonster and retry'],
  ['已安装 v${updateOperation.installedVersion ?? versionStatus?.latestVersion}',
    'Installed v${updateOperation.installedVersion ?? versionStatus?.latestVersion}'],
  ['重启由 ${updateProviderSelection?.capabilities?.restart?.managedBy ?? "宿主"} 管理',
    'Restart is managed by ${updateProviderSelection?.capabilities?.restart?.managedBy ?? "the host"}'],
  ['由 ${updateProviderSelection?.provider?.label ?? "更新服务"} 安全更新到 v${providerUpdateCheck.latestVersion}',
    'Safely update to v${providerUpdateCheck.latestVersion} via ${updateProviderSelection?.provider?.label ?? "the update service"}'],
  ['上次检查：${new Date(versionStatus.checkedAt).toLocaleString()}',
    'Last checked: ${new Date(versionStatus.checkedAt).toLocaleString()}'],
];

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
 * Unlike the MCP Connector, the Automation client is not an iframe: its bundle
 * runs in the host document, so it resolves `--cm-*` from `apps/web/src/cm-theme.css`
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

/** CopyMonster palette bridge for the MCP Connector iframe. Parent CSS cannot cross
 * the iframe document boundary, so the iframe copies the live `--cm-*` values
 * from the host body and maps them onto its own `--bg`/`--card`/`--accent` set. */
const MCP_THEME_STYLE = `
  [data-plugin="dsh-mcp-connector"] .icon-btn.primary,
  [data-plugin="dsh-mcp-connector"] .btn-primary,
  [data-plugin="dsh-mcp-connector"] .btn:not(.ghost):not(.danger):not(.status-warning):not(.status-bad) {
    color: var(--accent-foreground, #fff);
  }
  [data-plugin="dsh-mcp-connector"] .icon-btn.primary:hover,
  [data-plugin="dsh-mcp-connector"] .btn-primary:hover,
  [data-plugin="dsh-mcp-connector"] .btn:not(.ghost):not(.danger):not(.status-warning):not(.status-bad):hover {
    background: var(--accent-hover);
  }
  [data-plugin="dsh-mcp-connector"] .card:hover,
  [data-plugin="dsh-mcp-connector"] .card.featured {
    border-color: var(--accent);
  }
  [data-plugin="dsh-mcp-connector"] .switch .slider { background: var(--line); }
  [data-plugin="dsh-mcp-connector"] .tool-item { border-top-color: var(--line); }
  [data-plugin="dsh-mcp-connector"] .detail-header .close-btn { color: var(--text-2); }
  [data-plugin="dsh-mcp-connector"] .detail-header .close-btn:hover {
    color: var(--text); background: var(--bg); border-color: var(--line);
  }
  [data-plugin="dsh-mcp-connector"] main::-webkit-scrollbar-thumb,
  [data-plugin="dsh-mcp-connector"] .detail-body::-webkit-scrollbar-thumb,
  [data-plugin="dsh-mcp-connector"] .tools-list::-webkit-scrollbar-thumb { background: var(--line); }
  [data-plugin="dsh-mcp-connector"] main::-webkit-scrollbar-thumb:hover,
  [data-plugin="dsh-mcp-connector"] .detail-body::-webkit-scrollbar-thumb:hover,
  [data-plugin="dsh-mcp-connector"] .tools-list::-webkit-scrollbar-thumb:hover { background: var(--muted); }
`;

const MCP_THEME_SCRIPT = `<script data-cm-mcp-theme-script>
(function () {
  function apply() {
    if (window.parent === window) return;
    try {
      var parentBody = window.parent.document.body;
      var parentRoot = window.parent.document.documentElement;
      var source = window.getComputedStyle(parentBody);
      var root = document.documentElement;
      var primary = source.getPropertyValue('--cm-primary').trim();
      function set(name, value) { if (value) root.style.setProperty(name, value); }
      set('--cm-primary', primary);
      set('--bg', source.getPropertyValue('--cm-background').trim());
      set('--card', source.getPropertyValue('--cm-card').trim());
      set('--line', source.getPropertyValue('--cm-border').trim());
      set('--text', source.getPropertyValue('--cm-card-foreground').trim());
      set('--text-2', source.getPropertyValue('--cm-foreground').trim());
      set('--muted', source.getPropertyValue('--cm-muted-foreground').trim());
      set('--accent', primary);
      set('--accent-hover', primary ? 'color-mix(in srgb, ' + primary + ' 82%, #000)' : '');
      set('--accent-light', primary ? 'color-mix(in srgb, ' + primary + ' 16%, transparent)' : '');
      set('--accent-foreground', source.getPropertyValue('--cm-primary-foreground').trim());
      set('--shadow', source.getPropertyValue('--cm-shadow').trim());
      root.setAttribute('data-cm-theme', parentRoot.getAttribute('data-ds-theme-source') || '');
    } catch (error) { /* direct iframe open or a cross-origin parent: keep the plugin defaults */ }
  }
  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  window.addEventListener('load', apply);
  setInterval(apply, 2000);
  try {
    var observer = new MutationObserver(apply);
    observer.observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-ds-theme-source', 'data-cm-is-admin', 'style'] });
    observer.observe(window.parent.document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] });
  } catch (error) { /* the observer only exists for the embedded same-origin panel */ }
})();
</script>`;

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

function translateMcpClient(text) {
  let next = text;
  const ordered = [...MCP_CLIENT_REPLACEMENTS].sort((left, right) => right[0].length - left[0].length);
  for (const [from, to] of ordered) next = next.split(from).join(to);
  return next;
}

/** Points catalog resolution at the bundled English catalog and drops remote fallbacks. */
function translateMcpConstants(text) {
  let next = text;
  next = next.replace(
    /export const DEFAULT_CATALOG_URL =\s*'[^']*';/,
    "export const DEFAULT_CATALOG_URL = '';",
  );
  next = next.replace(
    /export const DEFAULT_CATALOG_FALLBACK_URLS = \[[^\]]*\];/,
    'export const DEFAULT_CATALOG_FALLBACK_URLS = [];',
  );
  if (!/export const DEFAULT_CATALOG_URL = '';/.test(next)
    || !/export const DEFAULT_CATALOG_FALLBACK_URLS = \[\];/.test(next)) {
    throw new Error('MCP catalog URL was not neutralized');
  }
  return next;
}

/** Replaces every Chinese catalog string through the exact translation table. */
function translateMcpCatalog(text) {
  if (!/[\u4e00-\u9fff]/.test(text)) return text;
  const translate = (value) => typeof value === 'string'
    ? (MCP_CATALOG_I18N[value] ?? value)
    : value;
  const walk = (value) => {
    if (typeof value === 'string') return translate(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]));
    }
    return value;
  };
  const translated = walk(JSON.parse(text));
  const remaining = JSON.stringify(translated).match(/[\u4e00-\u9fff]+/g);
  if (remaining !== null) {
    throw new Error(`untranslated MCP catalog strings: ${[...new Set(remaining)].join(', ')}`);
  }
  return `${JSON.stringify(translated, null, 2)}\n`;
}

function injectMcpTheme(text) {
  let next = text;
  if (!/<html[^>]*data-plugin="dsh-mcp-connector"/.test(next)) {
    next = next.replace(/<html([^>]*)>/, '<html$1 data-plugin="dsh-mcp-connector">');
  }
  next = next.replace('<html lang="zh-CN"', '<html lang="en"');
  if (!next.includes('data-cm-mcp-theme')) {
    next = next.replace('</head>', `<style data-cm-mcp-theme>${MCP_THEME_STYLE}</style>\n</head>`);
  }
  if (!next.includes('data-cm-mcp-theme-script')) {
    next = next.replace('</body>', `${MCP_THEME_SCRIPT}\n</body>`);
  }
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
      { relative: 'ui/index.html', transform: text => injectMcpTheme(translateMcp(text)) },
      { relative: 'lib/client.js', transform: text => translateMcpClient(rebrand(text)) },
      { relative: 'lib/constants.js', transform: translateMcpConstants },
      { relative: 'catalog/catalog.json', transform: translateMcpCatalog },
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
      { relative: 'lib/client.js', transform: text => applyAutomationTheme(markAutomationModelField(translateAutomationClient(rebrand(text)))) },
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
