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

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(val || 0)
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
      <div className="flex flex-col items-center justify-center p-12 text-[#8b949e]">
        <div className="w-8 h-8 border-2 border-[#E7BF73] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">Carregando indicadores do painel...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header com Status de Saúde e Botão de Atualizar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#30363d]">
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#f0f6fc', margin: '0 0 4px 0' }}>Overview da Plataforma</h3>
          <p style={{ fontSize: '13px', color: '#8b949e', margin: 0 }}>
            Métricas consolidadas de receita, uso de infraestrutura e saúde dos serviços.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Status do Banco e Latência (Problema 2 resolvido) */}
          <div className="px-3 py-1.5 rounded-lg bg-[#0d1117] border border-[#30363d] flex items-center gap-2">
            <span className="text-xs text-[#8b949e]">Banco:</span>
            {health.dbStatus === 'operational' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Operacional ({health.dbLatencyMs}ms)
              </span>
            )}
            {health.dbStatus === 'degraded' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Degradado ({health.dbLatencyMs}ms)
              </span>
            )}
            {health.dbStatus === 'down' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                Indisponível
              </span>
            )}
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#E7BF73]/10 hover:bg-[#E7BF73]/20 text-[#E7BF73] border border-[#E7BF73]/30 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            {isRefreshing ? (
              <>
                <span className="w-3 h-3 border-2 border-[#E7BF73] border-t-transparent rounded-full animate-spin" />
                Atualizando...
              </>
            ) : (
              <>
                <svg width="14" height="14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Recalcular Métricas
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">✕</button>
        </div>
      )}

      {/* Grid de 5 KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
        {/* KPI 1: MRR / ARR */}
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: '#8b949e', marginBottom: '6px' }}>MRR Estimado</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#E7BF73' }}>
            {formatCurrency(latestMetrics?.estimated_mrr || 0)}
          </div>
          <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>
            ARR: {formatCurrency((latestMetrics?.estimated_mrr || 0) * 12)}
          </div>
        </div>

        {/* KPI 2: Users Ativos */}
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: '#8b949e', marginBottom: '6px' }}>Users Ativos (Hoje)</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#f0f6fc' }}>
            {formatNumber(latestMetrics?.active_users || 0)}
          </div>
          <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>
            Tenants: {formatNumber(latestMetrics?.active_tenants || 0)}
          </div>
        </div>

        {/* KPI 3: Tokens Consumidos */}
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: '#8b949e', marginBottom: '6px' }}>Tokens (Hoje)</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#f0f6fc' }}>
            {formatTokens(latestMetrics?.tokens_consumed || 0)}
          </div>
          <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>
            Consumo diário
          </div>
        </div>

        {/* KPI 4: Sessions Totais */}
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: '#8b949e', marginBottom: '6px' }}>Sessions Totais</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#f0f6fc' }}>
            {formatNumber(totalSessions)}
          </div>
          <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>
            Indexadas no banco
          </div>
        </div>

        {/* KPI 5: Saúde do Sistema */}
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: '#8b949e', marginBottom: '6px' }}>Saúde do Sistema</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: health.dbStatus === 'operational' ? '#3fb950' : health.dbStatus === 'degraded' ? '#d29922' : '#f85149' }}>
            {health.dbStatus === 'operational' ? 'Operacional' : health.dbStatus === 'degraded' ? 'Degradado' : 'Indisponível'}
          </div>
          <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>
            Latência: {health.dbLatencyMs}ms ({health.providersActive} provedores)
          </div>
        </div>
      </div>

      {/* Seção Central: Distribuição por Modelo e Histórico */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Distribuição por Modelo */}
        <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-[#f0f6fc]">Models Mais Utilizados</h4>
              <span className="text-[11px] text-[#8b949e]">Top 10 por volume</span>
            </div>

            {modelStats.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8b949e]">
                Nenhuma sessão indexada com registro de modelo até o momento.
              </div>
            ) : (
              <div className="space-y-3">
                {modelStats.map((item, idx) => {
                  const maxCount = modelStats[0]?.session_count || 1
                  const pct = Math.round((item.session_count / maxCount) * 100)
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-mono text-[#f0f6fc]">{item.model}</span>
                        <span className="text-[#8b949e]">
                          {formatNumber(item.session_count)} sessões ({formatTokens(item.tokens_sum)} tokens)
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[#0d1117] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#E7BF73]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Histórico Recente de Métricas (Tabela) */}
        <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-[#f0f6fc]">Histórico Recente (Snapshot Diário)</h4>
            <span className="text-[11px] text-[#8b949e]">Últimos 14 dias</span>
          </div>

          {history.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#8b949e]">
              Nenhum snapshot diário gerado. Clique em &quot;Recalcular Métricas&quot; acima para registrar o primeiro.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#30363d] text-[#8b949e]">
                    <th className="pb-2 font-medium">Data</th>
                    <th className="pb-2 font-medium">Users</th>
                    <th className="pb-2 font-medium">Tokens</th>
                    <th className="pb-2 font-medium">MRR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]/50">
                  {history.map(row => (
                    <tr key={row.date} className="text-[#f0f6fc]">
                      <td className="py-2 font-mono text-[11px]">{row.date}</td>
                      <td className="py-2">{formatNumber(row.active_users)}</td>
                      <td className="py-2 text-[#8b949e]">{formatTokens(row.tokens_consumed)}</td>
                      <td className="py-2 text-[#E7BF73] font-medium">{formatCurrency(row.estimated_mrr)}</td>
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
