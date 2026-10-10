import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../../locales'
import { formatDate } from '../../lib/format'
import {
  DNA_REFINE_KEY, countMyPositioningMappings, deletePositioningMapping,
  duplicatePositioningMapping, listMyPositioningMappings, setDefaultPositioningMapping,
  type PositioningMapping, type PositioningQuota,
} from '../../components/dna/useDnaOnboardingState'
import '../../components/dna/dna.css'

export interface MyDnaPageProps {
  onClose(): void
}

/**
 * Settings panel for the creator's DNA mappings: quota header, card grid,
 * and per-card actions (default, refine, duplicate, archive) plus new-DNA
 * creation gated by the plan quota.
 * @param props - closes the owning modal so navigation can leave it.
 */
export function MyDnaPage({ onClose }: MyDnaPageProps) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<readonly PositioningMapping[]>([])
  const [quota, setQuota] = useState<PositioningQuota | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [duplicateFor, setDuplicateFor] = useState<string | null>(null)
  const [duplicateName, setDuplicateName] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(false)
    try {
      const [mappings, counted] = await Promise.all([
        listMyPositioningMappings(),
        countMyPositioningMappings(),
      ])
      setRows(mappings)
      setQuota(counted)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = useCallback(async (mappingId: string, operation: () => Promise<unknown>): Promise<void> => {
    if (busyId !== null) return
    setBusyId(mappingId)
    setActionError(false)
    try {
      await operation()
      await load()
    } catch {
      setActionError(true)
    } finally {
      setBusyId(null)
    }
  }, [busyId, load])

  const refine = (mappingId: string): void => {
    try { sessionStorage.setItem(DNA_REFINE_KEY, mappingId) } catch {
      // Private-mode browsers lose the refine target; onboarding falls back.
    }
    onClose()
    navigate('/onboarding/dna')
  }

  const createNew = (): void => {
    if (quota !== null && !quota.can_create) {
      window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: 'plans' }))
      return
    }
    try { sessionStorage.removeItem(DNA_REFINE_KEY) } catch {
      // Same private-mode allowance as the refine stage.
    }
    onClose()
    navigate('/onboarding/dna')
  }

  return (
    <div className="cm-dna-settings">
      <div className="cm-dna-settings-header">
        <div>
          <h3 className="cm-dna-settings-title">{t('settings.dna.title')}</h3>
          <p className="cm-dna-settings-subtitle">{t('settings.dna.subtitle')}</p>
        </div>
        <div className="cm-dna-settings-actions">
          {quota !== null && (
            <span className={quota.can_create ? 'cm-dna-quota' : 'cm-dna-quota cm-dna-quota--warn'}>
              {quota.is_unlimited
                ? t('settings.dna.quotaUnlimited')
                : t('settings.dna.quota', { count: quota.count, max: quota.max })}
            </span>
          )}
          {quota !== null && !quota.can_create
            ? (
              <button type="button" className="cm-dna-button cm-dna-button--primary" onClick={() => {
                window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: 'plans' }))
              }}>
                {t('settings.dna.upgrade.cta')}
              </button>
            )
            : (
              <button
                type="button"
                className="cm-dna-button cm-dna-button--primary"
                onClick={createNew}
                disabled={loading}
              >
                {t('settings.dna.action.createNew')}
              </button>
            )}
        </div>
      </div>

      {loading && <p className="cm-dna-settings-hint">{t('settings.dna.loading')}</p>}
      {loadError && <p className="cm-dna-settings-hint cm-dna-settings-hint--error">{t('settings.dna.error')}</p>}
      {actionError && <p className="cm-dna-settings-hint cm-dna-settings-hint--error">{t('settings.dna.error')}</p>}

      <div className="cm-dna-grid">
        {rows.map(row => (
          <div key={row.id} className="cm-dna-card-settings">
            <div className="cm-dna-card-settings-head">
              <h4 className="cm-dna-card-name">{row.name}</h4>
              <div className="cm-dna-card-badges">
                {row.is_default && <span className="cm-dna-badge cm-dna-badge--default">{t('settings.dna.card.default')}</span>}
                <span className={row.status === 'completed'
                  ? 'cm-dna-badge cm-dna-badge--completed'
                  : 'cm-dna-badge cm-dna-badge--progress'}>
                  {row.status === 'completed'
                    ? t('settings.dna.card.status.completed')
                    : t('settings.dna.card.status.in_progress')}
                </span>
              </div>
            </div>
            {row.product_name !== '' && <p className="cm-dna-card-product">{row.product_name}</p>}
            <p className="cm-dna-card-updated">{t('settings.dna.card.updated', { date: formatDate(row.updated_at) })}</p>

            {confirmDeleteId === row.id
              ? (
                <div className="cm-dna-inline-form">
                  <p className="cm-dna-inline-hint">
                    {t('settings.dna.confirmDelete.title')}
                    {' '}
                    {t('settings.dna.confirmDelete.message', { name: row.name })}
                  </p>
                  <div className="cm-dna-card-actions">
                    <button
                      type="button"
                      className="cm-dna-card-button cm-dna-card-button--danger"
                      disabled={busyId !== null}
                      onClick={() => {
                        void run(row.id, () => deletePositioningMapping(row.id))
                          .then(() => { setConfirmDeleteId(null) })
                      }}
                    >
                      {t('settings.dna.confirmDelete.confirm')}
                    </button>
                    <button
                      type="button"
                      className="cm-dna-card-button"
                      onClick={() => { setConfirmDeleteId(null) }}
                    >
                      {t('settings.dna.confirmDelete.cancel')}
                    </button>
                  </div>
                </div>
              )
              : duplicateFor === row.id
                ? (
                  <div className="cm-dna-inline-form">
                    <label className="cm-dna-inline-hint" htmlFor={`cm-dna-duplicate-${row.id}`}>
                      {t('settings.dna.duplicate.nameLabel')}
                    </label>
                    <input
                      id={`cm-dna-duplicate-${row.id}`}
                      className="cm-dna-inline-input"
                      value={duplicateName}
                      onChange={(event) => { setDuplicateName(event.target.value) }}
                    />
                    <div className="cm-dna-card-actions">
                      <button
                        type="button"
                        className="cm-dna-card-button"
                        disabled={busyId !== null || duplicateName.trim() === ''}
                        onClick={() => {
                          void run(row.id, () => duplicatePositioningMapping(row.id, duplicateName.trim()))
                            .then(() => {
                              setDuplicateFor(null)
                              setDuplicateName('')
                            })
                        }}
                      >
                        {t('settings.dna.duplicate.confirm')}
                      </button>
                      <button
                        type="button"
                        className="cm-dna-card-button"
                        onClick={() => { setDuplicateFor(null) }}
                      >
                        {t('settings.dna.confirmDelete.cancel')}
                      </button>
                    </div>
                  </div>
                )
                : (
                  <div className="cm-dna-card-actions">
                    {!row.is_default && (
                      <button
                        type="button"
                        className="cm-dna-card-button"
                        disabled={busyId !== null}
                        onClick={() => { void run(row.id, () => setDefaultPositioningMapping(row.id)) }}
                      >
                        {t('settings.dna.action.setDefault')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="cm-dna-card-button"
                      disabled={busyId !== null}
                      onClick={() => { refine(row.id) }}
                    >
                      {t('settings.dna.action.refine')}
                    </button>
                    <button
                      type="button"
                      className="cm-dna-card-button"
                      disabled={busyId !== null}
                      onClick={() => {
                        setDuplicateFor(row.id)
                        setDuplicateName(row.name)
                      }}
                    >
                      {t('settings.dna.action.duplicate')}
                    </button>
                    <button
                      type="button"
                      className="cm-dna-card-button cm-dna-card-button--danger"
                      disabled={busyId !== null}
                      onClick={() => { setConfirmDeleteId(row.id) }}
                    >
                      {t('settings.dna.action.delete')}
                    </button>
                  </div>
                )}
          </div>
        ))}
      </div>

      {!loading && !loadError && rows.length === 0 && (
        <p className="cm-dna-settings-hint">{t('settings.dna.empty')}</p>
      )}
    </div>
  )
}
