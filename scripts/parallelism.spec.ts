import { describe, expect, it } from 'vitest'
import { LOCAL_PARALLELISM_CAP, LOCAL_TEST_PARALLELISM_CAP, defaultParallelism, describeDefaultParallelism } from './parallelism.ts'

describe('default worker budget', () => {
  const LARGE_HOST = 32 * 1024 * 1024 * 1024
  const SMALL_HOST = 8 * 1024 * 1024 * 1024

  it('uses every reported CPU in CI', () => {
    expect(defaultParallelism({ CI: 'true' }, 256, LOCAL_PARALLELISM_CAP, LARGE_HOST)).toBe(256)
    expect(describeDefaultParallelism({ CI: 'true' }, 16)).toBe('16 available CPU(s)')
  })

  it('caps local runs without exceeding the reported CPUs', () => {
    expect(LOCAL_PARALLELISM_CAP).toBe(12)
    expect(defaultParallelism({}, 256, LOCAL_PARALLELISM_CAP, LARGE_HOST)).toBe(12)
    expect(defaultParallelism({ CI: 'false' }, 256, LOCAL_PARALLELISM_CAP, LARGE_HOST)).toBe(12)
    expect(defaultParallelism({}, 4, LOCAL_PARALLELISM_CAP, LARGE_HOST)).toBe(4)
    expect(describeDefaultParallelism({}, 256)).toBe(`${String(defaultParallelism({}, 256))} local default worker(s) of 256 CPU(s)`)
  })

  it('caps a memory-bound host below the CPU budget', () => {
    expect(defaultParallelism({}, 16, LOCAL_PARALLELISM_CAP, SMALL_HOST)).toBe(2)
    expect(defaultParallelism({ CI: 'true' }, 16, LOCAL_PARALLELISM_CAP, SMALL_HOST)).toBe(2)
    // A single-CPU host keeps its one worker rather than reaching for a second.
    expect(defaultParallelism({}, 1, LOCAL_PARALLELISM_CAP, SMALL_HOST)).toBe(1)
  })

  it('lets Vitest forks use a larger local cap', () => {
    expect(LOCAL_TEST_PARALLELISM_CAP).toBe(48)
    expect(defaultParallelism({}, 256, LOCAL_TEST_PARALLELISM_CAP, LARGE_HOST)).toBe(48)
    expect(defaultParallelism({ CI: 'true' }, 256, LOCAL_TEST_PARALLELISM_CAP, LARGE_HOST)).toBe(256)
  })
})
