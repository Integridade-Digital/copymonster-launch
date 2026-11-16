/** Simplified Chinese copy for the LeadLovers MCP settings card. */

import type { LeadLoversMcpLocaleKey } from './en.ts'

/** Simplified Chinese dictionary. */
export const zh: Record<LeadLoversMcpLocaleKey, string> = {
  title: 'LeadLovers MCP',
  description: '连接 LeadLovers 账户以管理联系人、项目和营销活动。',
  authorize: '授权',
  refreshToken: '刷新令牌',
  testConnection: '测试连接',
  clearCredentials: '清除凭据',
  finishAuthorization: '完成授权',
  codePlaceholder: '如果授权未能自动完成，请粘贴回调地址或代码',
  loading: '加载中…',
  notAuthorized: '未授权 — 点击“授权”并在 LeadLovers 页面完成登录后即可使用 MCP 工具。',
  authorized: '已授权 · 令牌更新于 {at} · MCP {state} · {count} 个工具',
  connected: '已连接',
  disconnected: '未连接',
  opened: '已在新标签页打开 LeadLovers 授权页面。',
  confirmClear: '确定清除 LeadLovers MCP 的全部凭据吗？MCP 工具将被注销，之后需要重新授权。',
  cancelled: '已取消。',
  toolsDiscovered: '发现的 MCP 工具（{count}）：{tools}',
  statusFailed: '无法读取状态：{error}',
  actionFailed: '操作失败：{error}',
  connectionSuccessful: '连接成功。',
  authorizationFailed: '授权失败。',
  tokenExpired: '令牌已过期。',
  connecting: '连接中…',
  ok: '[成功] ',
  failed: '[失败] ',
}
