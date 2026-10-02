import { useEffect, useRef } from 'react'
import { PlansPage, type PlansUser } from '../../pages/billing/PlansPage'
import { t } from '../../locales'
import css from './FooterActionsRoot.module.css'

interface PlansModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLButtonElement | null> | undefined
  currentUser?: PlansUser | null | undefined
}

export function PlansModal({ isOpen, onClose, triggerRef, currentUser }: PlansModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    panelRef.current?.focus()

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      triggerRef?.current?.focus()
    }
  }, [isOpen, onClose, triggerRef])

  if (!isOpen) return null

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('plans.title')}
        tabIndex={-1}
        className={css.panel}
      >
        <div className={css.singlePanelContent}>
          <div className={css.header}>
            <div className={css.headerTitle}>{t('plans.title')}</div>
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
            <PlansPage currentUser={currentUser} />
          </div>
        </div>
      </div>
    </div>
  )
}
