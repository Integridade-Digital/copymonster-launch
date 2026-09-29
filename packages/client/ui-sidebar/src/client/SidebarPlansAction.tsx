import React from 'react'
import { useNavigate } from 'react-router-dom'
import { IconPlanOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-types'
import type { SidebarKey } from './locales.js'
import styles from './SidebarPlansAction.module.css'

export function SidebarPlansAction({
  wide,
  t,
}: PropsRuntime<{ wide?: boolean }> & PropsLocale<SidebarKey>) {
  const navigate = useNavigate()

  return (
    <div className={styles.actionItem}>
      <button
        type="button"
        onClick={() => { navigate('/plans') }}
        className={wide ? styles.wideButton : styles.railButton}
        title={t('plans.button')}
        aria-label={t('plans.button')}
      >
        <span className={styles.actionIcon} aria-hidden="true">
          <IconPlanOutline14 size={14} />
        </span>
        {wide && (
          <span className={styles.actionLabel}>
            {t('plans.button')}
          </span>
        )}
      </button>
    </div>
  )
}
