/** Russian copy for the SendPulse MCP settings card. */

import type { SendPulseMcpLocaleKey } from './en.ts'

/** Russian dictionary. */
export const ru: Record<SendPulseMcpLocaleKey, string> = {
  title: 'SendPulse MCP',
  description: 'Подключите аккаунт SendPulse для управления email-кампаниями, чат-ботами и CRM.',
  authorize: 'Авторизовать',
  refreshToken: 'Обновить токен',
  testConnection: 'Проверить подключение',
  clearCredentials: 'Удалить учётные данные',
  finishAuthorization: 'Завершить авторизацию',
  codePlaceholder: 'Если авторизация не завершилась автоматически, вставьте URL возврата или код',
  loading: 'Загрузка…',
  notAuthorized: 'Не авторизовано — нажмите «Авторизовать» и войдите на странице SendPulse, чтобы включить инструменты MCP.',
  authorized: 'Авторизовано · токен обновлён {at} · MCP {state} · инструментов: {count}',
  connected: 'подключено',
  disconnected: 'отключено',
  opened: 'Страница авторизации SendPulse открыта в новой вкладке.',
  confirmClear: 'Удалить все учётные данные SendPulse MCP? Инструменты MCP будут отключены, и потребуется повторная авторизация.',
  cancelled: 'Отменено.',
  toolsDiscovered: 'Найденные инструменты MCP ({count}): {tools}',
  statusFailed: 'Не удалось прочитать состояние: {error}',
  actionFailed: 'Действие не выполнено: {error}',
  connectionSuccessful: 'Подключение успешно.',
  ok: '[ok] ',
  failed: '[ошибка] ',
}
