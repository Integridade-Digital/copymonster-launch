import { formatDate } from '../../../lib/format'
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

  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false)
  const [isDeleteConfigModalOpen, setIsDeleteConfigModalOpen] = useState<boolean>(false)
  const [isArchiveWorkspaceModalOpen, setIsArchiveWorkspaceModalOpen] = useState<boolean>(false)

  const [selectedConfig, setSelectedConfig] = useState<SystemConfigItem | null>(null)
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceItem | null>(null)

  const [formKey, setFormKey] = useState<string>('')
  const [formValueStr, setFormValueStr] = useState<string>('')
  const [formDescription, setFormDescription] = useState<string>('')
  const [formPrefixType, setFormPrefixType] = useState<'feature' | 'limit' | 'quota' | 'other'>('feature')
  const [formError, setFormError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState<boolean>(false)

  const handleCopyText = (text: string, key: string) => {
    if (!navigator?.clipboard?.writeText) return
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => {
        setCopiedKey(prev => (prev === key ? null : prev))
      }, 1500)
    }).catch((err) => {
      console.error('Falha ao copiar:', err)
    })
  }

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true)
    setError(null)
    try {
      const [configsRes, workspacesRes, storageRes] = await Promise.all([
        (supabase.rpc as any)('get_admin_system_config'),
        (supabase.rpc as any)('get_admin_workspaces'),
        (supabase.rpc as any)('get_admin_storage_paths'),
      ])

      if (configsRes.error) throw new Error(configsRes.error.message)
      if (workspacesRes.error) throw new Error(workspacesRes.error.message)
      if (!storageRes.error && storageRes.data) {
        setStorageData(storageRes.data as StoragePathsData)
      } else if (storageRes.error) {
        console.warn('get_admin_storage_paths ainda não disponível ou erro:', storageRes.error.message)
      }

      setConfigs((configsRes.data as SystemConfigItem[]) || [])
      setWorkspaces((workspacesRes.data as WorkspaceItem[]) || [])
    } catch (err: any) {
      console.error('Error ao carregar configurações do sistema:', err)
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
  const totalWorkspacesCount = workspaces.length

  const maskedSupabaseUrl = useMemo(() => {
    const rawUrl = (import.meta as any).env?.VITE_SUPABASE_URL || ''
    if (!rawUrl) return 'Not configured'
    try {
      const url = new URL(rawUrl)
      return `${url.protocol}//${url.hostname.slice(0, 8)}...${url.hostname.slice(-8)}`
    } catch {
      return 'https://***.supabase.co'
    }
  }, [])

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
      typeof item.value === 'object' ? JSON.stringify(item.value, null, 2) : String(item.value),
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
      alert(err?.message || 'Error ao alterar feature flag.')
    }
  }

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

    let parsedValue: any
    try {
      parsedValue = JSON.parse(formValueStr)
    } catch {
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
      console.error('Error ao salvar configuração:', err)
      setFormError(err?.message || 'Falha ao salvar configuração.')
    } finally {
      setIsMutating(false)
    }
  }

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
      console.error('Error ao excluir chave:', err)
      setFormError(err?.message || 'Falha ao excluir chave do sistema.')
    } finally {
      setIsMutating(false)
    }
  }

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
      console.error('Error ao arquivar workspace:', err)
      setFormError(err?.message || 'Falha ao arquivar workspace.')
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
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', color: 'var(--cm-foreground)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid var(--cm-border)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Configurações do Sistema</h2>
            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: 'color-mix(in srgb, var(--cm-primary) 15%, transparent)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)' }}>
              Ambiente Operacional
            </span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', margin: '4px 0 0 0' }}>
            Parâmetros globais do servidor, feature flags ativas, cotas, diretórios e workspaces multi-tenant.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', fontSize: '12px', fontWeight: 500, color: 'var(--cm-foreground)', cursor: 'pointer', opacity: (isRefreshing || isLoading) ? 0.5 : 1 }}
        >
          <span style={isRefreshing ? { display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--cm-border)', borderTopColor: 'var(--cm-primary)', borderRadius: '50%', animation: 'cm-auth-spin 0.7s linear infinite' } : undefined}>↻</span>
          Atualizar
        </button>
      </div>

      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">Total Parâmetros</div>
          <div className="adminCardValue">{totalConfigs}</div>
          <div className="adminCardSub">Configurações ativas</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Feature Flags Ativas</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>{activeFlagsCount}</div>
          <div className="adminCardSub">Habilitadas</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Limites & Cotas</div>
          <div className="adminCardValue">{totalLimitsCount}</div>
          <div className="adminCardSub">Políticas de consumo</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Workspaces Ativos</div>
          <div className="adminCardValue">{totalWorkspacesCount}</div>
          <div className="adminCardSub">Multi-tenant</div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '13px', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', color: 'var(--cm-destructive)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => loadData()}
            style={{ padding: '4px 10px', borderRadius: '6px', background: 'color-mix(in srgb, var(--cm-destructive) 20%, transparent)', color: 'var(--cm-destructive)', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
          >
            Tentar novamente
          </button>
        </div>
      )}

      <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--cm-primary)', fontSize: '14px' }}>🖥</span>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Ambiente & Servidor</h3>
          </div>
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: 'var(--cm-background)', color: 'var(--cm-muted-foreground)', border: '1px solid var(--cm-border)' }}>
            DSH Web Frontend
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '12px' }}>
          <div style={{ background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '12px' }}>
            <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '11px' }}>Modo de Execução</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)', fontWeight: 500, display: 'inline-block', marginTop: '4px' }}>
              {(import.meta as any).env?.MODE || 'production'}
            </span>
          </div>
          <div style={{ background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '12px' }}>
            <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '11px' }}>Endpoint Supabase</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)', fontWeight: 500, display: 'inline-block', marginTop: '4px' }}>
              {maskedSupabaseUrl}
            </span>
          </div>
          <div style={{ background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '12px' }}>
            <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '11px' }}>Raiz de Instalação no Host</span>
            <span style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500, display: 'inline-block', marginTop: '4px' }}>
              Não exposta por razões de segurança
            </span>
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--cm-primary)', fontSize: '14px' }}>🚩</span>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Feature Flags</h3>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', margin: '4px 0 0 0' }}>
              Habilitação gradual e controle dinâmico de funcionalidades (<code style={{ color: 'var(--cm-primary)' }}>feature.*</code>).
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="text"
              value={flagSearchQuery}
              onChange={e => setFlagSearchQuery(e.target.value)}
              placeholder="Buscar flag..."
              className="adminInput"
              style={{ width: '200px', marginBottom: 0 }}
            />
            <button
              type="button"
              onClick={() => openCreateConfigModal('feature')}
              className="adminButton"
              style={{ fontSize: '12px' }}
            >
              + Nova Flag
            </button>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
            <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--cm-border)', borderTopColor: 'var(--cm-primary)', borderRadius: '50%', marginRight: '8px', animation: 'cm-auth-spin 0.7s linear infinite' }} />
            Carregando feature flags...
          </div>
        ) : filteredFlags.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', borderRadius: '8px', border: '1px dashed var(--cm-border)', background: 'color-mix(in srgb, var(--cm-background) 30%, transparent)', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
            Nenhuma feature flag cadastrada no momento.
          </div>
        ) : (
          <div className="adminCard" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="adminTable">
              <thead>
                <tr>
                  <th>Chave</th>
                  <th>Valor / Estado</th>
                  <th>Descrição</th>
                  <th>Atualizado em</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFlags.map((item) => {
                  const isBool = typeof item.value === 'boolean'
                  const isEnabledObj =
                    item.value && typeof item.value === 'object' && 'enabled' in item.value
                  const isActive = isBool ? item.value : isEnabledObj ? Boolean(item.value.enabled) : false
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
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: `1px solid ${isActive ? 'color-mix(in srgb, var(--cm-success) 30%, transparent)' : 'var(--cm-border)'}`, background: isActive ? 'color-mix(in srgb, var(--cm-success) 15%, transparent)' : 'transparent', color: isActive ? 'var(--cm-success)' : 'var(--cm-muted-foreground)' }}
                          >
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isActive ? 'var(--cm-success)' : 'var(--cm-muted-foreground)', display: 'inline-block' }} />
                            {isActive ? 'Ativa' : 'Inativa'}
                          </button>
                        ) : (
                          <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-foreground)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                            {JSON.stringify(item.value)}
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
                            style={{ height: '28px', padding: '0 10px', background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-foreground)', cursor: 'pointer', fontSize: '11px' }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteConfigModal(item)}
                            style={{ height: '28px', padding: '0 10px', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', borderRadius: '6px', color: 'var(--cm-destructive)', cursor: 'pointer', fontSize: '11px' }}
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

      <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--cm-primary)', fontSize: '14px' }}>⚖️</span>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Limites Globais & Cotas</h3>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', margin: '4px 0 0 0' }}>
              Políticas de consumo, rate-limits e restrições operacionais (<code style={{ color: 'var(--cm-primary)' }}>limit.*</code> e <code style={{ color: 'var(--cm-primary)' }}>quota.*</code>).
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="text"
              value={limitSearchQuery}
              onChange={e => setLimitSearchQuery(e.target.value)}
              placeholder="Buscar limite..."
              className="adminInput"
              style={{ width: '200px', marginBottom: 0 }}
            />
            <button
              type="button"
              onClick={() => openCreateConfigModal('limit')}
              className="adminButton"
              style={{ fontSize: '12px' }}
            >
              + Novo Limite
            </button>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
            <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--cm-border)', borderTopColor: 'var(--cm-primary)', borderRadius: '50%', marginRight: '8px', animation: 'cm-auth-spin 0.7s linear infinite' }} />
            Carregando limites...
          </div>
        ) : filteredLimits.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', borderRadius: '8px', border: '1px dashed var(--cm-border)', background: 'color-mix(in srgb, var(--cm-background) 30%, transparent)', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
            Nenhum limite ou cota global configurado.
          </div>
        ) : (
          <div className="adminCard" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="adminTable">
              <thead>
                <tr>
                  <th>Chave</th>
                  <th>Valor</th>
                  <th>Descrição</th>
                  <th>Atualizado em</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLimits.map(item => (
                  <tr key={item.key}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 500, color: 'var(--cm-foreground)' }}>
                      {item.key}
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-primary)', fontWeight: 600, background: 'color-mix(in srgb, var(--cm-primary) 10%, transparent)', padding: '2px 8px', borderRadius: '4px', border: '1px solid color-mix(in srgb, var(--cm-primary) 20%, transparent)' }}>
                        {typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}
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
                          style={{ height: '28px', padding: '0 10px', background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-foreground)', cursor: 'pointer', fontSize: '11px' }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteConfigModal(item)}
                          style={{ height: '28px', padding: '0 10px', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', borderRadius: '6px', color: 'var(--cm-destructive)', cursor: 'pointer', fontSize: '11px' }}
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

      <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--cm-primary)', fontSize: '14px' }}>📁</span>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Workspaces Multi-tenant</h3>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', margin: '4px 0 0 0' }}>
              Metadados de ambientes de trabalho isolados por tenant e usuário.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="text"
              value={workspaceSearchQuery}
              onChange={e => setWorkspaceSearchQuery(e.target.value)}
              placeholder="Buscar workspace ou tenant..."
              className="adminInput"
              style={{ width: '240px', marginBottom: 0 }}
            />
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
            <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--cm-border)', borderTopColor: 'var(--cm-primary)', borderRadius: '50%', marginRight: '8px', animation: 'cm-auth-spin 0.7s linear infinite' }} />
            Carregando workspaces...
          </div>
        ) : filteredWorkspaces.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', borderRadius: '8px', border: '1px dashed var(--cm-border)', background: 'color-mix(in srgb, var(--cm-background) 30%, transparent)', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
            Nenhum workspace ativo encontrado.
          </div>
        ) : (
          <div className="adminCard" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="adminTable">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Workspace ID</th>
                  <th>Tenant</th>
                  <th>Owner</th>
                  <th>Caminho Relativo</th>
                  <th>Criado em</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkspaces.map(ws => (
                  <tr key={ws.id}>
                    <td style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{ws.title}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-foreground)' }}>{ws.workspace_id}</td>
                    <td>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-secondary) 50%, transparent)', color: 'var(--cm-foreground)', border: '1px solid var(--cm-border)' }}>
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
                        style={{ height: '28px', padding: '0 10px', background: 'color-mix(in srgb, var(--cm-primary) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', borderRadius: '6px', color: 'var(--cm-primary)', cursor: 'pointer', fontSize: '11px', fontWeight: 500 }}
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

      <div style={{ background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--cm-border)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--cm-primary)', fontSize: '14px' }}>💾</span>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Armazenamento & Paths do Host</h3>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', margin: '4px 0 0 0' }}>
              Raízes operacionais no filesystem do servidor e mapeamento absoluto de workspaces ativos.
            </p>
          </div>
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: 'var(--cm-background)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)' }}>
            Somente Leitura
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div style={{ background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                <span style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500 }}>Workspaces Root</span>
                <span style={{ fontSize: '10px', color: 'var(--cm-primary)', fontFamily: 'monospace', opacity: 0.8 }}>storage.workspaces_root</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--cm-foreground)', background: 'var(--cm-card)', padding: '8px', borderRadius: '8px', border: '1px solid var(--cm-border)', marginTop: '8px', wordBreak: 'break-all' }}>
                {workspacesRootPath}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyText(workspacesRootPath, 'ws-root')}
              style={{ width: '100%', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', fontSize: '12px', fontWeight: 500, color: 'var(--cm-foreground)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              {copiedKey === 'ws-root' ? (
                <span style={{ color: 'var(--cm-success)', fontWeight: 600 }}>✓ Copied!</span>
              ) : (
                <span>📋 Copy path</span>
              )}
            </button>
          </div>

          <div style={{ background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                <span style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500 }}>Uploads Root</span>
                <span style={{ fontSize: '10px', color: 'var(--cm-primary)', fontFamily: 'monospace', opacity: 0.8 }}>storage.uploads_root</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--cm-foreground)', background: 'var(--cm-card)', padding: '8px', borderRadius: '8px', border: '1px solid var(--cm-border)', marginTop: '8px', wordBreak: 'break-all' }}>
                {uploadsRootPath}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyText(uploadsRootPath, 'up-root')}
              style={{ width: '100%', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', fontSize: '12px', fontWeight: 500, color: 'var(--cm-foreground)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              {copiedKey === 'up-root' ? (
                <span style={{ color: 'var(--cm-success)', fontWeight: 600 }}>✓ Copied!</span>
              ) : (
                <span>📋 Copy path</span>
              )}
            </button>
          </div>

          <div style={{ background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                <span style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500 }}>Logs Root</span>
                <span style={{ fontSize: '10px', color: 'var(--cm-primary)', fontFamily: 'monospace', opacity: 0.8 }}>storage.logs_root</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--cm-foreground)', background: 'var(--cm-card)', padding: '8px', borderRadius: '8px', border: '1px solid var(--cm-border)', marginTop: '8px', wordBreak: 'break-all' }}>
                {logsRootPath}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyText(logsRootPath, 'log-root')}
              style={{ width: '100%', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', fontSize: '12px', fontWeight: 500, color: 'var(--cm-foreground)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              {copiedKey === 'log-root' ? (
                <span style={{ color: 'var(--cm-success)', fontWeight: 600 }}>✓ Copied!</span>
              ) : (
                <span>📋 Copy path</span>
              )}
            </button>
          </div>
        </div>

        <div style={{ background: 'var(--cm-background)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--cm-primary)' }}>🔒</span>
              <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Acesso Seguro ao Servidor</h4>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--cm-muted-foreground)' }}>
              O filesystem do host não é exposto pelo painel. Use SSH/SFTP.
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--cm-primary)', wordBreak: 'break-all', userSelect: 'all' }}>
              {sshExampleCommand}
            </div>
            <button
              type="button"
              onClick={() => handleCopyText(sshExampleCommand, 'ssh-cmd')}
              style={{ padding: '4px 12px', borderRadius: '6px', background: 'color-mix(in srgb, var(--cm-primary) 15%, transparent)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 40%, transparent)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {copiedKey === 'ssh-cmd' ? '✓ Copied!' : 'Copy comando'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📂</span> Mapeamento de Workspaces e Paths Absolutos
            </h4>
            <input
              type="text"
              value={storageWsSearchQuery}
              onChange={e => setStorageWsSearchQuery(e.target.value)}
              placeholder="Buscar workspace ou path..."
              className="adminInput"
              style={{ width: '240px', marginBottom: 0 }}
            />
          </div>

          {isLoading ? (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
              <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--cm-border)', borderTopColor: 'var(--cm-primary)', borderRadius: '50%', marginRight: '8px', animation: 'cm-auth-spin 0.7s linear infinite' }} />
              Carregando mapeamento de paths...
            </div>
          ) : storageWorkspaces.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', borderRadius: '8px', border: '1px dashed var(--cm-border)', background: 'color-mix(in srgb, var(--cm-background) 30%, transparent)', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
              Nenhum workspace registrado com mapeamento de path ativo.
            </div>
          ) : (
            <div className="adminCard" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="adminTable">
                <thead>
                  <tr>
                    <th>Título</th>
                    <th>Workspace ID</th>
                    <th>Tenant</th>
                    <th>Caminho Relativo</th>
                    <th>Caminho Completo (Host)</th>
                    <th style={{ textAlign: 'right' }}>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {storageWorkspaces.map(ws => (
                    <tr key={ws.id}>
                      <td style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{ws.title}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-foreground)' }}>{ws.workspace_id}</td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-secondary) 50%, transparent)', color: 'var(--cm-foreground)', border: '1px solid var(--cm-border)' }}>
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

      {isConfigModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
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
            style={{ position: 'relative', width: '100%', maxWidth: '520px', margin: '24px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '12px', padding: '24px', boxShadow: 'var(--cm-shadow)', maxHeight: '80vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--cm-border)', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>
                {selectedConfig ? 'Editar Parâmetro' : `Novo Parâmetro (${formPrefixType})`}
              </h3>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                style={{ cursor: isMutating ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: 'var(--cm-muted-foreground)', fontSize: '16px' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '12px' }}>
              <div>
                <label style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Chave do Parâmetro *</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(selectedConfig) || isMutating}
                  value={formKey}
                  onChange={e => setFormKey(e.target.value)}
                  placeholder="Ex: feature.export_pdf, limit.max_tokens..."
                  className="adminInput"
                  style={{ fontFamily: 'monospace', opacity: (Boolean(selectedConfig) || isMutating) ? 0.5 : 1, marginBottom: 0 }}
                />
              </div>

              <div>
                <label style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Valor (JSON ou Primitivo) *</label>
                <textarea
                  rows={4}
                  required
                  disabled={isMutating}
                  value={formValueStr}
                  onChange={e => setFormValueStr(e.target.value)}
                  placeholder='Ex: {"enabled": true} ou 1000'
                  className="adminInput"
                  style={{ fontFamily: 'monospace', opacity: isMutating ? 0.5 : 1, marginBottom: 0 }}
                />
                <span style={{ fontSize: '10px', color: 'var(--cm-muted-foreground)', display: 'block', marginTop: '4px' }}>
                  Dica: Para feature flags simples, utilize <code>{'{"enabled": true}'}</code> ou <code>true</code>.
                </span>
              </div>

              <div>
                <label style={{ color: 'var(--cm-muted-foreground)', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Descrição do Impacto</label>
                <input
                  type="text"
                  disabled={isMutating}
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Finalidade ou documento de referência deste parâmetro"
                  className="adminInput"
                  style={{ opacity: isMutating ? 0.5 : 1, marginBottom: 0 }}
                />
              </div>

              {formError && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '13px', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', color: 'var(--cm-destructive)' }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--cm-border)' }}>
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isMutating}
                  style={{ height: '32px', padding: '0 16px', background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-foreground)', cursor: isMutating ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500, opacity: isMutating ? 0.5 : 1 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isMutating}
                  className="adminButton"
                  style={{ opacity: isMutating ? 0.5 : 1 }}
                >
                  {isMutating ? 'Saving...' : 'Salvar Parâmetro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeleteConfigModalOpen && selectedConfig && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
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
            style={{ position: 'relative', width: '100%', maxWidth: '480px', margin: '24px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '12px', padding: '24px', boxShadow: 'var(--cm-shadow)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--cm-destructive)' }}>
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Excluir Parâmetro</h3>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', marginTop: '12px', marginBottom: 0 }}>
              Tem certeza de que deseja excluir a chave{' '}
              <strong style={{ color: 'var(--cm-foreground)', fontFamily: 'monospace' }}>{selectedConfig.key}</strong>?
            </p>

            {formError && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '13px', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', color: 'var(--cm-destructive)', marginTop: '12px' }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', marginTop: '16px', borderTop: '1px solid var(--cm-border)' }}>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                style={{ height: '32px', padding: '0 16px', background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-foreground)', cursor: isMutating ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500, opacity: isMutating ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfig}
                disabled={isMutating}
                style={{ height: '32px', padding: '0 16px', background: 'color-mix(in srgb, var(--cm-destructive) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 40%, transparent)', borderRadius: '6px', color: 'var(--cm-destructive)', cursor: isMutating ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, opacity: isMutating ? 0.5 : 1 }}
              >
                {isMutating ? 'Deleting...' : 'Confirm Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isArchiveWorkspaceModalOpen && selectedWorkspace && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
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
            style={{ position: 'relative', width: '100%', maxWidth: '480px', margin: '24px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '12px', padding: '24px', boxShadow: 'var(--cm-shadow)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--cm-primary)' }}>
              <span style={{ fontSize: '20px' }}>📁</span>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>Arquivar Workspace</h3>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', marginTop: '12px', marginBottom: 0 }}>
              Deseja arquivar o workspace <strong style={{ color: 'var(--cm-foreground)' }}>{selectedWorkspace.title}</strong> (
              <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)' }}>{selectedWorkspace.workspace_id}</span>) do tenant{' '}
              <strong style={{ color: 'var(--cm-foreground)' }}>{selectedWorkspace.tenant_name}</strong>?
            </p>

            <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-primary) 10%, transparent)', fontSize: '12px', color: 'var(--cm-primary)', marginTop: '12px' }}>
              <strong>Nota de Segurança:</strong> Esta ação realiza um arquivamento lógico (soft delete).
              A pasta física de arquivos no servidor <strong>NÃO</strong> é excluída.
            </div>

            {formError && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '13px', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', color: 'var(--cm-destructive)', marginTop: '12px' }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', marginTop: '16px', borderTop: '1px solid var(--cm-border)' }}>
              <button
                type="button"
                onClick={closeModals}
                disabled={isMutating}
                style={{ height: '32px', padding: '0 16px', background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-foreground)', cursor: isMutating ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500, opacity: isMutating ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveWorkspace}
                disabled={isMutating}
                style={{ height: '32px', padding: '0 16px', background: 'color-mix(in srgb, var(--cm-primary) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-primary) 40%, transparent)', borderRadius: '6px', color: 'var(--cm-primary)', cursor: isMutating ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, opacity: isMutating ? 0.5 : 1 }}
              >
                {isMutating ? 'Arquivando...' : 'Confirm Arquivamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
