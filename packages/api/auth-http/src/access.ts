/**
 * Tenant access policy for browser principals verified by the signed identity
 * handshake. The owner and platform operators keep the full method surface;
 * a member reaches every registered endpoint except the ones that change the
 * Host, its plugins, its terminals, or its stored credentials.
 *
 * Every Remote endpoint reports the `global` resource, so one binding covers
 * the method surface. The action list is read from the live Typert registry on
 * each decision, so a newly mounted package is governed without a policy edit.
 * @module @deepseek-ai/dsh-api-auth-http/access
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteAccessAction, RemoteAccessBinding, RemoteAccessPolicy } from '@deepseek-ai/dsh-api-remote-access'
import type { PrincipalMap } from '@deepseek-ai/dsh-typert-protocol'

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
  'settings/recordAuditLog',
  'settings/recordTokenUsage',
  'credentials/set',
  'credentials/unset',
])

/**
 * Build the policy for the `user` principal kind.
 * @param ctx - plugin Context carrying the live Typert registry.
 * @returns policy allowing the owner and operators everything and members the
 * non-sensitive endpoints.
 */
export function createTenantPolicy(ctx: Context): RemoteAccessPolicy<PrincipalMap['user']> {
  return {
    bindings(principal) {
      const operator = principal.role === 'owner' || principal.role === 'admin' || principal.isAdmin
      const actions = ctx.typert.local.list()
        .map(descriptor => `${descriptor.namespace}/${descriptor.method}` as RemoteAccessAction)
        .filter(action => operator || !MEMBER_DENIED.has(action))
      const binding: RemoteAccessBinding = {
        role: { name: operator ? 'tenant-operator' : 'tenant-member', resource: 'global', actions },
        resource: { kind: 'global' },
      }
      return [binding]
    },
    explain: request => `tenant role ${request.principal.role} may not call ${request.action}`,
  }
}
