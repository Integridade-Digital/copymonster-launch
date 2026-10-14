import { useMemo } from 'react'

/** Structural slice of one session-window entry the tracker reads. */
export interface DnaWindowEntry {
  readonly type: string
  readonly event?: {
    readonly type: string
    readonly data: { readonly message?: { readonly content?: readonly { readonly type: string; readonly text?: string }[] } }
  }
}

/** Snapshot slice of the session the standard kit's useSession exposes. */
export interface DnaSessionSnapshotSlice {
  readonly running: boolean
  readonly openState: string
}

/** Event-window slice the injected `dnaEventWindow` hook exposes. */
export interface DnaEventWindowSlice {
  readonly entries: readonly DnaWindowEntry[]
}

/** Selector-hook shapes the session-scoped slot kit and inject face bind. */
export type DnaUseSession = <T>(select: (snapshot: DnaSessionSnapshotSlice) => T) => T
export type DnaUseEventWindow = <T>(select: (window: DnaEventWindowSlice) => T) => T

/** Bare event-window source the inject face contributes under `hooks`. */
export interface DnaEventWindowSource {
  getSnapshot(): DnaEventWindowSlice
  subscribe(listener: () => void): () => void
}

function messageText(event: NonNullable<DnaWindowEntry['event']>): string {
  return (event.data.message?.content ?? [])
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join('')
    .trim()
}

/** Record of one block answered in the session. */
export interface DnaAnsweredBlock {
  readonly block: number
  readonly ordinal: number
  readonly assistantText: string | null
}

/**
 * Interview state derived by replaying the session event window.
 * `nextAnswerBlock` 0 means the next real answer names the product; 13 means the interview ended.
 */
export interface DnaReplayState {
  readonly started: boolean
  readonly nextAnswerBlock: number
  readonly answeredBlock: number | null
  readonly answeredOrdinal: number | null
  readonly lastAssistantText: string | null
  readonly detectedProductName?: string | null
  readonly answeredBlocks: readonly DnaAnsweredBlock[]
}

export function replayOnboarding(
  entries: readonly DnaWindowEntry[],
  kickoffText: string,
  skipText: string,
): DnaReplayState {
  let started = false
  let nextAnswerBlock = 0
  let answeredBlock: number | null = null
  let answeredOrdinal: number | null = null
  let lastAssistantText: string | null = null
  let detectedProductName: string | null = null
  const answeredBlocks: DnaAnsweredBlock[] = []
  let ordinal = 0
  let assistantSeenBeforeStart = false

  for (const entry of entries) {
    if (entry.type !== 'event' || entry.event === undefined) continue
    const event = entry.event

    if (event.type === 'user/message') {
      ordinal += 1
      const text = messageText(event)

      // Preserva o fluxo normal quando o kickoff conhecido está presente.
      if (text === kickoffText) {
        started = true
        continue
      }

      // Em sessões sem esse marcador, ignora a mensagem inicial e aguarda
      // uma resposta do agente antes de iniciar o tracking.
      if (!started) {
        if (!assistantSeenBeforeStart || text.length === 0 || text === skipText) continue
        started = true
      }

      if (text === skipText) {
        if (nextAnswerBlock >= 1 && nextAnswerBlock <= 11) nextAnswerBlock += 1
        continue
      }

      if (nextAnswerBlock === 0) {
        detectedProductName = text
        nextAnswerBlock = 1
        continue
      }

      answeredBlock = nextAnswerBlock
      answeredOrdinal = ordinal
      answeredBlocks.push({
        block: answeredBlock,
        ordinal,
        assistantText: null,
      })
      nextAnswerBlock = Math.min(nextAnswerBlock + 1, 13)
    } else if (event.type === 'assistant/message') {
      lastAssistantText = messageText(event)

      if (!started) assistantSeenBeforeStart = true

      if (answeredBlocks.length > 0) {
        const last = answeredBlocks[answeredBlocks.length - 1]
        ;(last as { assistantText: string | null }).assistantText = lastAssistantText
      }
    }
  }

  return {
    started,
    nextAnswerBlock,
    answeredBlock,
    answeredOrdinal,
    lastAssistantText,
    detectedProductName,
    answeredBlocks,
  }
}

/** Live session facts and interview state the chrome renders from. */
export interface DnaTrackerSnapshot {
  readonly running: boolean
  readonly openState: string
  readonly eventWindow: DnaEventWindowSlice | null
  readonly replay: DnaReplayState
}

export function useDnaSessionTracker(
  useSession: DnaUseSession | undefined,
  useDnaEventWindow: DnaUseEventWindow | undefined,
  kickoffText: string,
  skipText: string,
): DnaTrackerSnapshot {
  const running = useSession?.(select => select.running) ?? false
  const openState = useSession?.(select => select.openState) ?? 'cold'
  const eventWindow = useDnaEventWindow?.(select => select) ?? null
  const replay = useMemo(
    () => replayOnboarding(eventWindow?.entries ?? [], kickoffText, skipText),
    [eventWindow, kickoffText, skipText],
  )
  return { running, openState, eventWindow, replay }
}
