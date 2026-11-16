/** Japanese copy for the WhatsApp Business MCP settings card. */

import type { WhatsAppMcpLocaleKey } from './en.ts'

/** Japanese dictionary. */
export const ja: Record<WhatsAppMcpLocaleKey, string> = {
  title: 'WhatsApp Business MCP',
  description: 'WhatsApp Business アカウントを接続して、メッセージとテンプレートを管理します。',
  authorize: '認証',
  refreshToken: 'トークンを更新',
  testConnection: '接続をテスト',
  clearCredentials: '認証情報を削除',
  finishAuthorization: '認証を完了',
  codePlaceholder: '認証が自動で完了しない場合は、コールバック URL またはコードを貼り付けてください',
  loading: '読み込み中…',
  notAuthorized: '未認証 — 「認証」をクリックして Meta でのサインインを完了すると、MCP ツールが有効になります。',
  authorized: '認証済み · トークン更新 {at} · MCP {state} · ツール {count} 件',
  connected: '接続済み',
  disconnected: '未接続',
  opened: 'Meta の認証ページを新しいタブで開きました。',
  confirmClear: 'WhatsApp Business MCP の認証情報をすべて削除しますか？MCP ツールは登録解除され、再度認証が必要になります。',
  cancelled: 'キャンセルしました。',
  toolsDiscovered: '検出した MCP ツール（{count}）：{tools}',
  statusFailed: 'ステータスを読み取れませんでした：{error}',
  actionFailed: '操作に失敗しました：{error}',
  connectionSuccessful: '接続に成功しました。',
  authorizationFailed: '認証に失敗しました。',
  tokenExpired: 'トークンの有効期限が切れました。',
  connecting: '接続中…',
  ok: '[ok] ',
  failed: '[失敗] ',
}
