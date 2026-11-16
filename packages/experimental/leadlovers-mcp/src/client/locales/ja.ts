/** Japanese copy for the LeadLovers MCP settings card. */

import type { LeadLoversMcpLocaleKey } from './en.ts'

/** Japanese dictionary. */
export const ja: Record<LeadLoversMcpLocaleKey, string> = {
  title: 'LeadLovers MCP',
  description: 'LeadLovers アカウントを接続して、連絡先・プロジェクト・キャンペーンを管理します。',
  authorize: '認証',
  refreshToken: 'トークンを更新',
  testConnection: '接続をテスト',
  clearCredentials: '認証情報を消去',
  finishAuthorization: '認証を完了',
  codePlaceholder: '認証が自動で完了しない場合は、コールバック URL またはコードを貼り付けてください',
  loading: '読み込み中…',
  notAuthorized: '未認証 — 「認証」をクリックし、LeadLovers のページでサインインすると MCP ツールを利用できます。',
  authorized: '認証済み · トークン更新 {at} · MCP {state} · {count} 個のツール',
  connected: '接続済み',
  disconnected: '未接続',
  opened: 'LeadLovers の認証ページを新しいタブで開きました。',
  confirmClear: 'LeadLovers MCP の認証情報をすべて消去しますか？MCP ツールは登録解除され、再度認証が必要になります。',
  cancelled: 'キャンセルしました。',
  toolsDiscovered: '検出された MCP ツール（{count}）: {tools}',
  statusFailed: 'ステータスを読み取れませんでした: {error}',
  actionFailed: '操作に失敗しました: {error}',
  connectionSuccessful: '接続に成功しました。',
  authorizationFailed: '認証に失敗しました。',
  tokenExpired: 'トークンの有効期限が切れました。',
  connecting: '接続中…',
  ok: '[ok] ',
  failed: '[失敗] ',
}
