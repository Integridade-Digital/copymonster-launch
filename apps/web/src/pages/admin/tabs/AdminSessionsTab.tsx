import { formatDate, formatDateTime } from '../../../lib/format'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'

interface AdminSessionRow {
  session_id: string
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  user_id: string
  user_email: string
  user_full_name: string
  title: string
  model_used: string
  tokens_total: number
  status: 'active' | 'completed' | 'archived' | 'error' | string
  created_at: string
  updated_at: string
  total_count: number
}

interface SessionKPIs {
  total_sessions: number
  active_sessions: number
  completed_sessions: number
  archived_sessions: number
  total_tokens: number
}

interface TenantOption {
  id: string
  name: string
  slug: string
}

type RpcCaller = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

export function AdminSessionsTab() {
  const [sessions, setSessions] = useState<AdminSessionRow[]>([])
  const [kpis, setKpis] = useState<SessionKPIs | null>(null)
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [workspacesRoot, setWorkspacesRoot] = useState<string>('/var/dsh/workspaces')

  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // Filtros
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  const [selectedTenant, setSelectedTenant] = useState<string>('')
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')
  const [selectedPeriod, setSelectedPeriod] = useState<'all' | '7d' | '30d'>('all')

  // Paginação
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(25)
  const [totalCount, setTotalCount] = useState<number>(0)

  // Drawer de Detalhes e Modal de Purge
  const [inspectingSession, setInspectingSession] = useState<AdminSessionRow | null>(null)
  const [sessionToPurge, setSessionToPurge] = useState<AdminSessionRow | null>(null)
  const [isSubmittingAction, setIsSubmittingAction] = useState<boolean>(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedCommand, setCopiedCommand] = useState<boolean>(false)

  // Debounce da busca
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm)
      setCurrentPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Carregar tenants e path de workspaces
  useEffect(() => {
    async function loadAuxiliaryData() {
      try {
        const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller
        const [tenantsRes, storageRes] = await Promise.all([
          supabase.from('tenants').select('id, name, slug').order('name'),
          callRpc('get_admin_storage_paths'),
        ])

        if (!tenantsRes.error && tenantsRes.data) {
          setTenants(tenantsRes.data as TenantOption[])
        }

        const storageData = storageRes.data as { paths?: { workspaces_root?: string } } | null
        if (!storageRes.error && storageData?.paths?.workspaces_root) {
          setWorkspacesRoot(storageData.paths.workspaces_root)
        }
      } catch (err) {
        console.warn('Error ao carregar dados auxiliares de sessões:', err)
      }
    }
    loadAuxiliaryData()
  }, [])

  // Buscar Sessions e KPIs
  const loadSessionsData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)

    try {
      const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller
      const [kpisRes, listRes] = await Promise.all([
        callRpc('get_admin_sessions_kpis'),
        callRpc('get_admin_sessions', {
          p_search: debouncedSearch.trim() || null,
          p_tenant_id: selectedTenant || null,
          p_model: selectedModel || null,
          p_status: selectedStatus || null,
          p_page: currentPage,
          p_page_size: pageSize,
        }),
      ])

      if (kpisRes.error) throw new Error(`KPIs: ${kpisRes.error.message}`)
      if (listRes.error) throw new Error(`Listagem: ${listRes.error.message}`)

      const kpiData = kpisRes.data as SessionKPIs
      setKpis(kpiData)

      let rows = (listRes.data as AdminSessionRow[]) || []

      // Filtro em memória por período se solicitado
      if (selectedPeriod !== 'all' && rows.length > 0) {
        const now = Date.now()
        const days = selectedPeriod === '7d' ? 7 : 30
        const cutoff = now - days * 24 * 60 * 60 * 1000
        rows = rows.filter(r => new Date(r.created_at).getTime() >= cutoff)
      }

      setSessions(rows)

      const firstRow = rows[0]
      if (firstRow && firstRow.total_count !== undefined) {
        setTotalCount(Number(firstRow.total_count))
      } else {
        setTotalCount(0)
      }

      // Catalogar modelos dinamicamente das linhas retornadas
      const modelsFound = Array.from(
        new Set(
          rows
            .map(r => r.model_used)
            .filter(m => Boolean(m) && m !== 'N/A'),
        ),
      )
      setAvailableModels(prev => Array.from(new Set([...prev, ...modelsFound])))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao buscar dados de sessões.'
      console.error('Falha ao carregar sessões:', err)
      setError(msg)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [debouncedSearch, selectedTenant, selectedModel, selectedStatus, selectedPeriod, currentPage, pageSize])

  useEffect(() => {
    loadSessionsData()
  }, [loadSessionsData])

  // Ação: Copy ID da Sessão
  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Ação: Copy SSH Command do Transcript
  const handleCopyCommand = (command: string) => {
    navigator.clipboard.writeText(command)
    setCopiedCommand(true)
    setTimeout(() => setCopiedCommand(false), 2000)
  }

  // Ação: Arquivar Sessão
  const handleArchiveSession = async (session: AdminSessionRow) => {
    setActionError(null)
    setActionSuccess(null)
    setIsSubmittingAction(true)

    try {
      const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller
      const { error: rpcErr } = await callRpc('admin_archive_session', {
        p_session_id: session.session_id,
      })

      if (rpcErr) throw new Error(rpcErr.message)

      setActionSuccess(`Sessão "${session.title}" arquivada com sucesso.`)
      setTimeout(() => setActionSuccess(null), 4000)

      if (inspectingSession?.session_id === session.session_id) {
        setInspectingSession(prev => (prev ? { ...prev, status: 'archived' } : null))
      }

      await loadSessionsData(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao arquivar sessão.'
      setActionError(msg)
    } finally {
      setIsSubmittingAction(false)
    }
  }

  // Ação: Purgar Sessão (Soft Delete)
  const handleConfirmPurge = async () => {
    if (!sessionToPurge) return

    setActionError(null)
    setActionSuccess(null)
    setIsSubmittingAction(true)

    try {
      const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller
      const { error: rpcErr } = await callRpc('admin_purge_session', {
        p_session_id: sessionToPurge.session_id,
      })

      if (rpcErr) throw new Error(rpcErr.message)

      setActionSuccess(`Sessão "${sessionToPurge.title}" purgada da listagem.`)
      setTimeout(() => setActionSuccess(null), 4000)

      if (inspectingSession?.session_id === sessionToPurge.session_id) {
        setInspectingSession(null)
      }
      setSessionToPurge(null)

      await loadSessionsData(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao purgar sessão.'
      setActionError(msg)
    } finally {
      setIsSubmittingAction(false)
    }
  }

  // Formatação de tokens legível
  const formatTokens = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`
    return num.toLocaleString('pt-BR')
  }

  // Formatação de data
  const formatDate = (isoStr: string) => {
    if (!isoStr) return '-'
    const d = new Date(isoStr)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // Cores de status
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--cm-primary)]/20 text-[var(--cm-primary)] border border-[var(--cm-primary)]/40">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--cm-primary)] animate-pulse" />
            Ativa
          </span>
        )
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            Concluída
          </span>
        )
      case 'archived':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--cm-muted-foreground)]/15 text-[var(--cm-muted-foreground)] border border-[var(--cm-muted-foreground)]/30">
            Arquivada
          </span>
        )
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            Error
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--cm-secondary)] text-[var(--cm-muted-foreground)]">
            {status}
          </span>
        )
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  // SSH Command para o transcript da sessão em inspeção
  const sshTranscriptCommand = useMemo(() => {
    if (!inspectingSession) return ''
    const cleanRoot = workspacesRoot.endsWith('/') ? workspacesRoot.slice(0, -1) : workspacesRoot
    return `find ${cleanRoot} -name "*${inspectingSession.session_id}*.jsonl" -exec cat {} +`
  }, [inspectingSession, workspacesRoot])

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', color: 'var(--cm-foreground)' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[var(--cm-border)]">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight text-[var(--cm-foreground)]">Sessions Globais</h2>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--cm-primary)]/20 text-[var(--cm-primary)] border border-[var(--cm-primary)]/30">
              Total: {kpis?.total_sessions ?? totalCount}
            </span>
            {kpis && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                {kpis.active_sessions} ativas hoje
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--cm-muted-foreground)] mt-1">
            Monitoramento centralizado de sessões de chat, volume de tokens, auditoria e governança.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadSessionsData(true)}
            disabled={isLoading || isRefreshing}
            className="px-3 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-xs font-medium text-[var(--cm-foreground)] transition flex items-center gap-1.5 disabled:opacity-50"
            title="Atualizar dados"
          >
            <svg width="14" height="14"
              className={`w-3.5 h-3.5 text-[var(--cm-muted-foreground)] ${isRefreshing ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
          </button>
        </div>
      </div>

      {/* Alertas de Ação */}
      {actionSuccess && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-lg text-emerald-300 text-sm flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 hover:text-emerald-200 text-xs">✕</button>
        </div>
      )}
      {actionError && (
        <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-lg text-rose-300 text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-200 text-xs">✕</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium">Total de Sessions</div>
          <div className="text-xl font-bold text-[var(--cm-foreground)] mt-1">{kpis ? kpis.total_sessions.toLocaleString('pt-BR') : '-'}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[var(--cm-primary)]" />
            Ativas
          </div>
          <div className="text-xl font-bold text-[var(--cm-primary)] mt-1">{kpis ? kpis.active_sessions.toLocaleString('pt-BR') : '-'}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Concluídas
          </div>
          <div className="text-xl font-bold text-[var(--cm-foreground)] mt-1">{kpis ? kpis.completed_sessions.toLocaleString('pt-BR') : '-'}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[var(--cm-muted-foreground)]" />
            Arquivadas
          </div>
          <div className="text-xl font-bold text-[var(--cm-muted-foreground)] mt-1">{kpis ? kpis.archived_sessions.toLocaleString('pt-BR') : '-'}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70 col-span-2 sm:col-span-1">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[var(--cm-primary)]" />
            Tokens Consumidos
          </div>
          <div className="text-xl font-bold text-[var(--cm-primary)] mt-1">{kpis ? formatTokens(kpis.total_tokens) : '-'}</div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="p-4 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/50 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Busca por ID, título ou email */}
          <div className="sm:col-span-4 relative">
            <input
              type="text"
              placeholder="Search by ID, título ou e-mail..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 pl-9 bg-[var(--cm-background)] border border-[var(--cm-border)] rounded-lg text-sm text-[var(--cm-foreground)] placeholder-[var(--cm-muted-foreground)] focus:outline-none focus:border-[var(--cm-primary)] transition"
            />
            <svg width="14" height="14"
              className="w-4 h-4 text-[var(--cm-muted-foreground)] absolute left-3 top-2.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-xs text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)]"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filtro por Tenant */}
          <div className="sm:col-span-2">
            <select
              value={selectedTenant}
              onChange={(e) => {
                setSelectedTenant(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 bg-[var(--cm-background)] border border-[var(--cm-border)] rounded-lg text-sm text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)] transition"
            >
              <option value="">Todos os Tenants</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro por Modelo */}
          <div className="sm:col-span-2">
            <select
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 bg-[var(--cm-background)] border border-[var(--cm-border)] rounded-lg text-sm text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)] transition"
            >
              <option value="">Todos os Models</option>
              {availableModels.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro por Status */}
          <div className="sm:col-span-2">
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 bg-[var(--cm-background)] border border-[var(--cm-border)] rounded-lg text-sm text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)] transition"
            >
              <option value="">Todos os Status</option>
              <option value="active">Ativa</option>
              <option value="completed">Concluída</option>
              <option value="archived">Arquivada</option>
              <option value="error">Error</option>
            </select>
          </div>

          {/* Filtro por Período */}
          <div className="sm:col-span-2">
            <select
              value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value as 'all' | '7d' | '30d')}
              className="w-full px-3 py-2 bg-[var(--cm-background)] border border-[var(--cm-border)] rounded-lg text-sm text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)] transition"
            >
              <option value="all">Todo o Período</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>
        </div>

        {/* Resumo de filtros ativos */}
        {(debouncedSearch || selectedTenant || selectedModel || selectedStatus || selectedPeriod !== 'all') && (
          <div className="flex items-center justify-between text-xs text-[var(--cm-muted-foreground)] pt-2 border-t border-[var(--cm-border)]/50">
            <span>Filtros aplicados. Encontrados: {totalCount} sessões.</span>
            <button
              onClick={() => {
                setSearchTerm('')
                setSelectedTenant('')
                setSelectedModel('')
                setSelectedStatus('')
                setSelectedPeriod('all')
                setCurrentPage(1)
              }}
              className="text-[var(--cm-primary)] hover:underline"
            >
              Limpar todos os filtros
            </button>
          </div>
        )}
      </div>

      {/* Error de Carregamento */}
      {error && (
        <div className="p-4 bg-rose-950/40 border border-rose-500/50 rounded-xl text-rose-300 text-sm flex items-center justify-between">
          <div>
            <p className="font-semibold">Error ao carregar sessões</p>
            <p className="text-xs text-rose-400 mt-0.5">{error}</p>
          </div>
          <button
            onClick={() => loadSessionsData()}
            className="px-3 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-xs rounded-lg transition"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Tabela de Sessions */}
      <div className="border border-[var(--cm-border)] rounded-xl overflow-hidden bg-[var(--cm-card)]/70">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[var(--cm-foreground)]">
            <thead className="bg-[var(--cm-card)] border-b border-[var(--cm-border)] text-xs font-semibold text-[var(--cm-muted-foreground)] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Sessão</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Modelo</th>
                <th className="px-4 py-3 text-right">Tokens</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3">Criado em</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cm-border)]/60">
              {isLoading && !isRefreshing ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[var(--cm-muted-foreground)]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <svg width="14" height="14" className="w-6 h-6 animate-spin text-[var(--cm-primary)]" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span className="text-xs">Carregando catálogo de sessões...</span>
                    </div>
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[var(--cm-muted-foreground)]">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <p className="text-base font-medium text-[var(--cm-foreground)]">Nenhuma sessão encontrada</p>
                      <p className="text-xs text-[var(--cm-muted-foreground)]">
                        {debouncedSearch || selectedTenant || selectedModel || selectedStatus
                          ? 'Tente ajustar os filtros acima.'
                          : 'Ainda não há sessões registradas no sistema.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                sessions.map(row => (
                  <tr key={row.session_id} className="hover:bg-[var(--cm-secondary)]/20 transition-colors">
                    {/* Título e ID Mono */}
                    <td className="px-4 py-3 max-w-[240px]">
                      <div className="font-medium text-[var(--cm-foreground)] truncate" title={row.title}>
                        {row.title}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-[11px] text-[var(--cm-muted-foreground)] truncate max-w-[140px]" title={row.session_id}>
                          {row.session_id}
                        </span>
                        <button
                          onClick={() => handleCopyId(row.session_id)}
                          className="text-[10px] text-[var(--cm-muted-foreground)] hover:text-[var(--cm-primary)] transition"
                          title="Copy ID da sessão"
                        >
                          {copiedId === row.session_id ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                    </td>

                    {/* Tenant */}
                    <td className="px-4 py-3 text-xs text-[var(--cm-foreground)]">
                      <div className="font-medium truncate max-w-[140px]" title={row.tenant_name}>
                        {row.tenant_name}
                      </div>
                      <div className="text-[var(--cm-muted-foreground)] text-[11px] font-mono truncate max-w-[140px]">
                        {row.tenant_slug}
                      </div>
                    </td>

                    {/* Usuário */}
                    <td className="px-4 py-3 text-xs text-[var(--cm-foreground)]">
                      <div className="font-medium truncate max-w-[160px]" title={row.user_email}>
                        {row.user_full_name || row.user_email}
                      </div>
                      {row.user_full_name && (
                        <div className="text-[var(--cm-muted-foreground)] text-[11px] truncate max-w-[160px]" title={row.user_email}>
                          {row.user_email}
                        </div>
                      )}
                    </td>

                    {/* Modelo */}
                    <td className="px-4 py-3 text-xs">
                      <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-[var(--cm-card)] border border-[var(--cm-border)] text-[var(--cm-primary)]">
                        {row.model_used}
                      </span>
                    </td>

                    {/* Tokens */}
                    <td className="px-4 py-3 text-xs font-mono text-right text-[var(--cm-foreground)]">
                      {formatTokens(row.tokens_total)}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      {getStatusBadge(row.status)}
                    </td>

                    {/* Data */}
                    <td className="px-4 py-3 text-xs text-[var(--cm-muted-foreground)] whitespace-nowrap">
                      {formatDate(row.created_at)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right text-xs">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setInspectingSession(row)}
                          className="px-2.5 py-1 rounded bg-[var(--cm-card)] border border-[var(--cm-border)] hover:border-[var(--cm-primary)] text-[var(--cm-foreground)] hover:text-[var(--cm-primary)] transition font-medium"
                          title="Inspecionar metadados e transcript"
                        >
                          Detalhes
                        </button>
                        {row.status !== 'archived' && (
                          <button
                            onClick={() => handleArchiveSession(row)}
                            disabled={isSubmittingAction}
                            className="px-2 py-1 rounded border border-[var(--cm-border)] hover:border-[var(--cm-muted-foreground)] text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] transition disabled:opacity-50"
                            title="Arquivar sessão"
                          >
                            Arquivar
                          </button>
                        )}
                        <button
                          onClick={() => setSessionToPurge(row)}
                          disabled={isSubmittingAction}
                          className="px-2 py-1 rounded border border-rose-900/40 hover:border-rose-500/60 bg-rose-950/20 text-rose-400 hover:text-rose-200 transition disabled:opacity-50"
                          title="Remover sessão da listagem (soft delete)"
                        >
                          Purgar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé e Paginação */}
        <div className="px-4 py-3 bg-[var(--cm-card)] border-t border-[var(--cm-border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[var(--cm-muted-foreground)]">
          <div className="flex items-center gap-2">
            <span>
              Exibindo {sessions.length} de {totalCount} sessões (Página {currentPage} de {totalPages})
            </span>
            <span className="text-[var(--cm-border)]">|</span>
            <div className="flex items-center gap-1.5">
              <span>Linhas por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setCurrentPage(1)
                }}
                className="bg-[var(--cm-background)] border border-[var(--cm-border)] rounded px-1.5 py-0.5 text-xs text-[var(--cm-foreground)]"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || isLoading}
              className="px-2.5 py-1 rounded border border-[var(--cm-border)] bg-[var(--cm-background)] hover:bg-[var(--cm-secondary)]/40 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Anterior
            </button>
            <span className="font-medium text-[var(--cm-foreground)] px-1">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || isLoading}
              className="px-2.5 py-1 rounded border border-[var(--cm-border)] bg-[var(--cm-background)] hover:bg-[var(--cm-secondary)]/40 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      {/* DRAWER / MODAL DE DETALHES DA SESSÃO */}
      {inspectingSession && (
        <div
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setInspectingSession(null)
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        >
          <div className="w-full max-w-2xl bg-[var(--cm-card)] border border-[var(--cm-border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header do Drawer */}
            <div className="px-6 py-4 border-b border-[var(--cm-border)] flex items-center justify-between bg-[var(--cm-background)]/60">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--cm-primary)]" />
                <h3 className="text-base font-bold text-[var(--cm-foreground)]">Inspeção de Sessão</h3>
                {getStatusBadge(inspectingSession.status)}
              </div>
              <button
                onClick={() => setInspectingSession(null)}
                className="text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] text-sm p-1 rounded-lg hover:bg-[var(--cm-secondary)]/40 transition"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Conteúdo do Drawer */}
            <div className="p-6 overflow-y-auto space-y-5 text-sm">
              {/* Título & ID */}
              <div>
                <label className="text-xs font-semibold text-[var(--cm-muted-foreground)] uppercase tracking-wider">Título da Sessão</label>
                <div className="text-base font-medium text-[var(--cm-foreground)] mt-1">{inspectingSession.title}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-xs bg-[var(--cm-background)] border border-[var(--cm-border)] px-2 py-0.5 rounded text-[var(--cm-primary)]">
                    {inspectingSession.session_id}
                  </span>
                  <button
                    onClick={() => handleCopyId(inspectingSession.session_id)}
                    className="text-xs text-[var(--cm-muted-foreground)] hover:text-[var(--cm-primary)] transition"
                  >
                    {copiedId === inspectingSession.session_id ? '✓ ID Copied' : 'Copy ID'}
                  </button>
                </div>
              </div>

              {/* Grid de Metadados */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-background)]/60">
                <div>
                  <span className="text-xs text-[var(--cm-muted-foreground)] block">Tenant</span>
                  <span className="font-medium text-[var(--cm-foreground)]">{inspectingSession.tenant_name}</span>
                  <span className="text-[11px] font-mono text-[var(--cm-muted-foreground)] block mt-0.5">{inspectingSession.tenant_slug}</span>
                </div>
                <div>
                  <span className="text-xs text-[var(--cm-muted-foreground)] block">Usuário</span>
                  <span className="font-medium text-[var(--cm-foreground)]">{inspectingSession.user_full_name || inspectingSession.user_email}</span>
                  <span className="text-[11px] text-[var(--cm-muted-foreground)] block mt-0.5">{inspectingSession.user_email}</span>
                </div>
                <div>
                  <span className="text-xs text-[var(--cm-muted-foreground)] block">Modelo Utilizado</span>
                  <span className="font-mono text-xs text-[var(--cm-primary)] mt-0.5 inline-block">
                    {inspectingSession.model_used}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[var(--cm-muted-foreground)] block">Tokens Registrados</span>
                  <span className="font-mono text-xs text-[var(--cm-foreground)] mt-0.5 inline-block">
                    {inspectingSession.tokens_total.toLocaleString('pt-BR')} ({formatTokens(inspectingSession.tokens_total)})
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[var(--cm-muted-foreground)] block">Criada em</span>
                  <span className="text-xs text-[var(--cm-foreground)]">{formatDate(inspectingSession.created_at)}</span>
                </div>
                <div>
                  <span className="text-xs text-[var(--cm-muted-foreground)] block">Last Updated</span>
                  <span className="text-xs text-[var(--cm-foreground)]">{formatDate(inspectingSession.updated_at)}</span>
                </div>
              </div>

              {/* Card Informativo do Filesystem */}
              <div className="p-4 rounded-xl border border-[var(--cm-primary)]/40 bg-[var(--cm-card)] space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--cm-primary)] uppercase tracking-wider">
                  <svg width="14" height="14" className="w-4 h-4 text-[var(--cm-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Transcript no Filesystem (.jsonl)
                </div>
                <p className="text-xs text-[var(--cm-muted-foreground)] leading-relaxed">
                  O transcript completo desta sessão está gravado como stream de eventos no filesystem do servidor.
                  Para auditar as mensagens brutas via terminal SSH, execute o comando abaixo:
                </p>
                <div className="p-2.5 rounded-lg bg-[var(--cm-background)] border border-[var(--cm-border)] flex items-center justify-between gap-2">
                  <code className="text-xs font-mono text-[var(--cm-primary)] break-all select-all">
                    {sshTranscriptCommand}
                  </code>
                  <button
                    onClick={() => handleCopyCommand(sshTranscriptCommand)}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)] text-[var(--cm-foreground)] whitespace-nowrap transition"
                  >
                    {copiedCommand ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            {/* Rodapé do Drawer com Actions */}
            <div className="px-6 py-4 border-t border-[var(--cm-border)] bg-[var(--cm-background)]/60 flex items-center justify-between">
              <button
                onClick={() => handleCopyId(inspectingSession.session_id)}
                className="px-3 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-xs font-medium text-[var(--cm-foreground)] transition"
              >
                {copiedId === inspectingSession.session_id ? '✓ ID Copied' : 'Copy ID'}
              </button>

              <div className="flex items-center gap-2">
                {inspectingSession.status !== 'archived' && (
                  <button
                    onClick={() => handleArchiveSession(inspectingSession)}
                    disabled={isSubmittingAction}
                    className="px-3 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-xs font-medium text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] transition disabled:opacity-50"
                  >
                    Arquivar
                  </button>
                )}
                <button
                  onClick={() => setSessionToPurge(inspectingSession)}
                  disabled={isSubmittingAction}
                  className="px-3 py-1.5 rounded-lg border border-rose-900/50 bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 text-xs font-medium transition disabled:opacity-50"
                >
                  Purgar Sessão
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE PURGE (SOFT DELETE) */}
      {sessionToPurge && (
        <div
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSessionToPurge(null)
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
        >
          <div className="w-full max-w-md bg-[var(--cm-card)] border border-rose-900/50 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-400">
              <div className="w-8 h-8 rounded-full bg-rose-950/60 border border-rose-900/60 flex items-center justify-center font-bold">
                !
              </div>
              <h3 className="text-base font-bold text-[var(--cm-foreground)]">Confirm Deletion (Purge)</h3>
            </div>

            <p className="text-xs text-[var(--cm-muted-foreground)] leading-relaxed">
              Você está prestes a purgar a sessão{' '}
              <strong className="text-[var(--cm-foreground)]">"{sessionToPurge.title}"</strong> ({sessionToPurge.session_id}).
            </p>

            <div className="p-3 bg-rose-950/30 border border-rose-900/40 rounded-xl text-xs text-rose-300 space-y-1">
              <p className="font-semibold">Aviso de Governança:</p>
              <p className="text-rose-400/90">
                Esta ação fará o <strong>soft delete</strong> da sessão no banco de dados, removendo-a da listagem administrativa.
                Os arquivos brutos no filesystem (.jsonl) permanecerão preservados para auditoria profunda.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setSessionToPurge(null)}
                disabled={isSubmittingAction}
                className="px-3.5 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-xs font-medium text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPurge}
                disabled={isSubmittingAction}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmittingAction ? (
                  <>
                    <svg width="14" height="14" className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Purgando...</span>
                  </>
                ) : (
                  <span>Confirm Purge</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
