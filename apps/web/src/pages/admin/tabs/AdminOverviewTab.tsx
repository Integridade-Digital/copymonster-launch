import { formatCurrency } from '../../../lib/format'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase/client'
import { t } from '../../../locales'

interface DailyMetric {
  date: string
  active_users: number
  active_tenants: number
  tokens_consumed: number
  estimated_mrr: number
  new_subscriptions: number
  canceled_subscriptions: number
}

interface ModelStat {
  model: string
  session_count: number
  tokens_sum: number
}

interface SystemHealth {
  dbStatus: 'operational' | 'degraded' | 'down'
  dbLatencyMs: number
}

export function AdminOverviewTab() {
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalSessions, setTotalSessions] = useState<number>(0)
  const [latestMetrics, setLatestMetrics] = useState<DailyMetric | null>(null)
  const [history, setHistory] = useState<DailyMetric[]>([])
  const [modelStats, setModelStats] = useState<ModelStat[]>([])
  const [health, setHealth] = useState<SystemHealth>({
    dbStatus: 'operational',
    dbLatencyMs: 0,
  })

  const loadOverviewData = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // 1. Verificação de latência e saúde do banco.
      const tStart = performance.now()
      const { error: healthError } = await supabase
        .from('users')
        .select('id')
        .limit(1)
      const tEnd = performance.now()
      const latency = Math.round(tEnd - tStart)

      if (healthError) {
        setHealth({
          dbStatus: 'down',
          dbLatencyMs: latency,
        })
      } else {
        setHealth({
          dbStatus: latency > 1000 ? 'degraded' : 'operational',
          dbLatencyMs: latency,
        })
      }

      // 2. Histórico de métricas diárias (últimos 14 registros)
      const { data: metricsData, error: metricsErr } = await supabase
        .from('metrics_daily')
        .select('*')
        .order('date', { ascending: false })
        .limit(14)

      if (!metricsErr && metricsData && metricsData.length > 0) {
        setLatestMetrics(metricsData[0] as unknown as DailyMetric)
        setHistory(metricsData as unknown as DailyMetric[])
      } else {
        setLatestMetrics(null)
        setHistory([])
      }

      // 3. Contagem total de sessões indexadas
      const { count: sessionCount } = await supabase
        .from('sessions_index')
        .select('id', { count: 'exact', head: true })
      setTotalSessions(sessionCount || 0)

      // 4. Distribuição de modelos via RPC agregada (Problema 3)
      const { data: distData, error: distError } = await (supabase.rpc as unknown as (name: string) => Promise<{ data: unknown[] | null; error: unknown }>)('get_model_distribution')
      if (!distError && distData) {
        setModelStats(
          distData.map((d: unknown) => {
            const rec = d as { model?: string; session_count?: number; tokens_sum?: number }
            return {
              model: rec.model ?? '',
              session_count: Number(rec.session_count) || 0,
              tokens_sum: Number(rec.tokens_sum) || 0,
            }
          }),
        )
      } else {
        setModelStats([])
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || t('admin.overview.loadFailure'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadOverviewData()
  }, [loadOverviewData])

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true)
      setError(null)
      const { error: rpcErr } = await (supabase.rpc as unknown as (name: string) => Promise<{ error: unknown }>)('refresh_metrics_daily')
      if (rpcErr) {
        throw rpcErr
      }
      await loadOverviewData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || t('admin.overview.recalculateFailure'))
    } finally {
      setIsRefreshing(false)
    }
  }



  const formatNumber = (val: number) => {
    return new Intl.NumberFormat('pt-BR').format(val || 0)
  }

  const formatTokens = (tokens: number) => {
    if (!tokens) return '0'
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
    return formatNumber(tokens)
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px', color: 'var(--cm-muted-foreground)' }}>
        <span className="adminSpinner" style={{ marginBottom: '16px' }} aria-hidden="true" />
        <p style={{ fontSize: '13px', margin: 0 }}>{t('admin.overview.loading')}</p>
      </div>
    )
  }

  return (
    <div className="adminTabBody">
      <div className="adminTabHeader">
        <div className="adminTabHeaderText">
          <div className="adminTabTitleRow">
            <p className="adminTabSubtitle">{t('admin.overview.subtitle')}</p>
            <span className={`adminBadge ${health.dbStatus === 'operational' ? 'adminBadgeSuccess' : health.dbStatus === 'degraded' ? 'adminBadgePrimary' : 'adminBadgeDanger'}`}>
              <span
                aria-hidden="true"
                style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}
              />
              {health.dbStatus === 'operational'
                ? t('admin.overview.operationalLatency', { ms: health.dbLatencyMs })
                : health.dbStatus === 'degraded'
                  ? t('admin.overview.degradedLatency', { ms: health.dbLatencyMs })
                  : t('admin.overview.dbUnavailable')}
            </span>
          </div>
        </div>

        <div className="adminToolbar">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="adminButton adminButtonSecondary"
            style={{ opacity: isRefreshing ? 0.5 : 1 }}
          >
            {isRefreshing ? (
              <>
                <span className="adminSpinner" aria-hidden="true" />
                {t('admin.overview.updating')}
              </>
            ) : (
              <>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t('admin.overview.recalculate')}
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="adminNotice adminNoticeError">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="adminNoticeDismiss" aria-label={t('common.close')}>✕</button>
        </div>
      )}

      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.overview.mrr')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>
            {formatCurrency(latestMetrics?.estimated_mrr || 0)}
          </div>
          <div className="adminCardSub">
            {t('admin.overview.arr', { value: formatCurrency((latestMetrics?.estimated_mrr || 0) * 12) })}
          </div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.overview.activeUsers')}</div>
          <div className="adminCardValue">
            {formatNumber(latestMetrics?.active_users || 0)}
          </div>
          <div className="adminCardSub">
            {t('admin.overview.tenantsLine', { value: formatNumber(latestMetrics?.active_tenants || 0) })}
          </div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.overview.tokensToday')}</div>
          <div className="adminCardValue">
            {formatTokens(latestMetrics?.tokens_consumed || 0)}
          </div>
          <div className="adminCardSub">
            {t('admin.overview.dailyUsage')}
          </div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.overview.totalSessions')}</div>
          <div className="adminCardValue">
            {formatNumber(totalSessions)}
          </div>
          <div className="adminCardSub">
            {t('admin.overview.indexedInDb')}
          </div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.overview.systemHealth')}</div>
          <div
            className="adminCardValue"
            style={{ color: health.dbStatus === 'operational' ? 'var(--cm-success)' : health.dbStatus === 'degraded' ? 'var(--cm-primary)' : 'var(--cm-destructive)' }}
          >
            {health.dbStatus === 'operational' ? t('admin.overview.dbOperational') : health.dbStatus === 'degraded' ? t('admin.overview.dbDegraded') : t('admin.overview.dbUnavailable')}
          </div>
          <div className="adminCardSub">
            {t('admin.overview.latency', { ms: health.dbLatencyMs })}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
        <div className="adminCard">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
              <h4 className="adminSectionTitle">{t('admin.overview.topModels')}</h4>
              <span className="adminSectionHint">{t('admin.overview.topModelsHint')}</span>
            </div>

            {modelStats.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', fontSize: '13px', color: 'var(--cm-muted-foreground)' }}>
                {t('admin.overview.noModelSessions')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {modelStats.map((item, idx) => {
                  const maxCount = modelStats[0]?.session_count || 1
                  const pct = Math.round((item.session_count / maxCount) * 100)
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12px' }}>
                        <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)' }}>{item.model}</span>
                        <span style={{ color: 'var(--cm-muted-foreground)' }}>
                          {t('admin.overview.modelUsage', { sessions: formatNumber(item.session_count), tokens: formatTokens(item.tokens_sum) })}
                        </span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '3px', background: 'var(--cm-secondary)', overflow: 'hidden' }}>
                        <div
                          style={{ height: '100%', borderRadius: '3px', background: 'var(--cm-primary)', width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="adminCard">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
            <h4 className="adminSectionTitle">{t('admin.overview.history')}</h4>
            <span className="adminSectionHint">{t('admin.overview.historyHint')}</span>
          </div>

          {history.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', fontSize: '13px', color: 'var(--cm-muted-foreground)' }}>
              {t('admin.overview.noSnapshot')}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="adminTable">
                <thead>
                  <tr>
                    <th>{t('admin.overview.date')}</th>
                    <th>{t('admin.overview.users')}</th>
                    <th>{t('admin.common.tokens')}</th>
                    <th>{t('admin.overview.mrrColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(row => (
                    <tr key={row.date}>
                      <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{row.date}</td>
                      <td>{formatNumber(row.active_users)}</td>
                      <td style={{ color: 'var(--cm-muted-foreground)' }}>{formatTokens(row.tokens_consumed)}</td>
                      <td style={{ color: 'var(--cm-primary)', fontWeight: 500 }}>{formatCurrency(row.estimated_mrr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
