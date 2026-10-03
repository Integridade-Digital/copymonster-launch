import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPathInSandbox,
  ensureInitialUserWorkspace,
  ensureUserSandboxDirectory,
  resolveUserSandboxRoot,
} from '../src/sandbox.ts'

describe('Tenant & User Filesystem Sandbox', () => {
  it('resolves expected nested sandbox root', () => {
    const root = resolveUserSandboxRoot('tenant-123', 'user-456')
    expect(root).toContain('tenant-123/user-456/workspaces')
  })

  it('allows paths strictly inside sandbox', () => {
    const root = '/var/copymonster/data/tenant-1/user-1/workspaces'
    const allowed = assertPathInSandbox('/var/copymonster/data/tenant-1/user-1/workspaces/project-a', root)
    expect(allowed).toBe('/var/copymonster/data/tenant-1/user-1/workspaces/project-a')
  })

  it('rejects path traversal attacks (..)', () => {
    const root = '/var/copymonster/data/tenant-1/user-1/workspaces'
    expect(() => {
      assertPathInSandbox('/var/copymonster/data/tenant-1/user-1/workspaces/../../etc/passwd', root)
    }).toThrow(/Security Violation: Path traversal forbidden/)
  })

  it('rejects attempts to access another user or root system directory', () => {
    const root = '/var/copymonster/data/tenant-1/user-1/workspaces'
    expect(() => {
      assertPathInSandbox('/var/copymonster/data/tenant-2/user-9/workspaces', root)
    }).toThrow(/Security Violation/)

    expect(() => {
      assertPathInSandbox('/root', root)
    }).toThrow(/Security Violation/)
  })

  it('creates and resolves initial user workspace directory', async () => {
    const initialPath = await ensureInitialUserWorkspace('tenant-init', 'user-init')
    expect(initialPath).toContain('tenant-init/user-init/workspaces/default')
  })

  it('canonicalizes a symlinked data directory so stored paths stay comparable', async () => {
    const previousDataDir = process.env.COPYMONSTER_DATA_DIR
    const tempRoot = await mkdtemp(join(tmpdir(), 'sandbox-sym-'))
    const realDataDir = join(tempRoot, 'real')
    const linkedDataDir = join(tempRoot, 'linked')
    await mkdir(realDataDir)
    await symlink(realDataDir, linkedDataDir, 'dir')
    process.env.COPYMONSTER_DATA_DIR = linkedDataDir
    try {
      const beforeCreation = resolveUserSandboxRoot('tenant-sym', 'user-sym')
      const afterCreation = await ensureUserSandboxDirectory('tenant-sym', 'user-sym')
      const createdWorkspace = await ensureInitialUserWorkspace('tenant-sym', 'user-sym')

      expect(afterCreation).toBe(beforeCreation)
      expect(afterCreation.startsWith(await realpath(realDataDir))).toBe(true)
      expect(afterCreation).not.toContain(linkedDataDir)

      // The registry stores fs.realpath output, so a workspace the sandbox
      // created must still pass the containment check.
      expect(() => assertPathInSandbox(createdWorkspace, afterCreation)).not.toThrow()
    } finally {
      if (previousDataDir === undefined) delete process.env.COPYMONSTER_DATA_DIR
      else process.env.COPYMONSTER_DATA_DIR = previousDataDir
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
