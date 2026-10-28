import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { sessionDir } from '../src/format.ts'

let root: string
let ctx: Context

/** Materialize a stored log: create() alone leaves no filesystem footprint. */
async function writeLog(persistence: SessionPersistence, m: SessionHeader, events: readonly SessionEvent[]): Promise<void> {
  const handle = await persistence.create(m)
  try {
    await handle.append(events)
  } finally {
    await handle.close()
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-delete-'))
  ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
})

afterEach(async () => { await ctx.fiber.dispose() })

describe('JsonlSessionPersistence.delete', () => {
  it('removes the stored session artifact directory from disk', async () => {
    const m = meta('del-1', '/work')
    await writeLog(ctx.sessionPersistence, m, oneTurnLog())
    expect(existsSync(sessionDir(root, '/work', m.id))).toBe(true)

    await ctx.sessionPersistence.delete(m.id)

    expect(existsSync(sessionDir(root, '/work', m.id))).toBe(false)
  })

  it('is idempotent for an absent session id', async () => {
    await expect(ctx.sessionPersistence.delete(SessionId('never-existed'))).resolves.toBeUndefined()
  })

  it('refuses deletion while this process holds a writer', async () => {
    const m = meta('del-held', '/work')
    const handle = await ctx.sessionPersistence.create(m)

    await expect(ctx.sessionPersistence.delete(m.id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)

    // Releasing the unmaterialized handle drops the pending writer claim;
    // delete then finds no stored artifact and resolves as a no-op.
    await handle.close()
    await expect(ctx.sessionPersistence.delete(m.id)).resolves.toBeUndefined()
  })
})
