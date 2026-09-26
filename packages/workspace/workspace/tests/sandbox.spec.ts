import { describe, expect, it } from 'vitest'
import {
  assertPathInSandbox,
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
})
