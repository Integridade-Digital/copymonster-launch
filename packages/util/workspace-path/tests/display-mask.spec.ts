import { describe, expect, it } from 'vitest'
import { HIDDEN_WORKSPACE_PATH, serverPathMask, workspaceMask } from '../src/index.ts'

describe('workspaceMask', () => {
  it('leaves text unchanged without a known workspace', () => {
    expect(workspaceMask(undefined)('/var/data/tenant/notes.md')).toBe('/var/data/tenant/notes.md')
  })

  it('replaces the workspace directory and its trailing-slash spelling', () => {
    const mask = workspaceMask('/work/tenant')
    expect(mask('wrote /work/tenant/src/a.ts')).toBe(`wrote ${HIDDEN_WORKSPACE_PATH}/src/a.ts`)
    expect(mask('cannot read /work/tenant/')).toBe(`cannot read ${HIDDEN_WORKSPACE_PATH}/`)
  })

  it('replaces the Windows and POSIX spellings of the same workspace', () => {
    const mask = workspaceMask('C:\\work\\tenant')
    expect(mask('C:/work/tenant/a.ts')).toBe(`${HIDDEN_WORKSPACE_PATH}/a.ts`)
    expect(mask('C:\\work\\tenant\\a.ts')).toBe(`${HIDDEN_WORKSPACE_PATH}\\a.ts`)
  })

  it('treats a root workspace as every separator occurrence', () => {
    expect(workspaceMask('/')('/work/tenant')).toBe(`${HIDDEN_WORKSPACE_PATH}work${HIDDEN_WORKSPACE_PATH}tenant`)
  })
})

describe('serverPathMask', () => {
  it('masks the workspace directory and other server-side absolute paths', () => {
    const mask = serverPathMask('/var/data/tenant')
    expect(mask('read /var/data/tenant/src/a.ts')).toBe(`read ${HIDDEN_WORKSPACE_PATH}/src/a.ts`)
    expect(mask('EACCES /var/data/other-tenant/a.ts')).toBe(`EACCES ${HIDDEN_WORKSPACE_PATH}`)
    expect(mask('log /home/funel/.dsh/log.txt')).toBe(`log ${HIDDEN_WORKSPACE_PATH}`)
    expect(mask('root /root/copymonster-launch/apps/cli')).toBe(`root ${HIDDEN_WORKSPACE_PATH}`)
  })

  it('keeps ordinary words, relative paths, and URLs untouched', () => {
    const mask = serverPathMask(undefined)
    const text = 'src/app.ts, ./src, https://app.copymonster.co/home/pricing, /various'
    expect(mask(text)).toBe(text)
  })

  it('masks without a known workspace', () => {
    expect(serverPathMask(undefined)('write /srv/tenant/a.md')).toBe(`write ${HIDDEN_WORKSPACE_PATH}`)
  })
})
