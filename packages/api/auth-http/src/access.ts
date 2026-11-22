/**
 * Tenant access policy for browser principals verified by the signed identity
 * handshake. The owner and platform operators keep the full method surface;
 * a member reaches every registered endpoint except the ones that change the
 * Host, its plugins, its terminals, or its stored credentials.
 *
 * Every Remote endpoint reports the `global` resource, so one binding covers
 * the method surface. The action list is read from the live Typert registry on
 * each decision, so a newly mounted package is governed without a policy edit.
 *
 * Resource-scoped endpoints (`workspace/*`, `session/*`) name a Workspace or
 * Session instead, so the policy also binds the resources this caller owns.
 * Possession is decided here from the caller's own sandbox root: a Workspace
 * whose directory lies inside it, and a Session whose working directory does.
 * The owning method still enforces its own rules for callers that reach it.
 * @module @deepseek-ai/dsh-api-auth-http/access
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteAccessAction, RemoteAccessBinding, RemoteAccessPolicy } from '@deepseek-ai/dsh-api-remote-access'
import type { PrincipalMap } from '@deepseek-ai/dsh-typert-protocol'
import { assertPathInSandbox, resolveUserSandboxRoot } from '@deepseek-ai/dsh-workspace'
// Type-only: resolves the `workspaceRegistry` and `sessions` Context services
// whose live rows the owned-resource bindings enumerate.
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session'

/**
 * Endpoints a member may not call. Each one either runs code in the Host,
 * opens a shell, rewrites deployment settings, or stores a credential; the
 * owning method still enforces its own rules for callers that reach it.
 */
const MEMBER_DENIED: ReadonlySet<string> = new Set([
  'pluginManager/installBundle',
  'pluginManager/updateBundle',
  'pluginManager/removeBundle',
  'pluginManager/setBundleEnabled',
  'pluginManager/setPluginEnabled',
  'pluginManager/setVersionExemption',
  'terminal/create',
  'terminal/attach',
  'terminal/retain',
  'terminal/close',
  'terminal/rename',
  'settings/update',
  'settings/replace',
  'settings/mutate',
  'settings/savePlatformRouting',
  'settings/recordTokenUsage',
  'credentials/set',
  'credentials/unset',
  // Reports the real provider and model behind the tenant mask.
  'session/modelMaskStatus',
])

/**
 * Whether `path` lies inside the caller's own sandbox.
 * @param path - absolute directory a Workspace or Session reports.
 * @param sandboxRoot - the caller's confined Workspace root.
 * @returns true when the directory belongs to this caller.
 */
function insideSandbox(path: string | undefined, sandboxRoot: string): boolean {
  if (path === undefined || path === '') return false
  try {
    assertPathInSandbox(path, sandboxRoot)
    return true
  } catch {
    return false
  }
}

function isSessionOwnedByPrincipal(
  session: { id: string; header?: { cwd?: string } },
  principal: PrincipalMap['user'],
  sandboxRoot: string,
): boolean {
  if (principal.isAdmin) return true
  const cwd = session.header?.cwd
  // When cwd is not specified or empty, it is a standard session created by this tenant caller
  if (!cwd || cwd.trim() === '') return true
  if (insideSandbox(cwd, sandboxRoot)) return true
  if (principal.tenantId && principal.userId && cwd.includes(principal.tenantId) && cwd.includes(principal.userId)) {
    return true
  }
  return false
}

function isWorkspaceOwnedByPrincipal(
  workspace: { id: string; path?: string },
  principal: PrincipalMap['user'],
  sandboxRoot: string,
): boolean {
  if (principal.isAdmin) return true
  const path = workspace.path
  if (!path || path.trim() === '') return true
  if (insideSandbox(path, sandboxRoot)) return true
  if (principal.tenantId && principal.userId && path.includes(principal.tenantId) && path.includes(principal.userId)) {
    return true
  }
  return false
}

/**
 * Build the policy for the `user` principal kind.
 * @param ctx - plugin Context carrying the live Typert registry and the
 *   Workspace and Session stores the caller's own rows are read from.
 * @returns policy allowing the owner and operators everything, members the
 *   non-sensitive endpoints, and every caller its own Workspaces and Sessions.
 */
export function createTenantPolicy(ctx: Context): RemoteAccessPolicy<PrincipalMap['user']> {
  return {
    bindings(principal) {
      const operator = principal.role === 'owner' || principal.role === 'admin' || principal.isAdmin
      const actions = ctx.typert.local.list()
        .map(descriptor => `${descriptor.namespace}/${descriptor.method}` as RemoteAccessAction)
        .filter(action => operator || !MEMBER_DENIED.has(action))
      const bindings: RemoteAccessBinding[] = [{
        role: { name: operator ? 'tenant-operator' : 'tenant-member', resource: 'global', actions },
        resource: { kind: 'global' },
      }]
      // A resource-scoped call is allowed only on a resource this caller owns,
      // so the policy names each owned id. The stores are optional: a Host
      // without them simply grants no resource-scoped binding. A platform
      // operator reaches every resource the Host holds.
      const sandboxRoot = resolveUserSandboxRoot(principal.tenantId, principal.userId)
      const roleName = operator ? 'tenant-operator' : 'tenant-member'
      const registry = ctx.get('workspaceRegistry')
      const ownedWorkspaces = (registry?.list() ?? []).filter(ws => isWorkspaceOwnedByPrincipal(ws, principal, sandboxRoot))
      for (const workspace of ownedWorkspaces) {
        bindings.push({
          role: { name: roleName, resource: 'workspace', actions },
          resource: { kind: 'workspace', id: workspace.id },
        })
      }

      // Grant permission to sessions known from storage, owned workspaces, or live memory.
      // After a restart, ctx.sessions.list() starts empty; sessions persist in disk JSONL
      // and are indexed into workspace.sessionIds and registry.knownHeaders.
      const grantedSessionIds = new Set<string>()

      for (const workspace of ownedWorkspaces) {
        const sessionIds = (workspace as { sessionIds?: readonly string[] }).sessionIds
        if (Array.isArray(sessionIds)) {
          for (const sessionId of sessionIds) {
            grantedSessionIds.add(String(sessionId))
          }
        }
      }

      const knownHeaders = (registry as { knownHeaders?: ReadonlyMap<string, { cwd?: string }> } | undefined)?.knownHeaders
      if (knownHeaders && typeof knownHeaders.entries === 'function') {
        for (const [id, header] of knownHeaders.entries()) {
          // Empty/missing cwd is accepted for a live session created by this
          // caller, but it cannot prove ownership of an arbitrary cold disk row.
          const cwd = header?.cwd
          if ((principal.isAdmin || (cwd !== undefined && cwd.trim() !== ''))
            && isSessionOwnedByPrincipal({ id: String(id), header }, principal, sandboxRoot)) {
            grantedSessionIds.add(String(id))
          }
        }
      }

      for (const session of ctx.get('sessions')?.list() ?? []) {
        if (isSessionOwnedByPrincipal(session, principal, sandboxRoot)) {
          grantedSessionIds.add(String(session.id))
        }
      }

      // Global archive/pin indexes carry IDs, not tenant ownership. Only the
      // platform-wide principal may bind them without an owned workspace or
      // an indexed header proving the session belongs to this caller.
      if (principal.isAdmin && registry) {
        for (const id of registry.archivedSessionIds ?? []) grantedSessionIds.add(String(id))
        for (const id of registry.pinnedSessionIds ?? []) grantedSessionIds.add(String(id))
      }

      for (const sessionId of grantedSessionIds) {
        bindings.push({
          role: { name: roleName, resource: 'session', actions },
          resource: { kind: 'session', id: sessionId },
        })
      }
      return bindings
    },
    explain: (request) => {
      // Name the resource when the refusal is about one: an operator reading
      // the report needs to know the endpoint is fine and the target is not
      // this caller's.
      const scoped = request.resources.find(resource => resource.kind !== 'global')
      if (scoped === undefined) return `tenant role ${request.principal.role} may not call ${request.action}`
      return `tenant role ${request.principal.role} may not call ${request.action} on ${scoped.kind} ${String(scoped.id)}`
    },
  }
}
