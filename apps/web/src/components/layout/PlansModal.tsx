import { useEffect, useRef } from 'react'
import { PlansPage } from '../../pages/billing/PlansPage'
import css from './FooterActionsRoot.module.css'

interface PlansModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLButtonElement | null>
}

export function PlansModal({ isOpen, onClose, triggerRef }: PlansModalProps) {
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
        aria-label="Planos e Faturamento"
        tabIndex={-1}
        className={css.panel}
      >
        <button
          type="button"
          className={css.closeButton}
          onClick={onClose}
          aria-label="Fechar painel de planos"
        >
          ✕
        </button>
        <div className={css.content}>
          <PlansPage />
        </div>
      </div>
    </div>
  )
}
