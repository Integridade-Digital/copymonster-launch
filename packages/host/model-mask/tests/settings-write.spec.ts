/**
 * The Settings page writes the mask's live fields through the settings service.
 * This spec drives that write path against the real Config schema, so a path the
 * schema does not accept fails here instead of in the browser.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Hmr from '@deepseek-ai/dsh-hmr'
import Settings from '@deepseek-ai/dsh-settings'
import * as mask from '../src/index.ts'

async function fixture(): Promise<Context> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'model-mask-settings-')))
  const dir = join(home, 'profiles', 'test')
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'llm', name: 'cordis:llm' },
    { id: 'agent-default-model', name: 'cordis:agent-default-model' },
    { id: 'model-mask', name: 'cordis:model-mask', config: { fallbackPolicy: { enabled: true } } },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    ctx.provide('profileContext', profile)
    ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    Object.assign(ctx.loader.builtins, {
      editor: ConfigEditor,
      settings: Settings,
      llm: { inject: [] as const, apply: (inner: Context) => { new LlmRuntime(inner) } },
      'agent-default-model': {
        inject: [] as const,
        apply: (inner: Context) => {
          inner.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'none', model: 'none' }) })
        },
      },
      'model-mask': mask,
    })
  })
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Timer)
  const hmr = ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  await hmr.await()
  await ctx.hmr.runExclusive(async () => {})
  return ctx
}

it('accepts the failover policy write the Settings page performs', async () => {
  const ctx = await fixture()
  await ctx.settings.mutate('model-mask', [
    { op: 'set', path: ['fallbackPolicy', 'enabled'], value: false },
  ])
  expect(ctx.settings.describe().find(row => row.ns === 'model-mask')!.value)
    .toMatchObject({ fallbackPolicy: { enabled: false } })
})

it('accepts the pinned route and failover policy writes the Admin card performs', async () => {
  const ctx = await fixture()
  await ctx.settings.mutate('model-mask', [
    { op: 'set', path: ['primaryProvider'], value: 'deepseek-official' },
    { op: 'set', path: ['primaryModel'], value: 'deepseek-chat' },
    { op: 'set', path: ['fallbackProvider'], value: 'openrouter' },
    { op: 'set', path: ['fallbackModel'], value: 'openrouter/free' },
    { op: 'set', path: ['fallbackPolicy', 'enabled'], value: true },
  ])
  expect(ctx.settings.describe().find(row => row.ns === 'model-mask')!.value).toMatchObject({
    primaryProvider: 'deepseek-official',
    primaryModel: 'deepseek-chat',
    fallbackProvider: 'openrouter',
    fallbackModel: 'openrouter/free',
    fallbackPolicy: { enabled: true },
  })
  expect(ctx.modelMask.getPolicy()).toMatchObject({
    primaryProvider: 'deepseek-official',
    primaryModel: 'deepseek-chat',
  })
})

it('clears the pins so the mask follows the live catalog again', async () => {
  const ctx = await fixture()
  await ctx.settings.mutate('model-mask', [
    { op: 'set', path: ['primaryProvider'], value: 'deepseek-official' },
    { op: 'set', path: ['primaryModel'], value: 'deepseek-chat' },
  ])
  await ctx.settings.mutate('model-mask', [
    { op: 'set', path: ['primaryProvider'], value: '' },
    { op: 'set', path: ['primaryModel'], value: '' },
  ])
  // No real provider is mounted here, so the catalog holds only the mask's own
  // alias; what matters is that the cleared pins leave no stored route behind.
  expect(ctx.modelMask.getPolicy()).toMatchObject({ primaryProvider: '', primaryModel: '' })
  expect(ctx.settings.describe().find(row => row.ns === 'model-mask')!.value).toMatchObject({
    primaryProvider: '',
    primaryModel: '',
  })
  expect(ctx.modelMask.currentRoutes().primaryRoute.provider).not.toBe('deepseek-official')
})
