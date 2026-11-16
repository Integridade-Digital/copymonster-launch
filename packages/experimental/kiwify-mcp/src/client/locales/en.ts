/** Locale keys for the Kiwify MCP settings card. */

/** English copy, the fallback dictionary. */
export const en = {
  title: 'Kiwify MCP',
  description: 'Connect your Kiwify account to manage products, sales and affiliates.',
  authorize: 'Authorize',
  refreshToken: 'Refresh token',
  testConnection: 'Test connection',
  clearCredentials: 'Clear credentials',
  finishAuthorization: 'Finish authorization',
  codePlaceholder: 'If authorization does not complete automatically, paste the callback URL or code',
  loading: 'Loading…',
  notAuthorized: 'Not authorized — click Authorize and complete sign-in on Kiwify to enable the MCP tools.',
  authorized: 'Authorized · token updated {at} · MCP {state} · {count} tools',
  connected: 'connected',
  disconnected: 'disconnected',
  opened: 'Opened the Kiwify authorization page in a new tab.',
  confirmClear: 'Clear all Kiwify MCP credentials? The MCP tools will be unregistered and authorization will be required again.',
  cancelled: 'Cancelled.',
  toolsDiscovered: 'Discovered MCP tools ({count}): {tools}',
  statusFailed: 'Could not read status: {error}',
  actionFailed: 'Action failed: {error}',
  connectionSuccessful: 'Connection successful.',
  authorizationFailed: 'Authorization failed.',
  tokenExpired: 'Token expired.',
  connecting: 'Connecting…',
  ok: '[ok] ',
  failed: '[failed] ',
} as const

/** Key union the card renders. */
export type KiwifyMcpLocaleKey = keyof typeof en
