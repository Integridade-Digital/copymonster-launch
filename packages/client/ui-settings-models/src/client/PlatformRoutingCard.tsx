/**
 * Platform provider manager card rendered inside `settings.models.footer`.
 *
 * Visible exclusively to platform administrators (`whenPlatformAdmin`). It owns
 * the routes the tenant mask `copy-monster-default` resolves to: the primary
 * provider/model pair every tenant turn starts on, the contingency pair it may
 * fail over to before any output, and whether failover across the chain is
 * enabled. The provider list and each provider's models come from the live
 * catalog the Host advertises to administrators. Leaving a pair on
 * `routingAutomatic` clears it, so the mask falls back to the catalog order.
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

/** Dependencies injected from the Models page context. */
export interface PlatformRoutingCardInjected {
  readonly controller: ModelsSettingsStore
  readonly hooks: {
    readonly snapshot: SnapshotStore<ModelsSettingsState>
  }
  readonly operations: ModelsOperations
  /** Real providers and their models, as the Host advertises them to an administrator. */
  readonly catalog: () => Promise<readonly RoutingCatalogProvider[]>
  readonly t: (key: keyof typeof en) => string
}

/** One catalog provider with the models a route may name. */
export interface RoutingCatalogProvider {
  readonly id: string
  readonly name: string
  readonly models: readonly { readonly id: string; readonly name: string }[]
}

export type PlatformRoutingCardProps = PropsRuntime<'settings.models.footer'> &
  InjectFace<PlatformRoutingCardInjected>

/** The `model-mask` settings fields this card reads. */
interface MaskSettingsConfig {
  primaryProvider?: string
  primaryModel?: string
  fallbackProvider?: string
  fallbackModel?: string
  fallbackPolicy?: {
    enabled?: boolean
  }
}

/** One draft route: empty strings mean the mask follows the catalog order. */
interface RouteDraft {
  provider: string
  model: string
}

/** The draft the card edits, one route pair plus the failover switch. */
interface RoutingDraft {
  primary: RouteDraft
  fallback: RouteDraft
  fallbackEnabled: boolean
}

/** Value of a pair selector that clears the route. */
const AUTOMATIC = ''

/** Derive the editable draft from the stored namespace value. */
function draftOf(stored: MaskSettingsConfig): RoutingDraft {
  return {
    primary: { provider: stored.primaryProvider ?? AUTOMATIC, model: stored.primaryModel ?? AUTOMATIC },
    fallback: { provider: stored.fallbackProvider ?? AUTOMATIC, model: stored.fallbackModel ?? AUTOMATIC },
    fallbackEnabled: stored.fallbackPolicy?.enabled ?? true,
  }
}

/** Whether two drafts store the same values. */
function sameDraft(left: RoutingDraft, right: RoutingDraft): boolean {
  return left.primary.provider === right.primary.provider
    && left.primary.model === right.primary.model
    && left.fallback.provider === right.fallback.provider
    && left.fallback.model === right.fallback.model
    && left.fallbackEnabled === right.fallbackEnabled
}

/**
 * Platform provider manager card: primary route, contingency route, failover switch.
 * @param props - the footer slot props carrying the page store and operations.
 * @returns the administrator card.
 */
export function PlatformRoutingCard(props: PlatformRoutingCardProps): ReactNode {
  const { useSnapshot, operations, catalog, t } = props
  const state = useSnapshot(snapshot => snapshot)

  // Read model-mask from described namespaces
  const maskNamespace = state.namespaces.get('model-mask')
  const stored = useMemo<MaskSettingsConfig>(
    () => (maskNamespace?.value ?? {}) as MaskSettingsConfig,
    [maskNamespace?.value],
  )
  const storedDraft = useMemo(() => draftOf(stored), [stored])

  const [draft, setDraft] = useState<RoutingDraft>(storedDraft)
  const [providers, setProviders] = useState<readonly RoutingCatalogProvider[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // Sync state if the stored value changes from an external update
  useEffect(() => { setDraft(storedDraft) }, [storedDraft])

  useEffect(() => {
    let cancelled = false
    catalog().then(
      (entries) => {
        if (cancelled) return
        setProviders(entries)
        setCatalogError(null)
      },
      (error: unknown) => {
        if (cancelled) return
        setCatalogError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => { cancelled = true }
  }, [catalog])

  const canEdit = state.writable && maskNamespace !== undefined
  const stale = !sameDraft(draft, storedDraft)
  const incomplete = [draft.primary, draft.fallback].some(route => (route.provider === AUTOMATIC) !== (route.model === AUTOMATIC))
  const saveDisabled = isSaving || !canEdit || incomplete || !stale

  const updateRoute = useCallback((which: 'primary' | 'fallback', patch: Partial<RouteDraft>): void => {
    setStatusMessage(null)
    setDraft((current) => {
      // Choosing a provider resets the model: the previous id belongs to another catalog.
      const route = patch.provider === undefined
        ? { ...current[which], ...patch }
        : { provider: patch.provider, model: AUTOMATIC }
      return { ...current, [which]: route }
    })
  }, [])

  const save = useCallback(async (): Promise<void> => {
    setIsSaving(true)
    setStatusMessage(null)
    try {
      const outcome = await operations.writeSettings('model-mask', [
        { op: 'set', path: ['primaryProvider'], value: draft.primary.provider },
        { op: 'set', path: ['primaryModel'], value: draft.primary.model },
        { op: 'set', path: ['fallbackProvider'], value: draft.fallback.provider },
        { op: 'set', path: ['fallbackModel'], value: draft.fallback.model },
        { op: 'set', path: ['fallbackPolicy', 'enabled'], value: draft.fallbackEnabled },
      // A card that reached the Host without a described namespace writes unfenced.
      ], maskNamespace?.revision)
      if (outcome.kind === 'written') setStatusMessage({ kind: 'success', text: t('routingSaved') })
      else setStatusMessage({ kind: 'error', text: outcome.message || t('routingError') })
    } catch (error: unknown) {
      setStatusMessage({ kind: 'error', text: error instanceof Error ? error.message : t('routingError') })
    } finally {
      setIsSaving(false)
    }
  }, [operations, draft, maskNamespace?.revision, t])

  const reset = useCallback((): void => {
    setStatusMessage(null)
    setDraft(storedDraft)
  }, [storedDraft])

  const renderProviderOptions = (selected: string): ReactNode[] => {
    const options: ReactNode[] = [
      <option key="" value="">{t('routingAutomatic')}</option>,
      ...providers.map(entry => (
        <option key={entry.id} value={entry.id}>{entry.name}</option>
      )),
    ]
    // A provider removed from the catalog stays visible so the stored pin is
    // never shown as the automatic choice it is not.
    if (selected !== AUTOMATIC && !providers.some(entry => entry.id === selected)) {
      options.push(
        <option key={selected} value={selected}>{t('routingUnavailableProvider').replace('{provider}', () => selected)}</option>,
      )
    }
    return options
  }

  const renderModelOptions = (route: RouteDraft): ReactNode[] => {
    const provider = providers.find(entry => entry.id === route.provider)
    const options: ReactNode[] = [<option key="" value="">{t('routingAutomaticModel')}</option>]
    for (const model of provider?.models ?? []) {
      options.push(<option key={model.id} value={model.id}>{model.name}</option>)
    }
    // A pinned model the catalog no longer lists stays visible so the operator
    // sees what is stored instead of a select that silently shows nothing.
    if (route.model !== AUTOMATIC && !(provider?.models ?? []).some(model => model.id === route.model)) {
      options.push(
        <option key={route.model} value={route.model}>{t('routingUnavailableModel').replace('{model}', () => route.model)}</option>,
      )
    }
    return options
  }

  const renderRoute = (which: 'primary' | 'fallback', title: string, providerLabel: string, modelLabel: string): ReactNode => {
    const route = draft[which]
    const fieldId = `routing-${which}`
    return (
      <div className={styles.sectionBox}>
        <span className={styles.sectionTitle}>{title}</span>
        {route.provider === AUTOMATIC && (
          <p className={styles.hint}>{t(which === 'primary' ? 'routingPrimaryAuto' : 'routingFallbackAuto')}</p>
        )}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldId}-provider`}>{providerLabel}</label>
          <select
            id={`${fieldId}-provider`}
            className={`${styles.select} ${styles.selectInput}`}
            value={route.provider}
            disabled={!canEdit}
            onChange={event => updateRoute(which, { provider: event.target.value })}
          >
            {renderProviderOptions(route.provider)}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldId}-model`}>{modelLabel}</label>
          <select
            id={`${fieldId}-model`}
            className={`${styles.select} ${styles.selectInput}`}
            value={route.model}
            disabled={!canEdit || route.provider === AUTOMATIC}
            onChange={event => updateRoute(which, { model: event.target.value })}
          >
            {renderModelOptions(route)}
          </select>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.card} data-testid="platform-routing-card">
      <div className={styles.header}>
        <h3 className={styles.title}>{t('routingPolicyTitle')}</h3>
        <p className={styles.intro}>{t('routingIntro')}</p>
      </div>

      {catalogError !== null && (
        <p className={styles.feedbackError} role="status">
          {t('routingCatalogError').replace('{message}', () => catalogError ?? '')}
        </p>
      )}
      {!state.writable && (
        <p className={styles.feedbackError} role="status">{t('readOnly')}</p>
      )}

      <div className={styles.grid}>
        {renderRoute('primary', t('routingPrimaryTitle'), t('routingPrimaryProvider'), t('routingPrimaryModel'))}
        {renderRoute('fallback', t('routingFallbackTitle'), t('routingFallbackProvider'), t('routingFallbackModel'))}
      </div>

      <div className={styles.policyOption}>
        <input
          type="checkbox"
          id="fallback-toggle"
          className={styles.checkbox}
          checked={draft.fallbackEnabled}
          disabled={!canEdit}
          onChange={(event) => {
            setStatusMessage(null)
            setDraft(current => ({ ...current, fallbackEnabled: event.target.checked }))
          }}
        />
        <label htmlFor="fallback-toggle">{t('routingPolicyEnabled')}</label>
      </div>

      {incomplete && (
        <p className={styles.feedbackError} role="status">{t('routingIncomplete')}</p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.saveButton}
          onClick={() => { void save() }}
          disabled={saveDisabled}
        >
          {isSaving ? t('routingSaving') : t('routingSave')}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={reset}
          disabled={isSaving || !stale}
        >
          {t('routingReset')}
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
