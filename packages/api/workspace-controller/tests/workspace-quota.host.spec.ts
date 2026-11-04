/**
 * Workspace creation honours the caller tenant's plan ceiling.
 *
 * The ceiling comes from `get_my_tenant_metrics()` read with the caller's own
 * token, so the suite mocks the Supabase client and drives the registry.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { UserIdentity } from '@deepseek-ai/dsh-api-auth-context'
import { WorkspaceCommands } from '../src/commands.ts'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createUserClient: vi.fn() }))

vi.mock('@deepseek-ai/dsh-supabase-client', () => ({
  createUserClient: mocks.createUserClient,
}))

const identity = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: 'owner',
  email: 'owner@example.test',
} as unknown as UserIdentity

/** Registry double that records creations and reports a fixed occupancy. */
/** One Workspace record with every field `workspaceView` projects. */
function record(index: number, title: string, path: string) {
  const at = new Date(0).toISOString()
  return {
    id: `ws-${index}`,
    title,
    path,
    sessionIds: [] as string[],
    createdAt: at,
    updatedAt: at,
  }
}

function registryDouble(initial: number) {
  const workspaces = Array.from({ length: initial }, (_, index) =>
    record(index, `Workspace ${index}`, `/tmp/ws-${index}`))
  return {
    list: () => workspaces.map(workspace => ({ ...workspace })),
    resolveByPath: async () => undefined,
    create: async (path: string, title?: string) => {
      const workspace = record(workspaces.length, title ?? path, path)
      workspaces.push(workspace)
      return workspace
    },
  }
}

/** Answer `get_my_tenant_metrics` with one plan ceiling. */
function plan(maxWorkspaces: number | null): void {
  mocks.rpc.mockResolvedValue({
    data: { tenant: { id: 'tenant-1' }, plan: { max_workspaces: maxWorkspaces } },
    error: null,
  })
}

let dataDir: string

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createUserClient.mockReturnValue({ rpc: mocks.rpc })
  dataDir = mkdtempSync(join(tmpdir(), 'cm-ws-quota-'))
  process.env.COPYMONSTER_DATA_DIR = dataDir
})

afterEach(() => {
  delete process.env.COPYMONSTER_DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

/** Build a command controller over the registry double and a caller token. */
function commands(registry: ReturnType<typeof registryDouble>): WorkspaceCommands {
  const ctx = new Context()
  ctx.provide('workspaceRegistry', registry as never)
  ctx.provide('authToken', 'caller-token')
  return new WorkspaceCommands(ctx)
}

describe('workspace plan ceiling', () => {
  it('allows creation below the ceiling', async () => {
    plan(5)
    const controller = commands(registryDouble(2))

    const result = await controller.create({ path: 'third' }, identity)

    expect(result.created).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_tenant_metrics', {})
  })

  it('refuses creation at the ceiling', async () => {
    plan(5)
    const controller = commands(registryDouble(5))

    await expect(controller.create({ path: 'sixth' }, identity)).rejects.toMatchObject({
      code: 'workspace/quota-exceeded',
      details: { used: 5, limit: 5 },
    })
  })

  it.each([null, 0, -1])('treats a %s ceiling as unlimited', async (limit) => {
    plan(limit)
    const controller = commands(registryDouble(50))

    const result = await controller.create({ path: 'another' }, identity)

    expect(result.created).toBe(true)
  })

  it('does not block creation when the plan read fails', async () => {
    mocks.rpc.mockRejectedValue(new Error('network down'))
    const controller = commands(registryDouble(50))

    const result = await controller.create({ path: 'resilient' }, identity)

    expect(result.created).toBe(true)
  })

  it('reuses one plan read across creations', async () => {
    plan(5)
    const controller = commands(registryDouble(0))

    await controller.create({ path: 'a' }, identity)
    await controller.create({ path: 'b' }, identity)

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})
