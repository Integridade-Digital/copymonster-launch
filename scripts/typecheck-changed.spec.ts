/**
 * Behaviour of the pre-push typecheck gate (`lefthook.yml` → `scripts/typecheck-changed.ts`).
 *
 * The gate exists because the aggregate programs carry test-file errors and Vite 8
 * plugin-typing drift that would otherwise fail every push. These cases pin which paths the
 * gate admits and which it leaves to the CI typecheck lane.
 */

import { describe, expect, it } from 'vitest'
import { parseArgs, owningPackage, programsFor, shouldCheck } from './typecheck-changed.ts'

describe('shouldCheck', () => {
  it('admits package source files', () => {
    expect(shouldCheck('packages/core/agent/src/index.ts')).toBe(true)
    expect(shouldCheck('packages/client/ui-chat/src/client/view.tsx')).toBe(true)
    expect(shouldCheck('scripts/apply-waimao-rebrand.ts')).toBe(true)
  })

  it('leaves every test program to the CI lane', () => {
    for (const path of [
      'packages/api/auth-http/tests/billing.spec.ts',
      'packages/client/ui-workspace/tests/rows.client.spec.tsx',
      'packages/web/web-fetch-http/tests/ssrf.spec.ts',
      'packages/core/agent/tests/index.test.ts',
      'packages/core/agent/tests/setup.mts',
      'packages/core/agent/tests/setup.cts',
    ]) expect(shouldCheck(path)).toBe(false)
  })

  it('leaves the Vite 8 plugin-typing drift sources to the CI lane', () => {
    expect(shouldCheck('apps/web/katex-fonts.ts')).toBe(false)
    expect(shouldCheck('apps/web/product-isolation.ts')).toBe(false)
  })

  it('ignores files that no TypeScript program owns', () => {
    for (const path of ['lefthook.yml', 'pnpm-lock.yaml', '.dsh/profiles/web/package.json', 'scripts/notes.md']) {
      expect(shouldCheck(path)).toBe(false)
    }
  })

  it('ignores vendored and generated output', () => {
    for (const path of [
      'vendor/cordis/src/index.ts',
      'packages/core/agent/lib/types/index.d.ts',
      'apps/web/dist/bundle.ts',
      'node_modules/foo/src/index.ts',
      'packages/core/agent/node_modules/bar/index.ts',
    ]) expect(shouldCheck(path)).toBe(false)
  })
})

describe('parseArgs', () => {
  it('collects explicit files', () => {
    expect(parseArgs(['packages/core/agent/src/index.ts', 'apps/web/main.ts'])).toEqual({
      files: ['packages/core/agent/src/index.ts', 'apps/web/main.ts'],
    })
  })

  it('reads an explicit base revision', () => {
    expect(parseArgs(['--base', 'origin/master'])).toEqual({ base: 'origin/master', files: [] })
  })

  it('rejects an unknown option', () => {
    expect(() => parseArgs(['--nope'])).toThrow('unknown option --nope')
  })

  it('rejects a base without a revision', () => {
    expect(() => parseArgs(['--base'])).toThrow('--base needs a revision')
  })
})

describe('owningPackage', () => {
  it('finds the nearest package manifest', () => {
    const directory = owningPackage('packages/core/agent/src/dispatch.ts')
    expect(directory?.endsWith('/packages/core/agent')).toBe(true)
  })

  it('finds a nested package before its parent', () => {
    const directory = owningPackage('packages/bundle/base/src/index.ts')
    expect(directory?.endsWith('/packages/bundle/base')).toBe(true)
  })
})

describe('programsFor', () => {
  it('prefers the face leaf config for a package that declares faces', () => {
    const directory = owningPackage('packages/bundle/base/src/index.ts')
    if (directory === undefined) throw new Error('base package must exist')
    const programs = programsFor(directory, 'packages/bundle/base/src/index.ts')
    expect(programs.every(path => /tsconfig\.(?:host|client|json)/u.test(path))).toBe(true)
  })

  it('returns a program for an ordinary package', () => {
    const directory = owningPackage('packages/util/brand/src/index.ts')
    if (directory === undefined) throw new Error('brand package must exist')
    expect(programsFor(directory, 'packages/util/brand/src/index.ts').length).toBeGreaterThan(0)
  })
})
