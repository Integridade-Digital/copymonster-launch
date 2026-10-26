import { useCallback, useEffect, useState } from 'react'
import { t } from '../../locales'
import { startDnaOnboarding } from '../../components/dna/installDnaOnboarding'
import { formatDate } from '../../lib/format'
import {
  DNA_REFINE_KEY, DNA_FORCE_NEW_KEY, countMyPositioningMappings, deletePositioningMapping,
  duplicatePositioningMapping, listMyPositioningMappings, setDefaultPositioningMapping,
  type PositioningMapping, type PositioningQuota,
} from '../../components/dna/useDnaOnboardingState'
import css from './MyDnaPage.module.css'

export interface MyDnaPageProps {
  onClose(): void
}

/**
 * Settings panel for the creator's DNA mappings: quota header, card grid,
 * and per-card actions (default, refine, duplicate, archive) plus new-DNA
 * creation gated by the plan quota.
 * @param props - closes the owning modal before an onboarding restart.
 */
export function MyDnaPage({ onClose }: MyDnaPageProps) {
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
    startDnaOnboarding()
  }

  const createNew = (): void => {
    if (quota !== null && !quota.can_create) {
      window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: 'plans' }))
      return
    }
    try {
      sessionStorage.removeItem(DNA_REFINE_KEY)
      sessionStorage.setItem(DNA_FORCE_NEW_KEY, 'true')
    } catch {
      // Same private-mode allowance as the refine stage.
    }
    onClose()
    startDnaOnboarding()
  }

  return (
    <div className={css.page}>
      <div className={css.actionsBar}>
        {quota !== null && (
          <span className={quota.can_create ? css.quota : `${css.quota} ${css.quotaWarn}`}>
            {quota.is_unlimited
              ? t('settings.dna.quotaUnlimited')
              : t('settings.dna.quota', { count: quota.count, max: quota.max })}
          </span>
        )}
        {quota !== null && !quota.can_create
          ? (
            <button type="button" className={css.primaryButton} onClick={() => {
              window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: 'plans' }))
            }}>
              {t('settings.dna.upgrade.cta')}
            </button>
          )
          : (
            <button
              type="button"
              className={css.primaryButton}
              onClick={createNew}
              disabled={loading}
            >
              {t('settings.dna.action.createNew')}
            </button>
          )}
      </div>

      {loading && (
        <div className={css.loading} role="status" aria-live="polite">
          <span className={css.spinner} aria-hidden="true" />
          <span>{t('settings.dna.loading')}</span>
        </div>
      )}
      {loadError && <p className={css.error}>{t('settings.dna.error')}</p>}
      {actionError && <p className={css.error}>{t('settings.dna.error')}</p>}

      {!loading && !loadError && rows.length === 0 && (
        <div className={css.empty}>
          <span className={css.emptyIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3c0 6 10 6 10 12" />
              <path d="M17 3c0 6-10 6-10 12" />
              <path d="M7 21c0-1 10-1 10 0" />
              <line x1="8.5" y1="8" x2="15.5" y2="8" />
              <line x1="8.5" y1="16" x2="15.5" y2="16" />
            </svg>
          </span>
          <p className={css.emptyText}>{t('settings.dna.empty')}</p>
          <button type="button" className={css.primaryButton} onClick={createNew}>
            {t('settings.dna.action.createNew')}
          </button>
        </div>
      )}

      <div className={css.grid}>
        {rows.map(row => (
          <div key={row.id} className={`${css.card} cm-settings-dna-card`}>
            <div className={css.cardHead}>
              <h4 className={css.cardName}>{row.name}</h4>
              <div className={css.badges}>
                {row.is_default && <span className={`${css.badge} ${css.badgeDefault}`}>{t('settings.dna.card.default')}</span>}
                <span className={`${css.badge} ${row.status === 'completed' ? css.badgeCompleted : css.badgeProgress}`}>
                  {row.status === 'completed'
                    ? t('settings.dna.card.status.completed')
                    : t('settings.dna.card.status.in_progress')}
                </span>
              </div>
            </div>
            {row.product_name !== '' && <p className={css.cardProduct}>{row.product_name}</p>}
            <p className={css.cardUpdated}>{t('settings.dna.card.updated', { date: formatDate(row.updated_at) })}</p>

            {confirmDeleteId === row.id
              ? (
                <div className={css.inlineForm}>
                  <p className={css.inlineHint}>
                    {t('settings.dna.confirmDelete.title')}
                    {' '}
                    {t('settings.dna.confirmDelete.message', { name: row.name })}
                  </p>
                  <div className={css.cardActions}>
                    <button
                      type="button"
                      className={`${css.cardButton} ${css.delete}`}
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
                      className={css.cardButton}
                      onClick={() => { setConfirmDeleteId(null) }}
                    >
                      {t('settings.dna.confirmDelete.cancel')}
                    </button>
                  </div>
                </div>
              )
              : duplicateFor === row.id
                ? (
                  <div className={css.inlineForm}>
                    <label className={css.inlineHint} htmlFor={`cm-dna-duplicate-${row.id}`}>
                      {t('settings.dna.duplicate.nameLabel')}
                    </label>
                    <input
                      id={`cm-dna-duplicate-${row.id}`}
                      className={css.inlineInput}
                      value={duplicateName}
                      onChange={(event) => { setDuplicateName(event.target.value) }}
                    />
                    <div className={css.cardActions}>
                      <button
                        type="button"
                        className={css.cardButton}
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
                        className={css.cardButton}
                        onClick={() => { setDuplicateFor(null) }}
                      >
                        {t('settings.dna.confirmDelete.cancel')}
                      </button>
                    </div>
                  </div>
                )
                : (
                  <div className={css.cardActions}>
                    {!row.is_default && (
                      <button
                        type="button"
                        className={css.cardButton}
                        disabled={busyId !== null}
                        onClick={() => { void run(row.id, () => setDefaultPositioningMapping(row.id)) }}
                      >
                        {t('settings.dna.action.setDefault')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${css.cardButton} ${css.refine}`}
                      disabled={busyId !== null}
                      onClick={() => { refine(row.id) }}
                    >
                      {row.status === 'in_progress'
                        ? t('settings.dna.action.resume')
                        : t('settings.dna.action.refine')}
                    </button>
                    <button
                      type="button"
                      className={css.cardButton}
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
                      className={`${css.cardButton} ${css.delete}`}
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
    </div>
  )
}
