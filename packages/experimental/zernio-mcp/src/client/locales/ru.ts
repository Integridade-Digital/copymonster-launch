/** Russian copy for the Zernio MCP settings card. */

import type { ZernioMcpLocaleKey } from './en.ts'

/** Russian dictionary. */
export const ru: Record<ZernioMcpLocaleKey, string> = {
  title: 'Zernio MCP',
  description: 'Подключите аккаунт Zernio для управления публикациями, рекламой и входящими сообщениями.',
  authorize: 'Авторизовать',
  refreshToken: 'Обновить токен',
  testConnection: 'Проверить подключение',
  clearCredentials: 'Удалить учётные данные',
  finishAuthorization: 'Завершить авторизацию',
  codePlaceholder: 'Если авторизация не завершилась автоматически, вставьте URL возврата или код',
  loading: 'Загрузка…',
  notAuthorized: 'Не авторизовано — нажмите «Авторизовать» и войдите на странице Zernio, чтобы включить инструменты MCP.',
  authorized: 'Авторизовано · токен обновлён {at} · MCP {state} · инструментов: {count}',
  connected: 'подключено',
  disconnected: 'отключено',
  opened: 'Страница авторизации Zernio открыта в новой вкладке.',
  confirmClear: 'Удалить все учётные данные Zernio MCP? Инструменты MCP будут отключены, и потребуется повторная авторизация.',
  cancelled: 'Отменено.',
  toolsDiscovered: 'Найденные инструменты MCP ({count}): {tools}',
  statusFailed: 'Не удалось прочитать состояние: {error}',
  actionFailed: 'Действие не выполнено: {error}',
  connectionSuccessful: 'Подключение успешно.',
  ok: '[ok] ',
  failed: '[ошибка] ',
}
