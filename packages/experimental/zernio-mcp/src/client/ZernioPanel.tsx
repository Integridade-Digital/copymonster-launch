/**
 * Zernio MCP settings card — rendered inside the Web settings page
 * (`settings.section` entry). Drives the OAuth authorize flow (popup + manual
 * code paste), shows the registered MCP tool count, and offers one-click
 * test / refresh / clear. The inline styles mirror the Vercel MCP card so both
 * panels share one visual recipe.
 */

import { useCallback, useEffect, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ZernioMcpApi, type ZernioStatusView } from './api.ts'

/** Module-level API client (stateless; the component closes over it). */
const api = new ZernioMcpApi()

/** One shared style sheet, identical to the Vercel MCP card. */
const s = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '620px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1px solid var(--cm-border)',
    fontSize: '13px',
    color: 'inherit',
  },
  title: {
    fontWeight: 600,
    fontSize: '13px',
    margin: 0,
  },
  row: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid var(--cm-input)',
    background: 'var(--cm-muted)',
    color: 'inherit',
    fontSize: '12px',
  },
  flex: { flex: 1 },
  button: {
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid var(--cm-primary)',
    background: 'var(--cm-primary)',
    color: 'var(--cm-primary-foreground)',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  },
  msg: {
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    opacity: 0.9,
  },
  hint: {
    fontSize: '11px',
    opacity: 0.75,
    lineHeight: 1.6,
  },
} as const

/** Props the renderer binds for the Zernio MCP section. */
export type ZernioMcpSettingsPanelProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<'settings.zernioMcp'>

/**
 * The Zernio MCP settings card.
 * @param props - section runtime props and localized copy.
 * @returns the card element tree.
 */
export function ZernioMcpSettingsPanel({ t }: ZernioMcpSettingsPanelProps) {
  const [view, setView] = useState<ZernioStatusView | null>(null)
  const [code, setCode] = useState('')
  const [tools, setTools] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refreshStatus = useCallback(async () => {
    try {
      setView(await api.status())
    } catch (error) {
      setMsg(t('statusFailed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }, [t])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    const onFocus = (): void => { void refreshStatus() }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [refreshStatus])

  /** Run one async card action with busy/message bookkeeping. */
  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      setMsg(await action())
    } catch (error) {
      setMsg(t('actionFailed', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const authorize = (): void => {
    void run(async () => {
      const result = await api.oauthStart()
      if (!result.ok || result.authorizeUrl === undefined) {
        return t('failed') + (result.error ?? '')
      }
      window.open(result.authorizeUrl, '_blank', 'noopener')
      return t('opened')
    })
  }

  const finish = (): void => {
    void run(async () => {
      const result = await api.oauthFinish(code, '')
      setCode('')
      setView(result.view)
      return (result.ok ? t('ok') : t('failed')) + result.message
    })
  }

  const refreshTokens = (): void => {
    void run(async () => {
      const result = await api.oauthRefresh()
      setView(result.view)
      return (result.ok ? t('ok') : t('failed')) + result.message
    })
  }

  const test = (): void => {
    void run(async () => {
      const result = await api.test()
      setView(result.view)
      if (result.ok && result.tools !== undefined) setTools(result.tools)
      return result.ok ? result.message ?? t('connectionSuccessful') : t('failed') + (result.error ?? '')
    })
  }

  const clear = (): void => {
    void run(async () => {
      if (!window.confirm(t('confirmClear'))) return t('cancelled')
      const result = await api.clear()
      setView(result.view)
      setTools([])
      return result.message
    })
  }

  const authorized = Boolean(view?.authorized)
  return (
    <div style={s.card}>
      <p style={s.title}>{t('title')}</p>
      <p style={s.hint}>{t('description')}</p>
      <div style={s.row}>
        <button style={s.button} onClick={authorize} disabled={busy || authorized}>{t('authorize')}</button>
        <button style={s.button} onClick={refreshTokens} disabled={busy || !authorized}>{t('refreshToken')}</button>
        <button style={s.button} onClick={test} disabled={busy || !authorized}>{t('testConnection')}</button>
        <button style={s.button} onClick={clear} disabled={busy || !authorized}>{t('clearCredentials')}</button>
      </div>
      {!authorized && (
        <div style={s.row}>
          <input
            style={{ ...s.input, ...s.flex }}
            placeholder={t('codePlaceholder')}
            value={code}
            onChange={(event) => { setCode(event.target.value) }}
          />
          <button style={s.button} onClick={finish} disabled={busy || code.trim() === ''}>
            {t('finishAuthorization')}
          </button>
        </div>
      )}
      {tools.length > 0 && (
        <div style={s.hint}>
          {t('toolsDiscovered', { count: tools.length, tools: tools.slice(0, 12).join(', ') + (tools.length > 12 ? '…' : '') })}
        </div>
      )}
      {msg !== '' && <div style={s.msg}>{msg}</div>}
    </div>
  )
}
