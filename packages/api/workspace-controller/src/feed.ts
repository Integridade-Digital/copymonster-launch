import {
  assertPathInSandbox,
  resolveUserSandboxRoot,
} from '@deepseek-ai/dsh-workspace'
/** Reconnect-safe Workspace baseline and increment producer. */

import type { Context } from '@deepseek-ai/cordis'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { Workspace, WorkspaceRecord } from '@deepseek-ai/dsh-workspace'
import {
  workspaceDomainState,
  workspaceRecord,
  WorkspaceId,
} from '@deepseek-ai/dsh-workspace'
import type {
  WorkspaceBaseline,
  WorkspaceFollowFrame,
  WorkspaceView,
} from './types.ts'

/**
 * Project one authoritative Workspace entity into its Remote value.
 * @param workspace - authoritative registry entity.
 * @returns detached Workspace projection for Remote consumers.
 */
export function workspaceView(workspace: Workspace): WorkspaceView {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

function changedWorkspaceView(workspaceId: string, value: unknown): WorkspaceView {
  const record: WorkspaceRecord = workspaceRecord.parse(value)
  return {
    workspaceId: WorkspaceId(workspaceId),
    path: record.path,
    title: record.title,
    sessionIds: [...record.sessionIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Owns Workspace domain observation and all active follow generations. */
export class WorkspaceFeed {
  private readonly followers = new Set<WorkspaceFollower>()
  private knownIds: Set<string>
  private order: readonly string[]
  private archived: readonly string[]

  /** @param ctx - Host context containing the authoritative Workspace registry. */
  constructor(private readonly ctx: Context) {
    const baseline = ctx.workspaceRegistry.list()
    this.knownIds = new Set(baseline.map(workspace => String(workspace.id)))
    this.order = baseline.map(workspace => String(workspace.id))
    this.archived = ctx.workspaceRegistry.archivedSessionIds.map(String)
    ctx.on('domain/changed', (change: DomainChanged) => { this.changed(change) })
    ctx.effect(() => () => {
      for (const follower of this.followers) follower.close()
      this.followers.clear()
    }, 'workspace-controller.feed')
  }

  /**
   * Read the complete current projection visible to one authenticated caller.
   * @param identity - authenticated caller identity owning the confined root.
   * @returns the caller's Workspaces and the registry-global archived Session identities.
   */
  baseline(identity: UserIdentity): WorkspaceBaseline {
    const sandboxRoot = resolveUserSandboxRoot(identity.tenantId, identity.userId)
    const items = this.ctx.workspaceRegistry.list().filter(workspace => allowsPath(workspace.path, sandboxRoot))
    return {
      items: items.map(workspaceView),
      archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds],
    }
  }

  /**
   * Open one generation beginning with a complete baseline.
   *
   * Each generation confines itself to the caller's sandbox root, so one
   * publication reaches only the followers entitled to see that Workspace.
   * @param signal - generation cancellation.
   * @param identity - authenticated caller identity owning the confined root.
   * @returns baseline followed by ordered Workspace increments.
   */
  async *follow(signal: AbortSignal, identity: UserIdentity): AsyncIterable<WorkspaceFollowFrame> {
    signal.throwIfAborted()
    const sandboxRoot = resolveUserSandboxRoot(identity.tenantId, identity.userId)
    const follower = new WorkspaceFollower(sandboxRoot)
    this.followers.add(follower)
    try {
      const baseline = this.baseline(identity)
      follower.remember(baseline.items)
      yield { type: 'baseline', value: baseline }
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  private changed(change: DomainChanged): void {
    if (change.domain !== 'workspace') return
    if (change.table === '') {
      if (change.operation !== 'put') return
      const state = workspaceDomainState.parse(change.value)
      const nextOrder = state.workspaceIds.map(String)
      const orderChanged = !sameStrings(this.order, nextOrder)
      for (const id of state.workspaceIds) {
        if (this.knownIds.has(id)) continue
        const workspace = this.ctx.workspaceRegistry.get(id)
        if (workspace === undefined) {
          throw new Error(`committed Workspace registry references missing Workspace "${id}"`)
        }
        this.knownIds.add(id)
        this.publish({ type: 'upsert', workspace: workspaceView(workspace) })
      }
      this.order = nextOrder
      if (orderChanged) this.publish({ type: 'order', workspaceIds: [...state.workspaceIds] })
      const nextArchived = state.archivedSessionIds.map(String)
      if (!sameStrings(this.archived, nextArchived)) {
        this.archived = nextArchived
        this.publish({ type: 'archived', archivedSessionIds: [...state.archivedSessionIds] })
      }
      return
    }
    if (change.table !== 'workspaces') return
    if (change.operation === 'deleted') {
      if (!this.knownIds.delete(change.key)) return
      this.publish({ type: 'remove', workspaceId: WorkspaceId(change.key) })
      return
    }
    if (!this.knownIds.has(change.key)) return
    this.publish({
      type: 'upsert',
      workspace: changedWorkspaceView(change.key, change.value),
    })
  }

  /**
   * Offer one increment to every generation, filtered by each generation's own
   * confined root. A frame a follower is not entitled to see is dropped for that
   * follower only, so two callers never observe each other's Workspaces.
   */
  private publish(frame: Exclude<WorkspaceFollowFrame, { readonly type: 'baseline' }>): void {
    for (const follower of this.followers) follower.accept(frame)
  }
}

/** @returns whether one Workspace path lies inside a confined root. */
function allowsPath(path: string, sandboxRoot: string): boolean {
  try {
    assertPathInSandbox(path, sandboxRoot)
    return true
  } catch {
    return false
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

class WorkspaceFollower {
  private readonly frames = new Deque<WorkspaceFollowFrame>()
  private readonly visible = new Set<string>()
  private waiting: (() => void) | undefined
  private closed = false

  /** @param sandboxRoot - confined root this generation may observe. */
  constructor(private readonly sandboxRoot: string) {}

  /** @param items - baseline Workspaces this generation has already observed. */
  remember(items: readonly WorkspaceView[]): void {
    for (const item of items) this.visible.add(item.workspaceId)
  }

  /**
   * Queue one increment when this generation is entitled to observe it.
   *
   * An `upsert` is judged by its Workspace path. `remove` and `order` carry no
   * path, so they are judged against the identities already delivered to this
   * generation, which keeps another user's Workspace ids out of its stream.
   */
  accept(frame: Exclude<WorkspaceFollowFrame, { readonly type: 'baseline' }>): void {
    if (frame.type === 'upsert') {
      if (!allowsPath(frame.workspace.path, this.sandboxRoot)) return
      this.visible.add(frame.workspace.workspaceId)
      this.push(frame)
      return
    }
    if (frame.type === 'remove') {
      if (!this.visible.delete(frame.workspaceId)) return
      this.push(frame)
      return
    }
    if (frame.type === 'order') {
      const workspaceIds = frame.workspaceIds.filter(id => this.visible.has(id))
      if (workspaceIds.length === 0) return
      this.push({ type: 'order', workspaceIds })
      return
    }
    this.push(frame)
  }

  push(frame: WorkspaceFollowFrame): void {
    /* v8 ignore next -- closed followers are removed before later publication can reach them. */
    if (this.closed) return
    this.frames.pushBack(frame)
    this.waiting?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  async *read(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    while (!this.closed && !signal.aborted) {
      const frame = this.frames.popFront()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await this.wait(signal)
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', finish)
        /* v8 ignore next -- one read owns the sole installed wait callback. */
        if (this.waiting === finish) this.waiting = undefined
        resolve()
      }
      this.waiting = finish
      signal.addEventListener('abort', finish, { once: true })
      /* v8 ignore next -- native signals and the private queue cannot change during this synchronous setup. */
      if (signal.aborted || this.closed || this.frames.size > 0) finish()
    })
  }
}
