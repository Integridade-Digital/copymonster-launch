/**
 * Tenant and user filesystem sandbox isolation.
 * Prevents path traversal and confines workspace directories to tenant-specific roots.
 * @module @deepseek-ai/dsh-workspace/src/sandbox
 */

import { mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, normalize, resolve } from 'node:path'

/** Default base directory for tenant data when not configured via environment */
export const DEFAULT_COPYMONSTER_DATA_DIR = '/var/copymonster/data'

/**
 * Get the configured root directory for CopyMonster multi-tenant storage.
 */
export function getCopyMonsterDataDir(): string {
  return process.env.COPYMONSTER_DATA_DIR || DEFAULT_COPYMONSTER_DATA_DIR
}

/**
 * Resolves the absolute confined root directory for a specific tenant and user.
 * Structure: <COPYMONSTER_DATA_DIR>/<tenantId>/<userId>/workspaces
 */
export function resolveUserSandboxRoot(tenantId: string, userId: string): string {
  if (!tenantId || !tenantId.trim()) {
    throw new Error('Tenant ID is required to resolve sandbox root')
  }
  if (!userId || !userId.trim()) {
    throw new Error('User ID is required to resolve sandbox root')
  }
  const base = resolve(getCopyMonsterDataDir())
  const sanitizedTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '')
  const sanitizedUser = userId.replace(/[^a-zA-Z0-9_-]/g, '')
  return resolve(base, sanitizedTenant, sanitizedUser, 'workspaces')
}

/**
 * Validates that a requested path strictly resides within the user sandbox root.
 * Throws an error if path traversal or access outside the sandbox is attempted.
 *
 * @param requestedPath Absolute or relative path requested
 * @param sandboxRoot Confined directory root for the user
 * @returns Confined absolute path guaranteed to be inside sandboxRoot
 */
export function assertPathInSandbox(requestedPath: string, sandboxRoot: string): string {
  const normalizedRoot = resolve(normalize(sandboxRoot))
  const targetPath = isAbsolute(requestedPath)
    ? resolve(normalize(requestedPath))
    : resolve(normalizedRoot, requestedPath)

  if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + '/')) {
    throw new Error(`Security Violation: Path traversal forbidden. "${requestedPath}" is outside the authorized sandbox.`)
  }

  return targetPath
}

/**
 * Ensures the sandbox directory exists on the filesystem and returns its verified realpath.
 */
export async function ensureUserSandboxDirectory(tenantId: string, userId: string): Promise<string> {
  const root = resolveUserSandboxRoot(tenantId, userId)
  await mkdir(root, { recursive: true })
  return await realpath(root)
}
