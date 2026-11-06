/** German copy for the Zernio MCP settings card. */

import type { ZernioMcpLocaleKey } from './en.ts'

/** German dictionary. */
export const de: Record<ZernioMcpLocaleKey, string> = {
  title: 'Zernio MCP',
  description: 'Verbinde dein Zernio-Konto, um Beiträge, Anzeigen und den Posteingang zu verwalten.',
  authorize: 'Autorisieren',
  refreshToken: 'Token erneuern',
  testConnection: 'Verbindung testen',
  clearCredentials: 'Anmeldedaten löschen',
  finishAuthorization: 'Autorisierung abschließen',
  codePlaceholder: 'Wenn die Autorisierung nicht automatisch abgeschlossen wird, füge die Rückgabe-URL oder den Code ein',
  loading: 'Wird geladen…',
  notAuthorized: 'Nicht autorisiert — klicke auf Autorisieren und melde dich auf der Zernio-Seite an, um die MCP-Werkzeuge zu aktivieren.',
  authorized: 'Autorisiert · Token aktualisiert {at} · MCP {state} · {count} Werkzeuge',
  connected: 'verbunden',
  disconnected: 'getrennt',
  opened: 'Die Zernio-Autorisierungsseite wurde in einem neuen Tab geöffnet.',
  confirmClear: 'Alle Zernio-MCP-Anmeldedaten löschen? Die MCP-Werkzeuge werden abgemeldet und eine erneute Autorisierung ist erforderlich.',
  cancelled: 'Abgebrochen.',
  toolsDiscovered: 'Gefundene MCP-Werkzeuge ({count}): {tools}',
  statusFailed: 'Status konnte nicht gelesen werden: {error}',
  actionFailed: 'Aktion fehlgeschlagen: {error}',
  connectionSuccessful: 'Verbindung erfolgreich.',
  ok: '[ok] ',
  failed: '[fehlgeschlagen] ',
}
