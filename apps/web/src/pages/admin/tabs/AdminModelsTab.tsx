import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'

export interface LLMModel {
  id: string
  provider_id: string
  provider_name: string
  provider_type: string
  provider_is_active: boolean
  model_id: string
  display_name: string
  context_window: number
  cost_input_1k: number
  cost_output_1k: number
  capabilities: {
    chat?: boolean
    vision?: boolean
    tools?: boolean
    reasoning?: boolean
    streaming?: boolean
    [key: string]: boolean | undefined
  }
  is_default_for_plans: string[]
  allowed_plans: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SimpleProvider {
  id: string
  name: string
  provider_type: string
  is_active: boolean
}

const ALL_PLANS = [
  { id: 'starter', label: 'Starter' },
  { id: 'pro', label: 'Pro' },
  { id: 'legend', label: 'Legend' },
]

const CAPABILITY_OPTIONS = [
  { id: 'chat', label: 'Chat' },
  { id: 'vision', label: 'Vision' },
  { id: 'tools', label: 'Tools' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'streaming', label: 'Streaming' },
]

export function AdminModelsTab() {
  const [models, setModels] = useState<LLMModel[]>([])
  const [providers, setProviders] = useState<SimpleProvider[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>('all')
  const [selectedPlanFilter, setSelectedPlanFilter] = useState<string>('all')
  const [selectedCapabilityFilter, setSelectedCapabilityFilter] = useState<string>('all')

  // Modais
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false)
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null)

  // Formulário Modal Criação / Edição
  const [formProviderId, setFormProviderId] = useState<string>('')
  const [formDisplayName, setFormDisplayName] = useState<string>('')
  const [formModelId, setFormModelId] = useState<string>('')
  const [formContextWindow, setFormContextWindow] = useState<number>(8192)
  const [formCostInput, setFormCostInput] = useState<string>('0.000000')
  const [formCostOutput, setFormCostOutput] = useState<string>('0.000000')
  const [formCapabilities, setFormCapabilities] = useState<{ [key: string]: boolean }>({
    chat: true,
    vision: false,
    tools: true,
    reasoning: false,
    streaming: true,
  })
  const [formAllowedPlans, setFormAllowedPlans] = useState<string[]>(['starter', 'pro', 'legend'])
  const [formDefaultForPlans, setFormDefaultForPlans] = useState<string[]>([])
  const [formIsActive, setFormIsActive] = useState<boolean>(true)

  const [formError, setFormError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState<boolean>(false)

  // Carregar dados
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true)
    setError(null)
    try {
      const [modelsRes, providersRes] = await Promise.all([
        (supabase.rpc as any)('get_admin_llm_models'),
        (supabase.rpc as any)('get_admin_llm_providers'),
      ])

      if (modelsRes.error) throw new Error(modelsRes.error.message)
      if (providersRes.error) throw new Error(providersRes.error.message)

      setModels((modelsRes.data as LLMModel[]) || [])
      setProviders(
        ((providersRes.data as any[]) || []).map(p => ({
          id: p.id,
          name: p.name,
          provider_type: p.provider_type,
          is_active: p.is_active,
        })),
      )
    } catch (err: any) {
      console.error('Error ao carregar dados de modelos:', err)
      setError(err?.message || 'Falha ao buscar catálogo de modelos.')
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

  // Abertura de Modal de Edição / Criação
  const openCreateModal = () => {
    setSelectedModel(null)
    setFormProviderId(providers[0]?.id || '')
    setFormDisplayName('')
    setFormModelId('')
    setFormContextWindow(8192)
    setFormCostInput('0.000000')
    setFormCostOutput('0.000000')
    setFormCapabilities({
      chat: true,
      vision: false,
      tools: true,
      reasoning: false,
      streaming: true,
    })
    setFormAllowedPlans(['starter', 'pro', 'legend'])
    setFormDefaultForPlans([])
    setFormIsActive(true)
    setFormError(null)
    setIsEditModalOpen(true)
  }

  const openEditModal = (model: LLMModel) => {
    setSelectedModel(model)
    setFormProviderId(model.provider_id)
    setFormDisplayName(model.display_name)
    setFormModelId(model.model_id)
    setFormContextWindow(model.context_window)
    setFormCostInput(String(model.cost_input_1k))
    setFormCostOutput(String(model.cost_output_1k))
    setFormCapabilities({
      chat: !!model.capabilities?.chat,
      vision: !!model.capabilities?.vision,
      tools: !!model.capabilities?.tools,
      reasoning: !!model.capabilities?.reasoning,
      streaming: !!model.capabilities?.streaming,
    })
    setFormAllowedPlans(model.allowed_plans || [])
    setFormDefaultForPlans(model.is_default_for_plans || [])
    setFormIsActive(model.is_active)
    setFormError(null)
    setIsEditModalOpen(true)
  }

  const openDeleteModal = (model: LLMModel) => {
    setSelectedModel(model)
    setFormError(null)
    setIsDeleteModalOpen(true)
  }

  const closeModals = () => {
    if (isMutating) return
    setIsEditModalOpen(false)
    setIsDeleteModalOpen(false)
    setSelectedModel(null)
    setFormError(null)
  }

  // Toggle de capability
  const toggleCapability = (capId: string) => {
    setFormCapabilities(prev => ({
      ...prev,
      [capId]: !prev[capId],
    }))
  }

  // Toggle de plano permitido
  const toggleAllowedPlan = (planId: string) => {
    setFormAllowedPlans((prev) => {
      const exists = prev.includes(planId)
      const next = exists ? prev.filter(p => p !== planId) : [...prev, planId]
      // Se remover plano permitido, remover de defaults se estiver lá
      if (exists) {
        setFormDefaultForPlans(defPrev => defPrev.filter(p => p !== planId))
      }
      return next
    })
  }

  // Toggle de default para plano
  const toggleDefaultForPlan = (planId: string) => {
    if (!formAllowedPlans.includes(planId)) return
    setFormDefaultForPlans(prev =>
      prev.includes(planId) ? prev.filter(p => p !== planId) : [...prev, planId],
    )
  }

  // Submissão do Formulário de Salvar
  const handleSaveModel = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!formProviderId) {
      setFormError('Selecione um provedor válido.')
      return
    }
    if (!formDisplayName.trim()) {
      setFormError('O nome de exibição é obrigatório.')
      return
    }
    if (!formModelId.trim()) {
      setFormError('O identificador técnico do modelo (model_id) é obrigatório.')
      return
    }
    const costIn = parseFloat(formCostInput)
    const costOut = parseFloat(formCostOutput)
    if (isNaN(costIn) || costIn < 0 || isNaN(costOut) || costOut < 0) {
      setFormError('Os custos devem ser valores numéricos válidos e não-negativos.')
      return
    }
    if (formContextWindow <= 0) {
      setFormError('A janela de contexto deve ser maior que zero.')
      return
    }
    if (formAllowedPlans.length === 0) {
      setFormError('Ao menos um plano de acesso deve ser selecionado.')
      return
    }

    setIsMutating(true)
    try {
      const payload = {
        p_id: selectedModel ? selectedModel.id : null,
        p_provider_id: formProviderId,
        p_model_id: formModelId.trim(),
        p_display_name: formDisplayName.trim(),
        p_context_window: formContextWindow,
        p_cost_input_1k: costIn,
        p_cost_output_1k: costOut,
        p_capabilities: formCapabilities,
        p_is_default_for_plans: formDefaultForPlans,
        p_allowed_plans: formAllowedPlans,
        p_is_active: formIsActive,
      }

      const { error: saveErr } = await (supabase.rpc as any)('admin_save_llm_model', payload)
      if (saveErr) throw new Error(saveErr.message)

      closeModals()
      loadData(true)
    } catch (err: any) {
      console.error('Error ao salvar modelo:', err)
      setFormError(err?.message || 'Falha ao salvar configurações do modelo.')
    } finally {
      setIsMutating(false)
    }
  }

  // Exclusão
  const handleDeleteModel = async () => {
    if (!selectedModel) return
    setIsMutating(true)
    setFormError(null)
    try {
      const { error: delErr } = await (supabase.rpc as any)('admin_delete_llm_model', {
        p_id: selectedModel.id,
      })
      if (delErr) throw new Error(delErr.message)

      closeModals()
      loadData(true)
    } catch (err: any) {
      console.error('Error ao excluir modelo:', err)
      setFormError(err?.message || 'Não foi possível excluir o modelo.')
    } finally {
      setIsMutating(false)
    }
  }

  // Toggle direto de status ativo
  const handleToggleActive = async (model: LLMModel) => {
    const nextStatus = !model.is_active
    try {
      const { error: toggleErr } = await (supabase.rpc as any)('admin_toggle_llm_model', {
        p_id: model.id,
        p_is_active: nextStatus,
      })
      if (toggleErr) throw new Error(toggleErr.message)
      loadData(true)
    } catch (err: any) {
      alert(err?.message || 'Error ao alterar status do modelo.')
    }
  }

  // Models filtrados
  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      // Busca
      const query = searchQuery.trim().toLowerCase()
      if (query) {
        const matchesName = m.display_name.toLowerCase().includes(query)
        const matchesId = m.model_id.toLowerCase().includes(query)
        if (!matchesName && !matchesId) return false
      }
      // Provedor
      if (selectedProviderFilter !== 'all' && m.provider_id !== selectedProviderFilter) {
        return false
      }
      // Plan
      if (selectedPlanFilter !== 'all' && !m.allowed_plans?.includes(selectedPlanFilter)) {
        return false
      }
      // Capability
      if (selectedCapabilityFilter !== 'all') {
        if (!m.capabilities?.[selectedCapabilityFilter]) return false
      }
      return true
    })
  }, [models, searchQuery, selectedProviderFilter, selectedPlanFilter, selectedCapabilityFilter])

  // KPIs
  const totalModels = models.length
  const activeModels = models.filter(m => m.is_active && m.provider_is_active).length
  const providersWithModels = new Set(models.map(m => m.provider_id)).size

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--cm-border)]">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[var(--cm-foreground)]">Catálogo de Models</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--cm-primary)]/10 text-[var(--cm-primary)] border border-[var(--cm-primary)]/30">
              {activeModels} ativos / {totalModels} total
            </span>
          </div>
          <p className="text-xs text-[var(--cm-muted-foreground)] mt-1">
            Gestão de modelos disponíveis, cotas de contexto, precificação e permissões por plano.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] text-xs font-medium text-[var(--cm-foreground)] hover:text-[var(--cm-foreground)] hover:border-[var(--cm-muted-foreground)] transition disabled:opacity-50"
          >
            <span className={isRefreshing ? 'animate-spin' : ''}>↻</span>
            Atualizar
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[var(--cm-primary)] to-[var(--cm-primary)] text-xs font-semibold text-[var(--cm-primary-foreground)] hover:brightness-105 transition shadow-sm"
          >
            + Novo Modelo
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)]">Total de Models</div>
          <div className="text-xl font-bold text-[var(--cm-foreground)] mt-1">{totalModels}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)]">Models Ativos Operacionais</div>
          <div className="text-xl font-bold text-[var(--cm-primary)] mt-1">{activeModels}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)]">Provedores com Models</div>
          <div className="text-xl font-bold text-[var(--cm-foreground)] mt-1">{providersWithModels}</div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)] flex flex-wrap items-center gap-3">
        {/* Busca */}
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by nome ou model_id..."
            className="w-full px-3 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-xs text-[var(--cm-foreground)] placeholder-[var(--cm-muted-foreground)]/60 focus:border-[var(--cm-primary)] focus:outline-none"
          />
        </div>

        {/* Filtro Provedor */}
        <div className="w-full sm:w-auto">
          <select
            value={selectedProviderFilter}
            onChange={e => setSelectedProviderFilter(e.target.value)}
            className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-xs text-[var(--cm-foreground)] focus:border-[var(--cm-primary)] focus:outline-none"
          >
            <option value="all">Todos os Provedores</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {!p.is_active ? '(Inativo)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Filtro Plan */}
        <div className="w-full sm:w-auto">
          <select
            value={selectedPlanFilter}
            onChange={e => setSelectedPlanFilter(e.target.value)}
            className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-xs text-[var(--cm-foreground)] focus:border-[var(--cm-primary)] focus:outline-none"
          >
            <option value="all">Todos os Plans</option>
            {ALL_PLANS.map(plan => (
              <option key={plan.id} value={plan.id}>
                Plan {plan.label}
              </option>
            ))}
          </select>
        </div>

        {/* Filtro Capability */}
        <div className="w-full sm:w-auto">
          <select
            value={selectedCapabilityFilter}
            onChange={e => setSelectedCapabilityFilter(e.target.value)}
            className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-xs text-[var(--cm-foreground)] focus:border-[var(--cm-primary)] focus:outline-none"
          >
            <option value="all">Todas as Capacidades</option>
            {CAPABILITY_OPTIONS.map(cap => (
              <option key={cap.id} value={cap.id}>
                {cap.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Estados: Loading, Error, Vazio */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-[var(--cm-muted-foreground)]">
          <span className="inline-block animate-spin mr-2">↻</span> Carregando catálogo de modelos...
        </div>
      ) : error ? (
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
      ) : models.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-[var(--cm-border)] bg-[var(--cm-card)]/40 space-y-3">
          <div className="text-2xl text-[var(--cm-muted-foreground)]">⚙</div>
          <div className="text-sm font-medium text-[var(--cm-foreground)]">Nenhum modelo cadastrado</div>
          <p className="text-xs text-[var(--cm-muted-foreground)] max-w-sm mx-auto">
            Cadastre os modelos de IA disponíveis para vincular aos planos de assinatura e habilitar os Monster Agents.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[var(--cm-primary)] to-[var(--cm-primary)] text-xs font-semibold text-[var(--cm-primary-foreground)] hover:brightness-105 transition"
          >
            + Cadastrar Primeiro Modelo
          </button>
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="p-8 text-center rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/50 text-xs text-[var(--cm-muted-foreground)]">
          Nenhum modelo corresponde aos filtros selecionados.
        </div>
      ) : (
        /* Tabela de Models */
        <div className="overflow-x-auto rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--cm-border)] bg-[var(--cm-background)]/60 text-[var(--cm-muted-foreground)]">
                <th className="py-3 px-4 font-medium">Modelo</th>
                <th className="py-3 px-4 font-medium">Provedor</th>
                <th className="py-3 px-4 font-medium">Contexto</th>
                <th className="py-3 px-4 font-medium">Custos (1k Tokens)</th>
                <th className="py-3 px-4 font-medium">Capacidades</th>
                <th className="py-3 px-4 font-medium">Plans & Defaults</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cm-border)]/60">
              {filteredModels.map((m) => {

                return (
                  <tr key={m.id} className="hover:bg-[var(--cm-background)]/30 transition group">
                    {/* Modelo */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(m)}
                          title={m.is_active ? 'Modelo ativo (clique para pausar)' : 'Modelo inativo'}
                          className={`w-2 h-2 rounded-full transition ${
                            m.is_active ? 'bg-emerald-400' : 'bg-[var(--cm-muted-foreground)]'
                          }`}
                        />
                        <div>
                          <div className="font-medium text-[var(--cm-foreground)]">{m.display_name}</div>
                          <div className="font-mono text-[11px] text-[var(--cm-muted-foreground)]">{m.model_id}</div>
                        </div>
                      </div>
                    </td>

                    {/* Provedor */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex items-center w-fit px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--cm-secondary)]/60 text-[var(--cm-foreground)] border border-[var(--cm-border)]">
                          {m.provider_name}
                        </span>
                        {!m.provider_is_active && (
                          <span className="text-[10px] text-amber-400 font-medium">
                            Provedor Inativo
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Contexto */}
                    <td className="py-3.5 px-4 text-[var(--cm-foreground)]">
                      {m.context_window >= 1000
                        ? `${Math.round(m.context_window / 1000)}k tokens`
                        : `${m.context_window} tokens`}
                    </td>

                    {/* Custos */}
                    <td className="py-3.5 px-4">
                      <div className="font-mono text-[11px] text-[var(--cm-muted-foreground)]">
                        <div>In: ${Number(m.cost_input_1k).toFixed(6)}</div>
                        <div>Out: ${Number(m.cost_output_1k).toFixed(6)}</div>
                      </div>
                    </td>

                    {/* Capacidades */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {m.capabilities?.chat && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--cm-primary)]/10 text-[var(--cm-primary)] border border-[var(--cm-primary)]/20">
                            Chat
                          </span>
                        )}
                        {m.capabilities?.vision && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20">
                            Vision
                          </span>
                        )}
                        {m.capabilities?.tools && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20">
                            Tools
                          </span>
                        )}
                        {m.capabilities?.reasoning && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Reasoning
                          </span>
                        )}
                        {m.capabilities?.streaming && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Stream
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Plans & Defaults */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1 items-center">
                        {ALL_PLANS.map((plan) => {
                          const isAllowed = m.allowed_plans?.includes(plan.id)
                          const isDefault = m.is_default_for_plans?.includes(plan.id)

                          if (!isAllowed) return null

                          return (
                            <span
                              key={plan.id}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                isDefault
                                  ? 'bg-[var(--cm-primary)]/20 text-[var(--cm-primary)] border border-[var(--cm-primary)]/50 font-semibold'
                                  : 'bg-[var(--cm-background)] text-[var(--cm-foreground)] border border-[var(--cm-border)]'
                              }`}
                            >
                              {plan.label}
                              {isDefault && <span title="Padrão deste plano">★</span>}
                            </span>
                          )
                        })}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(m)}
                          className="px-2.5 py-1 rounded-md border border-[var(--cm-border)] bg-[var(--cm-background)] text-[var(--cm-foreground)] hover:text-[var(--cm-foreground)] hover:border-[var(--cm-muted-foreground)] transition text-xs font-medium"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteModal(m)}
                          className="px-2.5 py-1 rounded-md border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition text-xs font-medium"
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

      {/* Modal 1: Criar / Editar Modelo (Padrão Settings) */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[var(--cm-background)]/80 backdrop-blur-sm" onClick={closeModals} />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={el => el?.focus()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isMutating) {
                e.stopPropagation()
                e.nativeEvent?.stopImmediatePropagation?.()
                closeModals()
              }
            }}
            className="relative z-10 w-full max-w-xl rounded-2xl border border-[var(--cm-primary)]/25 bg-[var(--cm-card)] p-6 shadow-2xl space-y-5 focus:outline-none max-h-[90vh] overflow-y-auto"
          >
            {/* Header Modal */}
            <div className="flex items-center justify-between pb-3 border-b border-[var(--cm-border)]">
              <h3 className="text-sm font-semibold text-[var(--cm-foreground)]">
                {selectedModel ? 'Editar Modelo de IA' : 'Novo Modelo de IA'}
              </h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] p-1 transition"
              >
                ✕
              </button>
            </div>

            {/* Formulário */}
            <form onSubmit={handleSaveModel} className="space-y-4 text-xs">
              {/* Provedor */}
              <div className="space-y-1">
                <label className="text-[var(--cm-muted-foreground)] font-medium">Provedor de IA *</label>
                <select
                  value={formProviderId}
                  onChange={e => setFormProviderId(e.target.value)}
                  disabled={isMutating}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-[var(--cm-foreground)] focus:border-[var(--cm-primary)] focus:outline-none"
                >
                  {providers.length === 0 ? (
                    <option value="">Nenhum provedor disponível</option>
                  ) : (
                    providers.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.provider_type}) {!p.is_active ? '— Inativo' : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Display Name & Model ID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[var(--cm-muted-foreground)] font-medium">Display Name *</label>
                  <input
                    type="text"
                    required
                    value={formDisplayName}
                    onChange={e => setFormDisplayName(e.target.value)}
                    placeholder="Ex: GPT-4o, Claude 3.5..."
                    disabled={isMutating}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-[var(--cm-foreground)] placeholder-[var(--cm-muted-foreground)]/50 focus:border-[var(--cm-primary)] focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[var(--cm-muted-foreground)] font-medium">Identificador Técnico (model_id) *</label>
                  <input
                    type="text"
                    required
                    value={formModelId}
                    onChange={e => setFormModelId(e.target.value)}
                    placeholder="Ex: gpt-4o, claude-3-5-sonnet..."
                    disabled={isMutating}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-[var(--cm-foreground)] font-mono placeholder-[var(--cm-muted-foreground)]/50 focus:border-[var(--cm-primary)] focus:outline-none"
                  />
                </div>
              </div>

              {/* Context Window & Custos */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[var(--cm-muted-foreground)] font-medium">Janela Contexto (tokens) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={formContextWindow}
                    onChange={e => setFormContextWindow(parseInt(e.target.value, 10) || 0)}
                    disabled={isMutating}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-[var(--cm-foreground)] font-mono focus:border-[var(--cm-primary)] focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[var(--cm-muted-foreground)] font-medium">Custo In (1k tokens $)</label>
                  <input
                    type="text"
                    required
                    value={formCostInput}
                    onChange={e => setFormCostInput(e.target.value)}
                    disabled={isMutating}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-[var(--cm-foreground)] font-mono focus:border-[var(--cm-primary)] focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[var(--cm-muted-foreground)] font-medium">Custo Out (1k tokens $)</label>
                  <input
                    type="text"
                    required
                    value={formCostOutput}
                    onChange={e => setFormCostOutput(e.target.value)}
                    disabled={isMutating}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-[var(--cm-foreground)] font-mono focus:border-[var(--cm-primary)] focus:outline-none"
                  />
                </div>
              </div>

              {/* Capacidades */}
              <div className="space-y-2 pt-2 border-t border-[var(--cm-border)]">
                <label className="text-[var(--cm-muted-foreground)] font-medium">Capacidades do Modelo</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CAPABILITY_OPTIONS.map(cap => (
                    <label
                      key={cap.id}
                      className="flex items-center gap-2 p-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)]/60 cursor-pointer hover:border-[var(--cm-muted-foreground)] transition"
                    >
                      <input
                        type="checkbox"
                        checked={!!formCapabilities[cap.id]}
                        onChange={() => toggleCapability(cap.id)}
                        disabled={isMutating}
                        className="rounded border-[var(--cm-border)] bg-[var(--cm-card)] text-[var(--cm-primary)] focus:ring-[var(--cm-primary)]"
                      />
                      <span className="text-[var(--cm-foreground)]">{cap.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Allowed Plans */}
              <div className="space-y-2 pt-2 border-t border-[var(--cm-border)]">
                <label className="text-[var(--cm-muted-foreground)] font-medium">Plans com Acesso Liberado</label>
                <div className="grid grid-cols-3 gap-2">
                  {ALL_PLANS.map(plan => (
                    <label
                      key={plan.id}
                      className="flex items-center gap-2 p-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)]/60 cursor-pointer hover:border-[var(--cm-muted-foreground)] transition"
                    >
                      <input
                        type="checkbox"
                        checked={formAllowedPlans.includes(plan.id)}
                        onChange={() => toggleAllowedPlan(plan.id)}
                        disabled={isMutating}
                        className="rounded border-[var(--cm-border)] bg-[var(--cm-card)] text-[var(--cm-primary)] focus:ring-[var(--cm-primary)]"
                      />
                      <span className="text-[var(--cm-foreground)]">{plan.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Modelo Padrão por Plan */}
              <div className="space-y-2 pt-2 border-t border-[var(--cm-border)]">
                <div className="flex items-center justify-between">
                  <label className="text-[var(--cm-muted-foreground)] font-medium">
                    Modelo Padrão para os Plans
                  </label>
                  <span className="text-[10px] text-[var(--cm-primary)]">★ Exclusivo global por plano</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {ALL_PLANS.map((plan) => {
                    const isAllowed = formAllowedPlans.includes(plan.id)
                    const isDefault = formDefaultForPlans.includes(plan.id)

                    return (
                      <label
                        key={plan.id}
                        className={`flex items-center gap-2 p-2 rounded-lg border transition ${
                          !isAllowed
                            ? 'opacity-40 border-[var(--cm-border)] bg-[var(--cm-background)]/30 cursor-not-allowed'
                            : isDefault
                              ? 'border-[var(--cm-primary)]/60 bg-[var(--cm-primary)]/10 cursor-pointer'
                              : 'border-[var(--cm-border)] bg-[var(--cm-background)]/60 cursor-pointer hover:border-[var(--cm-muted-foreground)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={!isAllowed || isMutating}
                          checked={isDefault}
                          onChange={() => toggleDefaultForPlan(plan.id)}
                          className="rounded border-[var(--cm-border)] bg-[var(--cm-card)] text-[var(--cm-primary)] focus:ring-[var(--cm-primary)]"
                        />
                        <span className="text-[var(--cm-foreground)]">{plan.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Status Ativo */}
              <div className="flex items-center gap-3 pt-2 border-t border-[var(--cm-border)]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={e => setFormIsActive(e.target.checked)}
                    disabled={isMutating}
                    className="rounded border-[var(--cm-border)] bg-[var(--cm-card)] text-[var(--cm-primary)] focus:ring-[var(--cm-primary)]"
                  />
                  <span className="text-[var(--cm-foreground)] font-medium">Modelo Ativo no Sistema</span>
                </label>
              </div>

              {/* Mensagem de Error do Formulário */}
              {formError && (
                <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-400">
                  {formError}
                </div>
              )}

              {/* Actions do Modal */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--cm-border)]">
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  className="px-3.5 py-1.5 rounded-lg border border-[var(--cm-border)] text-[var(--cm-foreground)] hover:text-[var(--cm-foreground)] hover:border-[var(--cm-muted-foreground)] transition font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isMutating}
                  className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[var(--cm-primary)] to-[var(--cm-primary)] text-[var(--cm-primary-foreground)] font-semibold hover:brightness-105 transition disabled:opacity-50"
                >
                  {isMutating ? 'Saving...' : selectedModel ? 'Save Changes' : 'Criar Modelo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Confirmação de Exclusão */}
      {isDeleteModalOpen && selectedModel && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[var(--cm-background)]/80 backdrop-blur-sm" onClick={closeModals} />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={el => el?.focus()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isMutating) {
                e.stopPropagation()
                e.nativeEvent?.stopImmediatePropagation?.()
                closeModals()
              }
            }}
            className="relative z-10 w-full max-w-md rounded-2xl border border-red-500/30 bg-[var(--cm-card)] p-6 shadow-2xl space-y-4 focus:outline-none"
          >
            <div className="flex items-center gap-3 text-red-400">
              <span className="text-xl">⚠️</span>
              <h3 className="text-sm font-semibold text-[var(--cm-foreground)]">Excluir Modelo</h3>
            </div>

            <p className="text-xs text-[var(--cm-muted-foreground)]">
              Tem certeza de que deseja excluir o modelo{' '}
              <strong className="text-[var(--cm-foreground)]">{selectedModel.display_name}</strong> (
              <span className="font-mono">{selectedModel.model_id}</span>)?
            </p>

            {selectedModel.is_default_for_plans && selectedModel.is_default_for_plans.length > 0 && (
              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300">
                <strong>Atenção:</strong> Este modelo é atualmente o padrão para os planos:{' '}
                <strong>{selectedModel.is_default_for_plans.join(', ')}</strong>. A exclusão será
                bloqueada pelo sistema enquanto ele for o padrão ativo. Reatribua outro modelo padrão antes
                de excluir.
              </div>
            )}

            {formError && (
              <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-400">
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--cm-border)]">
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="px-3.5 py-1.5 rounded-lg border border-[var(--cm-border)] text-[var(--cm-foreground)] hover:text-[var(--cm-foreground)] hover:border-[var(--cm-muted-foreground)] transition text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteModel}
                disabled={isMutating}
                className="px-4 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 transition text-xs font-semibold disabled:opacity-50"
              >
                {isMutating ? 'Deleting...' : 'Confirm Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
