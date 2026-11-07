import { formatDateTime } from '../../lib/format'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase/client'
import { t } from '../../locales'

interface AuditLog {
  id: string
  tenant_id: string | null
  user_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  old_value: unknown
  new_value: unknown
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

interface AuditKPIs {
  total: number
  creations: number
  updates: number
  deletions: number
  security: number
}

interface KPIsRow {
  total: number
  creations: number
  updates: number
  deletions: number
  security: number
}

function AuditValueBlock({ label, value }: { label: string; value: unknown }) {
  const json = value === null || value === undefined ? '' : JSON.stringify(value, null, 2)
  if (!json) return null
  return (
    <div>
      <h4 className="adminFieldLabel">{label}</h4>
      <pre className="adminCodeBlock" style={{ background: 'var(--cm-background)', overflowX: 'auto' }}>{json}</pre>
    </div>
  )
}

export function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState<string>('')
  const [resourceFilter, setResourceFilter] = useState<string>('')
  const [page, setPage] = useState(0)
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [kpis, setKpis] = useState<AuditKPIs | null>(null)
  const [totalCount, setTotalCount] = useState<number>(0)
  const pageSize = 25

  const loadKPIs = useCallback(async () => {
    try {
      const { data, error } = await (supabase.rpc as unknown as (name: string) => Promise<{ data: KPIsRow[] | null; error: unknown }>)('get_admin_audit_kpis')
      if (error) throw error
      if (data && data.length > 0) {
        const row = data[0]
        setKpis({
          total: Number(row?.total ?? 0),
          creations: Number(row?.creations ?? 0),
          updates: Number(row?.updates ?? 0),
          deletions: Number(row?.deletions ?? 0),
          security: Number(row?.security ?? 0),
        })
      }
    } catch (err: unknown) {
      console.error('[AdminAuditPage] Error loading KPIs:', err)
    }
  }, [])

  const loadTotalCount = useCallback(async () => {
    try {
      const { data, error } = await (supabase.rpc as unknown as (name: string, params: { p_action: string | null; p_resource_type: string | null }) => Promise<{ data: number | null; error: unknown }>)('get_admin_audit_count', {
        p_action: actionFilter || null,
        p_resource_type: resourceFilter || null,
      })
      if (error) throw error
      setTotalCount(Number(data ?? 0))
    } catch (err: unknown) {
      console.error('[AdminAuditPage] Error loading total count:', err)
    }
  }, [actionFilter, resourceFilter])

  const loadAuditLogs = useCallback(async () => {
    try {
      setIsLoading(true)
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (actionFilter) {
        query = query.eq('action', actionFilter)
      }

      const { data, error } = await query
      if (error) throw error
      setLogs(data || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [actionFilter, page])

  useEffect(() => {
    loadKPIs()
  }, [loadKPIs])

  useEffect(() => {
    loadTotalCount()
  }, [loadTotalCount])

  useEffect(() => {
    loadAuditLogs()
  }, [loadAuditLogs])

  const filteredLogs = useMemo(() => {
    if (!resourceFilter) return logs
    return logs.filter(l => (l.resource_type || '').toLowerCase().includes(resourceFilter.toLowerCase()))
  }, [logs, resourceFilter])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  return (
    <div className="adminTabBody">
      <div className="adminTabHeader">
        <div className="adminTabHeaderText">
          <div className="adminTabTitleRow">
            <p className="adminTabSubtitle">{t('admin.audit.subtitle')}</p>
            <span className="adminBadge adminBadgePrimary">
              {t('admin.audit.total')}: {kpis?.total ?? 0}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="adminNotice adminNoticeError">
          <span>{error}</span>
        </div>
      )}

      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.audit.total')}</div>
          <div className="adminCardValue">{kpis?.total ?? 0}</div>
          <div className="adminCardSub">{t('admin.audit.totalHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.audit.creations')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-success)' }}>{kpis?.creations ?? 0}</div>
          <div className="adminCardSub">{t('admin.audit.creationsHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.audit.updates')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>{kpis?.updates ?? 0}</div>
          <div className="adminCardSub">{t('admin.audit.updatesHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.audit.deletions')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-destructive)' }}>{kpis?.deletions ?? 0}</div>
          <div className="adminCardSub">{t('admin.audit.deletionsHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.audit.security')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-foreground)' }}>{kpis?.security ?? 0}</div>
          <div className="adminCardSub">{t('admin.audit.securityHint')}</div>
        </div>
      </div>

      <div className="adminToolbar">
        <input
          type="text"
          value={resourceFilter}
          onChange={e => setResourceFilter(e.target.value)}
          placeholder={t('admin.audit.searchPlaceholder')}
          className="adminInput"
          style={{ width: '220px', marginBottom: 0 }}
        />
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value)
            setPage(0)
          }}
          className="adminInput"
          style={{ width: '160px', marginBottom: 0 }}
        >
          <option value="">{t('admin.audit.allActions')}</option>
          <option value="create">{t('admin.audit.actionCreate')}</option>
          <option value="update">{t('admin.audit.actionUpdate')}</option>
          <option value="delete">{t('admin.audit.actionDelete')}</option>
          <option value="login">{t('admin.audit.actionLogin')}</option>
        </select>
        {(actionFilter || resourceFilter) && (
          <button
            onClick={() => {
              setActionFilter('')
              setResourceFilter('')
              setPage(0)
            }}
            className="adminLinkButton"
          >
            {t('admin.common.clearFilters')}
          </button>
        )}
      </div>

      <div className="adminCard adminCardTable">
        <div style={{ overflowX: 'auto' }}>
          <table className="adminTable">
            <thead>
              <tr>
                <th>{t('admin.audit.dateTime')}</th>
                <th>{t('admin.audit.action')}</th>
                <th>{t('admin.audit.resource')}</th>
                <th>{t('admin.audit.resourceId')}</th>
                <th>{t('admin.audit.ip')}</th>
                <th style={{ textAlign: 'right' }}>{t('admin.audit.details')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--cm-muted-foreground)' }}>
                    <span className="adminSpinner" style={{ marginRight: '8px' }} aria-hidden="true" />
                    {t('admin.audit.loading')}
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--cm-muted-foreground)' }}>
                    {t('admin.audit.empty')}
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id}>
                    <td style={{ color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                      {formatDateTime(log.created_at)}
                    </td>
                    <td>
                      <span className="adminBadge">{log.action}</span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{log.resource_type || '-'}</td>
                    <td style={{ color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', fontSize: '11px' }}>{log.resource_id ? log.resource_id.slice(0, 8) + '...' : '-'}</td>
                    <td style={{ color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', fontSize: '11px' }}>{log.ip_address || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="adminRowButton"
                        style={{ color: 'var(--cm-primary)' }}
                      >
                        {t('admin.audit.viewPayload')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 16px', borderTop: '1px solid var(--cm-border)', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
          <div>{t('admin.common.page')} {page + 1} {t('admin.common.of')} {totalPages}</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || isLoading}
              className="adminRowButton"
              style={{ opacity: (page === 0 || isLoading) ? 0.4 : 1 }}
            >
              {t('admin.common.previous')}
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || isLoading}
              className="adminRowButton"
              style={{ opacity: (page >= totalPages - 1 || isLoading) ? 0.4 : 1 }}
            >
              {t('admin.common.next')}
            </button>
          </div>
        </div>
      </div>

      {selectedLog && (
        <div className="adminOverlay">
          <div className="adminOverlayMask" onClick={() => setSelectedLog(null)} />
          <div className="adminDialog" style={{ maxWidth: '640px' }}>
            <div className="adminDialogHeader">
              <h3 className="adminDialogTitle">
                {t('admin.audit.logLabel')} <span style={{ color: 'var(--cm-primary)', fontFamily: 'monospace' }}>{selectedLog.action}</span>
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="adminDialogClose"
                aria-label={t('common.close')}
              >
                {'×'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', fontSize: '13px' }}>
              <div>
                <span style={{ color: 'var(--cm-muted-foreground)' }}>{t('admin.audit.resourceLabel')}</span> {selectedLog.resource_type || '-'}
              </div>
              <div>
                <span style={{ color: 'var(--cm-muted-foreground)' }}>{t('admin.audit.resourceIdLabel')}</span>{' '}
                <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{selectedLog.resource_id || '-'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--cm-muted-foreground)' }}>{t('admin.audit.userLabel')}</span>{' '}
                <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{selectedLog.user_id || t('admin.audit.anonymous')}</span>
              </div>
              <div>
                <span style={{ color: 'var(--cm-muted-foreground)' }}>{t('admin.audit.dateTimeLabel')}</span>{' '}
                {formatDateTime(selectedLog.created_at)}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
              <AuditValueBlock label={t('admin.audit.oldValue')} value={selectedLog.old_value} />
              <AuditValueBlock label={t('admin.audit.newValue')} value={selectedLog.new_value} />
            </div>
            <div className="adminDialogFooter">
              <button
                onClick={() => setSelectedLog(null)}
                className="adminButton adminButtonSecondary"
              >
                {t('admin.common.cancelAction')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
