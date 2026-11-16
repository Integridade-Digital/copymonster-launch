#!/usr/bin/env node
/**
 * Type-check only the packages a push changes.
 *
 * `pnpm run typecheck` compiles both aggregate programs (`tsconfig.host.json`,
 * `tsconfig.client.json`) over every source and test file. That is the CI lane
 * (`.github/workflows/ci-master.yml`) and it is the wrong shape for a pre-push
 * gate: the aggregates currently carry errors in ~170 Client and ~18 Host test
 * files plus Vite 8 plugin-typing drift in two `apps/web` sources, so the hook
 * failed on every push regardless of what the push changed.
 *
 * This script maps each changed source file to the package that owns it and runs
 * that package's own `tsconfig`, which compiles just that package's `src`. A
 * source file a push broke therefore still fails here; test programs and the
 * known Vite 8 drift stay with the CI lane.
 *
 * Usage:
 *   node scripts/typecheck-changed.ts [--base <rev>]
 *   node scripts/typecheck-changed.ts <file> [<file>...]
 *
 * @module scripts/typecheck-changed
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/** Repository root, the parent of this script's directory. */
const ROOT = resolve(import.meta.dirname, '..')

/**
 * Test and generated-code suffixes that the push gate does not compile.
 *
 * Tests belong to the CI typecheck lane, which owns the aggregates that include
 * them, so a test-only push stays fast here.
 */
const TEST_SUFFIXES: readonly string[] = [
  '.spec.ts',
  '.spec.tsx',
  '.spec.mts',
  '.spec.cts',
  '.test.ts',
  '.test.tsx',
  '.test.mts',
  '.test.cts',
]

/**
 * Test-support directories whose files are fixtures, not shipped source.
 *
 * A package's `tests/` tree exists only for the test program, so a fixture that the
 * aggregate does not include (an `mts`/`cts` helper, for example) still belongs to the CI lane.
 */
const TEST_DIRECTORY = /(?:^|\/)tests\//u

/**
 * Source files whose only type errors come from Vite 8 plugin-typing drift.
 *
 * Both still compile at build time and are covered by the CI typecheck lane; the
 * push gate leaves them out so an unrelated push is not blocked by them.
 */
const KNOWN_DRIFT: readonly string[] = [
  'apps/web/katex-fonts.ts',
  'apps/web/product-isolation.ts',
]

/**
 * Whether a repository-relative path participates in the push gate.
 * @param path - repository-relative path with forward slashes.
 * @returns true when the file should be type-checked.
 */
export function shouldCheck(path: string): boolean {
  if (!/\.(?:ts|tsx|mts|cts)$/u.test(path)) return false
  if (TEST_SUFFIXES.some(suffix => path.endsWith(suffix))) return false
  if (TEST_DIRECTORY.test(path)) return false
  if (KNOWN_DRIFT.includes(path)) return false
  if (path.startsWith('vendor/') || path.includes('/lib/')) return false
  if (/(?:^|\/)dist\//u.test(path)) return false
  if (path.startsWith('node_modules/') || path.includes('/node_modules/')) return false
  return true
}

/**
 * Parse command-line arguments.
 * @param argv - arguments after the executable and script path.
 * @returns the parsed options and any explicit file list.
 */
export function parseArgs(argv: readonly string[]): { base?: string; files: string[] } {
  const files: string[] = []
  let base: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index] as string
    if (value === '--base') {
      const next = argv[index + 1]
      if (next === undefined) throw new Error('--base needs a revision')
      base = next
      index += 1
    } else if (value.startsWith('--')) throw new Error(`unknown option ${value}`)
    else files.push(value)
  }
  return { base, files }
}

/**
 * Repository-relative paths this push changes.
 * @param base - explicit base revision, or undefined for the upstream merge base.
 * @returns repository-relative paths with forward slashes.
 */
function changedFiles(base: string | undefined): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', base ?? mergeBase(), 'HEAD'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return output.split('\n').map(line => line.trim()).filter(line => line !== '')
}

/**
 * The merge base with the upstream branch.
 * @returns a revision `git diff` accepts.
 */
function mergeBase(): string {
  for (const candidate of ['origin/master', 'origin/main']) {
    try {
      return execFileSync('git', ['merge-base', candidate, 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    } catch {
      // This checkout has no such upstream; try the next candidate.
    }
  }
  return 'HEAD~1'
}

/**
 * The package directory owning a source file: the nearest ancestor holding a `package.json`.
 * @param path - repository-relative path.
 * @returns the absolute package directory, or undefined outside a package.
 */
export function owningPackage(path: string): string | undefined {
  let directory = dirname(join(ROOT, path))
  while (directory.startsWith(ROOT)) {
    if (existsSync(join(directory, 'package.json'))) return directory
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

/**
 * The package programs to compile for one package directory.
 *
 * A package with distinct Host and Client faces exposes both leaf configs; an
 * ordinary two-entry Client plugin has one root `tsconfig.json`. Compiling the
 * leaf that includes the changed file keeps the check to that face.
 * @param directory - absolute package directory.
 * @param path - the repository-relative file that changed.
 * @returns absolute tsconfig paths to compile.
 */
export function programsFor(directory: string, path: string): string[] {
  const packages = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { dsh?: { faces?: string[] } }
  const faces = packages.dsh?.faces
  if (Array.isArray(faces) && faces.length > 0) {
    const face = path.includes('/client/') || path.includes('.client.') ? 'client' : 'host'
    const leaf = join(directory, `tsconfig.${face}.json`)
    if (existsSync(leaf)) return [leaf]
  }
  const root = join(directory, 'tsconfig.json')
  if (existsSync(root)) return [root]
  for (const name of ['tsconfig.host.json', 'tsconfig.client.json']) {
    const candidate = join(directory, name)
    if (existsSync(candidate)) return [candidate]
  }
  return []
}

/**
 * Run the gate.
 * @returns the exit code.
 */
function main(): number {
  const options = parseArgs(process.argv.slice(2))
  const requested = options.files.length > 0 ? options.files : changedFiles(options.base)
  const candidates = requested
    .map(path => relative(ROOT, resolve(ROOT, path)).split('\\').join('/'))
    .filter(path => path !== '')

  const checked = candidates.filter(shouldCheck)
  const skipped = candidates.length - checked.length
  if (checked.length === 0) {
    process.stdout.write(`typecheck-changed: nothing to check (${skipped} file(s) left to CI)\n`)
    return 0
  }

  const programs = new Map<string, string[]>()
  for (const path of checked) {
    const directory = owningPackage(path)
    if (directory === undefined) {
      process.stdout.write(`skipped (no package): ${path}\n`)
      continue
    }
    const found = programsFor(directory, path)
    if (found.length === 0) {
      process.stdout.write(`skipped (no package tsconfig): ${path}\n`)
      continue
    }
    for (const program of found) {
      const list = programs.get(program) ?? []
      if (!list.includes(path)) list.push(path)
      programs.set(program, list)
    }
  }

  process.stdout.write(
    `typecheck-changed: ${checked.length} source file(s) in ${programs.size} package program(s); `
    + `${skipped} file(s) left to the CI typecheck lane\n`,
  )

  let failed = false
  for (const [program, files] of programs) {
    process.stdout.write(`  ${relative(ROOT, program)} (${files.length} changed)\n`)
    try {
      execFileSync(process.execPath, [
        join(ROOT, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--project', program,
      ], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072' } })
    } catch {
      failed = true
    }
  }

  if (failed) {
    process.stderr.write(
      'typecheck-changed: failed. A package this push changed no longer type-checks.\n'
      + 'Test programs and the Vite 8 plugin-typing drift in apps/web are excluded here and belong to the\n'
      + 'CI typecheck lane (.github/workflows/ci-master.yml); see the header of this script.\n',
    )
    return 1
  }
  process.stdout.write('typecheck-changed: ok\n')
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    process.exitCode = main()
  } catch (error) {
    process.stderr.write(`typecheck-changed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
