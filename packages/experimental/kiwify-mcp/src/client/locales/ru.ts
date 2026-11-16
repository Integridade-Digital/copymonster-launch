/** Russian copy for the Kiwify MCP settings card. */

import type { KiwifyMcpLocaleKey } from './en.ts'

/** Russian dictionary. */
export const ru: Record<KiwifyMcpLocaleKey, string> = {
  title: 'Kiwify MCP',
  description: 'Подключите аккаунт Kiwify для управления товарами, продажами и партнёрами.',
  authorize: 'Авторизовать',
  refreshToken: 'Обновить токен',
  testConnection: 'Проверить подключение',
  clearCredentials: 'Удалить учётные данные',
  finishAuthorization: 'Завершить авторизацию',
  codePlaceholder: 'Если авторизация не завершилась автоматически, вставьте URL возврата или код',
  loading: 'Загрузка…',
  notAuthorized: 'Не авторизовано — нажмите «Авторизовать» и завершите вход в Kiwify, чтобы включить инструменты MCP.',
  authorized: 'Авторизовано · токен обновлён {at} · MCP {state} · инструментов: {count}',
  connected: 'подключено',
  disconnected: 'не подключено',
  opened: 'Страница авторизации Kiwify открыта в новой вкладке.',
  confirmClear: 'Удалить все учётные данные Kiwify MCP? Инструменты MCP будут отключены, потребуется повторная авторизация.',
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
