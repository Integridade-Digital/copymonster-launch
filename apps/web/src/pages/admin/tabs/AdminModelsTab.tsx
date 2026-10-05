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

const CAPABILITY_COLORS: Record<string, string> = {
  chat: 'var(--cm-primary)',
  vision: 'var(--cm-success)',
  tools: 'var(--cm-muted-foreground)',
  reasoning: 'var(--cm-primary)',
  streaming: 'var(--cm-success)',
}

const secondaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  height: '32px',
  padding: '0 16px',
  background: 'transparent',
  border: '1px solid var(--cm-border)',
  borderRadius: '6px',
  color: 'var(--cm-foreground)',
  cursor: 'pointer',
  fontSize: '13px',
}

function capabilityPillStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 500,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color: color,
    border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
  }
}

function checkboxCardStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    borderRadius: '8px',
    border: active
      ? '1px solid color-mix(in srgb, var(--cm-primary) 60%, transparent)'
      : '1px solid var(--cm-border)',
    background: active
      ? 'color-mix(in srgb, var(--cm-primary) 10%, transparent)'
      : 'color-mix(in srgb, var(--cm-background) 60%, transparent)',
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

export function AdminModelsTab() {
  const [models, setModels] = useState<LLMModel[]>([])
  const [providers, setProviders] = useState<SimpleProvider[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState<string>('')
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>('all')
  const [selectedPlanFilter, setSelectedPlanFilter] = useState<string>('all')
  const [selectedCapabilityFilter, setSelectedCapabilityFilter] = useState<string>('all')

  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false)
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null)

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

  const toggleCapability = (capId: string) => {
    setFormCapabilities(prev => ({
      ...prev,
      [capId]: !prev[capId],
    }))
  }

  const toggleAllowedPlan = (planId: string) => {
    setFormAllowedPlans((prev) => {
      const exists = prev.includes(planId)
      const next = exists ? prev.filter(p => p !== planId) : [...prev, planId]
      if (exists) {
        setFormDefaultForPlans(defPrev => defPrev.filter(p => p !== planId))
      }
      return next
    })
  }

  const toggleDefaultForPlan = (planId: string) => {
    if (!formAllowedPlans.includes(planId)) return
    setFormDefaultForPlans(prev =>
      prev.includes(planId) ? prev.filter(p => p !== planId) : [...prev, planId],
    )
  }

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

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      const query = searchQuery.trim().toLowerCase()
      if (query) {
        const matchesName = m.display_name.toLowerCase().includes(query)
        const matchesId = m.model_id.toLowerCase().includes(query)
        if (!matchesName && !matchesId) return false
      }
      if (selectedProviderFilter !== 'all' && m.provider_id !== selectedProviderFilter) {
        return false
      }
      if (selectedPlanFilter !== 'all' && !m.allowed_plans?.includes(selectedPlanFilter)) {
        return false
      }
      if (selectedCapabilityFilter !== 'all') {
        if (!m.capabilities?.[selectedCapabilityFilter]) return false
      }
      return true
    })
  }, [models, searchQuery, selectedProviderFilter, selectedPlanFilter, selectedCapabilityFilter])

  const totalModels = models.length
  const activeModels = models.filter(m => m.is_active && m.provider_is_active).length
  const providersWithModels = new Set(models.map(m => m.provider_id)).size

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', color: 'var(--cm-foreground)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', paddingBottom: '16px', borderBottom: '1px solid var(--cm-border)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2>Catálogo de Models</h2>
            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: 'color-mix(in srgb, var(--cm-primary) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', color: 'var(--cm-primary)' }}>
              {activeModels} ativos / {totalModels} total
            </span>
          </div>
          <p style={{ marginTop: '4px' }}>
            Gestão de modelos disponíveis, cotas de contexto, precificação e permissões por plano.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            style={{ ...secondaryButtonStyle, opacity: isRefreshing || isLoading ? 0.5 : 1, cursor: isRefreshing || isLoading ? 'not-allowed' : 'pointer' }}
          >
            <span style={isRefreshing ? { display: 'inline-block', animation: 'cm-auth-spin 0.8s linear infinite' } : undefined}>↻</span>
            Atualizar
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="adminButton"
            style={{ gap: '6px' }}
          >
            + Novo Modelo
          </button>
        </div>
      </div>

      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">Total de Models</div>
          <div className="adminCardValue">{totalModels}</div>
          <div className="adminCardSub">No catálogo</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Models Ativos Operacionais</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-success)' }}>{activeModels}</div>
          <div className="adminCardSub">Com provedor ativo</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Provedores com Models</div>
          <div className="adminCardValue">{providersWithModels}</div>
          <div className="adminCardSub">Com modelos vinculados</div>
        </div>
      </div>

      <div className="adminCard" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by nome ou model_id..."
          className="adminInput"
          style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}
        />
        <select
          value={selectedProviderFilter}
          onChange={e => setSelectedProviderFilter(e.target.value)}
          className="adminInput"
          style={{ width: 'auto', marginBottom: 0 }}
        >
          <option value="all">Todos os Provedores</option>
          {providers.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} {!p.is_active ? '(Inativo)' : ''}
            </option>
          ))}
        </select>
        <select
          value={selectedPlanFilter}
          onChange={e => setSelectedPlanFilter(e.target.value)}
          className="adminInput"
          style={{ width: 'auto', marginBottom: 0 }}
        >
          <option value="all">Todos os Plans</option>
          {ALL_PLANS.map(plan => (
            <option key={plan.id} value={plan.id}>
              Plan {plan.label}
            </option>
          ))}
        </select>
        <select
          value={selectedCapabilityFilter}
          onChange={e => setSelectedCapabilityFilter(e.target.value)}
          className="adminInput"
          style={{ width: 'auto', marginBottom: 0 }}
        >
          <option value="all">Todas as Capacidades</option>
          {CAPABILITY_OPTIONS.map(cap => (
            <option key={cap.id} value={cap.id}>
              {cap.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '48px 0' }}>
          <div style={{ width: '24px', height: '24px', border: '2px solid var(--cm-primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'cm-auth-spin 0.8s linear infinite' }} />
          <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>Carregando catálogo de modelos...</div>
        </div>
      ) : error ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 16px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', fontSize: '12px' }}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => loadData()}
            style={{ border: 'none', background: 'transparent', color: 'var(--cm-destructive)', textDecoration: 'underline', cursor: 'pointer', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap' }}
          >
            Tentar novamente
          </button>
        </div>
      ) : models.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '48px 24px', textAlign: 'center', borderRadius: '12px', border: '1px dashed var(--cm-border)', background: 'color-mix(in srgb, var(--cm-card) 40%, transparent)' }}>
          <div style={{ fontSize: '24px', color: 'var(--cm-muted-foreground)' }}>⚙</div>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>Nenhum modelo cadastrado</div>
          <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', maxWidth: '360px' }}>
            Cadastre os modelos de IA disponíveis para vincular aos planos de assinatura e habilitar os Monster Agents.
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="adminButton"
            style={{ marginTop: '8px' }}
          >
            + Cadastrar Primeiro Modelo
          </button>
        </div>
      ) : filteredModels.length === 0 ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'color-mix(in srgb, var(--cm-card) 50%, transparent)', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
          Nenhum modelo corresponde aos filtros selecionados.
        </div>
      ) : (
        <div className="adminCard" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="adminTable">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Provedor</th>
                  <th>Contexto</th>
                  <th>Custos (1k Tokens)</th>
                  <th>Capacidades</th>
                  <th>Plans &amp; Defaults</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((m) => {
                  return (
                    <tr key={m.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(m)}
                            title={m.is_active ? 'Modelo ativo (clique para pausar)' : 'Modelo inativo'}
                            style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: m.is_active ? 'var(--cm-success)' : 'var(--cm-muted-foreground)', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{m.display_name}</div>
                            <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-muted-foreground)' }}>{m.model_id}</div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', width: 'fit-content', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-secondary) 60%, transparent)', color: 'var(--cm-foreground)', border: '1px solid var(--cm-border)' }}>
                            {m.provider_name}
                          </span>
                          {!m.provider_is_active && (
                            <span style={{ fontSize: '10px', color: 'var(--cm-primary)', fontWeight: 500 }}>
                              Provedor Inativo
                            </span>
                          )}
                        </div>
                      </td>

                      <td>
                        {m.context_window >= 1000
                          ? `${Math.round(m.context_window / 1000)}k tokens`
                          : `${m.context_window} tokens`}
                      </td>

                      <td>
                        <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-muted-foreground)' }}>
                          <div>In: ${Number(m.cost_input_1k).toFixed(6)}</div>
                          <div>Out: ${Number(m.cost_output_1k).toFixed(6)}</div>
                        </div>
                      </td>

                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '180px' }}>
                          {m.capabilities?.chat && (
                            <span style={capabilityPillStyle(CAPABILITY_COLORS.chat || 'var(--cm-primary)')}>
                              Chat
                            </span>
                          )}
                          {m.capabilities?.vision && (
                            <span style={capabilityPillStyle(CAPABILITY_COLORS.vision || 'var(--cm-success)')}>
                              Vision
                            </span>
                          )}
                          {m.capabilities?.tools && (
                            <span style={capabilityPillStyle(CAPABILITY_COLORS.tools || 'var(--cm-muted-foreground)')}>
                              Tools
                            </span>
                          )}
                          {m.capabilities?.reasoning && (
                            <span style={capabilityPillStyle(CAPABILITY_COLORS.reasoning || 'var(--cm-primary)')}>
                              Reasoning
                            </span>
                          )}
                          {m.capabilities?.streaming && (
                            <span style={capabilityPillStyle(CAPABILITY_COLORS.streaming || 'var(--cm-success)')}>
                              Stream
                            </span>
                          )}
                        </div>
                      </td>

                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                          {ALL_PLANS.map((plan) => {
                            const isAllowed = m.allowed_plans?.includes(plan.id)
                            const isDefault = m.is_default_for_plans?.includes(plan.id)

                            if (!isAllowed) return null

                            return (
                              <span
                                key={plan.id}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: isDefault ? 600 : 500,
                                  background: isDefault ? 'color-mix(in srgb, var(--cm-primary) 20%, transparent)' : 'var(--cm-background)',
                                  color: isDefault ? 'var(--cm-primary)' : 'var(--cm-foreground)',
                                  border: isDefault ? '1px solid color-mix(in srgb, var(--cm-primary) 50%, transparent)' : '1px solid var(--cm-border)',
                                }}
                              >
                                {plan.label}
                                {isDefault && <span title="Padrão deste plano">★</span>}
                              </span>
                            )
                          })}
                        </div>
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => openEditModal(m)}
                            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--cm-border)', background: 'var(--cm-background)', color: 'var(--cm-foreground)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteModal(m)}
                            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 25%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
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
        </div>
      )}

      {isEditModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={closeModals} />
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
            style={{ position: 'relative', width: '100%', maxWidth: '520px', margin: '24px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '12px', padding: '24px', boxShadow: 'var(--cm-shadow)', maxHeight: '90vh', overflowY: 'auto', color: 'var(--cm-foreground)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--cm-border)' }}>
              <h3>{selectedModel ? 'Editar Modelo de IA' : 'Novo Modelo de IA'}</h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                style={{ border: 'none', background: 'transparent', color: 'var(--cm-muted-foreground)', cursor: isMutating ? 'not-allowed' : 'pointer', opacity: isMutating ? 0.5 : 1, fontSize: '16px', lineHeight: 1, padding: '4px' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveModel} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label>Provedor de IA *</label>
                <select
                  value={formProviderId}
                  onChange={e => setFormProviderId(e.target.value)}
                  disabled={isMutating}
                  className="adminInput"
                  style={{ marginBottom: 0 }}
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label>Display Name *</label>
                  <input
                    type="text"
                    required
                    value={formDisplayName}
                    onChange={e => setFormDisplayName(e.target.value)}
                    placeholder="Ex: GPT-4o, Claude 3.5..."
                    disabled={isMutating}
                    className="adminInput"
                    style={{ marginBottom: 0 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label>Identificador Técnico (model_id) *</label>
                  <input
                    type="text"
                    required
                    value={formModelId}
                    onChange={e => setFormModelId(e.target.value)}
                    placeholder="Ex: gpt-4o, claude-3-5-sonnet..."
                    disabled={isMutating}
                    className="adminInput"
                    style={{ marginBottom: 0, fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label>Janela Contexto (tokens) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={formContextWindow}
                    onChange={e => setFormContextWindow(parseInt(e.target.value, 10) || 0)}
                    disabled={isMutating}
                    className="adminInput"
                    style={{ marginBottom: 0, fontFamily: 'monospace' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label>Custo In (1k tokens $)</label>
                  <input
                    type="text"
                    required
                    value={formCostInput}
                    onChange={e => setFormCostInput(e.target.value)}
                    disabled={isMutating}
                    className="adminInput"
                    style={{ marginBottom: 0, fontFamily: 'monospace' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label>Custo Out (1k tokens $)</label>
                  <input
                    type="text"
                    required
                    value={formCostOutput}
                    onChange={e => setFormCostOutput(e.target.value)}
                    disabled={isMutating}
                    className="adminInput"
                    style={{ marginBottom: 0, fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--cm-border)' }}>
                <label>Capacidades do Modelo</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {CAPABILITY_OPTIONS.map(cap => (
                    <label key={cap.id} style={checkboxCardStyle(!!formCapabilities[cap.id], isMutating)}>
                      <input
                        type="checkbox"
                        checked={!!formCapabilities[cap.id]}
                        onChange={() => toggleCapability(cap.id)}
                        disabled={isMutating}
                        style={{ width: '14px', height: '14px', accentColor: 'var(--cm-primary)', margin: 0, cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--cm-foreground)' }}>{cap.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--cm-border)' }}>
                <label>Plans com Acesso Liberado</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {ALL_PLANS.map(plan => (
                    <label key={plan.id} style={checkboxCardStyle(formAllowedPlans.includes(plan.id), isMutating)}>
                      <input
                        type="checkbox"
                        checked={formAllowedPlans.includes(plan.id)}
                        onChange={() => toggleAllowedPlan(plan.id)}
                        disabled={isMutating}
                        style={{ width: '14px', height: '14px', accentColor: 'var(--cm-primary)', margin: 0, cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--cm-foreground)' }}>{plan.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--cm-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <label style={{ marginBottom: 0 }}>
                    Modelo Padrão para os Plans
                  </label>
                  <span style={{ fontSize: '10px', color: 'var(--cm-primary)', whiteSpace: 'nowrap' }}>★ Exclusivo global por plano</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {ALL_PLANS.map((plan) => {
                    const isAllowed = formAllowedPlans.includes(plan.id)
                    const isDefault = formDefaultForPlans.includes(plan.id)

                    return (
                      <label key={plan.id} style={checkboxCardStyle(isDefault, !isAllowed || isMutating)}>
                        <input
                          type="checkbox"
                          disabled={!isAllowed || isMutating}
                          checked={isDefault}
                          onChange={() => toggleDefaultForPlan(plan.id)}
                          style={{ width: '14px', height: '14px', accentColor: 'var(--cm-primary)', margin: 0, cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '12px', color: 'var(--cm-foreground)' }}>{plan.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--cm-border)' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', whiteSpace: 'normal' }}>
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={e => setFormIsActive(e.target.checked)}
                    disabled={isMutating}
                    style={{ width: '14px', height: '14px', accentColor: 'var(--cm-primary)', margin: 0, cursor: 'pointer' }}
                  />
                  <span style={{ color: 'var(--cm-foreground)', fontWeight: 500 }}>Modelo Ativo no Sistema</span>
                </label>
              </div>

              {formError && (
                <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', fontSize: '12px' }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--cm-border)' }}>
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  style={{ ...secondaryButtonStyle, color: 'var(--cm-muted-foreground)', opacity: isMutating ? 0.5 : 1, cursor: isMutating ? 'not-allowed' : 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isMutating}
                  className="adminButton"
                  style={{ opacity: isMutating ? 0.5 : 1 }}
                >
                  {isMutating ? 'Saving...' : selectedModel ? 'Save Changes' : 'Criar Modelo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeleteModalOpen && selectedModel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={closeModals} />
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
            style={{ position: 'relative', width: '100%', maxWidth: '520px', margin: '24px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '12px', padding: '24px', boxShadow: 'var(--cm-shadow)', maxHeight: '90vh', overflowY: 'auto', color: 'var(--cm-foreground)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '12px', borderBottom: '1px solid var(--cm-border)' }}>
              <span style={{ color: 'var(--cm-primary)', fontSize: '16px' }}>⚠️</span>
              <h3 style={{ margin: 0 }}>Excluir Modelo</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
                Tem certeza de que deseja excluir o modelo{' '}
                <strong style={{ color: 'var(--cm-foreground)' }}>{selectedModel.display_name}</strong>{' '}
                (<span style={{ fontFamily: 'monospace' }}>{selectedModel.model_id}</span>)?
              </div>

              {selectedModel.is_default_for_plans && selectedModel.is_default_for_plans.length > 0 && (
                <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-primary) 12%, transparent)', color: 'var(--cm-primary)', fontSize: '12px' }}>
                  <strong>Atenção:</strong> Este modelo é atualmente o padrão para os planos:{' '}
                  <strong>{selectedModel.is_default_for_plans.join(', ')}</strong>. A exclusão será
                  bloqueada pelo sistema enquanto ele for o padrão ativo. Reatribua outro modelo padrão antes
                  de excluir.
                </div>
              )}

              {formError && (
                <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', fontSize: '12px' }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--cm-border)' }}>
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  style={{ ...secondaryButtonStyle, color: 'var(--cm-muted-foreground)', opacity: isMutating ? 0.5 : 1, cursor: isMutating ? 'not-allowed' : 'pointer', fontSize: '12px' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteModel}
                  disabled={isMutating}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '32px', padding: '0 16px', background: 'var(--cm-destructive)', color: 'var(--cm-destructive-foreground)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: isMutating ? 'not-allowed' : 'pointer', opacity: isMutating ? 0.5 : 1 }}
                >
                  {isMutating && (
                    <div style={{ width: '14px', height: '14px', border: '2px solid var(--cm-destructive-foreground)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'cm-auth-spin 0.8s linear infinite' }} />
                  )}
                  <span>{isMutating ? 'Deleting...' : 'Confirm Deletion'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
