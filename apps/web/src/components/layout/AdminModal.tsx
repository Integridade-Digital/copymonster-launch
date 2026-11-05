import { useId, useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { AdminOverviewTab } from '../../pages/admin/tabs/AdminOverviewTab'
import { AdminUsersTab } from '../../pages/admin/tabs/AdminUsersTab'
import { AdminTenantsTab } from '../../pages/admin/tabs/AdminTenantsTab'
import { AdminSystemTab } from '../../pages/admin/tabs/AdminSystemTab'
import { AdminSessionsTab } from '../../pages/admin/tabs/AdminSessionsTab'
import { AdminAuditTab } from '../../pages/admin/tabs/AdminAuditTab'
import { AdminBillingTab } from '../../pages/admin/tabs/AdminBillingTab'
import { AdminAffiliates } from '../../pages/admin/tabs/AdminAffiliates'
import { t } from '../../locales'
import css from './FooterActionsRoot.module.css'

interface AdminModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLElement | null> | undefined
  isPlatformAdmin?: boolean | undefined
}

export type AdminTabKey =
  | 'overview'
  | 'users'
  | 'tenants'
  | 'system'
  | 'sessions'
  | 'audit'
  | 'billing'
  | 'affiliates'

interface TabConfig {
  key: AdminTabKey
  labelEn: string
  labelZh: string
}

const ADMIN_TABS: TabConfig[] = [
  { key: 'overview', labelEn: 'Overview', labelZh: '概览' },
  { key: 'users', labelEn: 'Users', labelZh: '用户' },
  { key: 'tenants', labelEn: 'Tenants', labelZh: '租户' },
  { key: 'system', labelEn: 'Settings', labelZh: '设置' },
  { key: 'sessions', labelEn: 'Sessions', labelZh: '会话' },
  { key: 'audit', labelEn: 'Audit', labelZh: '审计' },
  { key: 'billing', labelEn: 'Billing', labelZh: '账单' },
  { key: 'affiliates', labelEn: 'Affiliates', labelZh: '联盟' },
]

export function AdminModal({ isOpen, onClose, triggerRef, isPlatformAdmin }: AdminModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<AdminTabKey>('overview')

  const titleId = useId()
  useFocusTrap(panelRef, { isOpen, onClose, triggerRef })

  if (!isOpen) return null

  const isAuthorized = isPlatformAdmin === true
  const activeTabConfig = ADMIN_TABS.find(t => t.key === activeTab) || ADMIN_TABS[0]
  const activeTabTitle = activeTab === 'affiliates' ? t('admin.affiliates.title') : activeTabConfig ? t(`admin.tab.${activeTab === 'system' ? 'settings' : activeTab}` as any) : t('admin.tab.overview')

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
                  const label = tab.key === 'affiliates' ? t('admin.affiliates.title') : t(`admin.tab.${tab.key === 'system' ? 'settings' : tab.key}` as any)
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`${css.railCell} ${isActive ? css.railCellActive : ''}`}
                    >
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
                {activeTab === 'system' && <AdminSystemTab />}
                {activeTab === 'sessions' && <AdminSessionsTab />}
                {activeTab === 'audit' && <AdminAuditTab />}
                {activeTab === 'billing' && <AdminBillingTab />}
                {activeTab === 'affiliates' && <AdminAffiliates />}
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
