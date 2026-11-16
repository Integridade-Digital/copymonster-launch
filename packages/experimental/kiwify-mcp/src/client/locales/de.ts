/** German copy for the Kiwify MCP settings card. */

import type { KiwifyMcpLocaleKey } from './en.ts'

/** German dictionary. */
export const de: Record<KiwifyMcpLocaleKey, string> = {
  title: 'Kiwify MCP',
  description: 'Verbinde dein Kiwify-Konto, um Produkte, Verkäufe und Partner zu verwalten.',
  authorize: 'Autorisieren',
  refreshToken: 'Token erneuern',
  testConnection: 'Verbindung testen',
  clearCredentials: 'Zugangsdaten löschen',
  finishAuthorization: 'Autorisierung abschließen',
  codePlaceholder: 'Wenn die Autorisierung nicht automatisch abgeschlossen wird, füge die Rücksprung-URL oder den Code ein',
  loading: 'Wird geladen…',
  notAuthorized: 'Nicht autorisiert — klicke auf Autorisieren und schließe die Anmeldung bei Kiwify ab, um die MCP-Werkzeuge zu aktivieren.',
  authorized: 'Autorisiert · Token aktualisiert am {at} · MCP {state} · {count} Werkzeuge',
  connected: 'verbunden',
  disconnected: 'getrennt',
  opened: 'Kiwify-Autorisierungsseite in einem neuen Tab geöffnet.',
  confirmClear: 'Alle Zugangsdaten von Kiwify MCP löschen? Die MCP-Werkzeuge werden abgemeldet und eine erneute Autorisierung ist erforderlich.',
  cancelled: 'Abgebrochen.',
  toolsDiscovered: 'Gefundene MCP-Werkzeuge ({count}): {tools}',
  statusFailed: 'Status konnte nicht gelesen werden: {error}',
  actionFailed: 'Aktion fehlgeschlagen: {error}',
  connectionSuccessful: 'Verbindung erfolgreich.',
  authorizationFailed: 'Autorisierung fehlgeschlagen.',
  tokenExpired: 'Token abgelaufen.',
  connecting: 'Verbindung wird hergestellt…',
  ok: '[ok] ',
  failed: '[fehlgeschlagen] ',
}
