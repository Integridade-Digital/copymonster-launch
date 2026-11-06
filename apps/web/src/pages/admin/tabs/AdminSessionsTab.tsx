import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'
import { t } from '../../../locales'

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
        console.warn('Failed to load auxiliary session data:', err)
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
      const msg = err instanceof Error ? err.message : t('admin.sessions.loadFailure')
      console.error('Failed to load sessions:', err)
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
      const msg = err instanceof Error ? err.message : t('admin.sessions.archiveFailure')
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
      const msg = err instanceof Error ? err.message : t('admin.sessions.purgeFailure')
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-primary) 15%, transparent)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--cm-primary)', display: 'inline-block' }} />
            {t('admin.sessions.statusActive')}
          </span>
        )
      case 'completed':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-success) 15%, transparent)', color: 'var(--cm-success)', border: '1px solid color-mix(in srgb, var(--cm-success) 30%, transparent)' }}>
            {t('admin.sessions.statusCompleted')}
          </span>
        )
      case 'archived':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'var(--cm-secondary)', color: 'var(--cm-muted-foreground)', border: '1px solid var(--cm-border)' }}>
            {t('admin.sessions.statusArchived')}
          </span>
        )
      case 'error':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-destructive) 15%, transparent)', color: 'var(--cm-destructive)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--cm-destructive)', display: 'inline-block' }} />
            {t('admin.common.error')}
          </span>
        )
      default:
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'var(--cm-secondary)', color: 'var(--cm-muted-foreground)', border: '1px solid var(--cm-border)' }}>
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

  const hasActiveFilters = Boolean(debouncedSearch || selectedTenant || selectedModel || selectedStatus || selectedPeriod !== 'all')

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', color: 'var(--cm-foreground)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--cm-border)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--cm-foreground)', margin: 0 }}>{t('admin.sessions.title')}</h2>
            <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-primary) 20%, transparent)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)' }}>
              {t('admin.sessions.totalBadge', { value: kpis?.total_sessions ?? totalCount })}
            </span>
            {kpis && (
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-success) 15%, transparent)', color: 'var(--cm-success)', border: '1px solid color-mix(in srgb, var(--cm-success) 30%, transparent)' }}>
                {t('admin.sessions.activeToday', { count: kpis.active_sessions })}
              </span>
            )}
          </div>
          <p style={{ fontSize: '13px', color: 'var(--cm-muted-foreground)', margin: '4px 0 0 0' }}>
            {t('admin.sessions.subtitle')}
          </p>
        </div>

        <button
          onClick={() => loadSessionsData(true)}
          disabled={isLoading || isRefreshing}
          title={t('admin.sessions.refreshAria')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 16px', background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', fontSize: '12px', fontWeight: 500, color: 'var(--cm-foreground)', cursor: 'pointer', opacity: isLoading || isRefreshing ? 0.5 : 1 }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--cm-muted-foreground)', animation: isRefreshing ? 'cm-auth-spin 0.8s linear infinite' : undefined }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>{isRefreshing ? t('admin.common.refreshing') : t('admin.common.refresh')}</span>
        </button>
      </div>

      {actionSuccess && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'color-mix(in srgb, var(--cm-success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-success) 30%, transparent)', color: 'var(--cm-success)' }}>
          <span>{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', opacity: 0.7, fontSize: '12px', lineHeight: 1, padding: '2px' }}>✕</button>
        </div>
      )}
      {actionError && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', color: 'var(--cm-destructive)' }}>
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', opacity: 0.7, fontSize: '12px', lineHeight: 1, padding: '2px' }}>✕</button>
        </div>
      )}

      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.sessions.total')}</div>
          <div className="adminCardValue">{kpis ? kpis.total_sessions.toLocaleString('pt-BR') : '-'}</div>
          <div className="adminCardSub">{t('admin.sessions.records')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.sessions.active')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>{kpis ? kpis.active_sessions.toLocaleString('pt-BR') : '-'}</div>
          <div className="adminCardSub">{t('admin.sessions.activeHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.sessions.completed')}</div>
          <div className="adminCardValue">{kpis ? kpis.completed_sessions.toLocaleString('pt-BR') : '-'}</div>
          <div className="adminCardSub">{t('admin.sessions.completedHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.sessions.archived')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-muted-foreground)' }}>{kpis ? kpis.archived_sessions.toLocaleString('pt-BR') : '-'}</div>
          <div className="adminCardSub">{t('admin.sessions.archived')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.sessions.tokensUsed')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>{kpis ? formatTokens(kpis.total_tokens) : '-'}</div>
          <div className="adminCardSub">{t('admin.sessions.tokensHint')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder={t('admin.sessions.searchPlaceholder')}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="adminInput"
          style={{ width: '240px', marginBottom: 0 }}
        />
        <select
          value={selectedTenant}
          onChange={(e) => {
            setSelectedTenant(e.target.value)
            setCurrentPage(1)
          }}
          className="adminInput"
          style={{ width: '200px', marginBottom: 0 }}
        >
          <option value="">{t('admin.common.allTenants')}</option>
          {tenants.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={selectedModel}
          onChange={(e) => {
            setSelectedModel(e.target.value)
            setCurrentPage(1)
          }}
          className="adminInput"
          style={{ width: '200px', marginBottom: 0 }}
        >
          <option value="">{t('admin.sessions.allModels')}</option>
          {availableModels.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => {
            setSelectedStatus(e.target.value)
            setCurrentPage(1)
          }}
          className="adminInput"
          style={{ width: '180px', marginBottom: 0 }}
        >
          <option value="">{t('admin.common.allStatuses')}</option>
          <option value="active">{t('admin.sessions.statusActive')}</option>
          <option value="completed">{t('admin.sessions.statusCompleted')}</option>
          <option value="archived">{t('admin.sessions.statusArchived')}</option>
          <option value="error">{t('admin.common.error')}</option>
        </select>
        <select
          value={selectedPeriod}
          onChange={e => setSelectedPeriod(e.target.value as 'all' | '7d' | '30d')}
          className="adminInput"
          style={{ width: '180px', marginBottom: 0 }}
        >
          <option value="all">{t('admin.sessions.allPeriods')}</option>
          <option value="7d">{t('admin.sessions.last7')}</option>
          <option value="30d">{t('admin.sessions.last30')}</option>
        </select>
        {hasActiveFilters && (
          <button
            onClick={() => {
              setSearchTerm('')
              setSelectedTenant('')
              setSelectedModel('')
              setSelectedStatus('')
              setSelectedPeriod('all')
              setCurrentPage(1)
            }}
            style={{ fontSize: '12px', color: 'var(--cm-primary)', cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline' }}
          >
            {t('admin.common.clearAllFilters')}
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontWeight: 600, margin: 0 }}>{t('admin.sessions.loadError')}</p>
            <p style={{ margin: '2px 0 0 0' }}>{error}</p>
          </div>
          <button
            onClick={() => loadSessionsData()}
            style={{ padding: '4px 12px', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 15%, transparent)', color: 'var(--cm-destructive)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
          >
            {t('admin.common.retry')}
          </button>
        </div>
      )}

      <div className="adminCard" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="adminTable">
            <thead>
              <tr>
                <th>{t('admin.sessions.session')}</th>
                <th>{t('admin.common.tenant')}</th>
                <th>{t('admin.common.user')}</th>
                <th>{t('admin.sessions.model')}</th>
                <th style={{ textAlign: 'right' }}>{t('admin.common.tokens')}</th>
                <th style={{ textAlign: 'center' }}>{t('admin.common.status')}</th>
                <th>{t('admin.sessions.createdAt')}</th>
                <th style={{ textAlign: 'right' }}>{t('admin.common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !isRefreshing ? (
                <tr>
                  <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: 'var(--cm-muted-foreground)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                      <div style={{ width: '24px', height: '24px', border: '2px solid var(--cm-primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'cm-auth-spin 0.8s linear infinite' }} />
                      <span style={{ fontSize: '12px' }}>{t('admin.sessions.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: 'var(--cm-muted-foreground)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--cm-foreground)', margin: 0 }}>{t('admin.sessions.empty')}</p>
                      <p style={{ fontSize: '12px', margin: 0 }}>
                        {debouncedSearch || selectedTenant || selectedModel || selectedStatus
                          ? t('admin.common.tryAdjustFilters')
                          : t('admin.sessions.emptyHint')}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                sessions.map(row => (
                  <tr key={row.session_id}>
                    <td style={{ maxWidth: '240px' }}>
                      <div style={{ fontWeight: 500, color: 'var(--cm-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.title}>
                        {row.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }} title={row.session_id}>
                          {row.session_id}
                        </span>
                        <button
                          onClick={() => handleCopyId(row.session_id)}
                          style={{ fontSize: '10px', color: 'var(--cm-muted-foreground)', cursor: 'pointer', background: 'none', border: 'none', whiteSpace: 'nowrap' }}
                          title={t('admin.sessions.copyIdAria')}
                        >
                          {copiedId === row.session_id ? `✓ ${t('admin.common.copied')}` : t('admin.common.copy')}
                        </button>
                      </div>
                    </td>

                    <td style={{ maxWidth: '160px' }}>
                      <div style={{ fontWeight: 500, color: 'var(--cm-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.tenant_name}>
                        {row.tenant_name}
                      </div>
                      <div style={{ color: 'var(--cm-muted-foreground)', fontSize: '11px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.tenant_slug}
                      </div>
                    </td>

                    <td style={{ maxWidth: '180px' }}>
                      <div style={{ fontWeight: 500, color: 'var(--cm-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.user_email}>
                        {row.user_full_name || row.user_email}
                      </div>
                      {row.user_full_name && (
                        <div style={{ color: 'var(--cm-muted-foreground)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.user_email}>
                          {row.user_email}
                        </div>
                      )}
                    </td>

                    <td>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', color: 'var(--cm-primary)' }}>
                        {row.model_used}
                      </span>
                    </td>

                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' }}>
                      {formatTokens(row.tokens_total)}
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      {getStatusBadge(row.status)}
                    </td>

                    <td style={{ color: 'var(--cm-muted-foreground)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      {formatDate(row.created_at)}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                        <button
                          onClick={() => setInspectingSession(row)}
                          style={{ padding: '4px 10px', borderRadius: '6px', background: 'var(--cm-card)', border: '1px solid var(--cm-border)', color: 'var(--cm-foreground)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
                          title={t('admin.sessions.inspectAria')}
                        >
                          {t('admin.common.details')}
                        </button>
                        {row.status !== 'archived' && (
                          <button
                            onClick={() => handleArchiveSession(row)}
                            disabled={isSubmittingAction}
                            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--cm-border)', background: 'transparent', color: 'var(--cm-muted-foreground)', cursor: 'pointer', fontSize: '12px', opacity: isSubmittingAction ? 0.5 : 1 }}
                            title={t('admin.sessions.archiveAria')}
                          >
                            {t('admin.sessions.archiveAction')}
                          </button>
                        )}
                        <button
                          onClick={() => setSessionToPurge(row)}
                          disabled={isSubmittingAction}
                          style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 25%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', cursor: 'pointer', fontSize: '12px', opacity: isSubmittingAction ? 0.5 : 1 }}
                          title={t('admin.sessions.purgeAria')}
                        >
                          {t('admin.sessions.purgeAction')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 16px', borderTop: '1px solid var(--cm-border)', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--cm-muted-foreground)' }}>
            <span>{t('admin.sessions.showingOf', { count: sessions.length, total: totalCount })}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{t('admin.common.rowsPerPage')}</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setCurrentPage(1)
                }}
                className="adminInput"
                style={{ width: '72px', height: '28px', marginBottom: 0, fontSize: '12px' }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--cm-muted-foreground)' }}>
              {t('admin.common.pageOf', { page: currentPage, total: totalPages })}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || isLoading}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', color: 'var(--cm-foreground)', cursor: 'pointer', opacity: (currentPage <= 1 || isLoading) ? 0.4 : 1, fontSize: '12px' }}
              >
                {t('admin.common.previous')}
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || isLoading}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', color: 'var(--cm-foreground)', cursor: 'pointer', opacity: (currentPage >= totalPages || isLoading) ? 0.4 : 1, fontSize: '12px' }}
              >
                {t('admin.common.next')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {inspectingSession && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{ position: 'absolute', inset: 0, background: 'var(--cm-overlay)', backdropFilter: 'blur(4px)' }}
            onClick={() => setInspectingSession(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setInspectingSession(null)
            }}
            style={{ position: 'relative', width: '100%', maxWidth: '640px', margin: '24px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '12px', padding: '24px', boxShadow: 'var(--cm-shadow)', maxHeight: '80vh', overflowY: 'auto', outline: 'none', color: 'var(--cm-foreground)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--cm-border)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--cm-primary)', display: 'inline-block' }} />
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>{t('admin.sessions.inspect')}</h3>
                {getStatusBadge(inspectingSession.status)}
              </div>
              <button
                onClick={() => setInspectingSession(null)}
                style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--cm-muted-foreground)', fontSize: '16px' }}
                title={t('admin.common.close')}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px' }}>
              <div>
                <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', marginBottom: '4px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('admin.sessions.sessionTitle')}</span>
                <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--cm-foreground)' }}>{inspectingSession.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '12px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', padding: '2px 8px', borderRadius: '4px', color: 'var(--cm-primary)' }}>
                    {inspectingSession.session_id}
                  </span>
                  <button
                    onClick={() => handleCopyId(inspectingSession.session_id)}
                    style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', cursor: 'pointer', background: 'none', border: 'none' }}
                  >
                    {copiedId === inspectingSession.session_id ? `✓ ${t('admin.common.copied')}` : t('admin.common.copyId')}
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', padding: '16px', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.common.tenant')}</span>
                  <span style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{inspectingSession.tenant_name}</span>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--cm-muted-foreground)', display: 'block', marginTop: '2px' }}>{inspectingSession.tenant_slug}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.common.user')}</span>
                  <span style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{inspectingSession.user_full_name || inspectingSession.user_email}</span>
                  <span style={{ fontSize: '11px', color: 'var(--cm-muted-foreground)', display: 'block', marginTop: '2px' }}>{inspectingSession.user_email}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.sessions.modelUsed')}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--cm-primary)', marginTop: '2px', display: 'inline-block' }}>
                    {inspectingSession.model_used}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.sessions.tokensRecorded')}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--cm-foreground)', marginTop: '2px', display: 'inline-block' }}>
                    {inspectingSession.tokens_total.toLocaleString('pt-BR')} ({formatTokens(inspectingSession.tokens_total)})
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.sessions.createdAt')}</span>
                  <span style={{ fontSize: '12px', color: 'var(--cm-foreground)' }}>{formatDate(inspectingSession.created_at)}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.sessions.lastUpdated')}</span>
                  <span style={{ fontSize: '12px', color: 'var(--cm-foreground)' }}>{formatDate(inspectingSession.updated_at)}</span>
                </div>
              </div>

              <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-primary) 40%, transparent)', background: 'var(--cm-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--cm-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--cm-primary)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {t('admin.sessions.transcriptTitle')}
                </div>
                <p style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', lineHeight: 1.6, margin: '8px 0 0 0' }}>
                  {t('admin.sessions.transcriptBody')}
                  {t('admin.sessions.transcriptHint')}
                </p>
                <div style={{ padding: '10px', borderRadius: '8px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <code style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--cm-primary)', wordBreak: 'break-all', userSelect: 'all' }}>
                    {sshTranscriptCommand}
                  </code>
                  <button
                    onClick={() => handleCopyCommand(sshTranscriptCommand)}
                    style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', color: 'var(--cm-foreground)', cursor: 'pointer', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap' }}
                  >
                    {copiedCommand ? `✓ ${t('admin.common.copied')}` : t('admin.common.copy')}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--cm-border)' }}>
                <button
                  onClick={() => handleCopyId(inspectingSession.session_id)}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '32px', padding: '0 16px', background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-foreground)', cursor: 'pointer', fontSize: '13px' }}
                >
                  {copiedId === inspectingSession.session_id ? `✓ ${t('admin.common.copied')}` : t('admin.common.copyId')}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {inspectingSession.status !== 'archived' && (
                    <button
                      onClick={() => handleArchiveSession(inspectingSession)}
                      disabled={isSubmittingAction}
                      style={{ height: '32px', padding: '0 16px', background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-muted-foreground)', cursor: 'pointer', fontSize: '13px', opacity: isSubmittingAction ? 0.5 : 1 }}
                    >
                      {t('admin.sessions.archiveAction')}
                    </button>
                  )}
                  <button
                    onClick={() => setSessionToPurge(inspectingSession)}
                    disabled={isSubmittingAction}
                    style={{ height: '32px', padding: '0 16px', background: 'var(--cm-destructive)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, opacity: isSubmittingAction ? 0.5 : 1 }}
                  >
                    {t('admin.sessions.purgeSession')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {sessionToPurge && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{ position: 'absolute', inset: 0, background: 'var(--cm-overlay)', backdropFilter: 'blur(4px)' }}
            onClick={() => setSessionToPurge(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSessionToPurge(null)
            }}
            style={{ position: 'relative', width: '100%', maxWidth: '520px', margin: '24px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '12px', padding: '24px', boxShadow: 'var(--cm-shadow)', maxHeight: '80vh', overflowY: 'auto', outline: 'none', color: 'var(--cm-foreground)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--cm-destructive)', marginBottom: '16px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'color-mix(in srgb, var(--cm-destructive) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
                !
              </div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>{t('admin.sessions.purgeTitle')}</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '12px' }}>
              <p style={{ color: 'var(--cm-muted-foreground)', margin: 0, lineHeight: 1.6 }}>
                {t('admin.sessions.purgeIntro')}{' '}
                <strong style={{ color: 'var(--cm-foreground)' }}>"{sessionToPurge.title}"</strong> ({sessionToPurge.session_id}).
              </p>

              <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)' }}>
                <p style={{ fontWeight: 600, margin: 0 }}>{t('admin.sessions.governance')}</p>
                <p style={{ margin: '4px 0 0 0', opacity: 0.9 }}>
                  {t('admin.sessions.purgeGovernance')}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
                <button
                  onClick={() => setSessionToPurge(null)}
                  disabled={isSubmittingAction}
                  style={{ height: '32px', padding: '0 16px', background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-muted-foreground)', cursor: 'pointer', fontSize: '13px', opacity: isSubmittingAction ? 0.5 : 1 }}
                >
                  {t('admin.common.cancelAction')}
                </button>
                <button
                  onClick={handleConfirmPurge}
                  disabled={isSubmittingAction}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '32px', padding: '0 16px', background: 'var(--cm-destructive)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, opacity: isSubmittingAction ? 0.5 : 1 }}
                >
                  {isSubmittingAction && <span style={{ width: '14px', height: '14px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'cm-auth-spin 0.8s linear infinite' }} />}
                  <span>{isSubmittingAction ? t('admin.sessions.purging') : t('admin.sessions.confirmPurge')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
