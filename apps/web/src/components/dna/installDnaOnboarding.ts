import type { BootSeams } from '@deepseek-ai/dsh-client-web'
// Type-only: pulls the cordis Context `slots` merge and the conversation
// SlotMap declarations (including 'conversation.session.header.actions') into
// this program — the same pattern packages/client/web/src/mount.ts and
// packages/client/ui-sidebar/src/client/index.ts use.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { OnboardingChrome, type OnboardingChromeProps } from './OnboardingChrome'
import { requestOnboardingModal } from './onboardingModal'
import { listMyPositioningMappings } from './useDnaOnboardingState'
import type { DnaEventWindowSource } from './useDnaSessionTracker'

/** The client Context type the LazyWebApp onBoot seam hands apps (same source as main.tsx). */
type DnaClientContext = Parameters<NonNullable<BootSeams['onBoot']>>[0]

/** The agent preset that conducts the onboarding interview (Etapa 2). */
export const DNA_ONBOARDING_PRESET = 'brand-positioning-monster'

/** localStorage key holding the claimed onboarding session id. */
const CLAIM_KEY = 'cm-dna-onboarding-session'

const claimListeners = new Set<() => void>()

function readClaim(): string | undefined {
  try { return localStorage.getItem(CLAIM_KEY) ?? undefined } catch { return undefined }
}

let claimedSessionId = readClaim()

export function dnaClaim(): string | undefined { return claimedSessionId }

function writeClaim(sessionId: string): void {
  try {
    localStorage.setItem(CLAIM_KEY, sessionId)
  } catch {
    // Private-mode browsers keep the claim in memory only.
  }
  claimedSessionId = sessionId
  for (const listener of claimListeners) listener()
}

export function clearDnaClaim(): void {
  try {
    localStorage.removeItem(CLAIM_KEY)
  } catch {
    // Same private-mode allowance as writeClaim.
  }
  claimedSessionId = undefined
  for (const listener of claimListeners) listener()
}

/** Bridges registered by {@link installDnaOnboarding}, invoked by {@link startDnaOnboarding}. */
const startListeners = new Set<() => void>()

/**
 * Begin (or restart) the guided DNA interview from outside the boot flow —
 * the My DNA "create" and "refine" actions. Clears the previous claim so the
 * bridge claims a fresh blank session, then opens the entry modal.
 */
export function startDnaOnboarding(): void {
  clearDnaClaim()
  for (const listener of startListeners) listener()
}

/** The bound session's prompt face, as the inject world reaches it. */
interface DnaSessionFace {
  prompt(
    content: readonly { readonly type: 'text'; readonly text: string }[],
    mode: 'queue' | 'steer',
  ): Promise<unknown>
}

/** Structural slice of the client scope services the bridge drives. */
interface DnaBridgeScope {
  readonly sessions: {
    readonly list: {
      getSnapshot(): {
        readonly byId: Record<string, { readonly blank: boolean; readonly retainedBy?: { readonly mainView?: number } }>
      }
      subscribe(listener: () => void): () => void
    }
    binding(id: string): {
      readonly session: DnaSessionFace
      readonly eventSource: DnaEventWindowSource
    } | undefined
  }
  readonly uiWorkspace: {
    openSession(target: string): void
    startSession?(workspaceId?: string): void
  }
  readonly remote: {
    readonly agentPresets: { select(sessionId: string, preset: string): Promise<{ ok: boolean }> }
  }
  readonly effect: (callback: () => void | (() => void), reason: string) => () => void
}

/** Inject face the chrome consumes: the event window as a bound hook plus the send callback. */
export interface OnboardingChromeInjected {
  readonly hooks: { readonly dnaEventWindow: DnaEventWindowSource }
  readonly send: (text: string) => void
}

/**
 * Register the onboarding chrome and drive the interview session: when the
 * creator has no completed DNA, open the entry modal, claim a blank session,
 * and select the Brand Positioning Monster preset on it. The interview itself
 * runs in the main chat; the modal is an entry overlay, so the URL never
 * changes.
 * @param ctx - the client Context from the LazyWebApp onBoot seam.
 */
export function installDnaOnboarding(ctx: DnaClientContext): void {
  ctx.inject(['sessions', 'uiWorkspace', 'remote', 'remote.agentPresets'], (untyped) => {
    const scope = untyped as unknown as DnaBridgeScope

    const chromeInjected = (sessionId: string | undefined): OnboardingChromeInjected => {
      const binding = sessionId === undefined ? undefined : scope.sessions.binding(sessionId)
      const session = binding === undefined ? undefined : binding.session
      return {
        hooks: binding === undefined
          ? { dnaEventWindow: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} } }
          : { dnaEventWindow: binding.eventSource },
        send: (text: string) => {
          if (session !== undefined) void session.prompt([{ type: 'text', text }], 'queue')
        },
      }
    }

    ctx.slots.inject('conversation.session.header.actions', function* () {
      yield ctx.slots.register(
        {
          name: 'conversation.session.header.actions',
          id: 'copymonster-dna-onboarding',
          order: 5,
          inject: chromeInjected,
        },
        OnboardingChrome,
      )
    })

    let onboarding = false
    let applied = false
    let nudgedForSession = false

    const claimSession = (): void => {
      if (!onboarding || applied) return
      const byId = scope.sessions.list.getSnapshot().byId
      const claimed = readClaim()
      if (claimed !== undefined && byId[claimed] !== undefined) {
        applied = true
        scope.uiWorkspace.openSession(claimed)
        return
      }
      const blank = Object.entries(byId)
        .find(([, summary]) => summary.blank && (summary.retainedBy?.mainView ?? 0) > 0)
      if (blank === undefined) {
        // A restart (create/refine) can run with no blank session left; ask the
        // workspace for one and claim it when it lands in the list.
        if (!nudgedForSession) {
          nudgedForSession = true
          scope.uiWorkspace.startSession?.()
        }
        return
      }
      applied = true
      writeClaim(blank[0])
      scope.uiWorkspace.openSession(blank[0])
      void scope.remote.agentPresets.select(blank[0], DNA_ONBOARDING_PRESET)
        .then((result) => {
          if (!result.ok) console.error('dna onboarding: the preset swap was refused')
        })
        .catch((error: unknown) => { console.error('dna onboarding: the preset swap failed', error) })
    }

    const begin = (force: boolean): void => {
      if (onboarding && !force) return
      onboarding = true
      applied = false
      nudgedForSession = false
      requestOnboardingModal()
      claimSession()
    }

    const disposeStart = (() => {
      const listener = (): void => { begin(true) }
      startListeners.add(listener)
      return () => { startListeners.delete(listener) }
    })()

    scope.effect(() => {
      const dispose = scope.sessions.list.subscribe(claimSession)
      void listMyPositioningMappings()
        .then((rows) => {
          if (rows.some(row => row.status === 'completed')) {
            // A completed mapping means no forced onboarding; drop any stale
            // claim so the interview chrome stays dormant.
            clearDnaClaim()
            return
          }
          begin(false)
        })
        .catch(() => {
          // Fail-open: an unreadable roster does not trap the creator in onboarding.
        })
      return () => { dispose(); disposeStart() }
    }, 'copymonster: dna onboarding bridge')
  })
}

export type { OnboardingChromeProps }
