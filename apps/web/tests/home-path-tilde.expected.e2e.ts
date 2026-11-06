// @vitest-environment jsdom
// Assembled POSIX home-path privacy: the fixture Host home is `/home/fixture`
// and a second Workspace lives under it. The sidebar hover card must keep the
// host directory out of both its visible text and its accessible name.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/expected/home-path-tilde/workspace-hover.expected.txt')

installAssembledBootEnv()

describe('assembled POSIX home-path privacy', () => {
  it('keeps the home-descendant Workspace path out of the hover card and copies the title', async () => {
    mountAssembledApp()

    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    const group = (await within(tree).findAllByText('project'))
      .map(el => el.closest<HTMLElement>('[role="treeitem"]'))
      .find(el => el?.getAttribute('aria-expanded') !== null)
    if (group == null) throw new Error('home-descendant Workspace group missing')

    fireEvent.pointerEnter(group.parentElement as HTMLElement)
    const copy = await waitFor(() => screen.getByRole('button', { name: 'Copy: project' }), { timeout: 2_000 })
    expect(screen.queryByText('~/Documents/project')).toBeNull()
    expect(screen.queryByText('/home/fixture/Documents/project')).toBeNull()
    expect(screen.queryByRole('button', { name: /\/home\/fixture/ })).toBeNull()

    const shape = [
      `hover=${copy.textContent}`,
      `copy=${copy.getAttribute('aria-label')}`,
    ].join('\n') + '\n'
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
    act(() => { fireEvent.pointerLeave(group.parentElement as HTMLElement) })
  })
})
