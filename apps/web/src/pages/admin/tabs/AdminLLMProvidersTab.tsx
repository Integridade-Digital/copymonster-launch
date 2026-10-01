import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'

export interface LLMProvider {
  id: string
  name: string
  provider_type: 'openai' | 'anthropic' | 'deepseek' | 'google' | 'groq' | 'openrouter' | 'custom' | string
  base_url: string | null
  is_active: boolean
  allowed_plans: string[]
  has_api_key: boolean
  api_key_masked: string | null
  created_at: string
  updated_at: string
}

const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic', defaultUrl: 'https://api.anthropic.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', defaultUrl: 'https://api.deepseek.com/v1' },
  { value: 'google', label: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com' },
  { value: 'groq', label: 'Groq', defaultUrl: 'https://api.groq.com/openai/v1' },
  { value: 'openrouter', label: 'OpenRouter', defaultUrl: 'https://openrouter.ai/api/v1' },
  { value: 'custom', label: 'Personalizado / Local', defaultUrl: '' },
]

const ALL_PLANS = [
  { id: 'starter', label: 'Starter' },
  { id: 'pro', label: 'Pro' },
  { id: 'legend', label: 'Legend' },
]

export function AdminLLMProvidersTab() {
  const [providers, setProviders] = useState<LLMProvider[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

  // Modais
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false)
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | null>(null)

  // Formulário de Edição / Criação
  const [formName, setFormName] = useState<string>('')
  const [formType, setFormType] = useState<string>('openai')
  const [formBaseUrl, setFormBaseUrl] = useState<string>('')
  const [formApiKey, setFormApiKey] = useState<string>('')
  const [showApiKey, setShowApiKey] = useState<boolean>(false)
  const [formIsActive, setFormIsActive] = useState<boolean>(true)
  const [formAllowedPlans, setFormAllowedPlans] = useState<string[]>(['starter', 'pro', 'legend'])

  // Feedback e Mutação
  const [isMutating, setIsMutating] = useState<boolean>(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [modalFeedback, setModalFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null)
  const [globalBanner, setGlobalBanner] = useState<{ type: 'error' | 'success'; message: string } | null>(null)

  const loadProviders = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await (supabase.rpc as any)('get_admin_llm_providers')
      if (rpcError) throw rpcError
      setProviders(data || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar provedores de IA.'
      setError(msg)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const openCreateModal = () => {
    setSelectedProvider(null)
    setFormName('')
    setFormType('openai')
    setFormBaseUrl('https://api.openai.com/v1')
    setFormApiKey('')
    setShowApiKey(false)
    setFormIsActive(true)
    setFormAllowedPlans(['starter', 'pro', 'legend'])
    setModalFeedback(null)
    setIsEditModalOpen(true)
  }

  const openEditModal = (p: LLMProvider) => {
    setSelectedProvider(p)
    setFormName(p.name)
    setFormType(p.provider_type)
    setFormBaseUrl(p.base_url || '')
    setFormApiKey('')
    setShowApiKey(false)
    setFormIsActive(p.is_active)
    setFormAllowedPlans(p.allowed_plans || ['starter', 'pro', 'legend'])
    setModalFeedback(null)
    setIsEditModalOpen(true)
  }

  const openDeleteModal = (p: LLMProvider) => {
    setSelectedProvider(p)
    setModalFeedback(null)
    setIsDeleteModalOpen(true)
  }

  const closeModals = () => {
    if (isMutating) return
    setIsEditModalOpen(false)
    setIsDeleteModalOpen(false)
    setSelectedProvider(null)
    setModalFeedback(null)
  }

  const handleTypeChange = (newType: string) => {
    setFormType(newType)
    // Se não tiver URL preenchida ou se for a URL default do tipo anterior, sugere a default
    const matched = PROVIDER_TYPES.find((t) => t.value === newType)
    if (matched && (!formBaseUrl || PROVIDER_TYPES.some((t) => t.defaultUrl === formBaseUrl))) {
      setFormBaseUrl(matched.defaultUrl)
    }
  }

  const handlePlanToggle = (planId: string) => {
    setFormAllowedPlans((prev) =>
      prev.includes(planId) ? prev.filter((p) => p !== planId) : [...prev, planId]
    )
  }

  // Toggle rápido de ativo / inativo no card
  const handleToggleActive = async (p: LLMProvider, e: React.MouseEvent) => {
    e.stopPropagation()
    setTogglingId(p.id)
    setGlobalBanner(null)
    const nextStatus = !p.is_active
    try {
      const { error: rpcError } = await (supabase.rpc as any)('admin_toggle_llm_provider', {
        p_id: p.id,
        p_is_active: nextStatus,
      })
      if (rpcError) throw rpcError

      setProviders((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, is_active: nextStatus } : item))
      )
      setGlobalBanner({
        type: 'success',
        message: `Provedor "${p.name}" ${nextStatus ? 'ativado' : 'desativado'} com sucesso.`,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao alterar status do provedor.'
      setGlobalBanner({ type: 'error', message: msg })
    } finally {
      setTogglingId(null)
    }
  }

  // Salvar (criação ou edição)
  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) {
      setModalFeedback({ type: 'error', message: 'O nome do provedor é obrigatório.' })
      return
    }
    if (formAllowedPlans.length === 0) {
      setModalFeedback({ type: 'error', message: 'Selecione ao menos um plano autorizado.' })
      return
    }

    setIsMutating(true)
    setModalFeedback(null)

    try {
      const payload: Record<string, any> = {
        p_id: selectedProvider?.id || null,
        p_name: formName.trim(),
        p_provider_type: formType,
        p_base_url: formBaseUrl.trim() || null,
        p_api_key: formApiKey.trim() || null,
        p_is_active: formIsActive,
        p_allowed_plans: formAllowedPlans,
      }

      const { error: rpcError } = await (supabase.rpc as any)('admin_save_llm_provider', payload)
      if (rpcError) throw rpcError

      setModalFeedback({
        type: 'success',
        message: selectedProvider ? 'Provedor atualizado com sucesso!' : 'Provedor cadastrado com sucesso!',
      })

      setTimeout(() => {
        closeModals()
        loadProviders(true)
      }, 700)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar provedor de IA.'
      setModalFeedback({ type: 'error', message: msg })
    } finally {
      setIsMutating(false)
    }
  }

  // Excluir provedor
  const handleDeleteProvider = async () => {
    if (!selectedProvider) return
    setIsMutating(true)
    setModalFeedback(null)

    try {
      const { error: rpcError } = await (supabase.rpc as any)('admin_delete_llm_provider', {
        p_id: selectedProvider.id,
      })
      if (rpcError) throw rpcError

      setGlobalBanner({
        type: 'success',
        message: `Provedor "${selectedProvider.name}" excluído com sucesso.`,
      })
      closeModals()
      loadProviders(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao excluir provedor.'
      setModalFeedback({ type: 'error', message: msg })
    } finally {
      setIsMutating(false)
    }
  }

  const activeCount = providers.filter((p) => p.is_active).length

  const getProviderBadge = (type: string) => {
    switch (type.toLowerCase()) {
      case 'openai':
        return { label: 'OpenAI', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' }
      case 'anthropic':
        return { label: 'Anthropic', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' }
      case 'deepseek':
        return { label: 'DeepSeek', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' }
      case 'google':
        return { label: 'Google Gemini', bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' }
      case 'groq':
        return { label: 'Groq', bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' }
      case 'openrouter':
        return { label: 'OpenRouter', bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' }
      default:
        return { label: 'Custom', bg: 'bg-[#30363d]/50', text: 'text-[#f0f6fc]', border: 'border-[#30363d]' }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header com título, contadores e ações principais */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#30363d]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-[#f0f6fc]">Provedores de IA & Conectividade</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#161b22] border border-[#30363d] text-[#e7bf73] font-medium">
              {activeCount} de {providers.length} ativos
            </span>
          </div>
          <p className="text-xs text-[#8b949e] mt-1">
            Gerencie as conexões de inteligência artificial, credenciais criptografadas e limites por plano.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsRefreshing(true)
              loadProviders(true)
            }}
            disabled={isLoading || isRefreshing}
            className="px-3 py-1.5 rounded-lg border border-[#30363d] bg-[#161b22] hover:bg-[#30363d]/50 text-xs font-medium text-[#f0f6fc] transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <span className={isRefreshing ? 'animate-spin' : ''}>🔄</span>
            <span>Atualizar</span>
          </button>

          <button
            onClick={openCreateModal}
            className="px-3.5 py-1.5 rounded-lg border border-[#e7bf73]/30 bg-[#e7bf73] hover:bg-[#d8ae5f] text-[#0d1117] text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
          >
            <span>+</span>
            <span>Novo Provedor</span>
          </button>
        </div>
      </div>

      {/* Banner de Feedback Global */}
      {globalBanner && (
        <div
          className={`p-3 rounded-lg text-xs border flex items-center justify-between ${
            globalBanner.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/15 text-rose-300'
          }`}
        >
          <span>{globalBanner.message}</span>
          <button onClick={() => setGlobalBanner(null)} className="opacity-70 hover:opacity-100 p-0.5">
            ✕
          </button>
        </div>
      )}

      {/* Estados: Loading, Erro, Vazio */}
      {isLoading ? (
        <div className="py-16 text-center space-y-3">
          <div className="w-6 h-6 border-2 border-[#e7bf73] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-[#8b949e]">Carregando catálogo de provedores...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs space-y-2">
          <p className="font-semibold">Erro ao carregar provedores:</p>
          <p>{error}</p>
          <button
            onClick={() => loadProviders()}
            className="mt-2 px-3 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 transition"
          >
            Tentar novamente
          </button>
        </div>
      ) : providers.length === 0 ? (
        <div className="py-16 text-center space-y-3 rounded-xl border border-dashed border-[#30363d] bg-[#161b22]/30">
          <div className="text-2xl">🤖</div>
          <h3 className="text-sm font-semibold text-[#f0f6fc]">Nenhum provedor cadastrado</h3>
          <p className="text-xs text-[#8b949e] max-w-sm mx-auto">
            Configure seu primeiro provedor de LLM para começar a conectar modelos de IA aos planos da plataforma.
          </p>
          <button
            onClick={openCreateModal}
            className="mt-2 px-4 py-2 rounded-lg bg-[#e7bf73] hover:bg-[#d8ae5f] text-[#0d1117] text-xs font-semibold transition"
          >
            + Cadastrar Provedor
          </button>
        </div>
      ) : (
        /* Grid de Cards de Provedores */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map((p) => {
            const badge = getProviderBadge(p.provider_type)
            const isToggling = togglingId === p.id

            return (
              <div
                key={p.id}
                className="flex flex-col justify-between rounded-xl border border-[#30363d] bg-[#161b22] hover:border-[#e7bf73]/30 transition p-4 space-y-4"
              >
                {/* Topo do Card: Badge + Status Toggle */}
                <div>
                  <div className="flex items-center justify-between gap-2 pb-2">
                    <span
                      className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${badge.bg} ${badge.text} ${badge.border}`}
                    >
                      {badge.label}
                    </span>

                    {/* Toggle Rápido Ativo / Inativo */}
                    <button
                      type="button"
                      onClick={(e) => handleToggleActive(p, e)}
                      disabled={isToggling}
                      title={p.is_active ? 'Clique para desativar' : 'Clique para ativar'}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                        p.is_active ? 'bg-emerald-500' : 'bg-[#30363d]'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          p.is_active ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Nome e URL */}
                  <h3 className="text-sm font-semibold text-[#f0f6fc] truncate" title={p.name}>
                    {p.name}
                  </h3>
                  <p className="text-[11px] text-[#8b949e] font-mono truncate mt-0.5" title={p.base_url || 'URL padrão'}>
                    {p.base_url || 'https://api...'}
                  </p>
                </div>

                {/* Status da Chave & Planos Permitidos */}
                <div className="space-y-2 pt-2 border-t border-[#30363d]/60 text-xs">
                  {/* Status da API Key */}
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#8b949e]">Chave de API:</span>
                    {p.has_api_key ? (
                      <span className="flex items-center gap-1 font-mono text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        {p.api_key_masked || 'Configurada'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        Não configurada
                      </span>
                    )}
                  </div>

                  {/* Planos Permitidos */}
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#8b949e]">Planos:</span>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {p.allowed_plans && p.allowed_plans.length > 0 ? (
                        p.allowed_plans.map((pl) => (
                          <span
                            key={pl}
                            className="px-1.5 py-0.2 rounded bg-[#0d1117] border border-[#30363d] text-[10px] text-[#e7bf73] uppercase font-mono"
                          >
                            {pl}
                          </span>
                        ))
                      ) : (
                        <span className="text-[#8b949e] italic">Nenhum</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Ações do Card */}
                <div className="pt-2 border-t border-[#30363d] flex items-center justify-between gap-1.5">
                  {/* Botão Testar Conectividade DESABILITADO com tooltip */}
                  <button
                    type="button"
                    disabled
                    title="Disponível em bloco futuro"
                    className="flex-1 px-2 py-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] text-[#8b949e] text-[11px] font-medium opacity-50 cursor-not-allowed flex items-center justify-center gap-1"
                  >
                    <span>⚡</span>
                    <span className="truncate">Testar Conexão</span>
                  </button>

                  {/* Botão Editar */}
                  <button
                    type="button"
                    onClick={() => openEditModal(p)}
                    className="px-2.5 py-1.5 rounded-lg border border-[#30363d] bg-[#161b22] hover:bg-[#30363d]/50 text-[#f0f6fc] text-[11px] font-medium transition"
                  >
                    Editar
                  </button>

                  {/* Botão Excluir */}
                  <button
                    type="button"
                    onClick={() => openDeleteModal(p)}
                    className="px-2.5 py-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-[11px] font-medium transition"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal 1: Criar / Editar Provedor (Padrão Settings) */}
      {isEditModalOpen && (
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
            className="relative z-10 w-full max-w-lg rounded-2xl border border-[#e7bf73]/25 bg-[#161b22] p-6 shadow-2xl space-y-5 focus:outline-none max-h-[90vh] overflow-y-auto"
          >
            {/* Header do Modal */}
            <div className="flex items-center justify-between pb-3 border-b border-[#30363d]">
              <h3 className="text-sm font-semibold text-[#f0f6fc]">
                {selectedProvider ? 'Editar Provedor de IA' : 'Novo Provedor de IA'}
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

            {/* Formulário */}
            <form onSubmit={handleSaveProvider} className="space-y-4 text-xs">
              {/* Campo Nome */}
              <div className="space-y-1">
                <label className="text-[#8b949e] font-medium">Nome de Exibição *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: OpenAI Principal, DeepSeek v3..."
                  disabled={isMutating}
                  className="w-full px-3 py-2 rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] placeholder-[#8b949e]/50 focus:border-[#e7bf73] focus:outline-none"
                />
              </div>

              {/* Campo Tipo de Provedor */}
              <div className="space-y-1">
                <label className="text-[#8b949e] font-medium">Tipo de Provedor *</label>
                <select
                  value={formType}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  disabled={isMutating}
                  className="w-full px-3 py-2 rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] focus:border-[#e7bf73] focus:outline-none"
                >
                  {PROVIDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Campo Base URL */}
              <div className="space-y-1">
                <label className="text-[#8b949e] font-medium">Base URL (Opcional)</label>
                <input
                  type="text"
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  placeholder="https://api..."
                  disabled={isMutating}
                  className="w-full px-3 py-2 rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] placeholder-[#8b949e]/50 focus:border-[#e7bf73] focus:outline-none font-mono text-[11px]"
                />
              </div>

              {/* Campo API Key com Criptografia */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[#8b949e] font-medium">
                    {selectedProvider ? 'Nova API Key (deixe vazio para manter atual)' : 'API Key *'}
                  </label>
                  {selectedProvider?.has_api_key && (
                    <span className="text-[10px] text-emerald-400 font-mono">
                      Atual: {selectedProvider.api_key_masked}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder={
                      selectedProvider
                        ? 'Deixe em branco para manter a chave atual'
                        : 'sk-...'
                    }
                    disabled={isMutating}
                    className="w-full px-3 py-2 pr-10 rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] placeholder-[#8b949e]/50 focus:border-[#e7bf73] focus:outline-none font-mono text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8b949e] hover:text-[#f0f6fc] text-xs p-1"
                  >
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                </div>
                <p className="text-[10px] text-[#8b949e]">
                  🔒 A chave é criptografada com pgcrypto (AES-256) antes de ser gravada e nunca sai em claro.
                </p>
              </div>

              {/* Checkboxes de Planos Permitidos */}
              <div className="space-y-2 pt-1">
                <label className="text-[#8b949e] font-medium">Planos Autorizados a Usar este Provedor *</label>
                <div className="flex gap-4">
                  {ALL_PLANS.map((plan) => {
                    const isChecked = formAllowedPlans.includes(plan.id)
                    return (
                      <label
                        key={plan.id}
                        className="flex items-center gap-2 cursor-pointer text-[#f0f6fc] select-none"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handlePlanToggle(plan.id)}
                          disabled={isMutating}
                          className="w-4 h-4 rounded border-[#30363d] bg-[#0d1117] text-[#e7bf73] focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <span className="text-xs">{plan.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Toggle de Ativo */}
              <div className="pt-2 flex items-center justify-between border-t border-[#30363d]">
                <div>
                  <div className="text-[#f0f6fc] font-medium">Provedor Ativo</div>
                  <div className="text-[#8b949e] text-[11px]">Habilitar este provedor para inferência no sistema</div>
                </div>
                <button
                  type="button"
                  onClick={() => setFormIsActive(!formIsActive)}
                  disabled={isMutating}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    formIsActive ? 'bg-emerald-500' : 'bg-[#30363d]'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      formIsActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Feedback no Modal */}
              {modalFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    modalFeedback.type === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {modalFeedback.message}
                </div>
              )}

              {/* Ações do Modal */}
              <div className="pt-3 flex gap-2 border-t border-[#30363d]">
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  className="w-1/2 px-4 py-2.5 rounded-lg border border-[#30363d] bg-[#161b22] hover:bg-[#30363d]/50 text-[#8b949e] hover:text-[#f0f6fc] transition font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isMutating}
                  className="w-1/2 px-4 py-2.5 rounded-lg border border-[#e7bf73]/30 bg-[#e7bf73] hover:bg-[#d8ae5f] text-[#0d1117] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isMutating && (
                    <div className="w-3.5 h-3.5 border-2 border-[#0d1117] border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>{selectedProvider ? 'Salvar Alterações' : 'Criar Provedor'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Confirmação de Exclusão (Padrão Settings) */}
      {isDeleteModalOpen && selectedProvider && (
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
            className="relative z-10 w-full max-w-md rounded-2xl border border-rose-500/30 bg-[#161b22] p-6 shadow-2xl space-y-5 focus:outline-none"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#30363d]">
              <h3 className="text-sm font-semibold text-[#f0f6fc]">Excluir Provedor de IA</h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="text-[#8b949e] hover:text-[#f0f6fc] p-1 transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-[#8b949e]">
                Tem certeza de que deseja excluir permanentemente o provedor{' '}
                <strong className="text-[#f0f6fc]">{selectedProvider.name}</strong>?
              </p>

              <div className="p-3 rounded-lg border border-[#30363d] bg-[#0d1117] space-y-1">
                <div className="text-[#f0f6fc] font-medium">{selectedProvider.name}</div>
                <div className="text-[#8b949e] font-mono text-[11px]">Tipo: {selectedProvider.provider_type}</div>
                <div className="text-[#8b949e] font-mono text-[11px] truncate">
                  URL: {selectedProvider.base_url || 'Padrão'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-300 text-[11px]">
                ⚠️ A exclusão será bloqueada pelo sistema se existirem modelos associados a este provedor no catálogo.
              </div>

              {modalFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    modalFeedback.type === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {modalFeedback.message}
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  className="w-1/2 px-4 py-2.5 rounded-lg border border-[#30363d] bg-[#161b22] hover:bg-[#30363d]/50 text-[#8b949e] hover:text-[#f0f6fc] transition font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDeleteProvider}
                  disabled={isMutating}
                  className="w-1/2 px-4 py-2.5 rounded-lg border border-rose-500/40 bg-rose-500 hover:bg-rose-600 text-white font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isMutating && (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>Confirmar Exclusão</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
