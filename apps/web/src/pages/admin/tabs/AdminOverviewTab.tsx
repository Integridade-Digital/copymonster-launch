import { formatCurrency } from '../../../lib/format'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase/client'

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
  providersCount: number
  providersActive: number
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
    providersCount: 0,
    providersActive: 0,
  })

  const loadOverviewData = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // 1. Verificação de latência e saúde do banco via llm_providers
      const tStart = performance.now()
      const { data: providersData, error: providersErr } = await supabase
        .from('llm_providers')
        .select('id, is_active')
      const tEnd = performance.now()
      const latency = Math.round(tEnd - tStart)

      if (providersErr) {
        setHealth({
          dbStatus: 'down',
          dbLatencyMs: latency,
          providersCount: 0,
          providersActive: 0,
        })
      } else {
        const activeCount = (providersData || []).filter((p: { is_active: boolean }) => p.is_active).length
        setHealth({
          dbStatus: latency > 1000 ? 'degraded' : 'operational',
          dbLatencyMs: latency,
          providersCount: (providersData || []).length,
          providersActive: activeCount,
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
      const { data: distData, error: distError } = await (supabase.rpc as any)('get_model_distribution')
      if (!distError && distData) {
        setModelStats(
          distData.map((d: any) => ({
            model: d.model,
            session_count: Number(d.session_count) || 0,
            tokens_sum: Number(d.tokens_sum) || 0,
          })),
        )
      } else {
        setModelStats([])
      }
    } catch (err: any) {
      setError(err?.message || 'Falha ao carregar métricas de visão geral.')
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
      const { error: rpcErr } = await (supabase.rpc as any)('refresh_metrics_daily')
      if (rpcErr) {
        throw rpcErr
      }
      await loadOverviewData()
    } catch (err: any) {
      setError(err?.message || 'Error ao recalcular métricas diárias.')
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
        <span className="cm-auth-spinner" style={{ marginBottom: '16px' }} aria-hidden="true" />
        <p style={{ fontSize: '13px', margin: 0 }}>Carregando indicadores do painel...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', color: 'var(--cm-foreground)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--cm-border)' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: '0 0 4px 0' }}>Overview da Plataforma</h3>
          <p style={{ fontSize: '13px', color: 'var(--cm-muted-foreground)', margin: 0 }}>
            Métricas consolidadas de receita, uso de infraestrutura e saúde dos serviços.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '8px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)' }}>
            <span style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>Banco:</span>
            {health.dbStatus === 'operational' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--cm-success)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--cm-success)', display: 'inline-block' }} />
                Operacional ({health.dbLatencyMs}ms)
              </span>
            )}
            {health.dbStatus === 'degraded' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--cm-primary)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--cm-primary)', display: 'inline-block' }} />
                Degradado ({health.dbLatencyMs}ms)
              </span>
            )}
            {health.dbStatus === 'down' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--cm-destructive)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--cm-destructive)', display: 'inline-block' }} />
                Indisponível
              </span>
            )}
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-primary) 10%, transparent)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', cursor: 'pointer', opacity: isRefreshing ? 0.5 : 1 }}
          >
            {isRefreshing ? (
              <>
                <span style={{ width: '14px', height: '14px', border: '2px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', borderTopColor: 'var(--cm-primary)', borderRadius: '50%', display: 'inline-block', animation: 'cm-auth-spin 0.7s linear infinite' }} />
                Atualizando...
              </>
            ) : (
              <>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Recalcular Métricas
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', borderRadius: '8px', color: 'var(--cm-destructive)', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ color: 'var(--cm-destructive)', cursor: 'pointer', background: 'none', border: 'none', fontSize: '14px' }}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
        <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--cm-muted-foreground)', marginBottom: '6px' }}>MRR Estimado</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--cm-primary)' }}>
            {formatCurrency(latestMetrics?.estimated_mrr || 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', marginTop: '4px' }}>
            ARR: {formatCurrency((latestMetrics?.estimated_mrr || 0) * 12)}
          </div>
        </div>

        <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--cm-muted-foreground)', marginBottom: '6px' }}>Users Ativos (Hoje)</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--cm-foreground)' }}>
            {formatNumber(latestMetrics?.active_users || 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', marginTop: '4px' }}>
            Tenants: {formatNumber(latestMetrics?.active_tenants || 0)}
          </div>
        </div>

        <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--cm-muted-foreground)', marginBottom: '6px' }}>Tokens (Hoje)</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--cm-foreground)' }}>
            {formatTokens(latestMetrics?.tokens_consumed || 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', marginTop: '4px' }}>
            Consumo diário
          </div>
        </div>

        <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--cm-muted-foreground)', marginBottom: '6px' }}>Sessions Totais</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--cm-foreground)' }}>
            {formatNumber(totalSessions)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', marginTop: '4px' }}>
            Indexadas no banco
          </div>
        </div>

        <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--cm-muted-foreground)', marginBottom: '6px' }}>Saúde do Sistema</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: health.dbStatus === 'operational' ? 'var(--cm-success)' : health.dbStatus === 'degraded' ? 'var(--cm-primary)' : 'var(--cm-destructive)' }}>
            {health.dbStatus === 'operational' ? 'Operacional' : health.dbStatus === 'degraded' ? 'Degradado' : 'Indisponível'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', marginTop: '4px' }}>
            Latência: {health.dbLatencyMs}ms ({health.providersActive} provedores)
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
        <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--cm-card)', border: '1px solid var(--cm-border)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Models Mais Utilizados</h4>
              <span style={{ fontSize: '11px', color: 'var(--cm-muted-foreground)' }}>Top 10 por volume</span>
            </div>

            {modelStats.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
                Nenhuma sessão indexada com registro de modelo até o momento.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {modelStats.map((item, idx) => {
                  const maxCount = modelStats[0]?.session_count || 1
                  const pct = Math.round((item.session_count / maxCount) * 100)
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)' }}>{item.model}</span>
                        <span style={{ color: 'var(--cm-muted-foreground)' }}>
                          {formatNumber(item.session_count)} sessões ({formatTokens(item.tokens_sum)} tokens)
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

        <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--cm-card)', border: '1px solid var(--cm-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Histórico Recente (Snapshot Diário)</h4>
            <span style={{ fontSize: '11px', color: 'var(--cm-muted-foreground)' }}>Últimos 14 dias</span>
          </div>

          {history.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
              Nenhum snapshot diário gerado. Clique em &quot;Recalcular Métricas&quot; acima para registrar o primeiro.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="adminTable">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Users</th>
                    <th>Tokens</th>
                    <th>MRR</th>
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
