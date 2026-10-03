/** Workspace-specific adapter for the Gateway-owned snapshot stream lifecycle. */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthToken } from '@deepseek-ai/dsh-api-auth-context/types'
import {
  RemoteSnapshotStream,
  RemoteStreamCarrierError,
  type ClientRemote,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { WorkspaceFollowFrame, WorkspaceFollowIncrement } from '../types.ts'
import type { WorkspaceFollowSink } from './model.ts'
import { ClientWorkspaceModel } from './model.ts'
import { WorkspaceController } from './service.ts'

export { ClientWorkspaceModel } from './model.ts'
export type {
  WorkspaceFollowSink, WorkspaceListPhase, WorkspaceRemote, WorkspaceSnapshot,
} from './model.ts'
export { WorkspaceController, WorkspaceCreateError } from './service.ts'
export type { IWorkspaces, WorkspaceSource } from './service.ts'
export type { WorkspaceId, WorkspaceView } from '../types.ts'

type WorkspaceBaselineFrame = Extract<WorkspaceFollowFrame, { type: 'baseline' }>

/** Gateway-owned snapshot stream configured for Workspace state. */
export type WorkspaceStateStream = RemoteSnapshotStream<
  WorkspaceBaselineFrame,
  WorkspaceFollowIncrement
>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** React-free Client Workspace state and commands. */
    workspaces: import('./service.ts').IWorkspaces
  }
}

/** Required Client Remote services. */
export const inject = ['remote', 'remote.workspace']

/**
 * Install Client Workspace state, commands, and reconnecting follow control.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  const model = new ClientWorkspaceModel(ctx.remote.workspace)
  new WorkspaceController(ctx, model)
  const control = createWorkspaceStateStream(ctx.remote, {
    accept: model,
    authToken: authTokenOf(ctx),
    carrierFailed: () => { model.handleCarrierFailure() },
    failed: (error) => { model.handleStreamFailure(error) },
  })
  control.start()
  ctx.effect(
    () => async () => { await control.dispose() },
    'workspace-controller.client.control',
  )
}

/**
 * Read the bearer token the Host re-verifies for the Workspace stream.
 *
 * `follow` resolves its own caller identity because the Typert generator cannot
 * yet express a stream and a context together. The token comes from the same
 * `auth` Client Context adapter that carries it for scoped verbs, so the page
 * publishes it in exactly one place.
 * @param ctx - Client root Context holding the `auth` Context adapter.
 * @returns the page's bearer token.
 * @throws Error when the page has published no token, because a Workspace stream
 * cannot be confined to a caller the Host cannot attribute.
 */
function authTokenOf(ctx: Context): AuthToken {
  const token = ctx.typert.contexts.getClient('auth')?.identity(ctx)
  if (token === undefined) {
    throw new Error('workspace-controller: the Workspace stream requires a published auth token')
  }
  return token as AuthToken
}

/** Domain sinks used by the Workspace state stream. */
export interface WorkspaceStateStreamOptions {
  /** Destinations for decoded Workspace state operations. */
  readonly accept: WorkspaceFollowSink
  /** Bearer token the Host re-verifies before opening each generation. */
  readonly authToken: AuthToken
  /** Observe a retryable carrier loss before reconnection. */
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
  /** Publish a terminal business or protocol failure. */
  readonly failed: (error: unknown) => void
}

/**
 * Create the reconnecting Workspace state stream.
 * @param remote - Client Remote face carrying the Workspace namespace and the stream factory.
 * @param options - Workspace state destinations.
 * @returns an unstarted stream owned by the Client Workspace runtime.
 */
export function createWorkspaceStateStream(
  remote: ClientRemote,
  options: WorkspaceStateStreamOptions,
): WorkspaceStateStream {
  const stream = remote.$stream<WorkspaceFollowFrame>({
    name: 'Workspace state stream',
    open: signal => remote.workspace.follow(options.authToken, signal),
    ended: accepted => accepted
      ? new RemoteStreamCarrierError('Workspace state stream ended without a terminal result')
      : new Error('Workspace state stream ended before its opening snapshot'),
    ...(options.carrierFailed === undefined ? {} : { carrierFailed: options.carrierFailed }),
  })
  return new RemoteSnapshotStream<WorkspaceBaselineFrame, WorkspaceFollowIncrement>(stream, {
    name: 'Workspace state stream',
    isSnapshot: (frame): frame is WorkspaceBaselineFrame => frame.type === 'baseline',
    replace: (frame) => { options.accept.replaceBaseline(frame.value) },
    update: (frame) => { acceptIncrement(options.accept, frame) },
    failed: options.failed,
  })
}

function acceptIncrement(accept: WorkspaceFollowSink, frame: WorkspaceFollowIncrement): void {
  switch (frame.type) {
    case 'upsert':
      accept.upsertView(frame.workspace)
      return
    case 'remove':
      accept.removeView(frame.workspaceId)
      return
    case 'order':
      accept.replaceOrder(frame.workspaceIds)
      return
    case 'archived':
      accept.replaceArchived(frame.archivedSessionIds)
      return
    /* v8 ignore next -- the generated Remote codec validates this closed union */
    default:
      return assertNever(frame)
  }
}

/* v8 ignore next 3 -- closed-union backstop after generated Remote validation */
function assertNever(value: never): never {
  throw new Error(`unreachable Workspace increment: ${JSON.stringify(value)}`)
}
