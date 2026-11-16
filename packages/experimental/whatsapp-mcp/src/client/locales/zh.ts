/** Chinese copy for the WhatsApp Business MCP settings card. */

import type { WhatsAppMcpLocaleKey } from './en.ts'

/** Simplified Chinese dictionary. */
export const zh: Record<WhatsAppMcpLocaleKey, string> = {
  title: 'WhatsApp Business MCP',
  description: '连接 WhatsApp Business 账户以管理消息和模板。',
  authorize: '授权',
  refreshToken: '刷新令牌',
  testConnection: '测试连接',
  clearCredentials: '清除凭据',
  finishAuthorization: '完成授权',
  codePlaceholder: '如果授权未自动完成，请粘贴回调 URL 或代码',
  loading: '加载中…',
  notAuthorized: '未授权 — 点击“授权”并在 Meta 完成登录以启用 MCP 工具。',
  authorized: '已授权 · 令牌更新于 {at} · MCP {state} · {count} 个工具',
  connected: '已连接',
  disconnected: '未连接',
  opened: '已在新标签页打开 Meta 授权页面。',
  confirmClear: '清除所有 WhatsApp Business MCP 凭据？MCP 工具将被注销，并且需要重新授权。',
  cancelled: '已取消。',
  toolsDiscovered: '已发现 MCP 工具（{count}）：{tools}',
  statusFailed: '无法读取状态：{error}',
  actionFailed: '操作失败：{error}',
  connectionSuccessful: '连接成功。',
  authorizationFailed: '授权失败。',
  tokenExpired: '令牌已过期。',
  connecting: '连接中…',
  ok: '[ok] ',
  failed: '[失败] ',
}
