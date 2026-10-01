import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'

export interface SystemConfigItem {
  key: string
  value: any
  description: string | null
  is_secret: boolean
  updated_at: string
  updated_by: string | null
  updated_by_email: string | null
}

export interface WorkspaceItem {
  id: string
  workspace_id: string
  title: string
  relative_path: string
  tenant_id: string
  tenant_name: string
  user_id: string
  user_email: string | null
  created_at: string
  updated_at: string
}

export function AdminSystemTab() {
  const [configs, setConfigs] = useState<SystemConfigItem[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [flagSearchQuery, setFlagSearchQuery] = useState<string>('')
  const [limitSearchQuery, setLimitSearchQuery] = useState<string>('')
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState<string>('')

  // Modais
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false)
  const [isDeleteConfigModalOpen, setIsDeleteConfigModalOpen] = useState<boolean>(false)
  const [isArchiveWorkspaceModalOpen, setIsArchiveWorkspaceModalOpen] = useState<boolean>(false)

  // Item selecionado para edição/exclusão
  const [selectedConfig, setSelectedConfig] = useState<SystemConfigItem | null>(null)
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceItem | null>(null)

  // Campos do formulário de config
  const [formKey, setFormKey] = useState<string>('')
  const [formValueStr, setFormValueStr] = useState<string>('')
  const [formDescription, setFormDescription] = useState<string>('')
  const [formPrefixType, setFormPrefixType] = useState<'feature' | 'limit' | 'quota' | 'other'>('feature')
  const [formError, setFormError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState<boolean>(false)

  // Carregar dados
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true)
    setError(null)
    try {
      const [configsRes, workspacesRes] = await Promise.all([
        (supabase.rpc as any)('get_admin_system_config'),
        (supabase.rpc as any)('get_admin_workspaces'),
      ])

      if (configsRes.error) throw new Error(configsRes.error.message)
      if (workspacesRes.error) throw new Error(workspacesRes.error.message)

      setConfigs((configsRes.data as SystemConfigItem[]) || [])
      setWorkspaces((workspacesRes.data as WorkspaceItem[]) || [])
    } catch (err: any) {
      console.error('Erro ao carregar configurações do sistema:', err)
      setError(err?.message || 'Falha ao buscar configurações do sistema e workspaces.')
    } finally {
      if (!isSilent) setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleRefresh = () => {
    setIsRefreshing(true)
    loadData(true)
  }

  // Segmentação de configs
  const featureFlags = useMemo(() => {
    return configs.filter((c) => c.key.startsWith('feature.'))
  }, [configs])

  const limitConfigs = useMemo(() => {
    return configs.filter((c) => c.key.startsWith('limit.') || c.key.startsWith('quota.'))
  }, [configs])

  // KPIs
  const totalConfigs = configs.length
  const activeFlagsCount = useMemo(() => {
    return featureFlags.filter((f) => {
      if (typeof f.value === 'boolean') return f.value
      if (f.value && typeof f.value === 'object' && 'enabled' in f.value) {
        return Boolean(f.value.enabled)
      }
      return false
    }).length
  }, [featureFlags])
  const totalLimitsCount = limitConfigs.length
  const totalWorkspacesCount = workspaces.length

  // Mascaramento da Supabase URL
  const maskedSupabaseUrl = useMemo(() => {
    const rawUrl = (import.meta as any).env?.VITE_SUPABASE_URL || ''
    if (!rawUrl) return 'Não configurada'
    try {
      const url = new URL(rawUrl)
      return `${url.protocol}//${url.hostname.slice(0, 8)}...${url.hostname.slice(-8)}`
    } catch {
      return 'https://***.supabase.co'
    }
  }, [])

  // Modais de Criação / Edição de Config
  const openCreateConfigModal = (type: 'feature' | 'limit' | 'quota') => {
    setSelectedConfig(null)
    setFormPrefixType(type)
    setFormKey(type === 'feature' ? 'feature.' : type === 'limit' ? 'limit.' : 'quota.')
    setFormValueStr(type === 'feature' ? '{"enabled": true}' : '1000')
    setFormDescription('')
    setFormError(null)
    setIsConfigModalOpen(true)
  }

  const openEditConfigModal = (item: SystemConfigItem) => {
    if (item.is_secret || item.key === 'LLM_ENCRYPTION_KEY' || item.key.startsWith('system.')) {
      alert('Esta chave é protegida pelo sistema e não pode ser editada via painel.')
      return
    }
    setSelectedConfig(item)
    setFormKey(item.key)
    setFormValueStr(
      typeof item.value === 'object' ? JSON.stringify(item.value, null, 2) : String(item.value)
    )
    setFormDescription(item.description || '')
    setFormError(null)
    setIsConfigModalOpen(true)
  }

  const openDeleteConfigModal = (item: SystemConfigItem) => {
    if (item.is_secret || item.key === 'LLM_ENCRYPTION_KEY' || item.key.startsWith('system.')) {
      alert('Chaves reservadas do sistema não podem ser excluídas.')
      return
    }
    setSelectedConfig(item)
    setFormError(null)
    setIsDeleteConfigModalOpen(true)
  }

  const openArchiveWorkspaceModal = (ws: WorkspaceItem) => {
    setSelectedWorkspace(ws)
    setFormError(null)
    setIsArchiveWorkspaceModalOpen(true)
  }

  const closeModals = () => {
    if (isMutating) return
    setIsConfigModalOpen(false)
    setIsDeleteConfigModalOpen(false)
    setIsArchiveWorkspaceModalOpen(false)
    setSelectedConfig(null)
    setSelectedWorkspace(null)
    setFormError(null)
  }

  // Toggle direto de Feature Flag booleana
  const handleToggleFeatureFlag = async (item: SystemConfigItem) => {
    if (item.is_secret || item.key.startsWith('system.')) return

    let nextValue: any
    if (typeof item.value === 'boolean') {
      nextValue = !item.value
    } else if (item.value && typeof item.value === 'object' && 'enabled' in item.value) {
      nextValue = { ...item.value, enabled: !item.value.enabled }
    } else {
      openEditConfigModal(item)
      return
    }

    try {
      const { error: saveErr } = await (supabase.rpc as any)('admin_upsert_system_config', {
        p_key: item.key,
        p_value: nextValue,
        p_description: item.description,
        p_is_secret: false,
      })
      if (saveErr) throw new Error(saveErr.message)
      loadData(true)
    } catch (err: any) {
      alert(err?.message || 'Erro ao alterar feature flag.')
    }
  }

  // Salvar Config (Create / Update)
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const key = formKey.trim()
    if (!key) {
      setFormError('A chave é obrigatória.')
      return
    }
    if (key === 'LLM_ENCRYPTION_KEY' || key.startsWith('system.')) {
      setFormError('Chaves reservadas do sistema não podem ser alteradas pelo painel.')
      return
    }

    // Parse do valor
    let parsedValue: any
    try {
      parsedValue = JSON.parse(formValueStr)
    } catch {
      // Se não for JSON válido, salvar como string pura caso não seja objeto requerido
      parsedValue = formValueStr
    }

    setIsMutating(true)
    try {
      const { error: saveErr } = await (supabase.rpc as any)('admin_upsert_system_config', {
        p_key: key,
        p_value: parsedValue,
        p_description: formDescription.trim() || null,
        p_is_secret: false,
      })
      if (saveErr) throw new Error(saveErr.message)

      closeModals()
      loadData(true)
    } catch (err: any) {
      console.error('Erro ao salvar configuração:', err)
      setFormError(err?.message || 'Falha ao salvar configuração.')
    } finally {
      setIsMutating(false)
    }
  }

  // Deletar Config
  const handleDeleteConfig = async () => {
    if (!selectedConfig) return
    setIsMutating(true)
    setFormError(null)
    try {
      const { error: delErr } = await (supabase.rpc as any)('admin_delete_system_config', {
        p_key: selectedConfig.key,
      })
      if (delErr) throw new Error(delErr.message)

      closeModals()
      loadData(true)
    } catch (err: any) {
      console.error('Erro ao excluir chave:', err)
      setFormError(err?.message || 'Falha ao excluir chave do sistema.')
    } finally {
      setIsMutating(false)
    }
  }

  // Arquivar Workspace (Soft Delete)
  const handleArchiveWorkspace = async () => {
    if (!selectedWorkspace) return
    setIsMutating(true)
    setFormError(null)
    try {
      const { error: archErr } = await (supabase.rpc as any)('admin_delete_workspace', {
        p_id: selectedWorkspace.id,
      })
      if (archErr) throw new Error(archErr.message)

      closeModals()
      loadData(true)
    } catch (err: any) {
      console.error('Erro ao arquivar workspace:', err)
      setFormError(err?.message || 'Falha ao arquivar workspace.')
    } finally {
      setIsMutating(false)
    }
  }

  // Filtros aplicados
  const filteredFlags = useMemo(() => {
    const q = flagSearchQuery.toLowerCase().trim()
    if (!q) return featureFlags
    return featureFlags.filter(
      (f) => f.key.toLowerCase().includes(q) || (f.description && f.description.toLowerCase().includes(q))
    )
  }, [featureFlags, flagSearchQuery])

  const filteredLimits = useMemo(() => {
    const q = limitSearchQuery.toLowerCase().trim()
    if (!q) return limitConfigs
    return limitConfigs.filter(
      (l) => l.key.toLowerCase().includes(q) || (l.description && l.description.toLowerCase().includes(q))
    )
  }, [limitConfigs, limitSearchQuery])

  const filteredWorkspaces = useMemo(() => {
    const q = workspaceSearchQuery.toLowerCase().trim()
    if (!q) return workspaces
    return workspaces.filter(
      (w) =>
        w.title.toLowerCase().includes(q) ||
        w.workspace_id.toLowerCase().includes(q) ||
        w.tenant_name.toLowerCase().includes(q) ||
        (w.user_email && w.user_email.toLowerCase().includes(q))
    )
  }, [workspaces, workspaceSearchQuery])

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#30363d]">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[#f0f6fc]">Configurações do Sistema</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#e7bf73]/10 text-[#e7bf73] border border-[#e7bf73]/30">
              Ambiente Operacional
            </span>
          </div>
          <p className="text-xs text-[#8b949e] mt-1">
            Parâmetros globais do servidor, feature flags ativas, cotas e gerenciamento de workspaces multi-tenant.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#30363d] bg-[#161b22] text-xs font-medium text-[#c9d1d9] hover:text-[#f0f6fc] hover:border-[#8b949e] transition disabled:opacity-50"
        >
          <span className={isRefreshing ? 'animate-spin' : ''}>↻</span>
          Atualizar
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <div className="text-xs text-[#8b949e]">Total Parâmetros</div>
          <div className="text-xl font-bold text-[#f0f6fc] mt-1">{totalConfigs}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <div className="text-xs text-[#8b949e]">Feature Flags Ativas</div>
          <div className="text-xl font-bold text-[#e7bf73] mt-1">{activeFlagsCount}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <div className="text-xs text-[#8b949e]">Limites & Cotas</div>
          <div className="text-xl font-bold text-[#f0f6fc] mt-1">{totalLimitsCount}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <div className="text-xs text-[#8b949e]">Workspaces Ativos</div>
          <div className="text-xl font-bold text-[#c9d1d9] mt-1">{totalWorkspacesCount}</div>
        </div>
      </div>

      {/* Estado Geral de Erro */}
      {error && (
        <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => loadData()}
            className="underline hover:text-red-300 ml-4 font-medium"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Seção 1 — Ambiente & Sistema */}
      <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[#e7bf73] text-sm">🖥</span>
            <h3 className="text-sm font-semibold text-[#f0f6fc]">Ambiente & Servidor</h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#0d1117] text-[#8b949e] border border-[#30363d]">
            DSH Web Frontend
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs">
          <div className="p-3 rounded-lg border border-[#30363d]/60 bg-[#0d1117]/60">
            <span className="text-[#8b949e] block text-[11px]">Modo de Execução</span>
            <span className="font-mono text-[#f0f6fc] font-medium mt-1 inline-block">
              {(import.meta as any).env?.MODE || 'production'}
            </span>
          </div>
          <div className="p-3 rounded-lg border border-[#30363d]/60 bg-[#0d1117]/60">
            <span className="text-[#8b949e] block text-[11px]">Endpoint Supabase</span>
            <span className="font-mono text-[#f0f6fc] font-medium mt-1 inline-block">
              {maskedSupabaseUrl}
            </span>
          </div>
          <div className="p-3 rounded-lg border border-[#30363d]/60 bg-[#0d1117]/60">
            <span className="text-[#8b949e] block text-[11px]">Raiz de Instalação no Host</span>
            <span className="text-amber-400/90 font-medium mt-1 inline-block">
              Não exposta por razões de segurança
            </span>
          </div>
        </div>
      </div>

      {/* Seção 2 — Feature Flags */}
      <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[#e7bf73] text-sm">🚩</span>
              <h3 className="text-sm font-semibold text-[#f0f6fc]">Feature Flags</h3>
            </div>
            <p className="text-xs text-[#8b949e] mt-0.5">
              Habilitação gradual e controle dinâmico de funcionalidades (<code className="text-[#e7bf73]">feature.*</code>).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={flagSearchQuery}
              onChange={(e) => setFlagSearchQuery(e.target.value)}
              placeholder="Buscar flag..."
              className="px-2.5 py-1 rounded-lg border border-[#30363d] bg-[#0d1117] text-xs text-[#f0f6fc] placeholder-[#8b949e]/50 focus:border-[#e7bf73] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => openCreateConfigModal('feature')}
              className="px-3 py-1 rounded-lg bg-gradient-to-r from-[#e7bf73] to-[#d8ae5f] text-xs font-semibold text-[#0d1117] hover:brightness-105 transition"
            >
              + Nova Flag
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 text-center text-xs text-[#8b949e]">
            <span className="inline-block animate-spin mr-2">↻</span> Carregando feature flags...
          </div>
        ) : filteredFlags.length === 0 ? (
          <div className="p-6 text-center rounded-lg border border-dashed border-[#30363d] bg-[#0d1117]/30 text-xs text-[#8b949e]">
            Nenhuma feature flag cadastrada no momento.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#30363d]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#30363d] bg-[#0d1117]/60 text-[#8b949e]">
                  <th className="py-2.5 px-3 font-medium">Chave</th>
                  <th className="py-2.5 px-3 font-medium">Valor / Estado</th>
                  <th className="py-2.5 px-3 font-medium">Descrição</th>
                  <th className="py-2.5 px-3 font-medium">Atualizado em</th>
                  <th className="py-2.5 px-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]/60">
                {filteredFlags.map((item) => {
                  const isBool = typeof item.value === 'boolean'
                  const isEnabledObj =
                    item.value && typeof item.value === 'object' && 'enabled' in item.value
                  const isActive = isBool ? item.value : isEnabledObj ? Boolean(item.value.enabled) : false
                  const canQuickToggle = isBool || isEnabledObj

                  return (
                    <tr key={item.key} className="hover:bg-[#0d1117]/30 transition">
                      <td className="py-2.5 px-3 font-mono font-medium text-[#f0f6fc]">
                        {item.key}
                      </td>
                      <td className="py-2.5 px-3">
                        {canQuickToggle ? (
                          <button
                            type="button"
                            onClick={() => handleToggleFeatureFlag(item)}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                              isActive
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : 'bg-[#30363d]/50 text-[#8b949e] border border-[#30363d]'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-[#8b949e]'}`} />
                            {isActive ? 'Ativa' : 'Inativa'}
                          </button>
                        ) : (
                          <span className="font-mono text-[11px] text-[#c9d1d9] truncate max-w-[200px] inline-block">
                            {JSON.stringify(item.value)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-[#8b949e] max-w-xs truncate">
                        {item.description || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-[#8b949e] whitespace-nowrap">
                        {new Date(item.updated_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditConfigModal(item)}
                            className="px-2 py-0.5 rounded border border-[#30363d] bg-[#0d1117] text-[#c9d1d9] hover:text-[#f0f6fc] hover:border-[#8b949e] text-[11px] transition"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteConfigModal(item)}
                            className="px-2 py-0.5 rounded border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-[11px] transition"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Seção 3 — Limites Globais & Cotas */}
      <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[#e7bf73] text-sm">⚖️</span>
              <h3 className="text-sm font-semibold text-[#f0f6fc]">Limites Globais & Cotas</h3>
            </div>
            <p className="text-xs text-[#8b949e] mt-0.5">
              Políticas de consumo, rate-limits e restrições operacionais (<code className="text-[#e7bf73]">limit.*</code> e <code className="text-[#e7bf73]">quota.*</code>).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={limitSearchQuery}
              onChange={(e) => setLimitSearchQuery(e.target.value)}
              placeholder="Buscar limite..."
              className="px-2.5 py-1 rounded-lg border border-[#30363d] bg-[#0d1117] text-xs text-[#f0f6fc] placeholder-[#8b949e]/50 focus:border-[#e7bf73] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => openCreateConfigModal('limit')}
              className="px-3 py-1 rounded-lg bg-gradient-to-r from-[#e7bf73] to-[#d8ae5f] text-xs font-semibold text-[#0d1117] hover:brightness-105 transition"
            >
              + Novo Limite
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 text-center text-xs text-[#8b949e]">
            <span className="inline-block animate-spin mr-2">↻</span> Carregando limites...
          </div>
        ) : filteredLimits.length === 0 ? (
          <div className="p-6 text-center rounded-lg border border-dashed border-[#30363d] bg-[#0d1117]/30 text-xs text-[#8b949e]">
            Nenhum limite ou cota global configurado.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#30363d]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#30363d] bg-[#0d1117]/60 text-[#8b949e]">
                  <th className="py-2.5 px-3 font-medium">Chave</th>
                  <th className="py-2.5 px-3 font-medium">Valor</th>
                  <th className="py-2.5 px-3 font-medium">Descrição</th>
                  <th className="py-2.5 px-3 font-medium">Atualizado em</th>
                  <th className="py-2.5 px-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]/60">
                {filteredLimits.map((item) => (
                  <tr key={item.key} className="hover:bg-[#0d1117]/30 transition">
                    <td className="py-2.5 px-3 font-mono font-medium text-[#f0f6fc]">
                      {item.key}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-mono text-[11px] text-[#e7bf73] font-semibold bg-[#e7bf73]/10 px-2 py-0.5 rounded border border-[#e7bf73]/20">
                        {typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[#8b949e] max-w-xs truncate">
                      {item.description || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-[#8b949e] whitespace-nowrap">
                      {new Date(item.updated_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditConfigModal(item)}
                          className="px-2 py-0.5 rounded border border-[#30363d] bg-[#0d1117] text-[#c9d1d9] hover:text-[#f0f6fc] hover:border-[#8b949e] text-[11px] transition"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteConfigModal(item)}
                          className="px-2 py-0.5 rounded border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-[11px] transition"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Seção 4 — Workspaces Multi-tenant */}
      <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[#e7bf73] text-sm">📁</span>
              <h3 className="text-sm font-semibold text-[#f0f6fc]">Workspaces Multi-tenant</h3>
            </div>
            <p className="text-xs text-[#8b949e] mt-0.5">
              Metadados de ambientes de trabalho isolados por tenant e usuário.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={workspaceSearchQuery}
              onChange={(e) => setWorkspaceSearchQuery(e.target.value)}
              placeholder="Buscar workspace ou tenant..."
              className="px-2.5 py-1 rounded-lg border border-[#30363d] bg-[#0d1117] text-xs text-[#f0f6fc] placeholder-[#8b949e]/50 focus:border-[#e7bf73] focus:outline-none"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 text-center text-xs text-[#8b949e]">
            <span className="inline-block animate-spin mr-2">↻</span> Carregando workspaces...
          </div>
        ) : filteredWorkspaces.length === 0 ? (
          <div className="p-6 text-center rounded-lg border border-dashed border-[#30363d] bg-[#0d1117]/30 text-xs text-[#8b949e]">
            Nenhum workspace ativo encontrado.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#30363d]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#30363d] bg-[#0d1117]/60 text-[#8b949e]">
                  <th className="py-2.5 px-3 font-medium">Título</th>
                  <th className="py-2.5 px-3 font-medium">Workspace ID</th>
                  <th className="py-2.5 px-3 font-medium">Tenant</th>
                  <th className="py-2.5 px-3 font-medium">Proprietário</th>
                  <th className="py-2.5 px-3 font-medium">Caminho Relativo</th>
                  <th className="py-2.5 px-3 font-medium">Criado em</th>
                  <th className="py-2.5 px-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]/60">
                {filteredWorkspaces.map((ws) => (
                  <tr key={ws.id} className="hover:bg-[#0d1117]/30 transition">
                    <td className="py-2.5 px-3 font-medium text-[#f0f6fc]">
                      {ws.title}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-[#c9d1d9]">
                      {ws.workspace_id}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-[#30363d]/50 text-[#f0f6fc] border border-[#30363d]">
                        {ws.tenant_name}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[#8b949e]">
                      {ws.user_email || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-[#8b949e] max-w-xs truncate">
                      {ws.relative_path}
                    </td>
                    <td className="py-2.5 px-3 text-[#8b949e] whitespace-nowrap">
                      {new Date(ws.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => openArchiveWorkspaceModal(ws)}
                        className="px-2.5 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-[11px] font-medium transition"
                      >
                        Arquivar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal 1: Criar / Editar Configuração (Padrão Settings) */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#0d1117]/80 backdrop-blur-sm" onClick={closeModals} />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={(el) => el?.focus()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isMutating) {
                e.stopPropagation()
                e.nativeEvent?.stopImmediatePropagation?.()
                closeModals()
              }
            }}
            className="relative z-10 w-full max-w-lg rounded-2xl border border-[#e7bf73]/25 bg-[#161b22] p-6 shadow-2xl space-y-4 focus:outline-none"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#30363d]">
              <h3 className="text-sm font-semibold text-[#f0f6fc]">
                {selectedConfig ? 'Editar Parâmetro' : `Novo Parâmetro (${formPrefixType})`}
              </h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="text-[#8b949e] hover:text-[#f0f6fc] p-1 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-[#8b949e] font-medium">Chave do Parâmetro *</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(selectedConfig) || isMutating}
                  value={formKey}
                  onChange={(e) => setFormKey(e.target.value)}
                  placeholder="Ex: feature.export_pdf, limit.max_tokens..."
                  className="w-full px-3 py-2 rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] font-mono focus:border-[#e7bf73] focus:outline-none disabled:opacity-60"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[#8b949e] font-medium">Valor (JSON ou Primitivo) *</label>
                <textarea
                  rows={4}
                  required
                  disabled={isMutating}
                  value={formValueStr}
                  onChange={(e) => setFormValueStr(e.target.value)}
                  placeholder='Ex: {"enabled": true} ou 1000'
                  className="w-full px-3 py-2 rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] font-mono focus:border-[#e7bf73] focus:outline-none"
                />
                <span className="text-[10px] text-[#8b949e]">
                  Dica: Para feature flags simples, utilize <code>{"{\"enabled\": true}"}</code> ou <code>true</code>.
                </span>
              </div>

              <div className="space-y-1">
                <label className="text-[#8b949e] font-medium">Descrição do Impacto</label>
                <input
                  type="text"
                  disabled={isMutating}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Finalidade ou documento de referência deste parâmetro"
                  className="w-full px-3 py-2 rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] focus:border-[#e7bf73] focus:outline-none"
                />
              </div>

              {formError && (
                <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-400">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#30363d]">
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  className="px-3.5 py-1.5 rounded-lg border border-[#30363d] text-[#c9d1d9] hover:text-[#f0f6fc] hover:border-[#8b949e] transition font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isMutating}
                  className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#e7bf73] to-[#d8ae5f] text-[#0d1117] font-semibold hover:brightness-105 transition disabled:opacity-50"
                >
                  {isMutating ? 'Salvando...' : 'Salvar Parâmetro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Confirmação de Exclusão de Parâmetro */}
      {isDeleteConfigModalOpen && selectedConfig && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#0d1117]/80 backdrop-blur-sm" onClick={closeModals} />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={(el) => el?.focus()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isMutating) {
                e.stopPropagation()
                e.nativeEvent?.stopImmediatePropagation?.()
                closeModals()
              }
            }}
            className="relative z-10 w-full max-w-md rounded-2xl border border-red-500/30 bg-[#161b22] p-6 shadow-2xl space-y-4 focus:outline-none"
          >
            <div className="flex items-center gap-3 text-red-400">
              <span className="text-xl">⚠️</span>
              <h3 className="text-sm font-semibold text-[#f0f6fc]">Excluir Parâmetro</h3>
            </div>

            <p className="text-xs text-[#8b949e]">
              Tem certeza de que deseja excluir a chave{' '}
              <strong className="text-[#f0f6fc] font-mono">{selectedConfig.key}</strong>?
            </p>

            {formError && (
              <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-400">
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#30363d]">
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="px-3.5 py-1.5 rounded-lg border border-[#30363d] text-[#c9d1d9] hover:text-[#f0f6fc] hover:border-[#8b949e] transition text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteConfig}
                disabled={isMutating}
                className="px-4 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 transition text-xs font-semibold disabled:opacity-50"
              >
                {isMutating ? 'Excluindo...' : 'Confirmar Exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Confirmação de Arquivamento de Workspace (Soft Delete) */}
      {isArchiveWorkspaceModalOpen && selectedWorkspace && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#0d1117]/80 backdrop-blur-sm" onClick={closeModals} />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={(el) => el?.focus()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isMutating) {
                e.stopPropagation()
                e.nativeEvent?.stopImmediatePropagation?.()
                closeModals()
              }
            }}
            className="relative z-10 w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#161b22] p-6 shadow-2xl space-y-4 focus:outline-none"
          >
            <div className="flex items-center gap-3 text-amber-400">
              <span className="text-xl">📁</span>
              <h3 className="text-sm font-semibold text-[#f0f6fc]">Arquivar Workspace</h3>
            </div>

            <p className="text-xs text-[#8b949e]">
              Deseja arquivar o workspace <strong className="text-[#f0f6fc]">{selectedWorkspace.title}</strong> (
              <span className="font-mono text-[#c9d1d9]">{selectedWorkspace.workspace_id}</span>) do tenant{' '}
              <strong className="text-[#f0f6fc]">{selectedWorkspace.tenant_name}</strong>?
            </p>

            <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300">
              <strong>Nota de Segurança:</strong> Esta ação realiza um arquivamento lógico (soft delete). A pasta física de arquivos no servidor <strong>NÃO</strong> é excluída.
            </div>

            {formError && (
              <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-400">
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#30363d]">
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="px-3.5 py-1.5 rounded-lg border border-[#30363d] text-[#c9d1d9] hover:text-[#f0f6fc] hover:border-[#8b949e] transition text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleArchiveWorkspace}
                disabled={isMutating}
                className="px-4 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition text-xs font-semibold disabled:opacity-50"
              >
                {isMutating ? 'Arquivando...' : 'Confirmar Arquivamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
