/** German copy for the SendPulse MCP settings card. */

import type { SendPulseMcpLocaleKey } from './en.ts'

/** German dictionary. */
export const de: Record<SendPulseMcpLocaleKey, string> = {
  title: 'SendPulse MCP',
  description: 'Verbinde dein SendPulse-Konto, um E-Mail-Marketing, CRM und Chatbots zu verwalten.',
  authorize: 'Autorisieren',
  refreshToken: 'Token erneuern',
  testConnection: 'Verbindung testen',
  clearCredentials: 'Anmeldedaten löschen',
  finishAuthorization: 'Autorisierung abschließen',
  codePlaceholder: 'Wenn die Autorisierung nicht automatisch abgeschlossen wird, füge die Rückgabe-URL oder den Code ein',
  loading: 'Wird geladen…',
  notAuthorized: 'Nicht autorisiert — klicke auf Autorisieren und melde dich auf der SendPulse-Seite an, um die MCP-Werkzeuge zu aktivieren.',
  authorized: 'Autorisiert · Token aktualisiert {at} · MCP {state} · {count} Werkzeuge',
  connected: 'verbunden',
  disconnected: 'getrennt',
  opened: 'Die SendPulse-Autorisierungsseite wurde in einem neuen Tab geöffnet.',
  confirmClear: 'Alle SendPulse-MCP-Anmeldedaten löschen? Die MCP-Werkzeuge werden abgemeldet und eine erneute Autorisierung ist erforderlich.',
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
