/** Locale keys for the WhatsApp Business MCP settings card. */

/** English copy, the fallback dictionary. */
export const en = {
  title: 'WhatsApp Business MCP',
  description: 'Connect your WhatsApp Business account to manage messages and templates.',
  authorize: 'Authorize',
  refreshToken: 'Refresh token',
  testConnection: 'Test connection',
  clearCredentials: 'Clear credentials',
  finishAuthorization: 'Finish authorization',
  codePlaceholder: 'If authorization does not complete automatically, paste the callback URL or code',
  loading: 'Loading…',
  notAuthorized: 'Not authorized — click Authorize and complete sign-in on Meta to enable the MCP tools.',
  authorized: 'Authorized · token updated {at} · MCP {state} · {count} tools',
  connected: 'connected',
  disconnected: 'disconnected',
  opened: 'Opened the Meta authorization page in a new tab.',
  confirmClear: 'Clear all WhatsApp Business MCP credentials? The MCP tools will be unregistered and authorization will be required again.',
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
export type WhatsAppMcpLocaleKey = keyof typeof en
