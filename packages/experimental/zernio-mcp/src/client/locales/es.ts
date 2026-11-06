/** Spanish copy for the Zernio MCP settings card. */

import type { ZernioMcpLocaleKey } from './en.ts'

/** Spanish dictionary. */
export const es: Record<ZernioMcpLocaleKey, string> = {
  title: 'Zernio MCP',
  description: 'Conecta tu cuenta de Zernio para gestionar publicaciones, anuncios y bandeja de entrada.',
  authorize: 'Autorizar',
  refreshToken: 'Renovar token',
  testConnection: 'Probar conexión',
  clearCredentials: 'Borrar credenciales',
  finishAuthorization: 'Finalizar autorización',
  codePlaceholder: 'Si la autorización no se completa automáticamente, pega la URL de retorno o el código',
  loading: 'Cargando…',
  notAuthorized: 'No autorizado — haz clic en Autorizar y completa el inicio de sesión en la página de Zernio para habilitar las herramientas MCP.',
  authorized: 'Autorizado · token actualizado {at} · MCP {state} · {count} herramientas',
  connected: 'conectado',
  disconnected: 'desconectado',
  opened: 'Se abrió la página de autorización de Zernio en una pestaña nueva.',
  confirmClear: '¿Borrar todas las credenciales de Zernio MCP? Las herramientas MCP se desregistrarán y será necesario autorizar de nuevo.',
  cancelled: 'Cancelado.',
  toolsDiscovered: 'Herramientas MCP descubiertas ({count}): {tools}',
  statusFailed: 'No se pudo leer el estado: {error}',
  actionFailed: 'La acción falló: {error}',
  connectionSuccessful: 'Conexión correcta.',
  ok: '[ok] ',
  failed: '[falló] ',
}
