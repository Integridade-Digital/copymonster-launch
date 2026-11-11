/**
 * Default worker budget shared by repository gates, builds, linters, and Vitest configurations.
 *
 * In CI (`CI=true`) the budget is the CPU count Node reports for the runner. Elsewhere it is capped at
 * {@link LOCAL_PARALLELISM_CAP}, or {@link LOCAL_TEST_PARALLELISM_CAP} for Vitest forks, because
 * `os.availableParallelism()` reports host CPUs rather than a container's CPU quota and local runs share
 * the workstation. Each tool's explicit override
 * (`DSH_GATE_CONCURRENCY`, `DSH_OXLINT_THREADS`, `DSH_COVERAGE_MAX_WORKERS`, `--maxWorkers`) still wins.
 */

import { availableParallelism, totalmem } from 'node:os'

/** Largest default worker count outside CI. */
export const LOCAL_PARALLELISM_CAP = 12

/** Largest default Vitest fork count outside CI, for unit and coverage runs. */
export const LOCAL_TEST_PARALLELISM_CAP = 48

/**
 * Resolve the default worker budget for one process.
 * @param env - Environment whose `CI` value selects the CI budget.
 * @param available - CPU count Node reports for this process.
 * @param cap - Local cap; {@link LOCAL_TEST_PARALLELISM_CAP} for Vitest forks.
 * @param totalBytes - Total system memory, used to detect a small host.
 * @returns `available` in CI, otherwise `available` capped at `cap`, and further
 * capped at {@link SMALL_HOST_PARALLELISM_CAP} on a host below {@link LARGE_HOST_MEMORY_BYTES}.
 */
export function defaultParallelism(
  env: NodeJS.ProcessEnv = process.env,
  available: number = availableParallelism(),
  cap: number = LOCAL_PARALLELISM_CAP,
  totalBytes: number = totalmem(),
): number {
  const budget = env.CI === 'true' ? available : Math.min(available, cap)
  if (totalBytes >= LARGE_HOST_MEMORY_BYTES) return Math.max(1, budget)
  return Math.max(1, Math.min(budget, SMALL_HOST_PARALLELISM_CAP))
}

/**
 * Largest default worker count outside CI on a small host.
 *
 * TypeScript compiles are memory-bound, not CPU-bound: two Host compilers
 * beside each other exhausted a 8 GiB host even though it had spare cores.
 * Hosts with at least {@link LARGE_HOST_MEMORY_BYTES} keep the CPU-based cap.
 */
export const SMALL_HOST_PARALLELISM_CAP = 2

/** Total memory at which a host stops being treated as small, in bytes. */
export const LARGE_HOST_MEMORY_BYTES = 16 * 1024 * 1024 * 1024

/**
 * Describe a default worker budget for scheduler and tool start lines.
 * @param env - Environment whose `CI` value selects the CI budget.
 * @param available - CPU count Node reports for this process.
 * @returns The budget and where it came from, for example `12 local default worker(s) of 256 CPU(s)`.
 */
export function describeDefaultParallelism(env: NodeJS.ProcessEnv = process.env, available: number = availableParallelism()): string {
  return env.CI === 'true'
    ? `${String(available)} available CPU(s)`
    : `${String(defaultParallelism(env, available))} local default worker(s) of ${String(available)} CPU(s)`
}
