/** French copy for the WhatsApp Business MCP settings card. */

import type { WhatsAppMcpLocaleKey } from './en.ts'

/** French dictionary. */
export const fr: Record<WhatsAppMcpLocaleKey, string> = {
  title: 'WhatsApp Business MCP',
  description: 'Connectez votre compte WhatsApp Business pour gérer les messages et les modèles.',
  authorize: 'Autoriser',
  refreshToken: 'Renouveler le jeton',
  testConnection: 'Tester la connexion',
  clearCredentials: 'Effacer les identifiants',
  finishAuthorization: 'Terminer l’autorisation',
  codePlaceholder: 'Si l’autorisation ne se termine pas automatiquement, collez l’URL de retour ou le code',
  loading: 'Chargement…',
  notAuthorized: 'Non autorisé — cliquez sur Autoriser et terminez la connexion à Meta pour activer les outils MCP.',
  authorized: 'Autorisé · jeton mis à jour le {at} · MCP {state} · {count} outils',
  connected: 'connecté',
  disconnected: 'déconnecté',
  opened: 'Page d’autorisation Meta ouverte dans un nouvel onglet.',
  confirmClear: 'Effacer tous les identifiants WhatsApp Business MCP ? Les outils MCP seront désenregistrés et une nouvelle autorisation sera nécessaire.',
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
