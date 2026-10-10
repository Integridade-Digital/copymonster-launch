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
  let ordinal = 0
  for (const entry of entries) {
    if (entry.type !== 'event' || entry.event === undefined) continue
    const event = entry.event
    if (event.type === 'user/message') {
      ordinal += 1
      const text = messageText(event)
      if (text === kickoffText) { started = true; continue }
      if (!started) continue
      if (text === skipText) {
        if (answeredBlock === null && nextAnswerBlock >= 1 && nextAnswerBlock <= 11) nextAnswerBlock += 1
        continue
      }
      if (answeredBlock !== null) continue
      if (nextAnswerBlock === 0) { nextAnswerBlock = 1; continue }
      answeredBlock = nextAnswerBlock
      answeredOrdinal = ordinal
      nextAnswerBlock = Math.min(nextAnswerBlock + 1, 13)
    } else if (event.type === 'assistant/message') {
      lastAssistantText = messageText(event)
    }
  }
  return { started, nextAnswerBlock, answeredBlock, answeredOrdinal, lastAssistantText }
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
