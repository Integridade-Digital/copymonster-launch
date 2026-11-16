/** Portuguese copy for the WhatsApp Business MCP settings card. */

import type { WhatsAppMcpLocaleKey } from './en.ts'

/** Brazilian Portuguese dictionary. */
export const pt: Record<WhatsAppMcpLocaleKey, string> = {
  title: 'WhatsApp Business MCP',
  description: 'Conecte a sua conta WhatsApp Business para gerir mensagens e templates.',
  authorize: 'Autorizar',
  refreshToken: 'Renovar token',
  testConnection: 'Testar conexão',
  clearCredentials: 'Limpar credenciais',
  finishAuthorization: 'Concluir autorização',
  codePlaceholder: 'Se a autorização não concluir automaticamente, cole a URL de retorno ou o código',
  loading: 'Carregando…',
  notAuthorized: 'Não autorizado — clique em Autorizar e conclua o login na Meta para habilitar as ferramentas MCP.',
  authorized: 'Autorizado · token atualizado em {at} · MCP {state} · {count} ferramentas',
  connected: 'conectado',
  disconnected: 'desconectado',
  opened: 'Página de autorização da Meta aberta em uma nova aba.',
  confirmClear: 'Limpar todas as credenciais do WhatsApp Business MCP? As ferramentas MCP serão removidas e será necessário autorizar novamente.',
  cancelled: 'Cancelado.',
  toolsDiscovered: 'Ferramentas MCP descobertas ({count}): {tools}',
  statusFailed: 'Não foi possível ler o status: {error}',
  actionFailed: 'A ação falhou: {error}',
  connectionSuccessful: 'Conexão bem-sucedida.',
  authorizationFailed: 'Falha na autorização.',
  tokenExpired: 'Token expirado.',
  connecting: 'Conectando…',
  ok: '[ok] ',
  failed: '[falhou] ',
}
