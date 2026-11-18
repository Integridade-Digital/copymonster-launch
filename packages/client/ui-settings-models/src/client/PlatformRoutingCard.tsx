/**
 * Platform Model Routing & Contingency card rendered inside `settings.models.footer`.
 *
 * Visible exclusively to platform administrators (`whenPlatformAdmin`), this
 * component gives operators control over the central primary model used by
 * tenants, the optional contingency (fallback) route, and the failover policy.
 *
 * Changes are committed through the settings Remote under the `model-mask`
 * namespace, updating the Host's live model-mask adapter in real time.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsOperations } from './operations.ts'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { en } from './locales.ts'
import styles from './PlatformRoutingCard.module.css'

/** Known standard model candidates per provider. */
const POPULAR_MODELS: Record<string, readonly string[]> = {
  'deepseek-official': ['deepseek-chat', 'deepseek-reasoner'],
  'openrouter': ['openrouter/free', 'deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'],
  'openai': ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
  'anthropic': ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
}

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

interface MaskSettingsConfig {
  primaryProvider?: string
  primaryModel?: string
  fallbackProvider?: string
  fallbackModel?: string
  fallbackPolicy?: {
    enabled?: boolean
    maxAttempts?: number
    timeoutMs?: number
  }
}

export function PlatformRoutingCard(props: PlatformRoutingCardProps): ReactNode {
  const { useSnapshot, operations, t } = props
  const state = useSnapshot(snapshot => snapshot)

  // Read model-mask from described namespaces
  const maskNamespace = state.namespaces.get('model-mask')
  const initialValues = useMemo<MaskSettingsConfig>(() => {
    const val = (maskNamespace?.value ?? {}) as MaskSettingsConfig
    return {
      primaryProvider: val.primaryProvider ?? 'deepseek-official',
      primaryModel: val.primaryModel ?? 'deepseek-chat',
      fallbackProvider: val.fallbackProvider ?? '',
      fallbackModel: val.fallbackModel ?? '',
      fallbackPolicy: {
        enabled: val.fallbackPolicy?.enabled ?? true,
      },
    }
  }, [maskNamespace?.value])

  const [primaryProvider, setPrimaryProvider] = useState<string>(initialValues.primaryProvider ?? 'deepseek-official')
  const [primaryModel, setPrimaryModel] = useState<string>(initialValues.primaryModel ?? 'deepseek-chat')
  const [fallbackProvider, setFallbackProvider] = useState<string>(initialValues.fallbackProvider ?? '')
  const [fallbackModel, setFallbackModel] = useState<string>(initialValues.fallbackModel ?? '')
  const [fallbackEnabled, setFallbackEnabled] = useState<boolean>(initialValues.fallbackPolicy?.enabled ?? true)

  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // Sync state if initialValues changes from external update
  useEffect(() => {
    setPrimaryProvider(initialValues.primaryProvider ?? 'deepseek-official')
    setPrimaryModel(initialValues.primaryModel ?? 'deepseek-chat')
    setFallbackProvider(initialValues.fallbackProvider ?? '')
    setFallbackModel(initialValues.fallbackModel ?? '')
    setFallbackEnabled(initialValues.fallbackPolicy?.enabled ?? true)
  }, [initialValues])

  const rows = state.rows
  const primaryRow = useMemo(
    () => rows.find(r => r.entry.provider === primaryProvider),
    [rows, primaryProvider],
  )
  const fallbackRow = useMemo(
    () => rows.find(r => r.entry.provider === fallbackProvider),
    [rows, fallbackProvider],
  )

  const primaryHasKey = Boolean(primaryRow?.credential?.configured || primaryRow?.configured)
  const fallbackHasKey = Boolean(fallbackRow?.credential?.configured || fallbackRow?.configured)

  const handleSave = useCallback(async (): Promise<void> => {
    setIsSaving(true)
    setStatusMessage(null)

    try {
      const outcome = await operations.writeSettings(
        'model-mask',
        [
          { op: 'set', path: ['primaryProvider'], value: primaryProvider },
          { op: 'set', path: ['primaryModel'], value: primaryModel },
          { op: 'set', path: ['fallbackProvider'], value: fallbackProvider === '' ? null : fallbackProvider },
          { op: 'set', path: ['fallbackModel'], value: fallbackModel === '' ? null : fallbackModel },
          { op: 'set', path: ['fallbackPolicy', 'enabled'], value: fallbackEnabled },
        ],
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
  }, [operations, primaryProvider, primaryModel, fallbackProvider, fallbackModel, fallbackEnabled, maskNamespace?.revision, t])

  return (
    <div className={styles.card} data-testid="platform-routing-card">
      <div className={styles.header}>
        <h3 className={styles.title}>{t('routingTitle')}</h3>
        <p className={styles.intro}>{t('routingIntro')}</p>
      </div>

      <div className={styles.grid}>
        {/* Primary Route */}
        <div className={styles.sectionBox}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>{t('routingPrimaryLabel')}</span>
            <div className={styles.statusRow}>
              <span
                className={`${styles.dot} ${primaryHasKey ? styles.dotConfigured : styles.dotMissing}`}
                title={primaryHasKey ? t('routingKeyConfigured') : t('routingNoKey')}
              />
              <span>{primaryHasKey ? t('routingKeyConfigured') : t('routingNoKey')}</span>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('routingPrimaryProvider')}</label>
            <select
              className={styles.select}
              value={primaryProvider}
              onChange={(e) => {
                const nextProvider = e.target.value
                setPrimaryProvider(nextProvider)
                const candidate = POPULAR_MODELS[nextProvider]?.[0]
                if (candidate) setPrimaryModel(candidate)
              }}
            >
              {rows.map(row => (
                <option key={row.entry.provider} value={row.entry.provider}>
                  {row.entry.displayName} ({row.entry.provider})
                </option>
              ))}
              {rows.every(r => r.entry.provider !== primaryProvider) && (
                <option value={primaryProvider}>{primaryProvider}</option>
              )}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('routingPrimaryModelName')}</label>
            <input
              type="text"
              className={styles.input}
              value={primaryModel}
              onChange={e => setPrimaryModel(e.target.value)}
              placeholder="e.g. deepseek-chat"
            />
          </div>
        </div>

        {/* Fallback Route */}
        <div className={styles.sectionBox}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>{t('routingFallbackLabel')}</span>
            {fallbackProvider ? (
              <div className={styles.statusRow}>
                <span
                  className={`${styles.dot} ${fallbackHasKey ? styles.dotConfigured : styles.dotMissing}`}
                  title={fallbackHasKey ? t('routingKeyConfigured') : t('routingNoKey')}
                />
                <span>{fallbackHasKey ? t('routingKeyConfigured') : t('routingNoKey')}</span>
              </div>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('routingFallbackProvider')}</label>
            <select
              className={styles.select}
              value={fallbackProvider}
              onChange={(e) => {
                const nextProvider = e.target.value
                setFallbackProvider(nextProvider)
                const candidate = POPULAR_MODELS[nextProvider]?.[0]
                if (candidate) setFallbackModel(candidate)
                else if (!nextProvider) setFallbackModel('')
              }}
            >
              <option value="">{t('routingFallbackNone')}</option>
              {rows.map(row => (
                <option key={row.entry.provider} value={row.entry.provider}>
                  {row.entry.displayName} ({row.entry.provider})
                </option>
              ))}
              {fallbackProvider && rows.every(r => r.entry.provider !== fallbackProvider) && (
                <option value={fallbackProvider}>{fallbackProvider}</option>
              )}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('routingFallbackModelName')}</label>
            <input
              type="text"
              className={styles.input}
              value={fallbackModel}
              onChange={e => setFallbackModel(e.target.value)}
              placeholder="e.g. openrouter/free"
              disabled={!fallbackProvider}
            />
          </div>
        </div>
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
          disabled={isSaving || !primaryProvider || !primaryModel}
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
