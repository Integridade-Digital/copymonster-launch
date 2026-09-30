import { useEffect, useRef, useState } from 'react'
import { RoleGate } from '../auth/RoleGate'
import { AdminTenantsPage } from '../../pages/admin/AdminTenantsPage'
import { AdminAuditPage } from '../../pages/admin/AdminAuditPage'
import css from './FooterActionsRoot.module.css'

interface AdminModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLElement | null>
}

export function AdminModal({ isOpen, onClose, triggerRef }: AdminModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<'tenants' | 'audit'>('tenants')

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
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
        aria-label="Painel Administrativo"
        tabIndex={-1}
        className={css.panel}
      >
        <button
          type="button"
          className={css.closeButton}
          onClick={onClose}
          aria-label="Fechar painel admin"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <RoleGate allowedRoles={['owner', 'admin']} fallback={<div className={css.adminRestricted}>Acesso restrito a administradores.</div>}>
          <div className={css.adminContainer}>
            <div className={css.adminTabBar}>
              <button
                type="button"
                onClick={() => setActiveTab('tenants')}
                className={`${css.adminTab} ${activeTab === 'tenants' ? css.adminTabActive : ''}`}
              >
                Tenants
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('audit')}
                className={`${css.adminTab} ${activeTab === 'audit' ? css.adminTabActive : ''}`}
              >
                Trilha de Auditoria
              </button>
            </div>
            <div className={css.adminContent}>
              {activeTab === 'tenants' ? <AdminTenantsPage /> : <AdminAuditPage />}
            </div>
          </div>
        </RoleGate>
      </div>
    </div>
  )
}
