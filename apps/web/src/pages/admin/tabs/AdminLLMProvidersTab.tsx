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

function feedbackBannerStyle(type: 'error' | 'success'): React.CSSProperties {
  const tone = type === 'success' ? 'var(--cm-success)' : 'var(--cm-destructive)'
  return {
    padding: '10px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
    background: `color-mix(in srgb, ${tone} 12%, transparent)`,
    color: tone,
  }
}

export function AdminLLMProvidersTab() {
  const [providers, setProviders] = useState<LLMProvider[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false)
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | null>(null)

  const [formName, setFormName] = useState<string>('')
  const [formType, setFormType] = useState<string>('openai')
  const [formBaseUrl, setFormBaseUrl] = useState<string>('')
  const [formApiKey, setFormApiKey] = useState<string>('')
  const [showApiKey, setShowApiKey] = useState<boolean>(false)
  const [formIsActive, setFormIsActive] = useState<boolean>(true)
  const [formAllowedPlans, setFormAllowedPlans] = useState<string[]>(['starter', 'pro', 'legend'])

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
    const matched = PROVIDER_TYPES.find(t => t.value === newType)
    if (matched && (!formBaseUrl || PROVIDER_TYPES.some(t => t.defaultUrl === formBaseUrl))) {
      setFormBaseUrl(matched.defaultUrl)
    }
  }

  const handlePlanToggle = (planId: string) => {
    setFormAllowedPlans(prev =>
      prev.includes(planId) ? prev.filter(p => p !== planId) : [...prev, planId],
    )
  }

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

      setProviders(prev =>
        prev.map(item => (item.id === p.id ? { ...item, is_active: nextStatus } : item)),
      )
      setGlobalBanner({
        type: 'success',
        message: `Provider "${p.name}" ${nextStatus ? 'activated' : 'deactivated'} successfully.`,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error ao alterar status do provedor.'
      setGlobalBanner({ type: 'error', message: msg })
    } finally {
      setTogglingId(null)
    }
  }

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) {
      setModalFeedback({ type: 'error', message: 'Provider name is required.' })
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
        message: selectedProvider ? 'Provider updated successfully!' : 'Provider registered successfully!',
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
        message: `Provider "${selectedProvider.name}" deleted successfully.`,
      })
      closeModals()
      loadProviders(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete provider.'
      setModalFeedback({ type: 'error', message: msg })
    } finally {
      setIsMutating(false)
    }
  }

  const activeCount = providers.filter(p => p.is_active).length

  const getProviderBadge = (type: string) => {
    switch (type.toLowerCase()) {
      case 'openai':
        return { label: 'OpenAI', color: 'var(--cm-success)' }
      case 'anthropic':
        return { label: 'Anthropic', color: 'var(--cm-primary)' }
      case 'deepseek':
        return { label: 'DeepSeek', color: 'var(--cm-primary)' }
      case 'google':
        return { label: 'Google Gemini', color: 'var(--cm-primary)' }
      case 'groq':
        return { label: 'Groq', color: 'var(--cm-primary)' }
      case 'openrouter':
        return { label: 'OpenRouter', color: 'var(--cm-primary)' }
      default:
        return { label: 'Custom', color: 'var(--cm-muted-foreground)' }
    }
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', color: 'var(--cm-foreground)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', paddingBottom: '16px', borderBottom: '1px solid var(--cm-border)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2>Provedores de IA & Conectividade</h2>
            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: 'color-mix(in srgb, var(--cm-card) 60%, transparent)', border: '1px solid var(--cm-border)', color: 'var(--cm-primary)' }}>
              {activeCount} de {providers.length} ativos
            </span>
          </div>
          <p style={{ marginTop: '4px' }}>
            Manage AI connections, encrypted credentials, and plan limits.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => {
              setIsRefreshing(true)
              loadProviders(true)
            }}
            disabled={isLoading || isRefreshing}
            style={{ ...secondaryButtonStyle, opacity: isLoading || isRefreshing ? 0.5 : 1, cursor: isLoading || isRefreshing ? 'not-allowed' : 'pointer' }}
          >
            <span style={isRefreshing ? { display: 'inline-block', animation: 'cm-auth-spin 0.8s linear infinite' } : undefined}>🔄</span>
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="adminButton"
            style={{ gap: '6px' }}
          >
            <span>+</span>
            <span>New Provider</span>
          </button>
        </div>
      </div>

      {globalBanner && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', ...feedbackBannerStyle(globalBanner.type) }}>
          <span>{globalBanner.message}</span>
          <button
            type="button"
            onClick={() => setGlobalBanner(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', opacity: 0.7, fontSize: '12px', lineHeight: 1, padding: '2px' }}
          >
            ✕
          </button>
        </div>
      )}

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '64px 0' }}>
          <div style={{ width: '24px', height: '24px', border: '2px solid var(--cm-primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'cm-auth-spin 0.8s linear infinite' }} />
          <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>Loading providers catalog...</div>
        </div>
      ) : error ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', borderRadius: '12px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', fontSize: '12px' }}>
          <div style={{ fontWeight: 600 }}>Error ao carregar provedores:</div>
          <div>{error}</div>
          <button
            type="button"
            onClick={() => loadProviders()}
            style={{ alignSelf: 'flex-start', marginTop: '4px', padding: '4px 12px', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 15%, transparent)', color: 'var(--cm-destructive)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
          >
            Tentar novamente
          </button>
        </div>
      ) : providers.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '64px 24px', textAlign: 'center', borderRadius: '12px', border: '1px dashed var(--cm-border)', background: 'color-mix(in srgb, var(--cm-card) 40%, transparent)' }}>
          <div style={{ fontSize: '28px' }}>🤖</div>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>Nenhum provedor cadastrado</div>
          <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', maxWidth: '360px' }}>
            Configure your first LLM provider to start connecting AI models to platform plans.
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="adminButton"
            style={{ marginTop: '8px' }}
          >
            + Cadastrar Provedor
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {providers.map((p) => {
            const badge = getProviderBadge(p.provider_type)
            const isToggling = togglingId === p.id

            return (
              <div
                key={p.id}
                style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                    {badge.label.toLowerCase() !== p.name.toLowerCase() ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          background: `color-mix(in srgb, ${badge.color} 15%, transparent)`,
                          color: badge.color,
                          border: `1px solid color-mix(in srgb, ${badge.color} 30%, transparent)`,
                        }}
                      >
                        {badge.label}
                      </span>
                    ) : (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          background: 'var(--cm-secondary)',
                          color: 'var(--cm-muted-foreground)',
                          border: '1px solid var(--cm-border)',
                        }}
                      >
                        OFICIAL
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={e => handleToggleActive(p, e)}
                      disabled={isToggling}
                      title={p.is_active ? 'Clique para desativar' : 'Clique para ativar'}
                      style={{
                        position: 'relative',
                        display: 'inline-block',
                        width: '36px',
                        height: '20px',
                        flexShrink: 0,
                        padding: 0,
                        border: 'none',
                        borderRadius: '10px',
                        background: p.is_active ? 'var(--cm-primary)' : 'var(--cm-secondary)',
                        cursor: isToggling ? 'wait' : 'pointer',
                        opacity: isToggling ? 0.5 : 1,
                        transition: 'background 0.2s',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          top: '2px',
                          left: p.is_active ? '18px' : '2px',
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          background: 'white',
                          transition: 'left 0.2s',
                        }}
                      />
                    </button>
                  </div>

                  <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>
                    {p.name}
                  </h3>
                  <div
                    style={{ fontSize: '11px', color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}
                    title={p.base_url || 'Default URL'}
                  >
                    {p.base_url || 'https://api...'}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px', borderTop: '1px solid color-mix(in srgb, var(--cm-border) 60%, transparent)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--cm-muted-foreground)' }}>API Key:</span>
                    {p.has_api_key ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontFamily: 'monospace', color: 'var(--cm-success)' }}>
                        <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--cm-success)' }} />
                        {p.api_key_masked || 'Configurada'}
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 500, color: 'var(--cm-primary)' }}>
                        <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--cm-primary)' }} />
                        Not configured
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '11px' }}>
                    <span style={{ color: 'var(--cm-muted-foreground)', flexShrink: 0 }}>Plans:</span>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {p.allowed_plans && p.allowed_plans.length > 0 ? (
                        p.allowed_plans.map(pl => (
                          <span
                            key={pl}
                            style={{ padding: '1px 6px', borderRadius: '4px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', fontSize: '10px', color: 'var(--cm-primary)', textTransform: 'uppercase', fontFamily: 'monospace' }}
                          >
                            {pl}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: 'var(--cm-muted-foreground)', fontStyle: 'italic' }}>Nenhum</span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '8px', borderTop: '1px solid var(--cm-border)' }}>
                  <button
                    type="button"
                    disabled
                    title="Available in a future release"
                    style={{
                      flex: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      padding: '5px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--cm-border)',
                      background: 'var(--cm-background)',
                      color: 'var(--cm-muted-foreground)',
                      fontSize: '11px',
                      fontWeight: 500,
                      opacity: 0.5,
                      cursor: 'not-allowed',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span>⚡</span>
                    <span>Test Connection</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openEditModal(p)}
                    style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', color: 'var(--cm-foreground)', cursor: 'pointer', fontSize: '11px', fontWeight: 500 }}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => openDeleteModal(p)}
                    style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 25%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', cursor: 'pointer', fontSize: '11px', fontWeight: 500 }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
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
              <h3>{selectedProvider ? 'Edit Provider de IA' : 'New Provider de IA'}</h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                style={{ border: 'none', background: 'transparent', color: 'var(--cm-muted-foreground)', cursor: isMutating ? 'not-allowed' : 'pointer', opacity: isMutating ? 0.5 : 1, fontSize: '16px', lineHeight: 1, padding: '4px' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveProvider} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label>Display Name *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: OpenAI Principal, DeepSeek v3..."
                  disabled={isMutating}
                  className="adminInput"
                  style={{ marginBottom: 0 }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label>Provider Type *</label>
                <select
                  value={formType}
                  onChange={e => handleTypeChange(e.target.value)}
                  disabled={isMutating}
                  className="adminInput"
                  style={{ marginBottom: 0 }}
                >
                  {PROVIDER_TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label>Base URL (Opcional)</label>
                <input
                  type="text"
                  value={formBaseUrl}
                  onChange={e => setFormBaseUrl(e.target.value)}
                  placeholder="https://api..."
                  disabled={isMutating}
                  className="adminInput"
                  style={{ marginBottom: 0, fontFamily: 'monospace', fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <label style={{ marginBottom: 0 }}>
                    {selectedProvider ? 'Nova API Key (deixe vazio para manter atual)' : 'API Key *'}
                  </label>
                  {selectedProvider?.has_api_key && (
                    <span style={{ fontSize: '10px', color: 'var(--cm-success)', fontFamily: 'monospace' }}>
                      Atual: {selectedProvider.api_key_masked}
                    </span>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formApiKey}
                    onChange={e => setFormApiKey(e.target.value)}
                    placeholder={selectedProvider ? 'Deixe em branco para manter a chave atual' : 'sk-...'}
                    disabled={isMutating}
                    className="adminInput"
                    style={{ marginBottom: 0, paddingRight: '36px', fontFamily: 'monospace', fontSize: '12px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', color: 'var(--cm-muted-foreground)', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                  >
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--cm-muted-foreground)' }}>
                  🔒 The API key is encrypted with pgcrypto (AES-256) and never exposed in plaintext.
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label>Plans Autorizados a Usar este Provedor *</label>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  {ALL_PLANS.map((plan) => {
                    const isChecked = formAllowedPlans.includes(plan.id)
                    return (
                      <label
                        key={plan.id}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', whiteSpace: 'normal' }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handlePlanToggle(plan.id)}
                          disabled={isMutating}
                          style={{ width: '14px', height: '14px', accentColor: 'var(--cm-primary)', cursor: 'pointer', margin: 0 }}
                        />
                        <span style={{ fontSize: '12px', color: 'var(--cm-foreground)' }}>{plan.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', paddingTop: '12px', borderTop: '1px solid var(--cm-border)' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>Provedor Ativo</div>
                  <div style={{ color: 'var(--cm-muted-foreground)', fontSize: '11px' }}>Enable this provider for system inference</div>
                </div>
                <button
                  type="button"
                  onClick={() => setFormIsActive(!formIsActive)}
                  disabled={isMutating}
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: '36px',
                    height: '20px',
                    flexShrink: 0,
                    padding: 0,
                    border: 'none',
                    borderRadius: '10px',
                    background: formIsActive ? 'var(--cm-primary)' : 'var(--cm-secondary)',
                    cursor: isMutating ? 'not-allowed' : 'pointer',
                    opacity: isMutating ? 0.5 : 1,
                    transition: 'background 0.2s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '2px',
                      left: formIsActive ? '18px' : '2px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      background: 'white',
                      transition: 'left 0.2s',
                    }}
                  />
                </button>
              </div>

              {modalFeedback && (
                <div style={feedbackBannerStyle(modalFeedback.type)}>
                  {modalFeedback.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--cm-border)' }}>
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  style={{ ...secondaryButtonStyle, flex: 1, color: 'var(--cm-muted-foreground)', opacity: isMutating ? 0.5 : 1, cursor: isMutating ? 'not-allowed' : 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isMutating}
                  className="adminButton"
                  style={{ flex: 1, gap: '8px', justifyContent: 'center', opacity: isMutating ? 0.5 : 1 }}
                >
                  {isMutating && (
                    <div style={{ width: '14px', height: '14px', border: '2px solid var(--cm-primary-foreground)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'cm-auth-spin 0.8s linear infinite' }} />
                  )}
                  <span>{selectedProvider ? 'Save Changes' : 'Create Provider'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeleteModalOpen && selectedProvider && (
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
              <h3>Delete Provider de IA</h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                style={{ border: 'none', background: 'transparent', color: 'var(--cm-muted-foreground)', cursor: isMutating ? 'not-allowed' : 'pointer', opacity: isMutating ? 0.5 : 1, fontSize: '16px', lineHeight: 1, padding: '4px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px', fontSize: '12px' }}>
              <div style={{ color: 'var(--cm-muted-foreground)' }}>
                Tem certeza de que deseja excluir permanentemente o provedor{' '}
                <strong style={{ color: 'var(--cm-foreground)' }}>{selectedProvider.name}</strong>?
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '12px', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
                <div style={{ fontWeight: 500 }}>{selectedProvider.name}</div>
                <div style={{ color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', fontSize: '11px' }}>Tipo: {selectedProvider.provider_type}</div>
                <div style={{ color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  URL: {selectedProvider.base_url || 'Padrão'}
                </div>
              </div>

              <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-primary) 12%, transparent)', color: 'var(--cm-primary)', fontSize: '11px' }}>
                ⚠️ A exclusão será bloqueada pelo sistema se existirem modelos associados a este provedor no catálogo.
              </div>

              {modalFeedback && (
                <div style={feedbackBannerStyle(modalFeedback.type)}>
                  {modalFeedback.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', paddingTop: '4px' }}>
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  style={{ ...secondaryButtonStyle, flex: 1, color: 'var(--cm-muted-foreground)', opacity: isMutating ? 0.5 : 1, cursor: isMutating ? 'not-allowed' : 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteProvider}
                  disabled={isMutating}
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '32px', padding: '0 16px', background: 'var(--cm-destructive)', color: 'var(--cm-destructive-foreground)', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: isMutating ? 'not-allowed' : 'pointer', opacity: isMutating ? 0.5 : 1 }}
                >
                  {isMutating && (
                    <div style={{ width: '14px', height: '14px', border: '2px solid var(--cm-destructive-foreground)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'cm-auth-spin 0.8s linear infinite' }} />
                  )}
                  <span>Confirm Deletion</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
