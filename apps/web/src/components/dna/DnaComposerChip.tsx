import { useEffect, useState } from 'react'
import { t } from '../../locales'
import { listMyPositioningMappings } from './useDnaOnboardingState'
import './dna.css'

/** One completed mapping the composer chip offers. */
export interface DnaChipOption {
  readonly id: string
  readonly name: string
}

/** The inject face the installer binds: the DNA switch over the remote. */
export interface DnaComposerChipInjected {
  readonly selectPositioning: (positioningMappingId?: string) => Promise<boolean>
}

export interface DnaComposerChipProps {
  readonly sessionId?: string
  readonly useSessions?: <T>(select: (sessions: {
    readonly byId: Record<string, { readonly positioningMappingId?: string }>
  }) => T) => T
  readonly selectPositioning?: (positioningMappingId?: string) => Promise<boolean>
}

/**
 * Composer DNA chip: shows the session's active Brand DNA, switches it in
 * runtime, or clears it for a DNA-free run. On a blank session the choice
 * lands before the first prompt, which is the new-session selection.
 * @param props - the session-scoped slot kit plus the injected DNA switch.
 */
export function DnaComposerChip(props: DnaComposerChipProps) {
  const { sessionId, useSessions, selectPositioning } = props
  const [options, setOptions] = useState<readonly DnaChipOption[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // The locally applied choice, bridging until the summary refresh carries it.
  const [applied, setApplied] = useState<string | null | undefined>(undefined)

  const summaryId = useSessions !== undefined && sessionId !== undefined
    ? useSessions(sessions => sessions.byId[sessionId]?.positioningMappingId)
    : undefined
  const activeId = applied === undefined ? summaryId : (applied ?? undefined)

  useEffect(() => {
    let cancelled = false
    listMyPositioningMappings()
      .then((rows) => {
        if (cancelled) return
        setOptions(rows
          .filter(row => row.status === 'completed')
          .map(row => ({ id: row.id, name: row.name })))
      })
      .catch(() => {
        // An unreadable roster offers no choices; the chip stays hidden.
        if (!cancelled) setOptions([])
      })
    return () => { cancelled = true }
  }, [])

  if (sessionId === undefined || selectPositioning === undefined || options.length === 0) return null

  const activeName = options.find(option => option.id === activeId)?.name

  const apply = async (positioningMappingId?: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setOpen(false)
    setFailed(false)
    const ok = await selectPositioning(positioningMappingId)
    if (ok) setApplied(positioningMappingId ?? null)
    else setFailed(true)
    setBusy(false)
  }

  return (
    <div className="cm-dna-chip">
      <button
        type="button"
        className="cm-dna-chip-button"
        title={t('onboarding.dna.chip.title')}
        onClick={() => { setOpen(previous => !previous) }}
        disabled={busy}
      >
        <span className="cm-dna-chip-label">{t('onboarding.dna.chip.title')}</span>
        <span className={activeId === undefined ? 'cm-dna-chip-value' : 'cm-dna-chip-value cm-dna-chip-value--active'}>
          {busy
            ? t('onboarding.dna.chip.switching')
            : activeId === undefined
              ? t('onboarding.dna.chip.free')
              : (activeName ?? t('onboarding.dna.chip.active'))}
        </span>
      </button>
      {failed && <span className="cm-dna-chip-error">{t('onboarding.dna.chip.error')}</span>}
      {open && (
        <>
          <div className="cm-dna-chip-backdrop" onClick={() => { setOpen(false) }} />
          <div className="cm-dna-chip-menu" role="menu">
            {options.map(option => (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                className={option.id === activeId
                  ? 'cm-dna-chip-option cm-dna-chip-option--active'
                  : 'cm-dna-chip-option'}
                onClick={() => { void apply(option.id) }}
              >
                {option.name}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className={activeId === undefined
                ? 'cm-dna-chip-option cm-dna-chip-option--active'
                : 'cm-dna-chip-option'}
              onClick={() => { void apply(undefined) }}
            >
              {t('onboarding.dna.chip.free')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
