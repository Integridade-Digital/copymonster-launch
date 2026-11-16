/** Locale keys for the SendPulse MCP settings card. */

/** English copy, the fallback dictionary. */
export const en = {
  title: 'SendPulse MCP',
  description: 'Connect your SendPulse account to manage email campaigns, chatbots and CRM.',
  authorize: 'Authorize',
  refreshToken: 'Refresh token',
  testConnection: 'Test connection',
  clearCredentials: 'Clear credentials',
  finishAuthorization: 'Finish authorization',
  codePlaceholder: 'If authorization does not complete automatically, paste the callback URL or code',
  loading: 'Loading…',
  notAuthorized: 'Not authorized — click Authorize and complete sign-in on the SendPulse page to enable the MCP tools.',
  authorized: 'Authorized · token updated {at} · MCP {state} · {count} tools',
  connected: 'connected',
  disconnected: 'disconnected',
  opened: 'Opened the SendPulse authorization page in a new tab.',
  confirmClear: 'Clear all SendPulse MCP credentials? The MCP tools will be unregistered and authorization will be required again.',
  cancelled: 'Cancelled.',
  toolsDiscovered: 'Discovered MCP tools ({count}): {tools}',
  statusFailed: 'Could not read status: {error}',
  actionFailed: 'Action failed: {error}',
  connectionSuccessful: 'Connection successful.',
  ok: '[ok] ',
  failed: '[failed] ',
} as const

/** Key union the card renders. */
export type SendPulseMcpLocaleKey = keyof typeof en
