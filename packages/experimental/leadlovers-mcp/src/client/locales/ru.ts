/** Russian copy for the LeadLovers MCP settings card. */

import type { LeadLoversMcpLocaleKey } from './en.ts'

/** Russian dictionary. */
export const ru: Record<LeadLoversMcpLocaleKey, string> = {
  title: 'LeadLovers MCP',
  description: 'Подключите аккаунт LeadLovers для управления контактами, проектами и кампаниями.',
  authorize: 'Авторизовать',
  refreshToken: 'Обновить токен',
  testConnection: 'Проверить подключение',
  clearCredentials: 'Удалить учётные данные',
  finishAuthorization: 'Завершить авторизацию',
  codePlaceholder: 'Если авторизация не завершилась автоматически, вставьте URL возврата или код',
  loading: 'Загрузка…',
  notAuthorized: 'Не авторизовано — нажмите «Авторизовать» и войдите на странице LeadLovers, чтобы включить инструменты MCP.',
  authorized: 'Авторизовано · токен обновлён {at} · MCP {state} · инструментов: {count}',
  connected: 'подключено',
  disconnected: 'отключено',
  opened: 'Страница авторизации LeadLovers открыта в новой вкладке.',
  confirmClear: 'Удалить все учётные данные LeadLovers MCP? Инструменты MCP будут отключены, и потребуется повторная авторизация.',
  cancelled: 'Отменено.',
  toolsDiscovered: 'Найденные инструменты MCP ({count}): {tools}',
  statusFailed: 'Не удалось прочитать состояние: {error}',
  actionFailed: 'Действие не выполнено: {error}',
  connectionSuccessful: 'Подключение успешно.',
  authorizationFailed: 'Не удалось выполнить авторизацию.',
  tokenExpired: 'Срок действия токена истёк.',
  connecting: 'Подключение…',
  ok: '[ok] ',
  failed: '[ошибка] ',
}
