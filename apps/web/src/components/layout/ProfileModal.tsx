import { useEffect, useRef, useState } from 'react'
import { ProfilePage, ProfileUser, ProfileSectionKey } from '../../pages/ProfilePage'
import { t, getActiveLocale } from '../../locales'
import css from './FooterActionsRoot.module.css'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef?: React.RefObject<HTMLButtonElement | null> | undefined
  currentUser?: ProfileUser | null | undefined
  onProfileUpdated?: (() => void) | undefined
}

interface ProfileTabConfig {
  key: ProfileSectionKey
  labelEn: string
  labelZh: string
  icon: string
}

const PROFILE_TABS: ProfileTabConfig[] = [
  { key: 'account', labelEn: 'Account Data', labelZh: '账户数据', icon: '👤' },
  { key: 'security', labelEn: 'Security & Password', labelZh: '安全与密码', icon: '🔒' },
]

export function ProfileModal({ isOpen, onClose, triggerRef, currentUser, onProfileUpdated }: ProfileModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [activeSection, setActiveSection] = useState<ProfileSectionKey>('account')
  const lang = getActiveLocale()

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

  const activeTabConfig = PROFILE_TABS.find(t => t.key === activeSection) || PROFILE_TABS[0]
  const activeTitle = activeTabConfig ? (lang === 'zh' ? activeTabConfig.labelZh : activeTabConfig.labelEn) : 'Account Data'

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('profile.title')}
        tabIndex={-1}
        className={css.panel}
      >
        {/* Left Nav Rail */}
        <nav className={css.navRail} aria-label={t('profile.title')}>
          <div className={css.railTitle}>{t('profile.title')}</div>
          <div className={css.railList}>
            {PROFILE_TABS.map((tab) => {
              const isActive = activeSection === tab.key
              const label = lang === 'zh' ? `${tab.labelEn} (${tab.labelZh})` : tab.labelEn
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveSection(tab.key)}
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
            <div className={css.headerTitle}>{activeTitle}</div>
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
            <ProfilePage
              currentUser={currentUser}
              onProfileUpdated={onProfileUpdated}
              activeSection={activeSection}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
