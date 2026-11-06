/** French copy for the Zernio MCP settings card. */

import type { ZernioMcpLocaleKey } from './en.ts'

/** French dictionary. */
export const fr: Record<ZernioMcpLocaleKey, string> = {
  title: 'Zernio MCP',
  description: 'Connectez votre compte Zernio pour gérer les publications, les publicités et la boîte de réception.',
  authorize: 'Autoriser',
  refreshToken: 'Renouveler le jeton',
  testConnection: 'Tester la connexion',
  clearCredentials: 'Effacer les identifiants',
  finishAuthorization: 'Terminer l’autorisation',
  codePlaceholder: 'Si l’autorisation ne se termine pas automatiquement, collez l’URL de retour ou le code',
  loading: 'Chargement…',
  notAuthorized: 'Non autorisé — cliquez sur Autoriser et connectez-vous sur la page Zernio pour activer les outils MCP.',
  authorized: 'Autorisé · jeton mis à jour {at} · MCP {state} · {count} outils',
  connected: 'connecté',
  disconnected: 'déconnecté',
  opened: 'La page d’autorisation Zernio s’est ouverte dans un nouvel onglet.',
  confirmClear: 'Effacer tous les identifiants Zernio MCP ? Les outils MCP seront désenregistrés et une nouvelle autorisation sera nécessaire.',
  cancelled: 'Annulé.',
  toolsDiscovered: 'Outils MCP découverts ({count}) : {tools}',
  statusFailed: 'Impossible de lire l’état : {error}',
  actionFailed: 'L’action a échoué : {error}',
  connectionSuccessful: 'Connexion réussie.',
  ok: '[ok] ',
  failed: '[échec] ',
}
