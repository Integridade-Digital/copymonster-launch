import { useId, useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { t } from '../../locales'
import { dnaClaim } from '../dna/installDnaOnboarding'
import css from './OnboardingDnaModal.module.css'

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
  const descriptionId = useId()
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
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={css.dialog}
      >
        <div className={css.header}>
          <div className={css.identity}>
            <span className={css.icon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </span>
            <div className={css.titles}>
              <h3 id={titleId} className={css.title}>{t('onboarding.dna.title')}</h3>
              <p className={css.subtitle}>{t('onboarding.dna.subtitle')}</p>
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
        <div className={css.body}>
          <p id={descriptionId} className={css.text}>{t('onboarding.dna.modal.intro')}</p>
          <span className={css.badge}>{t('onboarding.dna.modal.badge')}</span>
        </div>
        <div className={css.footer}>
          <button type="button" className={css.secondary} onClick={onClose}>
            {t('onboarding.dna.modal.later')}
          </button>
          <button type="button" className={css.primary} onClick={onClose}>
            {resuming ? t('onboarding.dna.modal.continue') : t('onboarding.dna.modal.start')}
          </button>
        </div>
      </div>
    </div>
  )
}
