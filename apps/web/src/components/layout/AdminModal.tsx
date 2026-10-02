import { useEffect, useRef, useState } from 'react'
import { AdminOverviewTab } from '../../pages/admin/tabs/AdminOverviewTab'
import { AdminUsersTab } from '../../pages/admin/tabs/AdminUsersTab'
import { AdminTenantsTab } from '../../pages/admin/tabs/AdminTenantsTab'
import { AdminLLMProvidersTab } from '../../pages/admin/tabs/AdminLLMProvidersTab'
import { AdminModelsTab } from '../../pages/admin/tabs/AdminModelsTab'
import { AdminSystemTab } from '../../pages/admin/tabs/AdminSystemTab'
import { AdminSessionsTab } from '../../pages/admin/tabs/AdminSessionsTab'
import { AdminAuditTab } from '../../pages/admin/tabs/AdminAuditTab'
import { AdminBillingTab } from '../../pages/admin/tabs/AdminBillingTab'
import css from './FooterActionsRoot.module.css'

interface AdminModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLElement | null> | undefined
  role?: string | null | undefined
}

type AdminTabKey =
  | 'overview'
  | 'users'
  | 'tenants'
  | 'llm_providers'
  | 'models'
  | 'system'
  | 'sessions'
  | 'audit'
  | 'billing'

const ADMIN_TABS: { key: AdminTabKey; label: string }[] = [
  { key: 'overview', label: 'Visão Geral' },
  { key: 'users', label: 'Usuários' },
  { key: 'tenants', label: 'Tenants' },
  { key: 'llm_providers', label: 'Provedores LLM' },
  { key: 'models', label: 'Modelos' },
  { key: 'system', label: 'Configuração' },
  { key: 'sessions', label: 'Sessões' },
  { key: 'audit', label: 'Auditoria' },
  { key: 'billing', label: 'Faturamento' },
]

export function AdminModal({ isOpen, onClose, triggerRef, role }: AdminModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<AdminTabKey>('overview')

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

  const isAuthorized = role === 'owner' || role === 'admin'

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
        {isAuthorized ? (
          <div className={css.adminContainer}>
            <div className={css.adminTabBar}>
              {ADMIN_TABS.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`${css.adminTab} ${activeTab === tab.key ? css.adminTabActive : ''}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className={css.adminContent}>
              {activeTab === 'overview' && <AdminOverviewTab />}
              {activeTab === 'users' && <AdminUsersTab />}
              {activeTab === 'tenants' && <AdminTenantsTab />}
              {activeTab === 'llm_providers' && <AdminLLMProvidersTab />}
              {activeTab === 'models' && <AdminModelsTab />}
              {activeTab === 'system' && <AdminSystemTab />}
              {activeTab === 'sessions' && <AdminSessionsTab />}
              {activeTab === 'audit' && <AdminAuditTab />}
              {activeTab === 'billing' && <AdminBillingTab />}
            </div>
          </div>
        ) : (
          <div className={css.adminRestricted}>Acesso restrito a administradores.</div>
        )}
      </div>
    </div>
  )
}
