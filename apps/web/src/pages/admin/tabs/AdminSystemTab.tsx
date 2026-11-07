import { formatDate } from '../../../lib/format'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'
import { t } from '../../../locales'

export interface SystemConfigItem {
  key: string
  value: unknown
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

export interface StoragePathsData {
  paths: {
    workspaces_root: string
    uploads_root: string
    logs_root: string
  }
  workspaces: Array<{
    id: string
    workspace_id: string
    title: string
    relative_path: string
    full_path: string
    tenant_id: string
    tenant_name: string
    created_at: string
  }>
}

export interface LlmProvider {
  id: string
  name: string
  provider_type: string
  base_url: string | null
  provider_route: string
  api_key_env: string | null
  is_active: boolean
  allowed_plans: string[]
  has_api_key: boolean
  api_key_masked: string
  created_at: string
  updated_at: string
}

export interface LlmModel {
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
  capabilities: Record<string, unknown>
  is_default_for_plans: string[]
  allowed_plans: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export function AdminSystemTab() {
  const [configs, setConfigs] = useState<SystemConfigItem[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [storageData, setStorageData] = useState<StoragePathsData | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const [flagSearchQuery, setFlagSearchQuery] = useState<string>('')
  const [limitSearchQuery, setLimitSearchQuery] = useState<string>('')
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState<string>('')
  const [storageWsSearchQuery, setStorageWsSearchQuery] = useState<string>('')
  const [llmSearchQuery, setLlmSearchQuery] = useState<string>('')

  // Editing state for the dedicated Central LLM Routing cards. Kept separate
  // from the generic llm.* table so mask/primary/fallback/delegation can be
  // saved without tripping the llm.mask.* protection in the generic editor.
  const [llmForm, setLlmForm] = useState<{
    maskEnabled: boolean
    maskVirtualModel: string
    maskVirtualModelName: string
    primaryProvider: string
    primaryModel: string
    fallback: Array<{ provider: string; model?: string }>
    delegationEnabled: boolean
    delegationProvider: string
    delegationModel: string
  }>({
    maskEnabled: false,
    maskVirtualModel: '',
    maskVirtualModelName: '',
    primaryProvider: '',
    primaryModel: '',
    fallback: [],
    delegationEnabled: false,
    delegationProvider: '',
    delegationModel: '',
  })
  const llmFormInitialized = useRef(false)

  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false)
  const [isDeleteConfigModalOpen, setIsDeleteConfigModalOpen] = useState<boolean>(false)
  const [isArchiveWorkspaceModalOpen, setIsArchiveWorkspaceModalOpen] = useState<boolean>(false)

  // LLM Providers and Models state
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([])
  const [llmModels, setLlmModels] = useState<LlmModel[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState<boolean>(true)
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false)

  const [selectedConfig, setSelectedConfig] = useState<SystemConfigItem | null>(null)
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceItem | null>(null)

  const [formKey, setFormKey] = useState<string>('')
  const [formValueStr, setFormValueStr] = useState<string>('')
  const [formDescription, setFormDescription] = useState<string>('')
  const [formPrefixType, setFormPrefixType] = useState<'feature' | 'limit' | 'quota' | 'llm' | 'other'>('feature')
  const [formError, setFormError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState<boolean>(false)
  const [llmSaveFeedback, setLlmSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleCopyText = (text: string, key: string) => {
    if (!navigator?.clipboard?.writeText) return
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => {
        setCopiedKey(prev => (prev === key ? null : prev))
      }, 1500)
    }).catch((err) => {
      console.error('Failed to copy:', err)
    })
  }

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true)
    setError(null)
    try {
      const [configsRes, workspacesRes, storageRes] = await Promise.all([
        supabase.rpc('get_admin_system_config'),
        supabase.rpc('get_admin_workspaces'),
        supabase.rpc('get_admin_storage_paths'),
      ])

      if (configsRes.error) throw new Error(configsRes.error.message)
      if (workspacesRes.error) throw new Error(workspacesRes.error.message)
      if (!storageRes.error && storageRes.data) {
        setStorageData(storageRes.data)
      } else if (storageRes.error) {
        console.warn('get_admin_storage_paths ainda não disponível ou erro:', storageRes.error.message)
      }

      setConfigs(configsRes.data || [])
      setWorkspaces(workspacesRes.data || [])
    } catch (err: unknown) {
      console.error('Failed to load system settings:', err)
      setError(err instanceof Error ? err.message : t('admin.system.loadFailure'))
    } finally {
      if (!isSilent) setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  const loadProviders = useCallback(async () => {
    setIsLoadingProviders(true)
    try {
      const { data, error } = await (supabase.rpc as unknown as (name: string) => Promise<{ data: LlmProvider[] | null; error: { message: string } | null }>)('get_admin_llm_providers')
      if (error) throw new Error(error.message)
      // Filter only active providers that have API keys configured
      const activeProviders = (data || []).filter((p: LlmProvider) => p.is_active && p.has_api_key)
      setLlmProviders(activeProviders)
    } catch (err: unknown) {
      console.error('Failed to load LLM providers:', err)
    } finally {
      setIsLoadingProviders(false)
    }
  }, [])

  const loadModelsForProvider = useCallback(async (providerId: string) => {
    setIsLoadingModels(true)
    try {
      const { data, error } = await (supabase.rpc as unknown as (name: string) => Promise<{ data: LlmModel[] | null; error: { message: string } | null }>)('get_admin_llm_models')
      if (error) throw new Error(error.message)
      // Filter models for the selected provider that are active
      const providerModels = (data || []).filter(
        (m: LlmModel) => m.provider_id === providerId && m.is_active && m.provider_is_active
      )
      setLlmModels(providerModels)
    } catch (err: unknown) {
      console.error('Failed to load LLM models:', err)
      setLlmModels([])
    } finally {
      setIsLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    loadProviders()
  }, [loadData, loadProviders])

  // Load models when provider changes
  useEffect(() => {
    if (llmForm.primaryProvider) {
      loadModelsForProvider(llmForm.primaryProvider)
    } else {
      setLlmModels([])
    }
  }, [llmForm.primaryProvider, loadModelsForProvider])

  const handleRefresh = () => {
    setIsRefreshing(true)
    loadData(true)
  }

  const featureFlags = useMemo(() => {
    return configs.filter(c => c.key.startsWith('feature.'))
  }, [configs])

  const limitConfigs = useMemo(() => {
    return configs.filter(c => c.key.startsWith('limit.') || c.key.startsWith('quota.'))
  }, [configs])

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

  const llmConfigs = useMemo(() => {
    return configs.filter(c => c.key.startsWith('llm.'))
  }, [configs])

  const filteredLlm = useMemo(() => {
    const q = llmSearchQuery.toLowerCase().trim()
    if (!q) return llmConfigs
    return llmConfigs.filter(
      l => l.key.toLowerCase().includes(q) || (l.description && l.description.toLowerCase().includes(q)),
    )
  }, [llmConfigs, llmSearchQuery])

  // ---- Central LLM routing helpers ---------------------------------------

  const configByKey = useMemo(() => {
    const map = new Map<string, SystemConfigItem>()
    for (const c of configs) map.set(c.key, c)
    return map
  }, [configs])

  const getStr = (key: string, def = '') => {
    const c = configByKey.get(key)
    if (!c) return def
    if (typeof c.value === 'string') return c.value
    if (c.value && typeof c.value === 'object') return JSON.stringify(c.value)
    return String(c.value ?? def)
  }

  const getBool = (key: string, def = false) => {
    const c = configByKey.get(key)
    if (!c) return def
    if (typeof c.value === 'boolean') return c.value
    return def
  }

  function getJson<T>(key: string, def: T): T {
    const c = configByKey.get(key)
    if (!c) return def
    if (c.value && typeof c.value === 'object') return c.value as T
    try {
      return JSON.parse(String(c.value)) as T
    } catch {
      return def
    }
  }

  const saveLlmConfig = async (key: string, value: unknown) => {
    setIsMutating(true)
    try {
      const { error } = await supabase.rpc('admin_upsert_system_config', {
        p_key: key,
        p_value: value,
        p_description: null,
        p_is_secret: false,
      })
      if (error) throw new Error(error.message)
      await loadData(true)
      setLlmSaveFeedback({ type: 'success', message: t('admin.system.llm.savedSuccess') })
    } catch (err: unknown) {
      setLlmSaveFeedback({ type: 'error', message: err instanceof Error ? err.message : t('admin.system.llm.saveFailure') })
    } finally {
      setIsMutating(false)
    }
  }

  const saveMask = async () => {
    await saveLlmConfig('llm.mask.enabled', llmForm.maskEnabled)
    await saveLlmConfig('llm.mask.virtualModel', llmForm.maskVirtualModel)
    await saveLlmConfig('llm.mask.virtualModelName', llmForm.maskVirtualModelName)
  }

  const savePrimary = async () => {
    await saveLlmConfig('llm.primary.provider', llmForm.primaryProvider)
    await saveLlmConfig('llm.primary.model', llmForm.primaryModel)
  }

  const saveFallback = async () => {
    await saveLlmConfig('llm.fallback', llmForm.fallback)
  }

  const saveDelegation = async () => {
    await saveLlmConfig('llm.delegation.enabled', llmForm.delegationEnabled)
    await saveLlmConfig('llm.delegation.provider', llmForm.delegationProvider)
    await saveLlmConfig('llm.delegation.model', llmForm.delegationModel)
  }

  // Seed the editing form from persisted config on first load only, so the
  // admin's in-flight edits are not clobbered by a subsequent reload.
  useEffect(() => {
    if (llmFormInitialized.current) return
    llmFormInitialized.current = true
    setLlmForm({
      maskEnabled: getBool('llm.mask.enabled'),
      maskVirtualModel: getStr('llm.mask.virtualModel', 'copy-monster-default'),
      maskVirtualModelName: getStr('llm.mask.virtualModelName', 'Model CopyMonster'),
      primaryProvider: getStr('llm.primary.provider', 'deepseek-official'),
      primaryModel: getStr('llm.primary.model', 'deepseek-chat'),
      fallback: getJson('llm.fallback', []),
      delegationEnabled: getBool('llm.delegation.enabled'),
      delegationProvider: getStr('llm.delegation.provider', ''),
      delegationModel: getStr('llm.delegation.model', ''),
    })
  }, [])

  const totalWorkspacesCount = workspaces.length

  const maskedSupabaseUrl = useMemo(() => {
    const rawUrl = (import.meta.env as Record<string, string | undefined>)?.VITE_SUPABASE_URL || ''
    if (!rawUrl) return t('admin.common.notConfigured')
    try {
      const url = new URL(rawUrl)
      return `${url.protocol}//${url.hostname.slice(0, 8)}...${url.hostname.slice(-8)}`
    } catch {
      return 'https://***.supabase.co'
    }
  }, [])

  const openCreateConfigModal = (type: 'feature' | 'limit' | 'quota' | 'llm') => {
    setSelectedConfig(null)
    setFormPrefixType(type)
    setFormKey(
      type === 'feature' ? 'feature.'
        : type === 'limit' ? 'limit.'
          : type === 'quota' ? 'quota.'
            : 'llm.',
    )
    setFormValueStr(
      type === 'feature' ? '{"enabled": true}'
        : type === 'limit' || type === 'quota' ? '1000'
          : '{"provider": "deepseek-official", "model": "deepseek-chat"}',
    )
    setFormDescription('')
    setFormError(null)
    setIsConfigModalOpen(true)
  }

  const openEditConfigModal = (item: SystemConfigItem) => {
    if (item.is_secret || item.key === 'LLM_ENCRYPTION_KEY' || item.key.startsWith('system.') || item.key.startsWith('llm.mask')) {
      alert(t('admin.system.protectedEdit'))
      return
    }
    setSelectedConfig(item)
    setFormKey(item.key)
    setFormValueStr(
      typeof item.value === 'object' ? JSON.stringify(item.value, null, 2) : String(item.value),
    )
    setFormDescription(item.description || '')
    setFormError(null)
    setIsConfigModalOpen(true)
  }

  const openDeleteConfigModal = (item: SystemConfigItem) => {
    if (item.is_secret || item.key === 'LLM_ENCRYPTION_KEY' || item.key.startsWith('system.') || item.key.startsWith('llm.mask')) {
      alert(t('admin.system.protectedDelete'))
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

  const handleToggleFeatureFlag = async (item: SystemConfigItem) => {
    if (item.is_secret || item.key.startsWith('system.')) return

    let nextValue: unknown
    if (typeof item.value === 'boolean') {
      nextValue = !item.value
    } else if (item.value && typeof item.value === 'object' && 'enabled' in item.value) {
      nextValue = { ...(item.value as Record<string, unknown>), enabled: !(item.value as { enabled: boolean }).enabled }
    } else {
      openEditConfigModal(item)
      return
    }

    try {
      const { error: saveErr } = await supabase.rpc('admin_upsert_system_config', {
        p_key: item.key,
        p_value: nextValue,
        p_description: item.description,
        p_is_secret: false,
      })
      if (saveErr) throw new Error(saveErr.message)
      loadData(true)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t('admin.system.flagFailure'))
    }
  }

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const key = formKey.trim()
    if (!key) {
      setFormError(t('admin.system.keyRequired'))
      return
    }
    if (key === 'LLM_ENCRYPTION_KEY' || key.startsWith('system.') || key.startsWith('llm.mask')) {
      setFormError(t('admin.system.reservedEdit'))
      return
    }

    let parsedValue: unknown
    try {
      parsedValue = JSON.parse(formValueStr)
    } catch {
      parsedValue = formValueStr
    }

    setIsMutating(true)
    try {
      const { error: saveErr } = await supabase.rpc('admin_upsert_system_config', {
        p_key: key,
        p_value: parsedValue,
        p_description: formDescription.trim() || null,
        p_is_secret: false,
      })
      if (saveErr) throw new Error(saveErr.message)

      closeModals()
      loadData(true)
    } catch (err: unknown) {
      console.error('Failed to save configuration:', err)
      setFormError(err instanceof Error ? err.message : t('admin.system.saveFailure'))
    } finally {
      setIsMutating(false)
    }
  }

  const handleDeleteConfig = async () => {
    if (!selectedConfig) return
    setIsMutating(true)
    setFormError(null)
    try {
      const { error: delErr } = await supabase.rpc('admin_delete_system_config', {
        p_key: selectedConfig.key,
      })
      if (delErr) throw new Error(delErr.message)

      closeModals()
      loadData(true)
    } catch (err: unknown) {
      console.error('Failed to delete key:', err)
      setFormError(err instanceof Error ? err.message : t('admin.system.deleteFailure'))
    } finally {
      setIsMutating(false)
    }
  }

  const handleArchiveWorkspace = async () => {
    if (!selectedWorkspace) return
    setIsMutating(true)
    setFormError(null)
    try {
      const { error: archErr } = await supabase.rpc('admin_delete_workspace', {
        p_id: selectedWorkspace.id,
      })
      if (archErr) throw new Error(archErr.message)

      closeModals()
      loadData(true)
    } catch (err: unknown) {
      console.error('Failed to archive workspace:', err)
      setFormError(err instanceof Error ? err.message : t('admin.system.archiveFailure'))
    } finally {
      setIsMutating(false)
    }
  }

  const filteredFlags = useMemo(() => {
    const q = flagSearchQuery.toLowerCase().trim()
    if (!q) return featureFlags
    return featureFlags.filter(
      f => f.key.toLowerCase().includes(q) || (f.description && f.description.toLowerCase().includes(q)),
    )
  }, [featureFlags, flagSearchQuery])

  const filteredLimits = useMemo(() => {
    const q = limitSearchQuery.toLowerCase().trim()
    if (!q) return limitConfigs
    return limitConfigs.filter(
      l => l.key.toLowerCase().includes(q) || (l.description && l.description.toLowerCase().includes(q)),
    )
  }, [limitConfigs, limitSearchQuery])

  const filteredWorkspaces = useMemo(() => {
    const q = workspaceSearchQuery.toLowerCase().trim()
    if (!q) return workspaces
    return workspaces.filter(
      w =>
        w.title.toLowerCase().includes(q) ||
        w.workspace_id.toLowerCase().includes(q) ||
        w.tenant_name.toLowerCase().includes(q) ||
        (w.user_email && w.user_email.toLowerCase().includes(q)),
    )
  }, [workspaces, workspaceSearchQuery])

  const storageWorkspaces = useMemo(() => {
    const list = storageData?.workspaces || []
    const q = storageWsSearchQuery.toLowerCase().trim()
    if (!q) return list
    return list.filter(
      w =>
        w.title.toLowerCase().includes(q) ||
        w.workspace_id.toLowerCase().includes(q) ||
        w.tenant_name.toLowerCase().includes(q) ||
        w.relative_path.toLowerCase().includes(q) ||
        w.full_path.toLowerCase().includes(q),
    )
  }, [storageData, storageWsSearchQuery])

  const workspacesRootPath = storageData?.paths.workspaces_root || '/var/dsh/workspaces'
  const uploadsRootPath = storageData?.paths.uploads_root || '/var/dsh/uploads'
  const logsRootPath = storageData?.paths.logs_root || '/var/dsh/logs'
  const sshExampleCommand = `ssh operador@servidor "cd ${workspacesRootPath} && ls -la"`

  return (
    <div className="adminTabBody">
      <div className="adminTabHeader">
        <div className="adminTabHeaderText">
          <div className="adminTabTitleRow">
            <p className="adminTabSubtitle">{t('admin.system.subtitle')}</p>
            <span className="adminBadge adminBadgePrimary">{t('admin.system.operational')}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className="adminButton adminButtonSecondary"
          style={{ opacity: (isRefreshing || isLoading) ? 0.5 : 1 }}
        >
          {isRefreshing ? <span className="adminSpinner" aria-hidden="true" /> : <span aria-hidden="true">↻</span>}
          {t('admin.common.refresh')}
        </button>
      </div>

      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.system.totalParams')}</div>
          <div className="adminCardValue">{totalConfigs}</div>
          <div className="adminCardSub">{t('admin.system.activeSettings')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.system.activeFlags')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>{activeFlagsCount}</div>
          <div className="adminCardSub">{t('admin.system.enabled')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.system.limits')}</div>
          <div className="adminCardValue">{totalLimitsCount}</div>
          <div className="adminCardSub">{t('admin.system.limitsHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.system.activeWorkspaces')}</div>
          <div className="adminCardValue">{totalWorkspacesCount}</div>
          <div className="adminCardSub">{t('admin.system.multiTenant')}</div>
        </div>
      </div>

      {error && (
        <div className="adminNotice adminNoticeError">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => loadData()}
            className="adminRowButton adminRowButtonDanger"
          >
            {t('admin.common.retry')}
          </button>
        </div>
      )}

      <div className="adminSectionCard">
        <div className="adminTabHeader">
          <div className="adminTabHeaderText">
            <h3 className="adminSectionTitle">{t('admin.system.environment')}</h3>
          </div>
          <span className="adminBadge">{t('admin.system.frontendBadge')}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div className="adminSubCard">
            <span className="adminFieldLabel">{t('admin.system.runtimeMode')}</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)', fontWeight: 500 }}>
              {(import.meta.env as Record<string, string | undefined>)?.MODE || t('admin.system.productionFallback')}
            </span>
          </div>
          <div className="adminSubCard">
            <span className="adminFieldLabel">{t('admin.system.supabaseEndpoint')}</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)', fontWeight: 500 }}>
              {maskedSupabaseUrl}
            </span>
          </div>
          <div className="adminSubCard">
            <span className="adminFieldLabel">{t('admin.system.installRoot')}</span>
            <span style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500 }}>
              {t('admin.system.notExposed')}
            </span>
          </div>
        </div>
      </div>

      <div className="adminSectionCard">
        <div className="adminTabHeader">
          <div className="adminTabHeaderText">
            <h3 className="adminSectionTitle">{t('admin.system.featureFlags')}</h3>
            <p className="adminSectionHint">{t('admin.system.flagsHint')}</p>
          </div>
          <div className="adminToolbar">
            <input
              type="text"
              value={flagSearchQuery}
              onChange={e => setFlagSearchQuery(e.target.value)}
              placeholder={t('admin.system.searchFlags')}
              className="adminInput"
              style={{ width: '200px', marginBottom: 0 }}
            />
            <button
              type="button"
              onClick={() => openCreateConfigModal('feature')}
              className="adminButton"
            >
              {t('admin.system.newFlag')}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="adminEmptyState">
            <span className="adminSpinner" style={{ marginRight: '8px' }} aria-hidden="true" />
            {t('admin.system.loadingFlags')}
          </div>
        ) : filteredFlags.length === 0 ? (
          <div className="adminEmptyState adminEmptyStateBordered">
            {t('admin.system.emptyFlags')}
          </div>
        ) : (
          <div className="adminCard adminCardTable">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>{t('admin.common.key')}</th>
                  <th>{t('admin.common.valueOrState')}</th>
                  <th>{t('admin.common.description')}</th>
                  <th>{t('admin.common.updatedAt')}</th>
                  <th style={{ textAlign: 'right' }}>{t('admin.common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredFlags.map((item) => {
                  const isBool = typeof item.value === 'boolean'
                  const isEnabledObj =
                    item.value && typeof item.value === 'object' && 'enabled' in (item.value as Record<string, unknown>)
                  const isActive = isBool ? item.value : isEnabledObj ? Boolean((item.value as { enabled: boolean }).enabled) : false
                  const canQuickToggle = isBool || isEnabledObj

                  return (
                    <tr key={item.key}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 500, color: 'var(--cm-foreground)' }}>
                        {item.key}
                      </td>
                      <td>
                        {canQuickToggle ? (
                          <button
                            type="button"
                            onClick={() => handleToggleFeatureFlag(item)}
                            className={`adminBadge ${isActive ? 'adminBadgeSuccess' : ''}`}
                            style={{ cursor: 'pointer' }}
                          >
                            <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                            {isActive ? t('admin.system.active') : t('admin.system.inactive')}
                          </button>
                        ) : (
                          <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-foreground)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                            {JSON.stringify(item.value as unknown)}
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--cm-muted-foreground)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.description || '—'}
                      </td>
                      <td style={{ color: 'var(--cm-muted-foreground)', whiteSpace: 'nowrap' }}>
                        {formatDate(item.updated_at)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => openEditConfigModal(item)}
                            className="adminRowButton"
                          >
                            {t('admin.common.edit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteConfigModal(item)}
                            className="adminRowButton adminRowButtonDanger"
                          >
                            {t('admin.common.delete')}
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

      <div className="adminSectionCard">
        <div className="adminTabHeader">
          <div className="adminTabHeaderText">
            <h3 className="adminSectionTitle">{t('admin.system.globalLimits')}</h3>
            <p className="adminSectionHint">{t('admin.system.limitsHint2')}</p>
          </div>
          <div className="adminToolbar">
            <input
              type="text"
              value={limitSearchQuery}
              onChange={e => setLimitSearchQuery(e.target.value)}
              placeholder={t('admin.system.searchLimits')}
              className="adminInput"
              style={{ width: '200px', marginBottom: 0 }}
            />
            <button
              type="button"
              onClick={() => openCreateConfigModal('limit')}
              className="adminButton"
            >
              {t('admin.system.newLimit')}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="adminEmptyState">
            <span className="adminSpinner" style={{ marginRight: '8px' }} aria-hidden="true" />
            {t('admin.system.loadingLimits')}
          </div>
        ) : filteredLimits.length === 0 ? (
          <div className="adminEmptyState adminEmptyStateBordered">
            {t('admin.system.emptyLimits')}
          </div>
        ) : (
          <div className="adminCard adminCardTable">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>{t('admin.common.key')}</th>
                  <th>{t('admin.common.value')}</th>
                  <th>{t('admin.common.description')}</th>
                  <th>{t('admin.common.updatedAt')}</th>
                  <th style={{ textAlign: 'right' }}>{t('admin.common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLimits.map(item => (
                  <tr key={item.key}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 500, color: 'var(--cm-foreground)' }}>
                      {item.key}
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-primary)', fontWeight: 600, background: 'color-mix(in srgb, var(--cm-primary) 10%, transparent)', padding: '2px 8px', borderRadius: 'var(--cm-radius-sm)', border: '1px solid color-mix(in srgb, var(--cm-primary) 20%, transparent)' }}>
                        {typeof item.value === 'object' ? JSON.stringify(item.value as unknown) : String(item.value)}
                      </span>
                    </td>
                    <td style={{ color: 'var(--cm-muted-foreground)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.description || '—'}
                    </td>
                    <td style={{ color: 'var(--cm-muted-foreground)', whiteSpace: 'nowrap' }}>
                      {formatDate(item.updated_at)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => openEditConfigModal(item)}
                          className="adminRowButton"
                        >
                          {t('admin.common.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteConfigModal(item)}
                          className="adminRowButton adminRowButtonDanger"
                        >
                          {t('admin.common.delete')}
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

      <div className="adminSectionCard">
        <div className="adminTabHeader">
          <div className="adminTabHeaderText">
            <h3 className="adminSectionTitle">{t('admin.system.workspaces')}</h3>
            <p className="adminSectionHint">{t('admin.system.workspacesHint')}</p>
          </div>
          <div className="adminToolbar">
            <input
              type="text"
              value={workspaceSearchQuery}
              onChange={e => setWorkspaceSearchQuery(e.target.value)}
              placeholder={t('admin.system.searchWorkspaces')}
              className="adminInput"
              style={{ width: '240px', marginBottom: 0 }}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="adminEmptyState">
            <span className="adminSpinner" style={{ marginRight: '8px' }} aria-hidden="true" />
            {t('admin.system.loadingWorkspaces')}
          </div>
        ) : filteredWorkspaces.length === 0 ? (
          <div className="adminEmptyState adminEmptyStateBordered">
            {t('admin.system.emptyWorkspaces')}
          </div>
        ) : (
          <div className="adminCard adminCardTable">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>{t('admin.common.title')}</th>
                  <th>{t('admin.system.workspaceId')}</th>
                  <th>{t('admin.common.tenant')}</th>
                  <th>{t('admin.common.owner')}</th>
                  <th>{t('admin.system.relativePath')}</th>
                  <th>{t('admin.common.createdAt')}</th>
                  <th style={{ textAlign: 'right' }}>{t('admin.common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkspaces.map(ws => (
                  <tr key={ws.id}>
                    <td style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{ws.title}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-foreground)' }}>{ws.workspace_id}</td>
                    <td>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--cm-radius-sm)', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-secondary) 50%, transparent)', color: 'var(--cm-foreground)', border: '1px solid var(--cm-border)' }}>
                        {ws.tenant_name}
                      </span>
                    </td>
                    <td style={{ color: 'var(--cm-muted-foreground)' }}>{ws.user_email || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-muted-foreground)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ws.relative_path}
                    </td>
                    <td style={{ color: 'var(--cm-muted-foreground)', whiteSpace: 'nowrap' }}>
                      {formatDate(ws.created_at)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => openArchiveWorkspaceModal(ws)}
                        className="adminRowButton"
                        style={{ color: 'var(--cm-primary)' }}
                      >
                        {t('admin.sessions.archiveAction')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="adminSectionCard">
        <div className="adminTabHeader">
          <div className="adminTabHeaderText">
            <h3 className="adminSectionTitle">{t('admin.system.storage')}</h3>
            <p className="adminSectionHint">{t('admin.system.storageHint')}</p>
          </div>
          <span className="adminBadge adminBadgePrimary">{t('admin.system.readOnly')}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div className="adminSubCard">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                <span style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500 }}>{t('admin.system.workspacesRoot')}</span>
                <span style={{ fontSize: '10px', color: 'var(--cm-primary)', fontFamily: 'monospace', opacity: 0.8 }}>storage.workspaces_root</span>
              </div>
              <div className="adminCodeBlock">
                {workspacesRootPath}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyText(workspacesRootPath, 'ws-root')}
              className="adminButton adminButtonSecondary"
              style={{ width: '100%' }}
            >
              {copiedKey === 'ws-root' ? (
                <span style={{ color: 'var(--cm-success)', fontWeight: 600 }}>{t('admin.common.copied')}</span>
              ) : (
                <span>{t('admin.common.copyPath')}</span>
              )}
            </button>
          </div>

          <div className="adminSubCard">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                <span style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500 }}>{t('admin.system.uploadsRoot')}</span>
                <span style={{ fontSize: '10px', color: 'var(--cm-primary)', fontFamily: 'monospace', opacity: 0.8 }}>storage.uploads_root</span>
              </div>
              <div className="adminCodeBlock">
                {uploadsRootPath}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyText(uploadsRootPath, 'up-root')}
              className="adminButton adminButtonSecondary"
              style={{ width: '100%' }}
            >
              {copiedKey === 'up-root' ? (
                <span style={{ color: 'var(--cm-success)', fontWeight: 600 }}>{t('admin.common.copied')}</span>
              ) : (
                <span>{t('admin.common.copyPath')}</span>
              )}
            </button>
          </div>

          <div className="adminSubCard">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                <span style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500 }}>{t('admin.system.logsRoot')}</span>
                <span style={{ fontSize: '10px', color: 'var(--cm-primary)', fontFamily: 'monospace', opacity: 0.8 }}>storage.logs_root</span>
              </div>
              <div className="adminCodeBlock">
                {logsRootPath}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyText(logsRootPath, 'log-root')}
              className="adminButton adminButtonSecondary"
              style={{ width: '100%' }}
            >
              {copiedKey === 'log-root' ? (
                <span style={{ color: 'var(--cm-success)', fontWeight: 600 }}>{t('admin.common.copied')}</span>
              ) : (
                <span>{t('admin.common.copyPath')}</span>
              )}
            </button>
          </div>
        </div>

        <div className="adminSubCard" style={{ borderColor: 'color-mix(in srgb, var(--cm-primary) 30%, transparent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <h4 className="adminSectionTitle">{t('admin.system.secureAccess')}</h4>
            <span className="adminSectionHint">{t('admin.system.filesystemHint')}</span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px', borderRadius: 'var(--cm-radius-md)', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--cm-primary)', wordBreak: 'break-all', userSelect: 'all' }}>
              {sshExampleCommand}
            </div>
            <button
              type="button"
              onClick={() => handleCopyText(sshExampleCommand, 'ssh-cmd')}
              className="adminRowButton"
              style={{ color: 'var(--cm-primary)', whiteSpace: 'nowrap' }}
            >
              {copiedKey === 'ssh-cmd' ? `✓ ${t('admin.common.copied')}` : t('admin.common.copyCommand')}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
          <div className="adminTabHeader">
            <div className="adminTabHeaderText">
              <h4 className="adminSectionTitle">{t('admin.system.pathMappingTitle')}</h4>
            </div>
            <div className="adminToolbar">
              <input
                type="text"
                value={storageWsSearchQuery}
                onChange={e => setStorageWsSearchQuery(e.target.value)}
                placeholder={t('admin.system.searchPaths')}
                className="adminInput"
                style={{ width: '240px', marginBottom: 0 }}
              />
            </div>
          </div>

          {isLoading ? (
            <div className="adminEmptyState">
              <span className="adminSpinner" style={{ marginRight: '8px' }} aria-hidden="true" />
              {t('admin.system.loadingPaths')}
            </div>
          ) : storageWorkspaces.length === 0 ? (
            <div className="adminEmptyState adminEmptyStateBordered">
              {t('admin.system.emptyPaths')}
            </div>
          ) : (
            <div className="adminCard adminCardTable">
              <table className="adminTable">
                <thead>
                  <tr>
                    <th>{t('admin.common.title')}</th>
                    <th>{t('admin.system.workspaceId')}</th>
                    <th>{t('admin.common.tenant')}</th>
                    <th>{t('admin.system.relativePath')}</th>
                    <th>{t('admin.system.fullPath')}</th>
                    <th style={{ textAlign: 'right' }}>{t('admin.common.createdAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {storageWorkspaces.map(ws => (
                    <tr key={ws.id}>
                      <td style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{ws.title}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-foreground)' }}>{ws.workspace_id}</td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--cm-radius-sm)', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-secondary) 50%, transparent)', color: 'var(--cm-foreground)', border: '1px solid var(--cm-border)' }}>
                          {ws.tenant_name}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-muted-foreground)' }}>
                        {ws.relative_path}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-primary)', wordBreak: 'break-all' }}>
                        {ws.full_path}
                      </td>
                      <td style={{ color: 'var(--cm-muted-foreground)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {formatDate(ws.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="adminSectionCard">
        <div className="adminTabHeader">
          <div className="adminTabHeaderText">
            <h3 className="adminSectionTitle">{t('admin.system.llm.title')}</h3>
            <p className="adminSectionHint">{t('admin.system.llm.subtitle')}</p>
          </div>
          <div className="adminToolbar">
            <input
              type="text"
              value={llmSearchQuery}
              onChange={e => setLlmSearchQuery(e.target.value)}
              placeholder={t('admin.system.searchLlm')}
              className="adminInput"
              style={{ width: '200px', marginBottom: 0 }}
            />
            <button
              type="button"
              onClick={() => openCreateConfigModal('llm')}
              className="adminButton"
            >
              {t('admin.system.newParam', { type: 'llm' })}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="adminEmptyState">
            <span className="adminSpinner" style={{ marginRight: '8px' }} aria-hidden="true" />
            {t('admin.system.loadingLlm')}
          </div>
        ) : (
          <>
            {llmSaveFeedback && (
              <div className={`adminNotice ${llmSaveFeedback.type === 'success' ? 'adminNoticeSuccess' : 'adminNoticeError'}`}>
                <span>{llmSaveFeedback.message}</span>
                <button onClick={() => setLlmSaveFeedback(null)} className="adminNoticeDismiss" aria-label={t('common.close')}>✕</button>
              </div>
            )}
            {/* ---- Central LLM routing: model masking ---- */}
            <div className="adminSubCard">
              <h4 className="adminSectionTitle">{t('admin.system.llm.maskTitle')}</h4>
              <p className="adminSectionHint">{t('admin.system.llm.maskEnabledHint')}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--cm-foreground)', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={llmForm.maskEnabled}
                    onChange={e => setLlmForm(prev => ({ ...prev, maskEnabled: e.target.checked }))}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--cm-primary)' }}
                  />
                  {t('admin.system.llm.maskEnabled')}
                </label>
                <button
                  type="button"
                  onClick={saveMask}
                  disabled={isMutating}
                  className="adminButton"
                >
                  {t('admin.system.llm.saveMask')}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' }}>
                <div>
                  <label className="adminFieldLabel">{t('admin.system.llm.virtualModelId')}</label>
                  <input
                    type="text"
                    value={llmForm.maskVirtualModel}
                    onChange={e => setLlmForm(prev => ({ ...prev, maskVirtualModel: e.target.value }))}
                    disabled={isMutating}
                    className="adminInput"
                    style={{ width: '100%', fontSize: '12px', fontFamily: 'monospace' }}
                  />
                </div>
                <div>
                  <label className="adminFieldLabel">{t('admin.system.llm.virtualModelName')}</label>
                  <input
                    type="text"
                    value={llmForm.maskVirtualModelName}
                    onChange={e => setLlmForm(prev => ({ ...prev, maskVirtualModelName: e.target.value }))}
                    disabled={isMutating}
                    className="adminInput"
                    style={{ width: '100%', fontSize: '12px' }}
                  />
                </div>
              </div>
            </div>

            {/* ---- Central LLM routing: primary route ---- */}
            <div className="adminSubCard">
              <h4 className="adminSectionTitle">{t('admin.system.llm.primaryTitle')}</h4>
              {llmProviders.length === 0 ? (
                <div className="adminEmptyState adminEmptyStateBordered" style={{ marginTop: '12px' }}>
                  {t('admin.system.llm.noProvidersConfigured')}
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' }}>
                    <div>
                      <label className="adminFieldLabel">{t('admin.system.llm.primaryProvider')}</label>
                      <select
                        value={llmForm.primaryProvider}
                        onChange={e => setLlmForm(prev => ({ ...prev, primaryProvider: e.target.value, primaryModel: '' }))}
                        disabled={isMutating || isLoadingProviders}
                        className="adminInput"
                        style={{ width: '100%', fontSize: '12px', fontFamily: 'monospace' }}
                      >
                        <option value="">{t('admin.system.llm.selectProvider')}</option>
                        {llmProviders.map(provider => (
                          <option key={provider.id} value={provider.provider_route}>
                            {provider.name} ({provider.provider_route})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="adminFieldLabel">{t('admin.system.llm.primaryModel')}</label>
                      {isLoadingModels ? (
                        <div className="adminInput" style={{ width: '100%', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
                          {t('admin.system.llm.loadingModels')}
                        </div>
                      ) : llmModels.length === 0 ? (
                        <select
                          value={llmForm.primaryModel}
                          onChange={e => setLlmForm(prev => ({ ...prev, primaryModel: e.target.value }))}
                          disabled={isMutating || !llmForm.primaryProvider}
                          className="adminInput"
                          style={{ width: '100%', fontSize: '12px', fontFamily: 'monospace' }}
                        >
                          <option value="">{t('admin.system.llm.selectModel')}</option>
                        </select>
                      ) : (
                        <select
                          value={llmForm.primaryModel}
                          onChange={e => setLlmForm(prev => ({ ...prev, primaryModel: e.target.value }))}
                          disabled={isMutating}
                          className="adminInput"
                          style={{ width: '100%', fontSize: '12px', fontFamily: 'monospace' }}
                        >
                          <option value="">{t('admin.system.llm.selectModel')}</option>
                          {llmModels.map(model => (
                            <option key={model.id} value={model.model_id}>
                              {model.display_name} ({model.model_id})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button
                      type="button"
                      onClick={savePrimary}
                      disabled={isMutating || !llmForm.primaryProvider || !llmForm.primaryModel}
                      className="adminButton"
                    >
                      {t('admin.system.llm.savePrimary')}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ---- Central LLM routing: failover chain ---- */}
            <div className="adminSubCard">
              <h4 className="adminSectionTitle">{t('admin.system.llm.fallbackTitle')}</h4>
              <p className="adminSectionHint">{t('admin.system.llm.fallbackHint')}</p>
              {llmProviders.length === 0 ? (
                <div className="adminEmptyState adminEmptyStateBordered" style={{ marginTop: '12px' }}>
                  {t('admin.system.llm.noProvidersConfigured')}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                    {llmForm.fallback.map((route, i) => (
                      <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <select
                          value={route.provider}
                          onChange={(e) => {
                            const next = [...llmForm.fallback]
                            next[i] = { ...next[i], provider: e.target.value, model: '' }
                            setLlmForm(prev => ({ ...prev, fallback: next }))
                          }}
                          disabled={isMutating}
                          className="adminInput"
                          style={{ flex: 1, fontSize: '12px', fontFamily: 'monospace' }}
                        >
                          <option value="">{t('admin.system.llm.selectProvider')}</option>
                          {llmProviders.map(provider => (
                            <option key={provider.id} value={provider.provider_route}>
                              {provider.name} ({provider.provider_route})
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder={t('admin.system.llm.modelPlaceholder')}
                          value={route.model}
                          onChange={(e) => {
                            const next = [...llmForm.fallback]
                            const r = next[i]
                            if (r) r.model = e.target.value
                            setLlmForm(prev => ({ ...prev, fallback: next }))
                          }}
                          disabled={isMutating}
                          className="adminInput"
                          style={{ flex: 1, fontSize: '12px', fontFamily: 'monospace' }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setLlmForm(prev => ({ ...prev, fallback: prev.fallback.filter((_, k) => k !== i) }))
                          }}
                          disabled={isMutating}
                          className="adminRowButton"
                          style={{ color: 'var(--cm-muted-foreground)' }}
                        >
                          {t('admin.common.delete')}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setLlmForm(prev => ({ ...prev, fallback: [...prev.fallback, { provider: '', model: '' }] }))}
                      disabled={isMutating}
                      className="adminButton"
                      style={{ alignSelf: 'flex-start' }}
                    >
                      {t('admin.system.newParam', { type: 'fallback' })}
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button
                      type="button"
                      onClick={saveFallback}
                      disabled={isMutating}
                      className="adminButton"
                    >
                      {t('admin.system.llm.saveFallback')}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ---- Central LLM routing: lightweight delegation ---- */}
            <div className="adminSubCard">
              <h4 className="adminSectionTitle">{t('admin.system.llm.delegationTitle')}</h4>
              <p className="adminSectionHint">{t('admin.system.llm.delegationHint')}</p>
              {llmProviders.length === 0 ? (
                <div className="adminEmptyState adminEmptyStateBordered" style={{ marginTop: '12px' }}>
                  {t('admin.system.llm.noProvidersConfigured')}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--cm-foreground)', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={llmForm.delegationEnabled}
                        onChange={e => setLlmForm(prev => ({ ...prev, delegationEnabled: e.target.checked }))}
                        style={{ width: '16px', height: '16px', accentColor: 'var(--cm-primary)' }}
                      />
                      {t('admin.system.llm.delegationEnabled')}
                    </label>
                    <button
                      type="button"
                      onClick={saveDelegation}
                      disabled={isMutating || !llmForm.delegationProvider || !llmForm.delegationModel}
                      className="adminButton"
                    >
                      {t('admin.system.llm.saveDelegation')}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' }}>
                    <div>
                      <label className="adminFieldLabel">{t('admin.system.llm.lightweightProvider')}</label>
                      <select
                        value={llmForm.delegationProvider}
                        onChange={e => setLlmForm(prev => ({ ...prev, delegationProvider: e.target.value, delegationModel: '' }))}
                        disabled={isMutating || !llmForm.delegationEnabled}
                        className="adminInput"
                        style={{ width: '100%', fontSize: '12px', fontFamily: 'monospace' }}
                      >
                        <option value="">{t('admin.system.llm.selectProvider')}</option>
                        {llmProviders.map(provider => (
                          <option key={provider.id} value={provider.provider_route}>
                            {provider.name} ({provider.provider_route})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="adminFieldLabel">{t('admin.system.llm.lightweightModel')}</label>
                      <input
                        type="text"
                        placeholder={t('admin.system.llm.modelPlaceholder')}
                        value={llmForm.delegationModel}
                        onChange={e => setLlmForm(prev => ({ ...prev, delegationModel: e.target.value }))}
                        disabled={isMutating || !llmForm.delegationEnabled || !llmForm.delegationProvider}
                        className="adminInput"
                        style={{ width: '100%', fontSize: '12px', fontFamily: 'monospace' }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ---- Generic llm.* parameter table ---- */}
            {filteredLlm.length === 0 ? (
              <div className="adminEmptyState adminEmptyStateBordered">
                {t('admin.system.emptyLlm')}
              </div>
            ) : (
              <div className="adminCard adminCardTable">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>{t('admin.common.key')}</th>
                      <th>{t('admin.common.valueOrState')}</th>
                      <th>{t('admin.common.description')}</th>
                      <th>{t('admin.common.updatedAt')}</th>
                      <th style={{ textAlign: 'right' }}>{t('admin.common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLlm.map(item => (
                      <tr key={item.key}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 500, color: 'var(--cm-foreground)' }}>
                          {item.key}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-primary)', fontWeight: 500, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                          {typeof item.value === 'object' ? JSON.stringify(item.value as unknown) : String(item.value)}
                        </td>
                        <td style={{ color: 'var(--cm-muted-foreground)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.description || '—'}
                        </td>
                        <td style={{ color: 'var(--cm-muted-foreground)', whiteSpace: 'nowrap' }}>
                          {formatDate(item.updated_at)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => openEditConfigModal(item)}
                              className="adminRowButton"
                            >
                              {t('admin.common.edit')}
                            </button>
                            {item.key.startsWith('llm.mask') ? (
                              <span className="adminBadge">
                                {t('admin.system.llm.maskProtected')}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openDeleteConfigModal(item)}
                                className="adminRowButton adminRowButtonDanger"
                              >
                                {t('admin.common.delete')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {isConfigModalOpen && (
        <div className="adminOverlay">
          <div
            className="adminOverlayMask"
            onClick={closeModals}
          />
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
            className="adminDialog"
            style={{ maxWidth: '520px' }}
          >
            <div className="adminDialogHeader">
              <h3 className="adminDialogTitle">
                {selectedConfig ? t('admin.system.editParam') : t('admin.system.newParam', { type: formPrefixType })}
              </h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="adminDialogClose"
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="adminFieldLabel">{t('admin.system.paramKey')}</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(selectedConfig) || isMutating}
                  value={formKey}
                  onChange={e => setFormKey(e.target.value)}
                  placeholder={t('admin.system.paramKeyPlaceholder')}
                  className="adminInput"
                  style={{ fontFamily: 'monospace', opacity: (Boolean(selectedConfig) || isMutating) ? 0.5 : 1, marginBottom: 0 }}
                />
              </div>

              <div>
                <label className="adminFieldLabel">{t('admin.system.paramValue')}</label>
                <textarea
                  rows={4}
                  required
                  disabled={isMutating}
                  value={formValueStr}
                  onChange={e => setFormValueStr(e.target.value)}
                  placeholder={t('admin.system.valuePlaceholder')}
                  className="adminInput"
                  style={{ fontFamily: 'monospace', opacity: isMutating ? 0.5 : 1, marginBottom: 0 }}
                />
                <span className="adminFieldHint">
                  {t('admin.system.valueTip')}
                </span>
              </div>

              <div>
                <label className="adminFieldLabel">{t('admin.system.impactDescription')}</label>
                <input
                  type="text"
                  disabled={isMutating}
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder={t('admin.system.impactPlaceholder')}
                  className="adminInput"
                  style={{ opacity: isMutating ? 0.5 : 1, marginBottom: 0 }}
                />
              </div>

              {formError && (
                <div className="adminNotice adminNoticeError">
                  {formError}
                </div>
              )}

              <div className="adminDialogFooter">
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  className="adminButton adminButtonSecondary"
                  style={{ opacity: isMutating ? 0.5 : 1 }}
                >
                  {t('admin.common.cancelAction')}
                </button>
                <button
                  type="submit"
                  disabled={isMutating}
                  className="adminButton"
                  style={{ opacity: isMutating ? 0.5 : 1 }}
                >
                  {isMutating ? t('admin.common.saving') : t('admin.system.saveParam')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeleteConfigModalOpen && selectedConfig && (
        <div className="adminOverlay">
          <div
            className="adminOverlayMask"
            onClick={closeModals}
          />
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
            className="adminDialog"
            style={{ maxWidth: '480px' }}
          >
            <div className="adminDialogHeader">
              <h3 className="adminDialogTitle">{t('admin.system.deleteParam')}</h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="adminDialogClose"
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>

            <p className="adminSectionHint" style={{ marginTop: '12px' }}>
              {t('admin.system.deleteConfirm')}{' '}
              <strong style={{ color: 'var(--cm-foreground)', fontFamily: 'monospace' }}>{selectedConfig.key}</strong>?
            </p>

            {formError && (
              <div className="adminNotice adminNoticeError" style={{ marginTop: '12px' }}>
                {formError}
              </div>
            )}

            <div className="adminDialogFooter">
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="adminButton adminButtonSecondary"
                style={{ opacity: isMutating ? 0.5 : 1 }}
              >
                {t('admin.common.cancelAction')}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfig}
                disabled={isMutating}
                className="adminButton adminButtonDanger"
                style={{ opacity: isMutating ? 0.5 : 1 }}
              >
                {isMutating ? t('admin.common.deleting') : t('admin.common.confirmDeletion')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isArchiveWorkspaceModalOpen && selectedWorkspace && (
        <div className="adminOverlay">
          <div
            className="adminOverlayMask"
            onClick={closeModals}
          />
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
            className="adminDialog"
            style={{ maxWidth: '480px' }}
          >
            <div className="adminDialogHeader">
              <h3 className="adminDialogTitle">{t('admin.system.archiveWorkspace')}</h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="adminDialogClose"
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>

            <p className="adminSectionHint" style={{ marginTop: '12px' }}>
              {t('admin.system.archiveConfirm')} <strong style={{ color: 'var(--cm-foreground)' }}>{selectedWorkspace.title}</strong> (
              <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)' }}>{selectedWorkspace.workspace_id}</span>{t('admin.system.archiveTenantSuffix')}{' '}
              <strong style={{ color: 'var(--cm-foreground)' }}>{selectedWorkspace.tenant_name}</strong>?
            </p>

            <div className="adminNotice" style={{ marginTop: '12px', borderColor: 'color-mix(in srgb, var(--cm-primary) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-primary) 10%, transparent)', color: 'var(--cm-primary)' }}>
              <span><strong>{t('admin.system.securityNote')}</strong> {t('admin.system.archiveNote')}</span>
            </div>

            {formError && (
              <div className="adminNotice adminNoticeError" style={{ marginTop: '12px' }}>
                {formError}
              </div>
            )}

            <div className="adminDialogFooter">
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                className="adminButton adminButtonSecondary"
                style={{ opacity: isMutating ? 0.5 : 1 }}
              >
                {t('admin.common.cancelAction')}
              </button>
              <button
                type="button"
                onClick={handleArchiveWorkspace}
                disabled={isMutating}
                className="adminButton"
                style={{ opacity: isMutating ? 0.5 : 1 }}
              >
                {isMutating ? t('admin.system.archiving') : t('admin.system.confirmArchive')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
