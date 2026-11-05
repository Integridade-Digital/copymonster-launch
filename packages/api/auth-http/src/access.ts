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
  'settings/recordTokenUsage',
  'credentials/set',
  'credentials/unset',
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
      for (const workspace of ctx.get('workspaceRegistry')?.list() ?? []) {
        if (!principal.isAdmin && !insideSandbox(workspace.path, sandboxRoot)) continue
        bindings.push({
          role: { name: roleName, resource: 'workspace', actions },
          resource: { kind: 'workspace', id: workspace.id },
        })
      }
      for (const session of ctx.get('sessions')?.list() ?? []) {
        if (!principal.isAdmin && !insideSandbox(session.header.cwd, sandboxRoot)) continue
        bindings.push({
          role: { name: roleName, resource: 'session', actions },
          resource: { kind: 'session', id: session.id },
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
