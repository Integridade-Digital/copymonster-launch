/**
 * Old-space ceiling for the Host TypeScript compiler and how it was chosen.
 *
 * The Host aggregate needs about 2.3 GiB resident, while the compiler's own
 * default ceiling is derived from the machine. A fixed 8 GiB ceiling let one
 * compile reserve more memory than a small host has, so a second concurrent
 * process pushed the machine into swap and starved the application sharing it.
 *
 * The ceiling is the smaller of a configured value and half the host's memory.
 * Override it with `DSH_TSC_MAX_OLD_SPACE_SIZE` (MiB); CI keeps the historical
 * large ceiling because its runners are sized for it.
 */

import { totalmem } from 'node:os'

/** Old-space ceiling, in MiB, used when `DSH_TSC_MAX_OLD_SPACE_SIZE` is unset. */
export const DEFAULT_TSC_MAX_OLD_SPACE_MIB = 4096

/** Environment variable that overrides {@link DEFAULT_TSC_MAX_OLD_SPACE_MIB}. */
export const TSC_MAX_OLD_SPACE_ENV = 'DSH_TSC_MAX_OLD_SPACE_SIZE'

/** Smallest ceiling this function will return, in MiB. */
const MIN_TSC_MAX_OLD_SPACE_MIB = 512

/**
 * Resolve the old-space ceiling for one Host compiler process.
 * @param env - Environment carrying an optional `DSH_TSC_MAX_OLD_SPACE_SIZE` override.
 * @param totalBytes - Total system memory to bound the ceiling by.
 * @returns The ceiling in MiB, as a whole number.
 */
export function tscMaxOldSpaceMiB(env: NodeJS.ProcessEnv = process.env, totalBytes: number = totalmem()): number {
  const configured = Number(env[TSC_MAX_OLD_SPACE_ENV])
  const requested = Number.isInteger(configured) && configured >= MIN_TSC_MAX_OLD_SPACE_MIB
    ? configured
    : DEFAULT_TSC_MAX_OLD_SPACE_MIB
  const halfOfMemory = Math.floor(totalBytes / 2 / 1024 / 1024)
  return Math.max(MIN_TSC_MAX_OLD_SPACE_MIB, Math.min(requested, halfOfMemory))
}

/**
 * Node arguments that cap the Host compiler's old-space heap.
 * @param env - Environment carrying an optional ceiling override.
 * @param totalBytes - Total system memory to bound the ceiling by.
 * @returns One `--max-old-space-size` argument.
 */
export function hostHeapArgs(env: NodeJS.ProcessEnv = process.env, totalBytes?: number): string[] {
  return [`--max-old-space-size=${String(tscMaxOldSpaceMiB(env, totalBytes))}`]
}
