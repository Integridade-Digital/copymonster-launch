import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'
import { t } from '../../../locales'
import { MODEL_MASK_STATUS_PATH } from '../../../lib/model-mask-status'

export interface SystemConfigItem {
  key: string
  value: unknown
  description: string | null
  is_secret: boolean
  updated_at: string
  updated_by: string | null
  updated_by_email: string | null
}

/** The mask's resolved routes, as reported by the Host. */
export interface ModelMaskRoute {
  provider: string
  model: string
}

/** Read-only masks status: the tenant alias and the real routes behind it. */
export interface ModelMaskStatus {
  alias: ModelMaskRoute
  primaryRoute: ModelMaskRoute | null
  fallbackChain: ModelMaskRoute[]
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
  const [maskStatus, setMaskStatus] = useState<ModelMaskStatus | null>(null)
  const [maskError, setMaskError] = useState<string | null>(null)

  /**
   * Read the mask's resolved routes. This is display-only: the operator never
   * chooses a provider or model here, because the mask follows whatever
   * Settings > Models has active.
   */
  const loadMaskStatus = useCallback(async () => {
    setMaskError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (token === undefined) {
        setMaskStatus(null)
        return
      }
      const response = await fetch(MODEL_MASK_STATUS_PATH, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error(`model mask status: ${response.status}`)
      setMaskStatus(await response.json() as ModelMaskStatus)
    } catch (err: unknown) {
      console.error('Failed to load model mask status:', err)
      setMaskStatus(null)
      setMaskError(t('admin.system.llm.maskStatusFailure'))
    }
  }, [])

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true)
    setError(null)
    try {
      const [configsRes, workspacesRes] = await Promise.all([
        supabase.rpc('get_admin_system_config'),
        supabase.rpc('get_admin_workspaces'),
        loadMaskStatus(),
      ])

      if (configsRes.error) throw new Error(configsRes.error.message)
      if (workspacesRes.error) throw new Error(workspacesRes.error.message)

      setConfigs(configsRes.data || [])
      setWorkspaces(workspacesRes.data || [])
    } catch (err: unknown) {
      console.error('Failed to load system settings:', err)
      setError(err instanceof Error ? err.message : t('admin.system.loadFailure'))
    } finally {
      if (!isSilent) setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [loadMaskStatus])

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

      {/* Central LLM Routing & Model Masking Overview */}
      <div className="adminSectionCard">
        <div className="adminTabHeader">
          <div className="adminTabHeaderText">
            <h3 className="adminSectionTitle">{t('admin.system.llm.title')}</h3>
            <p className="adminSectionHint">{t('admin.system.llm.subtitle')}</p>
          </div>
          <span className="adminBadge adminBadgePrimary">
            {t('admin.system.llm.nativeBadge')}
          </span>
        </div>

        {/* Notice explaining official key management in Settings > Models */}
        <div className="adminNotice" style={{ borderColor: 'color-mix(in srgb, var(--cm-primary) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-primary) 8%, transparent)', color: 'var(--cm-foreground)', marginTop: '8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontWeight: 600, color: 'var(--cm-primary)' }}>
              🔒 {t('admin.system.llm.officialManagerTitle')}
            </span>
            <span style={{ fontSize: '13px', lineHeight: 1.5 }}>
              {t('admin.system.llm.officialManagerNotice')}
            </span>
          </div>
        </div>

        {/* Model masking policy */}
        <div className="adminSubCard" style={{ marginTop: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h4 className="adminSectionTitle">{t('admin.system.llm.maskTitle')}</h4>
              <p className="adminSectionHint" style={{ marginTop: '2px' }}>
                {t('admin.system.llm.maskDescription')}
              </p>
            </div>
            <span className="adminBadge adminBadgeSuccess">
              ✓ {t('admin.system.active')}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '14px' }}>
            <div style={{ padding: '10px 12px', borderRadius: 'var(--cm-radius-md)', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
              <div className="adminFieldLabel" style={{ marginBottom: '4px' }}>{t('admin.system.llm.maskedAs')}</div>
              <div style={{ fontWeight: 600, color: 'var(--cm-foreground)', fontSize: '13px' }}>Model CopyMonster</div>
              <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-primary)', marginTop: '2px' }}>copymonster/copy-monster-default</div>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: 'var(--cm-radius-md)', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
              <div className="adminFieldLabel" style={{ marginBottom: '4px' }}>{t('admin.system.llm.activeModel')}</div>
              {maskStatus === null
                ? (
                  <div style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
                    {maskError ?? t('admin.system.llm.activeModelLoading')}
                  </div>
                )
                : (
                  <>
                    <div style={{ fontWeight: 600, color: 'var(--cm-foreground)', fontSize: '13px' }}>
                      {maskStatus.primaryRoute === null
                        ? t('admin.system.llm.activeModelNone')
                        : `${maskStatus.primaryRoute.provider} / ${maskStatus.primaryRoute.model}`}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--cm-muted-foreground)', marginTop: '2px' }}>
                      {maskStatus.fallbackChain.length === 0
                        ? t('admin.system.llm.noFallback')
                        : t('admin.system.llm.fallbackCount').replace('{count}', String(maskStatus.fallbackChain.length))}
                    </div>
                  </>
                )}
            </div>

            <div style={{ padding: '10px 12px', borderRadius: 'var(--cm-radius-md)', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
              <div className="adminFieldLabel" style={{ marginBottom: '4px' }}>{t('admin.system.llm.tenantCatalogPolicy')}</div>
              <div style={{ fontWeight: 600, color: 'var(--cm-foreground)', fontSize: '13px' }}>{t('admin.system.llm.tenantCatalogStatus')}</div>
              <div style={{ fontSize: '11px', color: 'var(--cm-muted-foreground)', marginTop: '2px' }}>{t('admin.system.llm.maskEnabledHint')}</div>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: 'var(--cm-radius-md)', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
              <div className="adminFieldLabel" style={{ marginBottom: '4px' }}>{t('admin.system.llm.adminCatalogPolicy')}</div>
              <div style={{ fontWeight: 600, color: 'var(--cm-foreground)', fontSize: '13px' }}>{t('admin.system.llm.adminCatalogStatus')}</div>
              <div style={{ fontSize: '11px', color: 'var(--cm-muted-foreground)', marginTop: '2px' }}>{t('admin.system.llm.adminCatalogNotice')}</div>
            </div>
          </div>
        </div>

        {/* How to configure providers and keys */}
        <div className="adminSubCard" style={{ marginTop: '12px' }}>
          <h4 className="adminSectionTitle">{t('admin.system.llm.howToManageTitle')}</h4>
          <p className="adminSectionHint" style={{ marginTop: '4px', lineHeight: 1.5 }}>
            {t('admin.system.llm.howToManageDesc')}
          </p>
          <p className="adminSectionHint" style={{ marginTop: '4px', lineHeight: 1.5 }}>
            {t('admin.system.llm.automaticRoutingHint')}
          </p>
        </div>
      </div>
    </div>
  )
}
