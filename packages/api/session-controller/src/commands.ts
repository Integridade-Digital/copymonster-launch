import { upsertSessionIndex } from './session-db-sync.ts'
import { createUserClient } from '@deepseek-ai/dsh-supabase-client'
/** Session commands whose activation policy is explicit at each Remote method. */

import { modelAvailable, VIRTUAL_ALIAS } from './catalog.ts'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import type { Agent, ModelSelection as AgentModelSelection } from '@deepseek-ai/dsh-agent'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentAdmissionPart, ImageAttachmentRef,
} from '@deepseek-ai/dsh-attachment'
import type { FileUploadReceiptId, StagedAttachment } from '@deepseek-ai/dsh-client-file-upload/types'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import {
  ReasoningEffortId, assistantStreamChunks, createUserMessage, freezeMessage,
} from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import { SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { assertPathInSandbox, resolveUserSandboxRoot } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  ApiSessionAgentController,
  ApiSessionCwdConflict,
  ApiSessionNotFound,
  ApiSessionPresetConflict,
  ApiSessionSubagentOwnership,
  apiSessionSubagentOwnershipError,
  hasApiSessionSubagentOwner,
  type ApiSessionCreated,
} from './agent.ts'
import type {
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionCreateRequest,
  SessionCreateValue,
  SessionDeleteRequest,
  SessionDeleteValue,
  SessionForkRequest,
  SessionForkValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionSelectPositioningRequest,
  SessionSelectPositioningValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
  SessionRequestId,
  TenantQuotaReason,
} from './types.ts'
import { quotaRefusalReason } from './types.ts'

/** Gate policy for the tenant token quota: `enforce` blocks, `observe` only logs. */
export type QuotaGateMode = 'enforce' | 'observe'

/**
 * Refusal when the tenant exhausted its plan tokens or its trial ended. The
 * text names the state without the provider topology, so a tenant reads why the
 * turn stopped instead of an "AI instability" fallback; the specific allowance
 * is prefixed from {@link QUOTA_REFUSAL_MESSAGE_PREFIX}.
 */
const QUOTA_EXCEEDED_MESSAGE = 'Seu uso de IA atingiu o limite do plano ou o período de teste encerrou. '
  + 'Ajuste seu plano para continuar.'

/** Fail-closed refusal when the quota RPC cannot answer. */
const QUOTA_UNAVAILABLE_MESSAGE = 'Não foi possível validar sua cota de IA no momento. Tente novamente.'

/**
 * Prefix the quota gate appends before each refusal reason, so the caller
 * reads a complete sentence and product copy keyed on the reason stays exact.
 */
const QUOTA_REFUSAL_MESSAGE_PREFIX: Readonly<Record<TenantQuotaReason, string>> = {
  quota_exceeded: 'Limite de tokens do plano atingido. ',
  trial_expired: 'Seu período de teste terminou. ',
  trial_tokens_exhausted: 'O limite de tokens do período de teste foi atingido. ',
}

/** Local reading of the caller tenant's subscription state. */
interface LocalTenantState {
  readonly status: string
  readonly trialEndsAt: string | null
}

/** How long one local tenant-state read is reused before asking Supabase again. */
const TENANT_STATE_TTL_MS = 60_000

/** Provider installed by the deployment profile, read from `agentDefaultModel`. */
const PROFILE_PROVIDER = 'copymonster'

/** Local subscription statuses that already lost service, whichever quota row answers. */
const LOCAL_INACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'trial_expired',
  'canceled',
  'past_due',
  'unpaid',
  'incomplete',
  'deleted',
])

/**
 * The model selection a non-admin tenant must run on.
 *
 * Tenant turns are billed to the platform credential through the virtual
 * CopyMonster route. A session that recorded a real provider while the profile
 * still carried the operator's selection would keep calling a route the tenant
 * cannot pay for, so every tenant entry point pins the alias the platform owns.
 * Platform administrators keep their real selection.
 * @param identity - authenticated caller, when the entry point resolved one.
 * @returns the virtual alias, or undefined for administrators and non-tenant callers.
 */
export function tenantModelSelection(identity?: UserIdentity): AgentModelSelection | undefined {
  if (identity === undefined || identity.tenantId === '' || identity.isAdmin === true) return undefined
  return { ...VIRTUAL_ALIAS }
}

/** One `check_tenant_quota` row. */
interface TenantQuotaRow {
  allowed?: boolean
  reason?: string
  remaining_tokens?: number
}

/** Normalized tenant quota result consumed by the gate. */
export interface TenantQuotaResult {
  readonly allowed: boolean
  readonly reason: string
  readonly remainingTokens: number
}

/**
 * Injectable tenant quota check; the default reads `check_my_tenant_quota` with
 * the caller's own token.
 */
export type TenantQuotaCheck = (tenantId: string, token?: string) => Promise<TenantQuotaResult>

/**
 * Default quota check: `check_my_tenant_quota` through a caller-scoped client.
 *
 * The RPC derives the tenant from `auth.uid()`, so the caller's token is what
 * authorizes the read; the tenant id parameter stays for the injectable
 * signature and for diagnostics only.
 */
async function fetchTenantQuota(_tenantId: string, token?: string): Promise<TenantQuotaResult> {
  if (token === undefined || token === '') {
    throw new Error('check_my_tenant_quota requires the caller bearer token')
  }
  const { data, error } = await createUserClient(token).rpc('check_my_tenant_quota')
  if (error !== null && error !== undefined) throw new Error(`check_my_tenant_quota failed: ${String(error)}`)
  const row = (Array.isArray(data) ? data[0] : data) as TenantQuotaRow | undefined
  return {
    allowed: row?.allowed === true,
    reason: typeof row?.reason === 'string' ? row.reason : 'unknown',
    remainingTokens: typeof row?.remaining_tokens === 'number' ? row.remaining_tokens : 0,
  }
}

type PromptContentCandidate =
  | SessionPromptRequest['content'][number]
  | Extract<SessionUpdateQueueRequest['action'], { readonly kind: 'edit' }>['content'][number]

/**
 * Whether prompt content carries non-whitespace text or an attachment.
 * @param content - submitted or edited prompt parts.
 * @returns false for content the Agent must not receive.
 */
export function hasPromptContent(content: readonly PromptContentCandidate[]): boolean {
  return content.some(part => part.type !== 'text' || part.text.trim().length > 0)
}

/** Refusal for a Session whose Agent still owns the durable writer. */
function sessionWriterHeld(sessionId: SessionId): RemoteError {
  return new RemoteError(
    'session/writer-held',
    `session "${sessionId}" is in use and cannot be deleted`,
    { sessionId },
  )
}

/**
 * Resolve the omitted-`atSeq` default to the latest completed-turn prefix,
 * including standalone events before the next turn begins.
 */
function latestCompletedPrefixBoundary(events: readonly SessionEvent[]): SessionSeq | undefined {
  const lastTurnEnd = events.findLast(event => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return undefined
  let boundary = lastTurnEnd.seq
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start' || (next.type === 'user/message' && next.surfaceOp === 'append')
      || next.type === 'agent/inbox/spliced') break
    boundary = next.seq
  }
  return boundary
}

/**
 * Tenant, user and bearer token a Session was last prompted under.
 *
 * The token is kept so the metering callback that runs after the turn can
 * record usage under the caller's own row-level security instead of the
 * service role.
 */
export const sessionTenantMap = new WeakMap<Session, {
  tenantId: string
  userId: string
  authToken?: string
  positioningMappingId?: string
}>()

/** One cached plan read, keyed by the caller token that authorized it. */
interface SessionPlanEntry {
  expiresAt: number
  maxSessions: number | undefined
}

/** How long a plan read is reused before asking Supabase again. */
const SESSION_PLAN_TTL_MS = 60_000

export class SessionCommandController {
  private readonly planLimits = new Map<string, SessionPlanEntry>()
  private readonly localTenantStates = new Map<string, { state: LocalTenantState; expiresAt: number }>()

  /**
   * @param ctx - Host context carrying Agent, model, attachment, title, and Workspace services.
   * @param agents - sole owner of create, resume, Agent composition, and Session-local model selection.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
    private readonly quotaGateMode?: QuotaGateMode,
    private readonly quotaCheck?: TenantQuotaCheck,
  ) {}

  /**
   * Create one ordinary Session for a new conversation, reusing the named
   * blank Session while it is an unarchived member of the requested Workspace.
   * The caller's sandbox confines the working directory.
   * @param request - optional blank Session to reuse, location, and Agent preset.
   * @param identity - authenticated caller whose sandbox confines the working directory.
   * @param token - bearer token that authorizes the quota read.
   * @returns the created or reused Session identity and its preset when configured.
   */
  async create(request: SessionCreateRequest, identity: UserIdentity, token?: string): Promise<SessionCreateValue> {
    // The quota gate already fails closed on an inactive subscription
    // (`subscription_inactive:<status>`), so no separate tenant read is needed.
    await this.assertTenantQuota(identity, 'session.create', token)
    await this.assertSessionCountQuota(identity, token)
    if (request.workspaceId !== undefined && request.cwd !== undefined) {
      throw new RemoteError('gateway/bad-request', 'session.create accepts workspaceId or cwd, not both', {})
    }
    const sandboxRoot = resolveUserSandboxRoot(identity.tenantId, identity.userId)
    let workspace: Workspace | undefined
    if (request.workspaceId !== undefined) {
      workspace = this.ctx.workspaceRegistry.get(request.workspaceId)
      if (workspace === undefined) {
        throw new RemoteError('workspace/not-found', `workspace "${request.workspaceId}" not found`, {
          workspaceId: request.workspaceId,
        })
      }
    }
    // Default the working directory to the caller's sandbox root; never the
    // process working directory, which would cross tenant boundaries.
    const cwd = workspace?.path ?? request.cwd ?? sandboxRoot
    let confined: string
    try {
      confined = assertPathInSandbox(cwd, sandboxRoot)
    } catch (error) {
      throw new RemoteError(
        'session/cwd-outside-sandbox',
        `session.create cwd "${cwd}" is outside the caller's sandbox`,
        { requestedCwd: cwd },
        { cause: error },
      )
    }
    let created: ApiSessionCreated
    try {
      created = await this.agents.createSession({
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        cwd: confined,
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
        reusable: sessionId => !this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)
          && (workspace === undefined || workspace.sessionIds.includes(sessionId)),
      })
    } catch (error) {
      this.rejectCreation(error)
    }
    const sessionId = created.agent.id
    // Brand DNA precedence (plano Etapa 7): an explicit choice wins; an absent
    // one inherits the caller's default completed mapping so a fresh session
    // lands on the just-mapped DNA; the composer chip clears it in place.
    let positioningMappingId = request.positioningMappingId
    if (positioningMappingId === undefined && identity?.tenantId !== undefined) {
      positioningMappingId = await this.defaultPositioningMappingId(identity.userId, token)
    }
    if (identity?.tenantId && typeof created.agent.session === 'object' && created.agent.session !== null) {
      sessionTenantMap.set(created.agent.session, {
        tenantId: identity.tenantId,
        userId: identity.userId,
        ...(token === undefined ? {} : { authToken: token }),
        ...(positioningMappingId === undefined ? {} : { positioningMappingId }),
      })
      upsertSessionIndex({
        sessionId: String(sessionId),
        title: undefined,
        model: undefined,
        status: 'active',
        token,
      })
    }
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(sessionId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${sessionId}" was created but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId, workspaceId: workspace.id },
        )
      }
    }
    try {
      (this.ctx.get('remoteAccess') as { invalidate?: () => void } | undefined)?.invalidate?.()
    } catch {
      // Best-effort invalidation
    }
    return { sessionId, ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }) }
  }

  /**
   * Validate and record one Session model selection; save the default in the background.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection recorded for the Session, without waiting for default persistence.
   */
  async selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    const agent = await this.resolveAgent(request.sessionId)
    return this.agents.serializeImageAdmission(agent, async () => {
      try {
        await this.requireModel(request)
        const selected: AgentModelSelection = {
          provider: request.provider,
          model: request.model,
          ...(request.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
        }
        await this.ctx.llm.resolveCallConfig(selected)
        agent.model.select(selected)
        return { selected: { ...selected } }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError(
          'session/model-unavailable',
          'Model unavailable. Please try again or contact support.',
          { model: request.model },
        )
      }
    })
  }

  /**
   * Select or clear the Brand DNA mapping one Session carries. The mapping
   * must exist, be completed, and belong to the caller; the injection reads
   * the choice at the next prompt assembly.
   * @param request - Session identity and the mapping to carry; absent clears.
   * @param identity - authenticated caller the mapping must belong to.
   * @param token - bearer token that scopes the mapping read to the caller.
   * @returns the applied choice.
   */
  async selectPositioning(
    request: SessionSelectPositioningRequest,
    identity: UserIdentity,
    token?: string,
  ): Promise<SessionSelectPositioningValue> {
    const agent = await this.resolveAgent(request.sessionId)
    this.assertSessionInSandbox(
      agent.session,
      resolveUserSandboxRoot(identity.tenantId, identity.userId),
    )
    let positioningMappingId: string | undefined
    if (request.positioningMappingId !== undefined) {
      if (token === undefined || token === '') {
        throw new RemoteError('session/unauthorized', 'selecting a mapping requires the caller token', {})
      }
      const { data, error } = await createUserClient(token).rpc('get_my_positioning_mapping', {
        p_mapping_id: request.positioningMappingId,
      })
      const row = (data ?? [])[0]
      if (error !== null || row === undefined) {
        throw new RemoteError(
          'session/positioning-not-found',
          `positioning mapping "${request.positioningMappingId}" is not visible to this caller`,
          { positioningMappingId: request.positioningMappingId },
        )
      }
      if (row.status !== 'completed') {
        throw new RemoteError(
          'session/positioning-not-completed',
          `positioning mapping "${request.positioningMappingId}" is not completed`,
          { positioningMappingId: request.positioningMappingId },
        )
      }
      positioningMappingId = request.positioningMappingId
    }
    const previous = sessionTenantMap.get(agent.session)
    sessionTenantMap.set(agent.session, {
      tenantId: previous?.tenantId ?? identity.tenantId,
      userId: previous?.userId ?? identity.userId,
      ...(token === undefined ? {} : { authToken: token }),
      ...(positioningMappingId === undefined ? {} : { positioningMappingId }),
    })
    return {
      sessionId: request.sessionId,
      ...(positioningMappingId === undefined ? {} : { positioningMappingId }),
    }
  }

  /**
   * The caller's default completed positioning mapping, when one is marked.
   * An unreadable roster must not block session creation: DNA-free it is.
   * @param userId - the caller the default must belong to.
   * @param token - bearer token that scopes the read to the caller.
   * @returns the default mapping id, or undefined when none is marked.
   */
  private async defaultPositioningMappingId(userId: string, token?: string): Promise<string | undefined> {
    if (token === undefined || token === '') return undefined
    try {
      const { data, error } = await createUserClient(token)
        .from('positioning_mappings')
        .select('id')
        .eq('user_id', userId)
        .eq('is_default', true)
        .eq('status', 'completed')
        .limit(1)
      const first = data?.[0]
      if (error !== null || first === undefined) return undefined
      return String(first.id)
    } catch {
      // Same fail-open rule as the guard clause: creation proceeds DNA-free.
      return undefined
    }
  }

  /**
   * Normalize and append a user-owned Session title.
   * @param request - Session identity and proposed title.
   * @param sandboxRoot - confined root; when supplied, the Session's cwd must be inside it.
   * @param token - bearer token that authorizes the index write.
   * @returns the accepted title and durable event sequence.
   */
  async rename(request: SessionRenameRequest, sandboxRoot?: string, token?: string): Promise<SessionRenameValue> {
    const agent = await this.resolveAgent(request.sessionId)
    this.assertSessionInSandbox(agent.session, sandboxRoot)
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) {
      throw new RemoteError('gateway/internal', 'renaming is unavailable: this deployment mounts no session-title service', {})
    }
    try {
      const accepted = titles.rename(agent.session, request.title)
      const tenantInfo = typeof agent.session === 'object' && agent.session !== null
        ? sessionTenantMap.get(agent.session)
        : undefined
      upsertSessionIndex({
        sessionId: String(request.sessionId),
        title: accepted.title,
        token: token ?? tenantInfo?.authToken,
      })
      return { title: accepted.title, seq: accepted.eventSeq }
    } catch (error) {
      if (error instanceof SessionTitleInvalidError) {
        throw new RemoteError('session/title-invalid', error.message, { sessionId: request.sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `failed to rename session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
  }

  /**
   * Permanently remove one stored Session and its durable log. Idempotent for
   * an absent Session. An idle live Session is disposed first so its writer is
   * released; a running Agent refuses until it settles.
   * @param request - Session identity to remove.
   * @param sandboxRoot - confined root; when supplied, the Session's cwd must be inside it.
   * @returns deletion confirmation.
   */
  async delete(request: SessionDeleteRequest, sandboxRoot?: string): Promise<SessionDeleteValue> {
    console.log('[SessionCommandController.delete] called', { sessionId: request.sessionId, sandboxRoot })
    const snapshot = await this.ctx.sessionPersistence.stat(request.sessionId)
    if (snapshot === undefined) {
      console.log('[SessionCommandController.delete] session not found, returning deleted: true')
      return { deleted: true }
    }
    console.log('[SessionCommandController.delete] snapshot found', { sessionId: request.sessionId, cwd: snapshot.header.cwd })
    const cwd = snapshot.header.cwd
    if (cwd !== undefined && sandboxRoot !== undefined) this.assertCwdInSandbox(cwd, sandboxRoot)
    const live = this.ctx.agents.get(request.sessionId)
    if (live?.status === 'running') {
      console.log('[SessionCommandController.delete] session is running, throwing sessionWriterHeld')
      throw sessionWriterHeld(request.sessionId)
    }
    console.log('[SessionCommandController.delete] disposing agent')
    await this.agents.disposeAgent(request.sessionId)
    console.log('[SessionCommandController.delete] deleting from persistence')
    try {
      await this.ctx.sessionPersistence.delete(request.sessionId)
    } catch (error) {
      if (error instanceof SessionAlreadyOwnedError) {
        console.log('[SessionCommandController.delete] SessionAlreadyOwnedError, throwing sessionWriterHeld')
        throw sessionWriterHeld(request.sessionId)
      }
      throw error
    }
    console.log('[SessionCommandController.delete] success')
    return { deleted: true }
  }

  /**
   * Create a new ordinary Session from an exact event prefix. An explicit
   * `atSeq` is the inclusive cut; an omitted value selects the latest
   * completed-turn prefix. An open cut receives synthetic fork closers.
   * @param request - source Session and optional exact event boundary.
   * @param sandboxRoot - confined root; when supplied, the source Session's cwd must be inside it.
   * @returns the new Session identity.
   */
  async fork(request: SessionForkRequest, sandboxRoot?: string): Promise<SessionForkValue> {
    let atSeq: ReturnType<typeof SessionSeq> | undefined
    try {
      atSeq = request.atSeq === undefined ? undefined : SessionSeq(request.atSeq)
    } catch {
      throw new RemoteError('gateway/bad-request', 'atSeq must be a non-negative safe integer', {})
    }
    let observed: SessionObservation
    try {
      observed = await this.ctx.sessionQuery.observeSession(request.sessionId)
    } catch (error) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${request.sessionId}" not found`, {
          sessionId: request.sessionId,
        })
      }
      throw new RemoteError(
        'gateway/internal',
        `fork source unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    if (sandboxRoot !== undefined && observed.header.cwd !== undefined) {
      this.assertCwdInSandbox(observed.header.cwd, sandboxRoot)
    }
    using source = observed
    const boundary = atSeq ?? latestCompletedPrefixBoundary(source.events)
    if (boundary === undefined || source.events[boundary]?.seq !== boundary) {
      throw new RemoteError(
        'session/fork-unavailable',
        request.atSeq === undefined
          ? `session "${request.sessionId}" has no completed turn to fork from`
          : `event ${String(request.atSeq)} does not exist in session "${request.sessionId}" (last seq: ${String(source.events.at(-1)?.seq ?? 'none')})`,
        { sessionId: request.sessionId },
      )
    }
    const seed = buildForkSeed(source.events, boundary)
    let workspace: Workspace | undefined
    try {
      workspace = await this.forkWorkspace(source.header)
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `failed to resolve fork workspace for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    const childId = brandString<SessionId>(`session-${randomUUID()}`)
    const composition = await this.agents.composeAgent(this.agents.presetForObservation(source))
    try {
      const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
      await this.ctx.agents.create({
        sessionId: childId,
        seed,
        inheritedEventCount: SessionLogOffset(boundary + 1),
        meta: {
          ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
          isSeeded: true,
          ...(composition.agentPreset === undefined
            ? {}
            : { agentPreset: composition.agentPreset }),
        },
        agentOptions: { provider, model },
        setup: composition.setup,
      })
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `failed to fork session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(childId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${childId}" was forked but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId: childId, workspaceId: workspace.id },
        )
      }
    }
    return { sessionId: childId }
  }

  /**
   * Admit one prompt after Agent and attachment validation; the Remote method
   * has already validated the content, built the durable message source, and
   * enforced the caller's sandbox and tenant quota.
   * @param request - Session identity, prompt content, and delivery mode.
   * @param source - the `user-rpc` source recorded on the accepted message.
   * @param sandboxRoot - confined root; when supplied, the Session's cwd must be inside it.
   * @param identity - authenticated caller whose tenant quota gates the prompt.
   * @param token - bearer token that authorizes the quota read and the metering write.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  async prompt(
    request: SessionPromptRequest,
    source: MessageSource,
    sandboxRoot?: string,
    identity?: UserIdentity,
    token?: string,
  ): Promise<SessionPromptValue> {
    const agent = await this.resolveAgent(request.sessionId)
    this.assertSessionInSandbox(agent.session, sandboxRoot)
    if (identity?.tenantId && typeof agent.session === 'object' && agent.session !== null) {
      // The prompt path rewrites tenant/user on every turn; the positioning
      // mapping id is session-scoped and must survive the rewrite.
      const previous = sessionTenantMap.get(agent.session)
      sessionTenantMap.set(agent.session, {
        tenantId: identity.tenantId,
        userId: identity.userId,
        ...(token === undefined ? {} : { authToken: token }),
        ...(previous?.positioningMappingId === undefined
          ? {}
          : { positioningMappingId: previous.positioningMappingId }),
      })
    }
    if (hasPromptRequest(agent, request.requestId)) return { accepted: true }
    await this.assertTenantQuota(identity, 'session.prompt', token)
    // Existing Sessions persisted a real provider before the platform route was
    // fixed; re-pin the tenant on every turn so a resumed conversation cannot
    // keep calling a route the tenant is not served on.
    const enforced = tenantModelSelection(identity)
    if (enforced !== undefined) {
      const current = agent.model.current()
      if (current === undefined || current.provider !== enforced.provider || current.model !== enforced.model) {
        agent.model.select(enforced)
      }
    }
    const selection = agent.model.current()
    if (selection !== undefined && !await modelAvailable(this.ctx, selection)) {
      throw new RemoteError(
        'session/model-unavailable',
        'Model unavailable. Please try again or contact support.',
        { model: selection.model },
      )
    }
    const admission = resolvePromptFileReceipts(
      request.content,
      receiptId => this.ctx.fileUploads.resolve(agent, receiptId),
    )
    // Encoded images and image upload receipts both make an image prompt.
    const hasImage = admission.content.some(part => part.type === 'image')
    const admit = async (): Promise<SessionPromptValue> => {
      try {
        if (hasImage) {
          const current = agent.model.current()
          if (current !== undefined) {
            const model = await this.ctx.llm.resolveModelInfo(current.provider, current.model)
            if (model.inputModalities !== undefined && !model.inputModalities.includes('image')) {
              throw new RemoteError(
                'session/attachment-invalid',
                `Model "${current.model}" does not support image input.`,
                { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
              )
            }
          }
        }
        const content = await this.ctx.attachments.admitPromptContent(admission.content)
        const message: UserMessage = createUserMessage({ content, source })
        if (this.ctx.agents.get(agent.id) !== agent) {
          throw new RemoteError(
            'session/not-found',
            `session "${agent.id}" was disposed during prompt admission`,
            { sessionId: agent.id },
          )
        }
        using binding = this.ctx.fileUploads.bindPrompt(agent, admission.receiptIds, request.requestId)
        if (request.mode === 'steer') agent.steer(message)
        else agent.followup(message)
        binding.commit()
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        if (error instanceof AttachmentError) {
          throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
        }
        throw new RemoteError('session/agent-busy', 'prompt rejected', { reason: String(error) })
      }
      return { accepted: true }
    }
    return hasImage ? this.agents.serializeImageAdmission(agent, admit) : admit()
  }

  private async requireModel(selection: Pick<AgentModelSelection, 'provider' | 'model'>): Promise<void> {
    if (!await modelAvailable(this.ctx, selection)) {
      throw new RemoteError('session/model-unavailable', 'Model unavailable. Please try again or contact support.',
        { model: selection.model })
    }
  }

  /**
   * Read one durable image after proving the Session log references it.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  async attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    let ref: ImageAttachmentRef | undefined
    try {
      using observation = await this.ctx.sessionQuery.observeSession(request.sessionId, { projectionMode: 'none' })
      if (observation.source === 'prepared' && observation.header.cwd === undefined) {
        throw new ApiSessionNotFound(`session "${request.sessionId}" not found`)
      }
      ref = referencedImage(observation.events, String(request.attachmentId))
    } catch (error) {
      if (error instanceof ApiSessionNotFound
        || (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND')) {
        throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `attachment authorization unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    if (ref === undefined) {
      throw new RemoteError(
        'session/attachment-invalid',
        'Image is not referenced by this session.',
        { reason: 'ATTACHMENT_NOT_REFERENCED' },
      )
    }
    try {
      const stored = await this.ctx.attachments.readImage(ref)
      return {
        attachment: stored.ref,
        data: Buffer.from(stored.data).toString('base64'),
      }
    } catch (error) {
      if (error instanceof AttachmentError) {
        throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
      }
      throw new RemoteError('gateway/internal', 'Unable to read image attachment.', {})
    }
  }

  /**
   * Mutate one pending Inbox occurrence, restoring an ordinary cold Agent when needed.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  async updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    if (request.action.kind === 'edit') {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Remote callers can submit untyped JSON.
      if (request.action.content.some(block => block.type !== 'text')) {
        throw new RemoteError(
          'session/attachment-invalid',
          'queue edits accept text content only',
          { reason: 'QUEUE_EDIT_NON_TEXT' },
        )
      }
      if (!hasPromptContent(request.action.content)) {
        throw new RemoteError(
          'gateway/bad-request',
          'queue edit content must include non-whitespace text',
          {},
        )
      }
    }
    let agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      const found = await this.agents.resolveAgent(request.sessionId)
      if ('error' in found) {
        if (found.error.code !== 'session/not-found') throw found.error
        throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
      }
      agent = found.agent
    }
    if (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      const identity = this.ctx.sessionProjections
        .snapshot(agent.session, ['subagent'])
        .values.subagent
      if (identity?.mode !== 'continuable'
        || !agent.session.isOwnSeq(identity.seq)) {
        throw apiSessionSubagentOwnershipError(request.sessionId)
      }
    }
    const nextTurn = agent.inbox.nextTurn.find(message => message.id === request.itemId)
    const nextStep = agent.inbox.nextStep.find(message => message.id === request.itemId)
    const located = nextTurn === undefined
      ? nextStep === undefined ? undefined : { target: 'next-step' as const, message: nextStep }
      : { target: 'next-turn' as const, message: nextTurn }
    if (located === undefined) {
      throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
    }
    const { target, message } = located
    if (request.action.kind === 'steer' && (target !== 'next-turn' || agent.status !== 'running')) {
      throw new RemoteError('session/steer-unavailable', 'current turn no longer accepts steering', { itemId: request.itemId })
    }
    switch (request.action.kind) {
      case 'edit':
        agent.inbox.replace(request.itemId, freezeMessage<UserMessage>({
          ...message,
          content: [...request.action.content],
        }))
        break
      case 'remove': {
        agent.inbox.remove(request.itemId)
        const source = message.source
        if (source.kind === 'user' && 'rpcId' in source) {
          this.ctx.fileUploads.retirePrompt(agent, source.rpcId)
        }
        break
      }
      case 'steer':
        agent.inbox.remove(request.itemId)
        agent.steer(message)
        break
      /* v8 ignore next 2 -- closed-union exhaustiveness guard */
      default:
        assertNever(request.action, 'queue action')
    }
    return { accepted: true }
  }

  /**
   * Cancel one live ordinary Agent while retaining pending inbox work.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  cancel(request: SessionCancelRequest): SessionCancelValue {
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      throw new RemoteError(
        'session/not-found',
        `session "${request.sessionId}" not found (not attached)`,
        { sessionId: request.sessionId },
      )
    }
    if (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      throw apiSessionSubagentOwnershipError(request.sessionId)
    }
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    return { accepted: true }
  }

  /**
   * Read the caller tenant's session ceiling from its plan.
   *
   * `get_my_tenant_metrics()` derives the tenant from `auth.uid()`, so the
   * caller's own token is enough. The read is cached briefly because it runs on
   * every session creation.
   * @param token - bearer token of the caller.
   * @returns the ceiling, or undefined when the plan sets none (unlimited).
   */
  private async maxSessions(token: string): Promise<number | undefined> {
    const now = Date.now()
    const cached = this.planLimits.get(token)
    if (cached !== undefined && now < cached.expiresAt) return cached.maxSessions

    let maxSessions: number | undefined
    try {
      const { data, error } = await createUserClient(token).rpc('get_my_tenant_metrics', {})
      if (error === null && data !== null) {
        const limit = data.plan?.max_sessions
        // A null or non-positive ceiling means the plan is unlimited.
        if (typeof limit === 'number' && limit > 0) maxSessions = limit
      }
    } catch {
      // An unreadable plan must not block creation; the ceiling is advisory.
    }

    if (this.planLimits.size > 1_000) this.planLimits.clear()
    this.planLimits.set(token, { expiresAt: now + SESSION_PLAN_TTL_MS, maxSessions })
    return maxSessions
  }

  /**
   * Refuse a new Session once the tenant reached its plan ceiling.
   *
   * Archived Sessions do not count: the ceiling bounds active work, not the
   * history a tenant keeps.
   * @param identity - authenticated caller; platform admins bypass the ceiling.
   * @param token - bearer token of the caller, when the call carries one.
   */
  private async assertSessionCountQuota(identity: UserIdentity, token?: string): Promise<void> {
    if (identity.isAdmin === true) return
    if (await this.profileServesIdentity(token)) return
    if (token === undefined || token === '') return
    const limit = await this.maxSessions(token)
    if (limit === undefined) return
    const archived = new Set(this.ctx.workspaceRegistry.archivedSessionIds)
    const used = this.ctx.sessions.list().filter(session => !archived.has(session.id)).length
    if (used < limit) return
    throw new RemoteError(
      'session/quota-exceeded',
      `Session limit reached (${used}/${limit}). Archive a session or upgrade the plan.`,
      { reason: 'session_limit', message: `Session limit reached (${used}/${limit}).` },
    )
  }

  /**
   * Enforce the tenant token quota before a session-mutating command through
   * `check_tenant_quota`. Fail-closed: a refused or unreachable check blocks
   * unless the gate runs in `observe` mode, which only logs. Platform admins
   * from `users.metadata.is_admin` bypass the gate, as does a caller the
   * deployment profile itself serves (see {@link profileServesIdentity}).
   * @param identity - authenticated caller; a missing tenant skips the gate.
   * @param operation - command name used in diagnostics.
   * @param token - bearer token that authorizes the caller-scoped quota RPC.
   */
  private async assertTenantQuota(
    identity: UserIdentity | undefined,
    operation: string,
    token?: string,
  ): Promise<void> {
    if (identity?.isAdmin === true) return
    if (identity?.tenantId === undefined || identity.tenantId === '') return
    if (await this.profileServesIdentity(token)) return
    const mode = this.resolveQuotaGateMode()
    let result: TenantQuotaResult
    try {
      result = await (this.quotaCheck ?? fetchTenantQuota)(identity.tenantId, token)
    } catch (error) {
      // `check_tenant_quota` is a wire boundary: any transport failure fails closed.
      void error
      if (mode === 'observe') {
        this.ctx.logger.warn('session-controller: quota check unavailable for %s (observe mode)', operation)
        return
      }
      throw new RemoteError('session/quota-check-failed', QUOTA_UNAVAILABLE_MESSAGE, { operation })
    }
    if (result.allowed) return
    if (mode === 'observe') {
      this.ctx.logger.warn(
        'session-controller: quota gate would block %s (reason=%s remaining=%d)',
        operation, result.reason, result.remainingTokens,
      )
      return
    }
    const reason = quotaRefusalReason(result.reason)
    const prefix = reason === undefined ? '' : QUOTA_REFUSAL_MESSAGE_PREFIX[reason]
    throw new RemoteError(
      'session/quota-exceeded',
      `${prefix}${QUOTA_EXCEEDED_MESSAGE} (${result.reason})`,
      {
        message: QUOTA_EXCEEDED_MESSAGE,
        reason: reason ?? result.reason,
        remainingTokens: result.remainingTokens,
      },
    )
  }

  /**
   * Whether the deployment profile serves this caller.
   *
   * A tenant installation generates its profile patch for one Supabase user,
   * whose signed identity carries no platform-administrator flag; the profile's
   * `agent-default-model` provider is the virtual alias only that patch
   * installs. An administrator identity refreshed after sign-in therefore
   * reaches the operator's own tenant without the stale flag blocking it.
   *
   * The local subscription row must agree: a trial that already consumed its
   * allowance is not erased by having signed in as the operator.
   * @param token - bearer token that authorizes the local tenant-state read.
   * @returns true when the profile is a tenant installation and the local row is current.
   */
  private async profileServesIdentity(token?: string): Promise<boolean> {
    const profile = this.ctx.get('agentDefaultModel') as { currentSelection(): { provider: string } } | undefined
    if (profile?.currentSelection().provider !== PROFILE_PROVIDER) return false
    const state = await this.localTenantState(token)
    if (state === undefined) return false
    return !LOCAL_INACTIVE_STATUSES.has(state.status)
      && !(state.status === 'trialing' && state.trialEndsAt !== null
        && Date.parse(state.trialEndsAt) < Date.now())
  }

  /**
   * The caller tenant's local subscription state, read through the
   * caller-scoped metrics RPC. A missing token, an RPC failure, or a malformed
   * payload leaves the server-side gate in charge.
   * @param token - bearer token that authorizes the caller-scoped read.
   * @returns the local status and trial end, or undefined when unreadable.
   */
  private async localTenantState(token?: string): Promise<LocalTenantState | undefined> {
    if (token === undefined || token === '') return undefined
    const now = Date.now()
    const cached = this.localTenantStates.get(token)
    if (cached !== undefined && now < cached.expiresAt) return cached.state
    this.localTenantStates.delete(token)
    // The RPC payload is a wire boundary: validate every field before use.
    try {
      const { data, error } = await createUserClient(token).rpc('get_my_tenant_metrics', {})
      if (error !== null) return undefined
      const tenant = (data as { tenant?: unknown } | null | undefined)?.tenant
      if (typeof tenant !== 'object' || tenant === null) return undefined
      const record = tenant as { subscription_status?: unknown; trial_ends_at?: unknown }
      if (typeof record.subscription_status !== 'string') return undefined
      const state: LocalTenantState = {
        status: record.subscription_status,
        trialEndsAt: typeof record.trial_ends_at === 'string' ? record.trial_ends_at : null,
      }
      this.localTenantStates.set(token, { state, expiresAt: now + TENANT_STATE_TTL_MS })
      return state
    } catch {
      // An unreadable local row never widens the gate: the server check stays authoritative.
      return undefined
    }
  }

  /** Resolve the gate policy: explicit config, then `QUOTA_GATE_MODE`, then `enforce`. */
  private resolveQuotaGateMode(): QuotaGateMode {
    if (this.quotaGateMode === 'enforce' || this.quotaGateMode === 'observe') return this.quotaGateMode
    return process.env.QUOTA_GATE_MODE === 'observe' ? 'observe' : 'enforce'
  }

  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    const found = await this.agents.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    return found.agent
  }

  private assertSessionInSandbox(session: Session, sandboxRoot?: string): void {
    if (sandboxRoot === undefined) return
    const cwd = session.header.cwd
    if (cwd === undefined) return
    this.assertCwdInSandbox(cwd, sandboxRoot)
  }

  private assertCwdInSandbox(cwd: string, sandboxRoot: string): void {
    try {
      assertPathInSandbox(cwd, sandboxRoot)
    } catch {
      throw new RemoteError('session/unauthorized', 'session is outside the caller sandbox', {})
    }
  }

  private rejectCreation(error: unknown): never {
    if (remoteErrorOf(error) !== undefined) throw error
    if (error instanceof ApiSessionPresetConflict) {
      throw new RemoteError('agent-preset/conflict', error.message, {
        sessionId: error.sessionId,
        requestedPreset: error.requestedPreset,
      })
    }
    if (error instanceof ApiSessionCwdConflict) {
      throw new RemoteError('session/conflict', error.message, {
        sessionId: error.sessionId,
        requestedCwd: error.requestedCwd,
        ...(error.existingCwd === undefined ? {} : { existingCwd: error.existingCwd }),
      })
    }
    if (error instanceof ApiSessionSubagentOwnership) {
      throw apiSessionSubagentOwnershipError(error.sessionId)
    }
    throw new RemoteError('gateway/internal', `failed to create session: ${String(error)}`, {})
  }

  private async forkWorkspace(source: SessionHeader): Promise<Workspace | undefined> {
    const workspaces = this.ctx.workspaceRegistry.list()
    const direct = workspaces.find(workspace => workspace.sessionIds.includes(source.id))
    if (direct !== undefined || source.origin !== 'subagent') return direct
    const lineage = await this.ctx.sessionQuery.traceSession(source.id)
    for (const ancestor of lineage.ancestors) {
      const workspace = workspaces.find(candidate => candidate.sessionIds.includes(ancestor.header.id))
      if (workspace !== undefined) return workspace
    }
    return undefined
  }
}

/** Replace each file part with the file or image its staged receipt names. */
function resolvePromptFileReceipts(
  content: SessionPromptRequest['content'],
  staged: (receiptId: FileUploadReceiptId) => StagedAttachment | undefined,
): { readonly content: AttachmentAdmissionPart[]; readonly receiptIds: readonly FileUploadReceiptId[] } {
  const receiptIds = new Set<FileUploadReceiptId>()
  const resolved = content.map((part): AttachmentAdmissionPart => {
    if (part.type !== 'file') return part
    const attachment = staged(part.receiptId)
    if (attachment === undefined) {
      throw new RemoteError(
        'session/attachment-invalid',
        'File was not uploaded for this session.',
        { reason: 'FILE_NOT_STAGED' },
      )
    }
    receiptIds.add(part.receiptId)
    return attachment
  })
  return { content: resolved, receiptIds: [...receiptIds] }
}

function hasPromptRequest(agent: Agent, requestId: SessionRequestId): boolean {
  const matches = (message: UserMessage): boolean => {
    const source = message.source
    return source.kind === 'user' && 'rpcId' in source && source.rpcId === requestId
  }
  if (agent.inbox.nextTurn.some(matches) || agent.inbox.nextStep.some(matches)) return true
  return agent.session.snapshotEvents().some((event) => {
    if (event.type !== 'user/message') return false
    const source = event.data.source
    return source.kind === 'user' && 'rpcId' in source && source.rpcId === requestId
  })
}
function imageBlockIn(
  content: unknown,
  match: (ref: ImageAttachmentRef) => boolean,
): ImageAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { readonly type?: unknown; readonly attachment?: unknown }
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as ImageAttachmentRef
      if (match(ref)) return ref
    }
  }
  return undefined
}

/** Read only first-party declared content fields; unknown event payloads stay opaque. */
function imageInEvent(
  event: SessionEvent,
  match: (ref: ImageAttachmentRef) => boolean,
): ImageAttachmentRef | undefined {
  const data = event.data as {
    readonly content?: unknown
    readonly message?: { readonly content?: unknown }
    readonly inserted?: unknown
    readonly summary?: unknown
    readonly rawOutput?: unknown
  }
  // First-party event payloads can be present without their producer plugin mounted.
  const type: string = event.type
  switch (type) {
    case 'user/message':
    case 'tool/ptc-dispatch':
      return imageBlockIn(data.content, match)
    case 'system/message':
    case 'developer/message':
    case 'tool/result':
    case 'team/message/queued':
      return imageBlockIn(data.message?.content, match)
    case 'agent/inbox/spliced': {
      const messages = data.inserted
      if (!Array.isArray(messages)) return undefined
      for (const message of messages as readonly unknown[]) {
        if (typeof message !== 'object' || message === null || Array.isArray(message)) continue
        const found = imageBlockIn((message as { readonly content?: unknown }).content, match)
        if (found !== undefined) return found
      }
      return undefined
    }
    case 'compaction/summary':
      return imageBlockIn(data.summary, match) ?? imageBlockIn(data.rawOutput, match)
    case 'assistant/message': {
      const found = imageBlockIn(data.message?.content, match)
      if (found !== undefined) return found
      break
    }
    case 'assistant/attempt': break
    default: return undefined
  }
  const assistant = event as SessionEvent<'assistant/message' | 'assistant/attempt'>
  for (const chunk of assistantStreamChunks(assistant.data.stream, 'block-end')) {
    const found = imageBlockIn([chunk.block], match)
    if (found !== undefined) return found
  }
  return undefined
}

function referencedImage(
  events: readonly SessionEvent[],
  attachmentId: string,
): ImageAttachmentRef | undefined {
  for (const event of events) {
    const found = imageInEvent(event, ref => String(ref.attachmentId) === attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}
