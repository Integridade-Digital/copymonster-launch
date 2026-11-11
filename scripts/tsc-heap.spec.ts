import { describe, expect, it } from 'vitest'
import { DEFAULT_TSC_MAX_OLD_SPACE_MIB, TSC_MAX_OLD_SPACE_ENV, hostHeapArgs, tscMaxOldSpaceMiB } from './tsc-heap.ts'

const GB = 1024 * 1024 * 1024

describe('Host compiler heap ceiling', () => {
  it('never exceeds half the host memory', () => {
    expect(tscMaxOldSpaceMiB({}, 8 * GB)).toBe(4096)
    expect(tscMaxOldSpaceMiB({}, 4 * GB)).toBe(2048)
    expect(tscMaxOldSpaceMiB({}, 64 * GB)).toBe(DEFAULT_TSC_MAX_OLD_SPACE_MIB)
  })

  it('honours an explicit ceiling below the memory bound', () => {
    expect(tscMaxOldSpaceMiB({ [TSC_MAX_OLD_SPACE_ENV]: '2048' }, 64 * GB)).toBe(2048)
    expect(tscMaxOldSpaceMiB({ [TSC_MAX_OLD_SPACE_ENV]: '1024' }, 8 * GB)).toBe(1024)
  })

  it('ignores a malformed or too-small override', () => {
    expect(tscMaxOldSpaceMiB({ [TSC_MAX_OLD_SPACE_ENV]: 'not-a-number' }, 64 * GB)).toBe(DEFAULT_TSC_MAX_OLD_SPACE_MIB)
    expect(tscMaxOldSpaceMiB({ [TSC_MAX_OLD_SPACE_ENV]: '16' }, 64 * GB)).toBe(DEFAULT_TSC_MAX_OLD_SPACE_MIB)
    expect(tscMaxOldSpaceMiB({ [TSC_MAX_OLD_SPACE_ENV]: '2.5' }, 64 * GB)).toBe(DEFAULT_TSC_MAX_OLD_SPACE_MIB)
  })

  it('keeps a floor on a host too small for the default', () => {
    expect(tscMaxOldSpaceMiB({}, 600 * 1024 * 1024)).toBe(512)
  })

  it('renders the Node argument the compiler receives', () => {
    expect(hostHeapArgs({}, 8 * GB)).toEqual(['--max-old-space-size=4096'])
  })
})
