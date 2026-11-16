/** German copy for the WhatsApp Business MCP settings card. */

import type { WhatsAppMcpLocaleKey } from './en.ts'

/** German dictionary. */
export const de: Record<WhatsAppMcpLocaleKey, string> = {
  title: 'WhatsApp Business MCP',
  description: 'Verbinde dein WhatsApp-Business-Konto, um Nachrichten und Vorlagen zu verwalten.',
  authorize: 'Autorisieren',
  refreshToken: 'Token erneuern',
  testConnection: 'Verbindung testen',
  clearCredentials: 'Zugangsdaten löschen',
  finishAuthorization: 'Autorisierung abschließen',
  codePlaceholder: 'Wenn die Autorisierung nicht automatisch abgeschlossen wird, füge die Rücksprung-URL oder den Code ein',
  loading: 'Wird geladen…',
  notAuthorized: 'Nicht autorisiert — klicke auf Autorisieren und schließe die Anmeldung bei Meta ab, um die MCP-Werkzeuge zu aktivieren.',
  authorized: 'Autorisiert · Token aktualisiert am {at} · MCP {state} · {count} Werkzeuge',
  connected: 'verbunden',
  disconnected: 'getrennt',
  opened: 'Meta-Autorisierungsseite in einem neuen Tab geöffnet.',
  confirmClear: 'Alle Zugangsdaten von WhatsApp Business MCP löschen? Die MCP-Werkzeuge werden abgemeldet und eine erneute Autorisierung ist erforderlich.',
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
