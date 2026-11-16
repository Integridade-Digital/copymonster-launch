/** German copy for the LeadLovers MCP settings card. */

import type { LeadLoversMcpLocaleKey } from './en.ts'

/** German dictionary. */
export const de: Record<LeadLoversMcpLocaleKey, string> = {
  title: 'LeadLovers MCP',
  description: 'Verbinde dein LeadLovers-Konto, um Kontakte, Projekte und Kampagnen zu verwalten.',
  authorize: 'Autorisieren',
  refreshToken: 'Token erneuern',
  testConnection: 'Verbindung testen',
  clearCredentials: 'Anmeldedaten löschen',
  finishAuthorization: 'Autorisierung abschließen',
  codePlaceholder: 'Wenn die Autorisierung nicht automatisch abgeschlossen wird, füge die Rückgabe-URL oder den Code ein',
  loading: 'Wird geladen…',
  notAuthorized: 'Nicht autorisiert — klicke auf Autorisieren und melde dich auf der LeadLovers-Seite an, um die MCP-Werkzeuge zu aktivieren.',
  authorized: 'Autorisiert · Token aktualisiert {at} · MCP {state} · {count} Werkzeuge',
  connected: 'verbunden',
  disconnected: 'getrennt',
  opened: 'Die LeadLovers-Autorisierungsseite wurde in einem neuen Tab geöffnet.',
  confirmClear: 'Alle LeadLovers-MCP-Anmeldedaten löschen? Die MCP-Werkzeuge werden abgemeldet und eine erneute Autorisierung ist erforderlich.',
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
