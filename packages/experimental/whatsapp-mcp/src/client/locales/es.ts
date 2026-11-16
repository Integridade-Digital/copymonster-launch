/** Spanish copy for the WhatsApp Business MCP settings card. */

import type { WhatsAppMcpLocaleKey } from './en.ts'

/** Spanish dictionary. */
export const es: Record<WhatsAppMcpLocaleKey, string> = {
  title: 'WhatsApp Business MCP',
  description: 'Conecta tu cuenta de WhatsApp Business para gestionar mensajes y plantillas.',
  authorize: 'Autorizar',
  refreshToken: 'Renovar token',
  testConnection: 'Probar conexión',
  clearCredentials: 'Borrar credenciales',
  finishAuthorization: 'Finalizar autorización',
  codePlaceholder: 'Si la autorización no se completa automáticamente, pega la URL de retorno o el código',
  loading: 'Cargando…',
  notAuthorized: 'No autorizado — pulsa Autorizar y completa el inicio de sesión en Meta para habilitar las herramientas MCP.',
  authorized: 'Autorizado · token actualizado el {at} · MCP {state} · {count} herramientas',
  connected: 'conectado',
  disconnected: 'desconectado',
  opened: 'Se abrió la página de autorización de Meta en una pestaña nueva.',
  confirmClear: '¿Borrar todas las credenciales de WhatsApp Business MCP? Las herramientas MCP se eliminarán y habrá que autorizar de nuevo.',
  cancelled: 'Cancelado.',
  toolsDiscovered: 'Herramientas MCP descubiertas ({count}): {tools}',
  statusFailed: 'No se pudo leer el estado: {error}',
  actionFailed: 'La acción falló: {error}',
  connectionSuccessful: 'Conexión correcta.',
  authorizationFailed: 'La autorización falló.',
  tokenExpired: 'Token caducado.',
  connecting: 'Conectando…',
  ok: '[ok] ',
  failed: '[falló] ',
}
