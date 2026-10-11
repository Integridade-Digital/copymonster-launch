import { useId, useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { t } from '../../locales'
import { dnaClaim } from '../dna/installDnaOnboarding'
import css from './FooterActionsRoot.module.css'

interface OnboardingDnaModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLElement | null> | undefined
}

/**
 * Entry modal for the guided DNA interview. It overlays the live workspace
 * like the other footer modals and closes so the creator can answer the agent
 * in the chat behind it; progress and completion stay in the chat header.
 * @param props - open state, close callback, and the focus-restore trigger.
 */
export function OnboardingDnaModal({ isOpen, onClose, triggerRef }: OnboardingDnaModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusTrap(panelRef, { isOpen, onClose, triggerRef })

  if (!isOpen) return null

  const resuming = dnaClaim() !== undefined

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
            <div className={css.headerTitleGroup}>
              <span className={css.headerIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3c0 6 10 6 10 12" />
                  <path d="M17 3c0 6-10 6-10 12" />
                  <path d="M7 21c0-1 10-1 10 0" />
                  <line x1="8.5" y1="8" x2="15.5" y2="8" />
                  <line x1="8.5" y1="16" x2="15.5" y2="16" />
                </svg>
              </span>
              <h3 id={titleId} className={css.headerTitle}>{t('onboarding.dna.title')}</h3>
            </div>
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
            <p className={css.subtitle}>{t('onboarding.dna.subtitle')}</p>
            <p>{t('onboarding.dna.modal.intro')}</p>
            <div className={css.badgeRow}>
              <span className={css.badge}>{t('onboarding.dna.modal.badge')}</span>
            </div>
            <div className={css.modalActions}>
              <button type="button" className={css.secondary} onClick={onClose}>
                {t('onboarding.dna.modal.later')}
              </button>
              <button type="button" className={css.primary} onClick={onClose}>
                {resuming ? t('onboarding.dna.modal.continue') : t('onboarding.dna.modal.start')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
