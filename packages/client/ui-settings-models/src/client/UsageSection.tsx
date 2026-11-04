/**
 * Usage settings section: the caller tenant's plan, trial consumption and
 * period usage.
 *
 * This is product information for every creator, not provider configuration:
 * the section is registered for everyone, while the Models section that owns
 * provider credentials stays behind the platform-operator gate.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { en } from './locales.ts'
import styles from './UsageSection.module.css'

/** Plan facts the section renders, as `getTenantMetrics` reports them. */
export interface UsagePlan {
  readonly name: string
  readonly slug: string
  readonly token_limit_input: number | null
  readonly token_limit_output: number | null
}

/** Trial and period counters the section renders. */
export interface UsageMetrics {
  readonly tenantId: string
  readonly subscriptionStatus: string
  readonly plan: UsagePlan | null
  readonly trial: {
    readonly trialEndsAt: string | null
    readonly trialUsed: boolean
    readonly trialTokensUsed: number
    readonly maxTrialTokens: number
    readonly isExpired: boolean
    readonly daysLeft: number
  }
  readonly usage: {
    readonly currentPeriodTokensUsed: number
    readonly totalTokensLimit: number
  }
}

/** Injected dependencies of {@link UsageSection} (slot `inject`). */
export interface UsageSectionInjected {
  /** Read the caller tenant's metrics through the settings Remote. */
  load: () => Promise<UsageMetrics>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Section owner props plus this section's injected face. */
export type UsageSectionProps = PropsRuntime<'settings.section'> & InjectFace<UsageSectionInjected>

/** Format a token count the way the billing page does. */
function tokens(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * Render the plan, trial and period usage of the signed-in tenant.
 * @param props - section owner state and the metrics loader.
 * @returns the usage panel.
 */
export function UsageSection(props: UsageSectionProps): ReactNode {
  const { load, t } = props
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; metrics?: UsageMetrics }>({
    status: 'loading',
  })

  // The slot rebuilds the inject face on every render; keep the first loader so
  // the effect below runs once instead of refetching on each parent render.
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let live = true
    void loadRef.current()
      .then((metrics) => { if (live) setState({ status: 'ready', metrics }) })
      .catch(() => { if (live) setState({ status: 'error' }) })
    return () => { live = false }
  }, [])

  if (state.status === 'loading') {
    return <div className={styles.page} role="status" aria-live="polite">{t('usageLoading')}</div>
  }
  if (state.status === 'error' || state.metrics === undefined) {
    return <div className={styles.page} role="alert">{t('usageError')}</div>
  }

  const { metrics } = state
  const trialLimit = metrics.trial.maxTrialTokens
  const trialPercent = trialLimit > 0
    ? Math.min(100, Math.round((metrics.trial.trialTokensUsed / trialLimit) * 100))
    : 0
  const periodPercent = metrics.usage.totalTokensLimit > 0
    ? Math.min(100, Math.round((metrics.usage.currentPeriodTokensUsed / metrics.usage.totalTokensLimit) * 100))
    : 0

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>{t('usageTitle')}</h2>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{t('usagePlan')}</dt>
          <dd>{metrics.plan === null ? t('usageNoPlan') : metrics.plan.name}</dd>
        </div>
        <div className={styles.fact}>
          <dt>{t('usageStatus')}</dt>
          <dd>{metrics.subscriptionStatus}</dd>
        </div>
        <div className={styles.fact}>
          <dt>{t('usageTrialEnds')}</dt>
          <dd>
            {metrics.trial.isExpired
              ? t('usageTrialExpired')
              : t('usageDaysRemaining').replace('{days}', String(metrics.trial.daysLeft))}
          </dd>
        </div>
      </dl>

      <section className={styles.meter}>
        <div className={styles.meterHead}>
          <span className={styles.meterLabel}>{t('usageTrialTokens')}</span>
          <span className={styles.meterValue}>
            {t('usageTokensUsed')
              .replace('{used}', tokens(metrics.trial.trialTokensUsed))
              .replace('{limit}', tokens(trialLimit))
              .replace('{percent}', String(trialPercent))}
          </span>
        </div>
        <div
          className={styles.track}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={trialPercent}
        >
          <div className={styles.fill} style={{ width: `${trialPercent}%` }} />
        </div>
      </section>

      <section className={styles.meter}>
        <div className={styles.meterHead}>
          <span className={styles.meterLabel}>{t('usagePeriodTokens')}</span>
          <span className={styles.meterValue}>
            {t('usageTokensUsed')
              .replace('{used}', tokens(metrics.usage.currentPeriodTokensUsed))
              .replace('{limit}', tokens(metrics.usage.totalTokensLimit))
              .replace('{percent}', String(periodPercent))}
          </span>
        </div>
        <div
          className={styles.track}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={periodPercent}
        >
          <div className={styles.fill} style={{ width: `${periodPercent}%` }} />
        </div>
      </section>
    </div>
  )
}
