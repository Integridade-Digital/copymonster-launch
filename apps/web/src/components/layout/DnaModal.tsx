import { useId, useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { MyDnaPage } from '../../pages/settings/MyDnaPage'
import { t } from '../../locales'
import css from './DnaModal.module.css'

interface DnaModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLButtonElement | null> | undefined
}

/**
 * "My DNA" modal shell: overlay plus a titled header around the MyDnaPage
 * management body, following the other DNA footer modals.
 * @param props - open state, close callback, and the focus-restore trigger.
 */
export function DnaModal({ isOpen, onClose, triggerRef }: DnaModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  useFocusTrap(panelRef, { isOpen, onClose, triggerRef })

  if (!isOpen) return null

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={css.dialog}
      >
        <div className={css.header}>
          <div className={css.identity}>
            <span className={css.icon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 3c0 6 10 6 10 12" />
                <path d="M17 3c0 6-10 6-10 12" />
                <path d="M7 21c0-1 10-1 10 0" />
                <line x1="8.5" y1="8" x2="15.5" y2="8" />
                <line x1="8.5" y1="16" x2="15.5" y2="16" />
              </svg>
            </span>
            <div className={css.titles}>
              <h3 id={titleId} className={css.title}>{t('settings.dna.title')}</h3>
              <p id={descriptionId} className={css.subtitle}>{t('settings.dna.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            className={css.close}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={css.bodyScroll}>
          <MyDnaPage onClose={onClose} />
        </div>
      </div>
    </div>
  )
}
