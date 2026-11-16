/** French copy for the SendPulse MCP settings card. */

import type { SendPulseMcpLocaleKey } from './en.ts'

/** French dictionary. */
export const fr: Record<SendPulseMcpLocaleKey, string> = {
  title: 'SendPulse MCP',
  description: 'Connectez votre compte SendPulse pour gérer l’email marketing, le CRM et les chatbots.',
  authorize: 'Autoriser',
  refreshToken: 'Renouveler le jeton',
  testConnection: 'Tester la connexion',
  clearCredentials: 'Effacer les identifiants',
  finishAuthorization: 'Terminer l’autorisation',
  codePlaceholder: 'Si l’autorisation ne se termine pas automatiquement, collez l’URL de retour ou le code',
  loading: 'Chargement…',
  notAuthorized: 'Non autorisé — cliquez sur Autoriser et connectez-vous sur la page SendPulse pour activer les outils MCP.',
  authorized: 'Autorisé · jeton mis à jour {at} · MCP {state} · {count} outils',
  connected: 'connecté',
  disconnected: 'déconnecté',
  opened: 'La page d’autorisation SendPulse s’est ouverte dans un nouvel onglet.',
  confirmClear: 'Effacer tous les identifiants SendPulse MCP ? Les outils MCP seront désenregistrés et une nouvelle autorisation sera nécessaire.',
  cancelled: 'Annulé.',
  toolsDiscovered: 'Outils MCP découverts ({count}) : {tools}',
  statusFailed: 'Impossible de lire l’état : {error}',
  actionFailed: 'L’action a échoué : {error}',
  connectionSuccessful: 'Connexion réussie.',
  authorizationFailed: 'L’autorisation a échoué.',
  tokenExpired: 'Jeton expiré.',
  connecting: 'Connexion…',
  ok: '[ok] ',
  failed: '[échec] ',
}
