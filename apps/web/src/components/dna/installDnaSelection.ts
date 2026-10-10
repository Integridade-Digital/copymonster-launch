import type { BootSeams } from '@deepseek-ai/dsh-client-web'
// Type-only: pulls the cordis Context `slots` merge and the conversation
// SlotMap declarations (including 'conversation.input.right') into this
// program — the same pattern packages/client/web/src/mount.ts uses.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DnaComposerChip, type DnaComposerChipInjected } from './DnaComposerChip'

/** The client Context type the LazyWebApp onBoot seam hands apps (same source as main.tsx). */
type DnaClientContext = Parameters<NonNullable<BootSeams['onBoot']>>[0]

/** Structural slice of the client remote the DNA selection drives. */
interface DnaSelectionScope {
  readonly remote: {
    readonly session: {
      selectPositioning(request: {
        sessionId: string
        positioningMappingId?: string
      }): Promise<{ ok: boolean }>
    }
  }
}

/**
 * Register the composer DNA chip: one session-scoped slot contribution that
 * switches or clears the session's Brand DNA over the session remote.
 * @param ctx - the client Context from the LazyWebApp onBoot seam.
 */
export function installDnaSelection(ctx: DnaClientContext): void {
  ctx.inject(['remote'], (untyped) => {
    const scope = untyped as unknown as DnaSelectionScope

    const chipInjected = (sessionId: string | undefined): DnaComposerChipInjected => ({
      selectPositioning: (positioningMappingId) => {
        if (sessionId === undefined) return Promise.resolve(false)
        return scope.remote.session
          .selectPositioning({
            sessionId,
            ...(positioningMappingId === undefined ? {} : { positioningMappingId }),
          })
          .then(result => result.ok)
          .catch(() => false)
      },
    })

    ctx.slots.inject('conversation.input.right', function* () {
      yield ctx.slots.register(
        {
          name: 'conversation.input.right',
          id: 'copymonster-dna-chip',
          order: 10,
          inject: chipInjected,
        },
        DnaComposerChip,
      )
    })
  })
}
