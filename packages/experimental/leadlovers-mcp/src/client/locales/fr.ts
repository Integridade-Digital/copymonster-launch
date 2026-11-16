/** French copy for the LeadLovers MCP settings card. */

import type { LeadLoversMcpLocaleKey } from './en.ts'

/** French dictionary. */
export const fr: Record<LeadLoversMcpLocaleKey, string> = {
  title: 'LeadLovers MCP',
  description: 'Connectez votre compte LeadLovers pour gérer les contacts, les projets et les campagnes.',
  authorize: 'Autoriser',
  refreshToken: 'Renouveler le jeton',
  testConnection: 'Tester la connexion',
  clearCredentials: 'Effacer les identifiants',
  finishAuthorization: 'Terminer l’autorisation',
  codePlaceholder: 'Si l’autorisation ne se termine pas automatiquement, collez l’URL de retour ou le code',
  loading: 'Chargement…',
  notAuthorized: 'Non autorisé — cliquez sur Autoriser et connectez-vous sur la page LeadLovers pour activer les outils MCP.',
  authorized: 'Autorisé · jeton mis à jour {at} · MCP {state} · {count} outils',
  connected: 'connecté',
  disconnected: 'déconnecté',
  opened: 'La page d’autorisation LeadLovers s’est ouverte dans un nouvel onglet.',
  confirmClear: 'Effacer tous les identifiants LeadLovers MCP ? Les outils MCP seront désenregistrés et une nouvelle autorisation sera nécessaire.',
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
