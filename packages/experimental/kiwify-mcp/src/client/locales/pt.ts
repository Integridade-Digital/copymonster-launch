/** Portuguese copy for the Kiwify MCP settings card. */

import type { KiwifyMcpLocaleKey } from './en.ts'

/** Brazilian Portuguese dictionary. */
export const pt: Record<KiwifyMcpLocaleKey, string> = {
  title: 'Kiwify MCP',
  description: 'Conecte a sua conta Kiwify para gerir produtos, vendas e afiliados.',
  authorize: 'Autorizar',
  refreshToken: 'Renovar token',
  testConnection: 'Testar conexão',
  clearCredentials: 'Limpar credenciais',
  finishAuthorization: 'Concluir autorização',
  codePlaceholder: 'Se a autorização não concluir automaticamente, cole a URL de retorno ou o código',
  loading: 'Carregando…',
  notAuthorized: 'Não autorizado — clique em Autorizar e conclua o login na Kiwify para habilitar as ferramentas MCP.',
  authorized: 'Autorizado · token atualizado em {at} · MCP {state} · {count} ferramentas',
  connected: 'conectado',
  disconnected: 'desconectado',
  opened: 'Página de autorização da Kiwify aberta em uma nova aba.',
  confirmClear: 'Limpar todas as credenciais do Kiwify MCP? As ferramentas MCP serão removidas e será necessário autorizar novamente.',
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
