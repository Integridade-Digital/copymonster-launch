/**
 * Platform-operator predicate for client gates.
 *
 * Every creator owns a personal tenant ({@link handle_new_user}, migration 032),
 * so a bare `owner`/`admin` role no longer identifies a platform operator. Only
 * membership in the platform tenant does. The id mirrors `DEFAULT_TENANT_ID`
 * (`@deepseek-ai/dsh-constants`, migration 001) because the Web bundle cannot
 * import that Host-plane package.
 */
export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Whether a role in a tenant identifies a platform operator.
 * @param role - the caller's role in the tenant.
 * @param tenantId - the tenant the role belongs to.
 * @returns true only for an owner/admin of the platform tenant.
 */
export function isPlatformAdmin(role: string | undefined | null, tenantId: string | undefined | null): boolean {
  return (role === 'owner' || role === 'admin') && tenantId === PLATFORM_TENANT_ID
}
