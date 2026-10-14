import { useEffect, useRef, useState } from 'react'
import { t } from '../../locales'
import {
  DNA_ADAPTIVE_BLOCKS, DNA_REFINE_KEY, dnaBlock, setDefaultPositioningMapping,
  updatePositioningBlock, useDnaOnboardingState,
} from './useDnaOnboardingState'
import { useDnaSessionTracker, type DnaUseEventWindow, type DnaUseSession } from './useDnaSessionTracker'
import { clearDnaClaim, dnaClaim } from './installDnaOnboarding'
import { CompletionPanel } from './CompletionPanel'
import { ExportDocumentModal } from './ExportDocumentModal'
import './dna.css'

/**
 * The creator's own interview messages, in their browser language.
 * Portuguese, English, and Spanish mirror the agent persona's language set;
 * every other browser language falls back to English.
 */
const KICKOFF_TEXTS: Record<'pt' | 'en' | 'es', string> = {
  pt: 'Olá! Estou pronto para mapear o DNA da minha marca.',
  en: 'Hi! I am ready to map my brand DNA.',
  es: '¡Hola! Estoy listo para mapear el ADN de mi marca.',
}

/** Refine visits open on an existing mapping and re-ask the blocks. */
const REFINE_KICKOFF_TEXTS: Record<'pt' | 'en' | 'es', string> = {
  pt: 'Quero revisar e refinar o DNA da minha marca, bloco por bloco.',
  en: 'I want to review and refine my brand DNA mapping, block by block.',
  es: 'Quiero revisar y refinar el ADN de mi marca, bloque por bloque.',
}

const SKIP_TEXTS: Record<'pt' | 'en' | 'es', string> = {
  pt: 'Pular este bloco, por favor.',
  en: 'Skip this block, please.',
  es: 'Saltar este bloque, por favor.',
}

function browserVoiceText(texts: Record<'pt' | 'en' | 'es', string>): string {
  const language = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : ''
  if (language.startsWith('pt')) return texts.pt
  if (language.startsWith('es')) return texts.es
  return texts.en
}

export interface OnboardingChromeProps {
  readonly sessionId?: string
  readonly useSession?: DnaUseSession
  readonly useDnaEventWindow?: DnaUseEventWindow
  readonly send?: (text: string) => void
  readonly startSession?: () => void
}

/**
 * Onboarding chrome: progress header, skip control, per-block auto-save, and
 * the completion panel — all bound to the session the bridge claimed for the
 * brand-positioning-monster interview.
 * @param props - the session-scoped slot kit plus the injected send callback; renders nothing for an unclaimed session.
 */
export function OnboardingChrome(props: OnboardingChromeProps) {
  const { sessionId, useSession, useDnaEventWindow, send, startSession } = props
  // The interview is active exactly when this seat belongs to the claimed
  // onboarding session; the entry modal opens the chat rather than a route.
  const claimed = dnaClaim()
  const isClaimedSession = sessionId !== undefined && sessionId === claimed
  const active = useSession !== undefined && isClaimedSession

  // A refine visit stages its target once; the chrome consumes and clears it.
  const [refineId] = useState(() => {
    try {
      const staged = sessionStorage.getItem(DNA_REFINE_KEY)
      sessionStorage.removeItem(DNA_REFINE_KEY)
      return staged ?? undefined
    } catch {
      return undefined
    }
  })

  const kickoffText = browserVoiceText(refineId === undefined ? KICKOFF_TEXTS : REFINE_KICKOFF_TEXTS)
  const skipText = browserVoiceText(SKIP_TEXTS)
  const { running, openState, eventWindow, replay } = useDnaSessionTracker(useSession, useDnaEventWindow, kickoffText, skipText)
  const { mapping, mappingError, setMapping } = useDnaOnboardingState(
    active, t('onboarding.dna.firstName'), refineId)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const kickoffSent = useRef(false)
  useEffect(() => {
    if (!active || !isClaimedSession || send === undefined) return
    if (mapping === null || mappingError) return
    if (openState !== 'open' || running) return
    if ((eventWindow?.entries.length ?? 0) > 0 || kickoffSent.current) return
    kickoffSent.current = true
    send(kickoffText)
  }, [active, isClaimedSession, send, mapping, mappingError, openState, running, eventWindow, kickoffText])

  // The interview runs inside the main chat, so the claimed seat marks the
  // document while it is on screen; dna.css withholds the agent's internal
  // blocks for as long as that mark is present.
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    root.dataset.cmOnboardingChat = 'true'
    return () => { delete root.dataset.cmOnboardingChat }
  }, [active])

  const lastSavedOrdinal = useRef(0)
  const lastAttemptedOrdinal = useRef(0)
  const savedHere = useRef(false)

  // Persist detected product name from block 0 when available and empty in mapping
  const productNameSaved = useRef(false)
  useEffect(() => {
    if (!active || !isClaimedSession || mapping === null) return
    if (!replay.detectedProductName || productNameSaved.current) return
    if (mapping.product_name && mapping.product_name.trim().length > 0) return

    productNameSaved.current = true
    updatePositioningBlock(mapping.id, 0, replay.detectedProductName)
      .then((row) => {
        setMapping(row)
      })
      .catch(() => {
        // Fallback: will be passed during finalization
      })
  }, [active, isClaimedSession, mapping, replay.detectedProductName, setMapping])

  // Auto-save each block as answered without getting stuck
  useEffect(() => {
    if (!active || !isClaimedSession || mapping === null) return
    if (openState !== 'open' || running || saving) return

    const pending = replay.answeredBlocks.find((item) => {
      const meta = dnaBlock(item.block)
      if (meta === undefined) return false
      if (mapping[meta.column] !== null) return false
      if (item.ordinal <= lastSavedOrdinal.current || item.ordinal <= lastAttemptedOrdinal.current) {
        return false
      }
      return true
    })

    if (!pending) return
    const block = dnaBlock(pending.block)
    if (block === undefined) return

    const contentToSave = pending.assistantText ?? replay.lastAssistantText ?? ''
    lastAttemptedOrdinal.current = pending.ordinal
    setSaving(true)
    setSaveError(false)

    updatePositioningBlock(mapping.id, pending.block, contentToSave)
      .then((row) => {
        lastSavedOrdinal.current = pending.ordinal
        savedHere.current = true
        setMapping(row)
      })
      .catch(() => { setSaveError(true) })
      .finally(() => { setSaving(false) })
  }, [active, isClaimedSession, mapping, openState, running, replay, saving, setMapping])

  if (!active) return null
  if (mappingError) {
    return <span className="cm-dna-hint cm-dna-hint--error">{t('onboarding.dna.createError')}</span>
  }
  if (mapping === null) {
    return <span className="cm-dna-hint">{t('onboarding.dna.loading')}</span>
  }
  if (!isClaimedSession) return null

  const isInterviewComplete = mapping.status === 'completed' || mapping.block_12_promises !== null
  const currentBlock = replay.answeredBlock ?? Math.min(replay.nextAnswerBlock, 12)
  const blockMeta = dnaBlock(currentBlock)
  const canSkip = !isInterviewComplete && replay.answeredBlock === null
    && (DNA_ADAPTIVE_BLOCKS as readonly number[]).includes(replay.nextAnswerBlock)

  const skip = (): void => { send?.(skipText) }

  return (
    <div className="cm-dna-chrome">
      <span className="cm-dna-title">{t('onboarding.dna.title')}</span>
      {isInterviewComplete
        ? <span className="cm-dna-progress">{t('onboarding.dna.completionTitle')}</span>
        : blockMeta !== undefined && (
          <span className="cm-dna-progress">
            {t('onboarding.dna.progress', { block: currentBlock })}
            {' — '}
            {t(blockMeta.nameKey)}
          </span>
        )}
      {saving && <span className="cm-dna-hint">{t('onboarding.dna.saving')}</span>}
      {saveError && <span className="cm-dna-hint cm-dna-hint--error">{t('onboarding.dna.saveError')}</span>}
      {!isInterviewComplete && canSkip && (
        <button type="button" className="cm-dna-skip" onClick={skip}>
          {t('onboarding.dna.skip')}
        </button>
      )}
      {isInterviewComplete && (refineId === undefined || savedHere.current) && !exportOpen && (
        <CompletionPanel
          mapping={mapping}
          detectedProductName={replay.detectedProductName}
          onFinalized={(updated) => {
            savedHere.current = true
            setMapping(updated)
          }}
          onView={() => { setExportOpen(true) }}
          onStart={async () => {
            try {
              await setDefaultPositioningMapping(mapping.id)
            } catch (err) {
              console.error('Failed to set default positioning mapping', err)
            }
            clearDnaClaim()
            startSession?.()
          }}
        />
      )}
      {isInterviewComplete && (refineId === undefined || savedHere.current) && exportOpen && (
        <ExportDocumentModal mapping={mapping} onClose={() => { setExportOpen(false) }} />
      )}
    </div>
  )
}
