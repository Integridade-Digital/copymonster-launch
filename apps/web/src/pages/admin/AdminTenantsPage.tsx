import { formatDate } from '../../lib/format'
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase/client'
import { t } from '../../locales'

interface Tenant {
  id: string
  name: string
  slug: string
  status: 'active' | 'suspended' | 'deleted'
  created_at: string
  subscription_status?: string
}

interface ActionFeedback {
  type: 'success' | 'error'
  message: string
}

export function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null)

  useEffect(() => {
    loadTenants()
  }, [])

  const loadTenants = useCallback(async () => {
    try {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setTenants(data || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  const clearActionFeedback = () => setActionFeedback(null)

  async function handleSuspendTenant(tenantId: string) {
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ status: 'suspended' })
        .eq('id', tenantId)

      if (error) throw error
      setActionFeedback({ type: 'success', message: t('admin.tenants.suspendedSuccess') })
      loadTenants()
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        message: t('admin.tenants.suspendFailure', { reason: err instanceof Error ? err.message : String(err) }),
      })
    }
  }

  async function handleActivateTenant(tenantId: string) {
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ status: 'active' })
        .eq('id', tenantId)

      if (error) throw error
      setActionFeedback({ type: 'success', message: t('admin.tenants.activatedSuccess') })
      loadTenants()
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        message: t('admin.tenants.activateFailure', { reason: err instanceof Error ? err.message : String(err) }),
      })
    }
  }

  const kpis = useMemo(() => {
    const total = tenants.length
    const active = tenants.filter(t => t.status === 'active').length
    const suspended = tenants.filter(t => t.status === 'suspended').length
    const trial = tenants.filter(t => (t.subscription_status || 'trial').toLowerCase().includes('trial')).length
    return { total, active, suspended, trial }
  }, [tenants])

  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      const matchesSearch =
        !searchTerm ||
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.slug.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === 'all' || t.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [tenants, searchTerm, statusFilter])

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '320px' }}>
        <span className="adminSpinner" style={{ width: '28px', height: '28px' }} aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="adminTabBody">
      <div className="adminTabHeader">
        <div className="adminTabHeaderText">
          <div className="adminTabTitleRow">
            <p className="adminTabSubtitle">{t('admin.tenants.subtitle')}</p>
            <span className="adminBadge adminBadgePrimary">
              {t('admin.tenants.total')}: {kpis.total}
            </span>
          </div>
        </div>
        <div className="adminToolbar">
          <button
            onClick={() => setShowCreateModal(true)}
            className="adminButton"
          >
            {t('admin.tenants.new')}
          </button>
        </div>
      </div>

      {error && (
        <div className="adminNotice adminNoticeError">
          <span>{error}</span>
        </div>
      )}

      {actionFeedback && (
        <div className={`adminNotice ${actionFeedback.type === 'success' ? 'adminNoticeSuccess' : 'adminNoticeError'}`}>
          <span>{actionFeedback.message}</span>
          <button onClick={clearActionFeedback} className="adminNoticeDismiss" aria-label={t('common.close')}>✕</button>
        </div>
      )}

      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.tenants.total')}</div>
          <div className="adminCardValue">{kpis.total}</div>
          <div className="adminCardSub">{t('admin.tenants.registered')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.tenants.active')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-success)' }}>{kpis.active}</div>
          <div className="adminCardSub">{t('admin.tenants.activeHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.tenants.suspended')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>{kpis.suspended}</div>
          <div className="adminCardSub">{t('admin.tenants.suspendedHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.tenants.trial')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-foreground)' }}>{kpis.trial}</div>
          <div className="adminCardSub">{t('admin.tenants.trialHint')}</div>
        </div>
      </div>

      <div className="adminToolbar">
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder={t('admin.tenants.searchPlaceholder')}
          className="adminInput"
          style={{ width: '240px', marginBottom: 0 }}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'suspended')}
          className="adminInput"
          style={{ width: '160px', marginBottom: 0 }}
        >
          <option value="all">{t('admin.common.allStatuses')}</option>
          <option value="active">{t('admin.tenants.onlyActive')}</option>
          <option value="suspended">{t('admin.tenants.onlySuspended')}</option>
        </select>
        {(searchTerm || statusFilter !== 'all') && (
          <button
            onClick={() => {
              setSearchTerm('')
              setStatusFilter('all')
            }}
            className="adminLinkButton"
          >
            {t('admin.common.clearFilters')}
          </button>
        )}
      </div>

      <div className="adminCard adminCardTable">
        <div style={{ overflowX: 'auto' }}>
          <table className="adminTable">
            <thead>
              <tr>
                <th>{t('admin.common.name')}</th>
                <th>{t('admin.common.slug')}</th>
                <th>{t('admin.common.status')}</th>
                <th>{t('admin.tenants.subscription')}</th>
                <th>{t('admin.tenants.createdAt')}</th>
                <th style={{ textAlign: 'right' }}>{t('admin.common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--cm-muted-foreground)' }}>
                    {t('admin.tenants.empty')}
                  </td>
                </tr>
              ) : (
                filteredTenants.map(tenant => (
                  <tr key={tenant.id}>
                    <td style={{ fontWeight: 500 }}>{tenant.name}</td>
                    <td style={{ color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', fontSize: '11px' }}>{tenant.slug}</td>
                    <td>
                      <span className={`adminBadge ${tenant.status === 'active' ? 'adminBadgeSuccess' : tenant.status === 'suspended' ? 'adminBadgePrimary' : 'adminBadgeDanger'}`}>
                        {tenant.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px', textTransform: 'capitalize' }}>
                      {tenant.subscription_status || t('admin.tenants.trial')}
                    </td>
                    <td style={{ color: 'var(--cm-muted-foreground)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                      {formatDate(tenant.created_at)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {tenant.status === 'active' ? (
                        <button
                          onClick={() => handleSuspendTenant(tenant.id)}
                          className="adminRowButton"
                          style={{ color: 'var(--cm-primary)' }}
                        >
                          {t('admin.tenants.suspendAction')}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleActivateTenant(tenant.id)}
                          className="adminRowButton"
                          style={{ color: 'var(--cm-success)' }}
                        >
                          {t('admin.tenants.activateAction')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreateModal && (
        <CreateTenantModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            loadTenants()
          }}
        />
      )}
    </div>
  )
}

function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsCreating(true)
    setModalError(null)

    try {
      const { error } = await supabase.from('tenants').insert([{ name, slug }])
      if (error) throw error
      onCreated()
    } catch (err: unknown) {
      setModalError(t('admin.tenants.createFailure', { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="adminOverlay">
      <div className="adminOverlayMask" onClick={onClose} />
      <div className="adminDialog" style={{ maxWidth: '480px' }}>
        <div className="adminDialogHeader">
          <h3 className="adminDialogTitle">{t('admin.tenants.create')}</h3>
          <button
            onClick={onClose}
            className="adminDialogClose"
            aria-label={t('common.close')}
          >
            {'×'}
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && (
            <div className="adminNotice adminNoticeError">
              <span>{modalError}</span>
            </div>
          )}
          <div>
            <label className="adminFieldLabel">{t('admin.common.name')}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('admin.tenants.namePlaceholder')}
              className="adminInput"
              style={{ marginBottom: 0 }}
              required
            />
          </div>
          <div>
            <label className="adminFieldLabel">{t('admin.common.slug')}</label>
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder={t('admin.tenants.slugPlaceholder')}
              className="adminInput"
              style={{ marginBottom: 0, fontFamily: 'monospace' }}
              required
            />
          </div>
          <div className="adminDialogFooter">
            <button
              type="button"
              onClick={onClose}
              className="adminButton adminButtonSecondary"
            >
              {t('admin.common.cancelAction')}
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="adminButton"
              style={{ opacity: isCreating ? 0.5 : 1 }}
            >
              {isCreating ? t('admin.tenants.creating') : t('admin.tenants.createAction')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
