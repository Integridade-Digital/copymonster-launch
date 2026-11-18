/**
 * Platform failover policy card rendered inside `settings.models.footer`.
 *
 * Visible exclusively to platform administrators (`whenPlatformAdmin`). The
 * tenant model route is not configurable here: `dsh-host-model-mask` resolves it
 * from the live catalog on every turn, so `Settings > Models` is the only place a
 * provider is chosen. This card owns the one remaining mask setting, whether a
 * turn may fail over across the resolved route chain.
 *
 * Changes are committed through the settings Remote under the `model-mask`
 * namespace, updating the Host's live model-mask adapter in real time.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsOperations } from './operations.ts'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { en } from './locales.ts'
import styles from './PlatformRoutingCard.module.css'

/** Dependencies injected from the Models page context. */
export interface PlatformRoutingCardInjected {
  readonly controller: ModelsSettingsStore
  readonly hooks: {
    readonly snapshot: SnapshotStore<ModelsSettingsState>
  }
  readonly operations: ModelsOperations
  readonly t: (key: keyof typeof en) => string
}

export type PlatformRoutingCardProps = PropsRuntime<'settings.models.footer'> &
  InjectFace<PlatformRoutingCardInjected>

/** The `model-mask` settings fields this card reads. */
interface MaskSettingsConfig {
  fallbackPolicy?: {
    enabled?: boolean
  }
}

export function PlatformRoutingCard(props: PlatformRoutingCardProps): ReactNode {
  const { useSnapshot, operations, t } = props
  const state = useSnapshot(snapshot => snapshot)

  // Read model-mask from described namespaces
  const maskNamespace = state.namespaces.get('model-mask')
  const storedEnabled = (maskNamespace?.value as MaskSettingsConfig | undefined)?.fallbackPolicy?.enabled ?? true

  const [fallbackEnabled, setFallbackEnabled] = useState<boolean>(storedEnabled)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // Sync state if the stored value changes from an external update
  useEffect(() => { setFallbackEnabled(storedEnabled) }, [storedEnabled])

  const handleSave = useCallback(async (): Promise<void> => {
    setIsSaving(true)
    setStatusMessage(null)

    try {
      const outcome = await operations.writeSettings(
        'model-mask',
        [{ op: 'set', path: ['fallbackPolicy', 'enabled'], value: fallbackEnabled }],
        maskNamespace?.revision,
      )

      if (outcome.kind === 'written') {
        setStatusMessage({ kind: 'success', text: t('routingSaved') })
      } else {
        setStatusMessage({ kind: 'error', text: outcome.message || t('routingError') })
      }
    } catch (err) {
      setStatusMessage({ kind: 'error', text: err instanceof Error ? err.message : t('routingError') })
    } finally {
      setIsSaving(false)
    }
  }, [operations, fallbackEnabled, maskNamespace?.revision, t])

  return (
    <div className={styles.card} data-testid="platform-routing-card">
      <div className={styles.header}>
        <h3 className={styles.title}>{t('routingPolicyTitle')}</h3>
        <p className={styles.intro}>{t('routingIntro')}</p>
      </div>

      <div className={styles.policyOption}>
        <input
          type="checkbox"
          id="fallback-toggle"
          className={styles.checkbox}
          checked={fallbackEnabled}
          onChange={e => setFallbackEnabled(e.target.checked)}
        />
        <label htmlFor="fallback-toggle">{t('routingPolicyEnabled')}</label>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.saveButton}
          onClick={() => { void handleSave() }}
          disabled={isSaving}
        >
          {isSaving ? t('routingSaving') : t('routingSave')}
        </button>
        {statusMessage && (
          <span
            className={statusMessage.kind === 'success' ? styles.feedbackSuccess : styles.feedbackError}
            role="status"
          >
            {statusMessage.text}
          </span>
        )}
      </div>
    </div>
  )
}
