/**
 * Tenant and user filesystem sandbox isolation.
 * Prevents path traversal and confines workspace directories to tenant-specific roots.
 * @module @deepseek-ai/dsh-workspace/src/sandbox
 */

import { realpathSync } from 'node:fs'
import { mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path'

/** Default base directory for tenant data when not configured via environment */
export const DEFAULT_COPYMONSTER_DATA_DIR = '/var/copymonster/data'

/**
 * Get the configured root directory for CopyMonster multi-tenant storage.
 */
export function getCopyMonsterDataDir(): string {
  return process.env.COPYMONSTER_DATA_DIR || DEFAULT_COPYMONSTER_DATA_DIR
}

/**
 * Resolve the absolute confined root directory for a specific tenant and user.
 * Structure: <COPYMONSTER_DATA_DIR>/<tenantId>/<userId>/workspaces
 *
 * The result is canonicalized through `fs.realpath` on the deepest ancestor that
 * exists, so it carries the same spelling the Workspace registry stores. That
 * matters because `assertPathInSandbox` compares a canonicalized Workspace path
 * against this root: a lexical root under a symlinked data directory would
 * reject every legitimate Workspace and silently empty the Workspace feed.
 * Segments that do not exist yet are appended unresolved, so the root can be
 * computed before the directory is created.
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
  return canonicalizeExistingAncestor(resolve(base, sanitizedTenant, sanitizedUser, 'workspaces'))
}

/**
 * Canonicalize the deepest existing ancestor of `target` and re-append the
 * segments that do not exist yet.
 *
 * `fs.realpath` rejects a path it cannot traverse, so resolving the full target
 * would make the root unavailable before the directory is created. Only the
 * existing prefix can carry symlinks, so canonicalizing just that prefix and
 * re-appending the remainder yields the same spelling the filesystem will report
 * once `mkdir` has created the rest.
 */
function canonicalizeExistingAncestor(target: string): string {
  const segments: string[] = []
  let current = target
  for (;;) {
    try {
      return resolve(realpathSync(current), ...segments.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return target
      segments.push(basename(current))
      current = parent
    }
  }
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
 * Validates that a path lies inside some user's managed Workspaces tree.
 *
 * This is the ownership-agnostic half of {@link assertPathInSandbox}: it accepts
 * any `<COPYMONSTER_DATA_DIR>/<tenantId>/<userId>/workspaces` subtree and refuses
 * everything else, including the data directory itself and the process working
 * directory. A caller that knows its own identity should confine with
 * `assertPathInSandbox` against `resolveUserSandboxRoot` instead.
 *
 * @param requestedPath - absolute path a caller asked to use.
 * @returns the resolved path inside a managed Workspaces tree.
 * @throws Error when the path escapes the managed tree or omits the required
 * `<tenantId>/<userId>/workspaces` prefix.
 */
export function assertPathInManagedWorkspaces(requestedPath: string): string {
  if (!isAbsolute(requestedPath)) {
    throw new Error(`Security Violation: "${requestedPath}" must be an absolute managed Workspace path.`)
  }
  const dataRoot = canonicalizeExistingAncestor(resolve(getCopyMonsterDataDir()))
  const targetPath = resolve(normalize(requestedPath))
  if (targetPath === dataRoot || !targetPath.startsWith(dataRoot + '/')) {
    throw new Error(`Security Violation: Path traversal forbidden. "${requestedPath}" is outside the managed Workspaces tree.`)
  }
  const [tenantId, userId, ...rest] = targetPath.slice(dataRoot.length + 1).split('/')
  if (tenantId === '' || userId === '' || rest[0] !== 'workspaces') {
    throw new Error(
      `Security Violation: Path traversal forbidden. "${requestedPath}" is not a <tenantId>/<userId>/workspaces path.`,
    )
  }
  return targetPath
}

/**
 * Ensure the sandbox directory exists and return its canonical root.
 *
 * Both sandbox resolvers return the same canonical spelling, so a caller that
 * creates the directory and a caller that only compares paths against it agree
 * on one root.
 */
export async function ensureUserSandboxDirectory(tenantId: string, userId: string): Promise<string> {
  const root = resolveUserSandboxRoot(tenantId, userId)
  await mkdir(root, { recursive: true })
  return resolveUserSandboxRoot(tenantId, userId)
}

/**
 * Ensure the initial user workspace directory exists (default subfolder) and
 * return its canonical path.
 */
export async function ensureInitialUserWorkspace(
  tenantId: string,
  userId: string,
  initialName: string = 'default',
): Promise<string> {
  const root = await ensureUserSandboxDirectory(tenantId, userId)
  const sanitizedName = initialName.replace(/[^a-zA-Z0-9_-]/g, '') || 'default'
  const initialPath = resolve(root, sanitizedName)
  await mkdir(initialPath, { recursive: true })
  return await realpath(initialPath)
}
