/** Host Workspace Remote owner: explicit commands and reconnect-safe state. */

import { Context } from '@deepseek-ai/cordis'
import type { AuthToken } from '@deepseek-ai/dsh-api-auth-context'
import { Remote, RemoteScope, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { requireAuthIdentity } from './auth-identity.ts'
import { WorkspaceCommands } from './commands.ts'
import { DirectoryPickerController } from './directory-picker.ts'
import { WorkspaceFeed } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceFollowFrame,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceUnarchiveSessionRequest,
  WorkspaceValue,
} from './types.ts'

export type * from './types.ts'
export { DirectoryPickerController } from './directory-picker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Workspace business API and Remote namespace owner. */
    workspaceController: WorkspaceController
  }
}

/** Host service backing the generated `ctx.remote.workspace` namespace. */
export class WorkspaceController extends TypertRemoteService {
  static inject = ['typert', 'workspaceRegistry']

  private readonly commands: WorkspaceCommands
  private readonly feed: WorkspaceFeed

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(ctx: Context) {
    super(ctx, 'workspaceController', { namespace: 'workspace' })
    this.commands = new WorkspaceCommands(ctx)
    this.feed = new WorkspaceFeed(ctx)
    // This package is the Loader entry for both Remote owners it hosts: the
    // directory-picking seam is abstract and never an entry itself. The child
    // stays pending until a picking backend is composed, so a host without one
    // registers no picking namespace instead of answering an unservable verb.
    ctx.plugin(DirectoryPickerController)
  }

  /**
   * Create or idempotently resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  @RemoteScope('auth', 'create')
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.commands.create(request, requireAuthIdentity(this.ctx))
  }

  /**
   * Ensure or auto-provision the initial default workspace for the authenticated user.
   * @returns the Workspace and whether this call created it.
   */
  @RemoteScope('auth', 'ensureInitial')
  ensureInitial(): Promise<WorkspaceCreateValue> {
    return this.commands.ensureInitialWorkspace(requireAuthIdentity(this.ctx))
  }

  /**
   * Rename one Workspace to a unique non-blank title.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  @RemoteScope('auth', 'rename')
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    return this.commands.rename(request, requireAuthIdentity(this.ctx))
  }

  /**
   * Remove one Workspace registration while retaining files and Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  @RemoteScope('auth', 'delete')
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.commands.delete(request, requireAuthIdentity(this.ctx))
  }

  /**
   * Move one Workspace within the registry display order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  @RemoteScope('auth', 'insertBefore')
  insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    return this.commands.insertBefore(request)
  }

  /**
   * Move one accounted Session within a Workspace.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  @RemoteScope('auth', 'insertSessionBefore')
  insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    return this.commands.insertSessionBefore(request)
  }

  /**
   * Hide one known Session from Workspace grouping surfaces.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  @RemoteScope('auth', 'archiveSession')
  archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.archiveSession(request)
  }

  /**
   * Restore one archived Session to Workspace grouping surfaces.
   * @param request - Session identity to unarchive.
   * @returns the complete resulting archive set.
   */
  @RemoteScope('auth', 'unarchiveSession')
  unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.unarchiveSession(request)
  }

  /**
   * Stream a complete Workspace baseline followed by ordered increments.
   *
   * `@RemoteScope` cannot carry this verb yet: the Typert generator discards
   * `mode` for a `context` invocation, so a scoped stream is emitted as a unary
   * method and breaks the Client contract. This verb therefore stays a direct
   * stream and resolves the caller's identity itself from the same bearer token
   * a scoped verb carries, refusing a call the Host cannot attribute to a
   * confined root. Migrate to `@RemoteScope('auth', 'follow')` once the
   * generator supports a stream and a context together.
   *
   * @param authToken - bearer token the Host re-verifies before reading data.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  @Remote({ mode: 'stream' })
  async *follow(authToken: AuthToken, signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    signal.throwIfAborted()
    const auth = this.ctx.get('auth')
    if (auth === undefined) {
      throw new RemoteError('workspace/unauthorized', 'Workspace streaming requires the auth service.', {})
    }
    const identity = await auth.resolveIdentity(authToken)
    if (identity === undefined) {
      throw new RemoteError(
        'workspace/unauthorized',
        'Workspace streaming requires an authenticated caller identity.',
        {},
      )
    }
    yield* this.feed.follow(signal, identity)
  }
}

export default WorkspaceController
