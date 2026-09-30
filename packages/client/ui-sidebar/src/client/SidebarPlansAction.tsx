import type { MouseEvent } from 'react'
import { IconPlanOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './SidebarPlansAction.module.css'

import type { SidebarKey } from './locales.ts'

interface SidebarPlansActionProps {
  wide?: boolean
  t?: (key: SidebarKey) => string
}

export function SidebarPlansAction({ wide, t }: SidebarPlansActionProps) {
  const handleClick = (e: MouseEvent) => {
    e.preventDefault()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: 'plans' }))
    }
  }

  return (
    <div className={styles.actionItem}>
      <button
        type="button"
        onClick={handleClick}
        className={wide ? styles.wideButton : styles.railButton}
        title={t?.('plans.button') || 'Plans'}
        aria-label={t?.('plans.button') || 'Plans'}
      >
        <span className={styles.actionIcon} aria-hidden="true">
          <IconPlanOutline14 size={14} />
        </span>
        {wide && (
          <span className={styles.actionLabel}>
            {t?.('plans.button') || 'Plans'}
          </span>
        )}
      </button>
    </div>
  )
}
