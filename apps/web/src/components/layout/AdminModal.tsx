import { useId, useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { AdminOverviewTab } from '../../pages/admin/tabs/AdminOverviewTab'
import { AdminUsersTab } from '../../pages/admin/tabs/AdminUsersTab'
import { AdminTenantsTab } from '../../pages/admin/tabs/AdminTenantsTab'
import { AdminLLMProvidersTab } from '../../pages/admin/tabs/AdminLLMProvidersTab'
import { AdminModelsTab } from '../../pages/admin/tabs/AdminModelsTab'
import { AdminSystemTab } from '../../pages/admin/tabs/AdminSystemTab'
import { AdminSessionsTab } from '../../pages/admin/tabs/AdminSessionsTab'
import { AdminAuditTab } from '../../pages/admin/tabs/AdminAuditTab'
import { AdminBillingTab } from '../../pages/admin/tabs/AdminBillingTab'
import { t, getActiveLocale } from '../../locales'
import css from './FooterActionsRoot.module.css'

interface AdminModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLElement | null> | undefined
  role?: string | null | undefined
}

export type AdminTabKey =
  | 'overview'
  | 'users'
  | 'tenants'
  | 'llm_providers'
  | 'models'
  | 'system'
  | 'sessions'
  | 'audit'
  | 'billing'

interface TabConfig {
  key: AdminTabKey
  labelEn: string
  labelZh: string
  icon: string
}

const ADMIN_TABS: TabConfig[] = [
  { key: 'overview', labelEn: 'Overview', labelZh: '概览', icon: '📊' },
  { key: 'users', labelEn: 'Users', labelZh: '用户', icon: '👥' },
  { key: 'tenants', labelEn: 'Tenants', labelZh: '租户', icon: '🏢' },
  { key: 'llm_providers', labelEn: 'LLM Providers', labelZh: 'LLM 提供商', icon: '🤖' },
  { key: 'models', labelEn: 'Models', labelZh: '模型', icon: '🧠' },
  { key: 'system', labelEn: 'Settings', labelZh: '设置', icon: '⚙️' },
  { key: 'sessions', labelEn: 'Sessions', labelZh: '会话', icon: '💬' },
  { key: 'audit', labelEn: 'Audit', labelZh: '审计', icon: '📜' },
  { key: 'billing', labelEn: 'Billing', labelZh: '账单', icon: '💳' },
]

export function AdminModal({ isOpen, onClose, triggerRef, role }: AdminModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<AdminTabKey>('overview')
  const lang = getActiveLocale()

  const titleId = useId()
  useFocusTrap(panelRef, { isOpen, onClose, triggerRef })

  if (!isOpen) return null

  const isAuthorized = role === 'owner' || role === 'admin'
  const activeTabConfig = ADMIN_TABS.find(t => t.key === activeTab) || ADMIN_TABS[0]
  const activeTabTitle = activeTabConfig ? (lang === 'zh' ? activeTabConfig.labelZh : activeTabConfig.labelEn) : 'Overview'

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
        {isAuthorized ? (
          <>
            {/* Left Nav Rail (Settings Pattern) */}
            <nav className={css.navRail} aria-label={t('common.admin')}>
              <div className={css.railTitle}>{t('common.admin')}</div>
              <div className={css.railList}>
                {ADMIN_TABS.map((tab) => {
                  const isActive = activeTab === tab.key
                  const label = lang === 'zh' ? `${tab.labelEn} (${tab.labelZh})` : tab.labelEn
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`${css.railCell} ${isActive ? css.railCellActive : ''}`}
                    >
                      <span className={css.railIcon}>{tab.icon}</span>
                      <span className={css.railLabel}>{label}</span>
                    </button>
                  )
                })}
              </div>
            </nav>

            {/* Right Content Area */}
            <div className={css.contentArea}>
              <div className={css.header}>
                <h3 id={titleId} className={css.headerTitle}>{activeTabTitle}</h3>
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
          </>
        ) : (
          <div className={css.singlePanelContent}>
            <div className={css.header}>
              <h3 id={titleId} className={css.headerTitle}>{t('common.admin')}</h3>
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
            <div className={css.adminRestricted}>{t('admin.restricted')}</div>
          </div>
        )}
      </div>
    </div>
  )
}
