/** Portuguese copy for the Zernio MCP settings card. */

import type { ZernioMcpLocaleKey } from './en.ts'

/** Brazilian Portuguese dictionary. */
export const pt: Record<ZernioMcpLocaleKey, string> = {
  title: 'Zernio MCP',
  description: 'Conecte sua conta Zernio para gerenciar posts, anúncios e caixa de entrada.',
  authorize: 'Autorizar',
  refreshToken: 'Renovar token',
  testConnection: 'Testar conexão',
  clearCredentials: 'Limpar credenciais',
  finishAuthorization: 'Concluir autorização',
  codePlaceholder: 'Se a autorização não concluir automaticamente, cole a URL de retorno ou o código',
  loading: 'Carregando…',
  notAuthorized: 'Não autorizado — clique em Autorizar e conclua o login na página da Zernio para habilitar as ferramentas MCP.',
  authorized: 'Autorizado · token atualizado em {at} · MCP {state} · {count} ferramentas',
  connected: 'conectado',
  disconnected: 'desconectado',
  opened: 'Página de autorização da Zernio aberta em uma nova aba.',
  confirmClear: 'Limpar todas as credenciais do Zernio MCP? As ferramentas MCP serão removidas e será necessário autorizar novamente.',
  cancelled: 'Cancelado.',
  toolsDiscovered: 'Ferramentas MCP descobertas ({count}): {tools}',
  statusFailed: 'Não foi possível ler o status: {error}',
  actionFailed: 'A ação falhou: {error}',
  connectionSuccessful: 'Conexão bem-sucedida.',
  ok: '[ok] ',
  failed: '[falhou] ',
}
