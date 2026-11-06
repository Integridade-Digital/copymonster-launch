/** Japanese copy for the Zernio MCP settings card. */

import type { ZernioMcpLocaleKey } from './en.ts'

/** Japanese dictionary. */
export const ja: Record<ZernioMcpLocaleKey, string> = {
  title: 'Zernio MCP',
  description: 'Zernio アカウントを接続して、投稿・広告・受信トレイを管理します。',
  authorize: '認証',
  refreshToken: 'トークンを更新',
  testConnection: '接続をテスト',
  clearCredentials: '認証情報を消去',
  finishAuthorization: '認証を完了',
  codePlaceholder: '認証が自動で完了しない場合は、コールバック URL またはコードを貼り付けてください',
  loading: '読み込み中…',
  notAuthorized: '未認証 — 「認証」をクリックし、Zernio のページでサインインすると MCP ツールを利用できます。',
  authorized: '認証済み · トークン更新 {at} · MCP {state} · {count} 個のツール',
  connected: '接続済み',
  disconnected: '未接続',
  opened: 'Zernio の認証ページを新しいタブで開きました。',
  confirmClear: 'Zernio MCP の認証情報をすべて消去しますか？MCP ツールは登録解除され、再度認証が必要になります。',
  cancelled: 'キャンセルしました。',
  toolsDiscovered: '検出された MCP ツール（{count}）: {tools}',
  statusFailed: 'ステータスを読み取れませんでした: {error}',
  actionFailed: '操作に失敗しました: {error}',
  connectionSuccessful: '接続に成功しました。',
  ok: '[ok] ',
  failed: '[失敗] ',
}
