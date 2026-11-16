/** French copy for the Kiwify MCP settings card. */

import type { KiwifyMcpLocaleKey } from './en.ts'

/** French dictionary. */
export const fr: Record<KiwifyMcpLocaleKey, string> = {
  title: 'Kiwify MCP',
  description: 'Connectez votre compte Kiwify pour gérer les produits, les ventes et les affiliés.',
  authorize: 'Autoriser',
  refreshToken: 'Renouveler le jeton',
  testConnection: 'Tester la connexion',
  clearCredentials: 'Effacer les identifiants',
  finishAuthorization: 'Terminer l’autorisation',
  codePlaceholder: 'Si l’autorisation ne se termine pas automatiquement, collez l’URL de retour ou le code',
  loading: 'Chargement…',
  notAuthorized: 'Non autorisé — cliquez sur Autoriser et terminez la connexion à Kiwify pour activer les outils MCP.',
  authorized: 'Autorisé · jeton mis à jour le {at} · MCP {state} · {count} outils',
  connected: 'connecté',
  disconnected: 'déconnecté',
  opened: 'Page d’autorisation Kiwify ouverte dans un nouvel onglet.',
  confirmClear: 'Effacer tous les identifiants Kiwify MCP ? Les outils MCP seront désenregistrés et une nouvelle autorisation sera nécessaire.',
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
