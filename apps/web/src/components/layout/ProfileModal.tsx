import { useId, useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
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
}

const PROFILE_TABS: ProfileTabConfig[] = [
  { key: 'account', labelEn: 'Account Data', labelZh: '账户数据' },
  { key: 'security', labelEn: 'Security & Password', labelZh: '安全与密码' },
]

/** Rail glyph for one profile section; both are native SVG, never emoji. */
function profileIcon(key: ProfileSectionKey) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (key === 'security') {
    return <svg {...common}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
  }
  return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
}

export function ProfileModal({ isOpen, onClose, triggerRef, currentUser, onProfileUpdated }: ProfileModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [activeSection, setActiveSection] = useState<ProfileSectionKey>('account')
  const lang = getActiveLocale()

  const titleId = useId()
  useFocusTrap(panelRef, { isOpen, onClose, triggerRef })

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
        aria-labelledby={titleId}
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
                  <span className={css.railIcon}>{profileIcon(tab.key)}</span>
                  <span className={css.railLabel}>{label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Right Content Area */}
        <div className={css.contentArea}>
          <div className={css.header}>
            <h3 id={titleId} className={css.headerTitle}>{activeTitle}</h3>
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
