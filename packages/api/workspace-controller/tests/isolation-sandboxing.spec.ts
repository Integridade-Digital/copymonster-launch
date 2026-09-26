import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import { DirectoryPickerController } from '../src/directory-picker.ts'
import { WorkspaceFeed } from '../src/feed.ts'
import { WorkspaceCommands } from '../src/commands.ts'
import {
  ensureUserSandboxDirectory,
  resolveUserSandboxRoot,
  WorkspaceId,
} from '@deepseek-ai/dsh-workspace'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('DirectoryPicker and Workspace Tenant Isolation', () => {
  it('confines directory list to sandbox and filters ancestry crumbs', async () => {
    const ctx = new Context()
    roots.push(ctx)

    const tenantId = 'tenant-alpha'
    const userId = 'user-123'
    const sandboxRoot = await ensureUserSandboxDirectory(tenantId, userId)

    ctx.provide('authIdentity', {
      userId,
      tenantId,
      role: 'member',
      email: 'user@example.com',
    })

    const cap: DirectoryPickerCapability = {
      kind: 'browse',
      async list(p?: string) {
        const target = p ?? '/home/vps-user'
        return {
          path: target,
          home: '/home/vps-user',
          crumbs: [
            { name: 'root', path: '/', hidden: false },
            { name: 'var', path: '/var', hidden: false },
            { name: 'copymonster', path: '/var/copymonster', hidden: false },
            { name: 'workspaces', path: sandboxRoot, hidden: false },
          ],
          entries: [
            { name: 'my-project', path: `${sandboxRoot}/my-project`, hidden: false },
            { name: 'leak-project', path: '/etc/leak-project', hidden: false },
          ],
          truncated: false,
        }
      },
      async createDirectory(parent: string, name: string) {
        return `${parent}/${name}`
      },
    }

    ctx.provide('directoryPicker', {
      capability() {
        return cap
      },
    })

    const controller = new DirectoryPickerController(ctx)

    // 1. List within sandbox
    const listing = await controller.list(undefined, new AbortController().signal)
    expect(listing.home).toBe(sandboxRoot)
    expect(listing.crumbs[0]?.path).toBe(sandboxRoot)
    expect(listing.entries.some(e => e.path.includes('leak-project'))).toBe(false)
    expect(listing.entries.some(e => e.path.includes('my-project'))).toBe(true)

    // 2. Reject path outside sandbox
    await expect(controller.list('/etc/shadow', new AbortController().signal)).rejects.toThrow(
      /outside the authorized sandbox/,
    )

    // 3. Reject creation outside sandbox
    await expect(controller.createDirectory('/root', 'exploit')).rejects.toThrow(
      /Access denied: cannot create directory outside authorized sandbox/,
    )
  })

  it('filters WorkspaceFeed baseline to authenticated user sandbox', async () => {
    const ctx = new Context()
    roots.push(ctx)

    const tenantId = 'tenant-beta'
    const userId = 'user-456'
    const userSandbox = resolveUserSandboxRoot(tenantId, userId)
    const otherSandbox = resolveUserSandboxRoot('tenant-other', 'other-user')

    ctx.provide('workspaceRegistry', {
      list() {
        return [
          { id: 'ws-1', title: 'User WS', path: `${userSandbox}/proj1`, sessionIds: [] },
          { id: 'ws-vps', title: 'VPS Host Secret WS', path: '/root/secret-vps', sessionIds: [] },
          { id: 'ws-other', title: 'Other Tenant WS', path: `${otherSandbox}/proj2`, sessionIds: [] },
        ]
      },
      archivedSessionIds: [],
    })

    ctx.provide('authIdentity', {
      userId,
      tenantId,
      role: 'member',
      email: 'beta@example.com',
    })

    const feed = new WorkspaceFeed(ctx)
    const baseline = feed.baseline()

    expect(baseline.items).toHaveLength(1)
    expect(baseline.items[0]?.workspaceId).toBe('ws-1')
    expect(baseline.items[0]?.title).toBe('User WS')
  })

  it('restricts WorkspaceCommands mutations to authenticated sandbox', async () => {
    const ctx = new Context()
    roots.push(ctx)

    const tenantId = 'tenant-gamma'
    const userId = 'user-789'
    const userSandbox = resolveUserSandboxRoot(tenantId, userId)

    ctx.provide('workspaceRegistry', {
      resolveByPath: async (_p: string) => undefined,
      create: async (p: string) => ({ id: 'ws-new', title: 'New', path: p, sessionIds: [] }),
      get: (id: string) => {
        if (id === 'ws-mine') {
          return { id: 'ws-mine', title: 'Mine', path: `${userSandbox}/mine`, sessionIds: [] }
        }
        if (id === 'ws-foreign') {
          return { id: 'ws-foreign', title: 'Foreign', path: '/var/other/proj', sessionIds: [] }
        }
        return undefined
      },
      delete: async () => true,
    })

    ctx.provide('authIdentity', {
      userId,
      tenantId,
      role: 'member',
      email: 'gamma@example.com',
    })

    const commands = new WorkspaceCommands(ctx)

    // Create relative path inside sandbox
    const created = await commands.create({ path: 'my-subfolder' })
    expect(created.workspace.path).toContain(userSandbox)

    // Attempt to delete foreign workspace throws forbidden
    await expect(commands.delete({ workspaceId: WorkspaceId('ws-foreign') })).rejects.toThrow(
      /Access denied: cannot delete workspace outside authorized sandbox/,
    )
  })
})
