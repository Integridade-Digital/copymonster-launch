import { useId, useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { MyDnaPage } from '../../pages/settings/MyDnaPage'
import { t } from '../../locales'
import css from './FooterActionsRoot.module.css'

interface DnaModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLButtonElement | null> | undefined
}

export function DnaModal({ isOpen, onClose, triggerRef }: DnaModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  const titleId = useId()
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
        tabIndex={-1}
        className={css.panel}
      >
        <div className={css.singlePanelContent}>
          <div className={css.header}>
            <h3 id={titleId} className={css.headerTitle}>{t('settings.dna.title')}</h3>
            <button
              type="button"
              className={css.closeButton}
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
    </div>
  )
}
