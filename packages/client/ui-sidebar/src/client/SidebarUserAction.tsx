import type { MouseEvent } from 'react'
import styles from './SidebarUserAction.module.css'

import type { SidebarKey } from './locales.ts'

interface SidebarUserActionProps {
  wide?: boolean
  t?: (key: SidebarKey) => string
}

export function SidebarUserAction({ wide, t }: SidebarUserActionProps) {
  const handleProfileClick = (e: MouseEvent) => {
    e.preventDefault()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: 'profile' }))
    }
  }

  const handleLogout = (e: MouseEvent) => {
    e.preventDefault()
    if (typeof window !== 'undefined') {
      try {
        const authGlobal = globalThis as { __DSH_AUTH__?: unknown }
        delete authGlobal.__DSH_AUTH__
      } catch {}
      window.dispatchEvent(new CustomEvent('copymonster:logout'))
      window.history.pushState({}, '', '/login')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }

  return (
    <div className={styles.userItem}>
      {wide ? (
        <div className={styles.wideUserContainer}>
          <div
            className={styles.userInfo}
            onClick={handleProfileClick}
            title={t?.('user.profile') || 'Profile'}
            role="button"
            tabIndex={0}
          >
            <div className={styles.userAvatar}>U</div>
            <span className={styles.userLabel}>{t?.('user.profile') || 'Profile'}</span>
          </div>
          <div className={styles.userActions}>
            <button
              type="button"
              className={styles.logoutButton}
              onClick={handleLogout}
              title={t?.('user.logout') || 'Log out'}
            >
              {t?.('user.logout') || 'Log out'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleProfileClick}
          className={styles.railUserButton}
          title={t?.('user.profile') || 'Profile'}
          aria-label={t?.('user.profile') || 'Profile'}
        >
          U
        </button>
      )}
    </div>
  )
}
