#!/usr/bin/env node
/**
 * Seed every per-user DSH profile with the CopyMonster and voice bundles.
 *
 * The orchestrator launches `dsh --profile web` against each user's
 * `<dataRoot>/users/<id>/home`. A profile only loads bundles listed in its
 * `dsh.profile.bundles`, so users created before the CopyMonster bundle existed
 * never mount the auth layer, the brand positioning preset, or the voice plugin.
 *
 * This script is idempotent: it inserts missing bundles in a stable position and
 * leaves every other entry untouched. Run it as the service user:
 *
 *   node scripts/seed-copymonster-profile.mjs --data-root /root/.dsh-server-login
 *
 * Use `--dry-run` to print the resulting bundle lists without writing.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const COPYMONSTER_BUNDLE = '@deepseek-ai/dsh-copymonster'
const VOICE_BUNDLE = '@deepseek-ai/dsh-experimental-voice-input-bundle'
const WEB_APP_BUNDLE = '@deepseek-ai/dsh-web-app'

function parseArgs(argv) {
  const options = {
    dataRoot: process.env.DSH_SERVER_LOGIN_DATA_ROOT ?? join(homedir(), '.dsh-server-login'),
    user: undefined,
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--data-root') options.dataRoot = argv[++index]
    else if (arg === '--user') options.user = argv[++index]
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: seed-copymonster-profile.mjs [--data-root <dir>] [--user <id>] [--dry-run]')
      process.exit(0)
    } else {
      console.error(`unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return options
}

/** Insert `bundle` after `anchor` when present, otherwise append it. */
function insertAfter(bundles, bundle, anchor) {
  if (bundles.includes(bundle)) return bundles
  const anchorIndex = bundles.indexOf(anchor)
  const next = [...bundles]
  next.splice(anchorIndex === -1 ? next.length : anchorIndex + 1, 0, bundle)
  return next
}

function seedManifest(manifest) {
  const profile = manifest?.dsh?.profile
  if (profile === undefined || !Array.isArray(profile.bundles)) return { changed: false, manifest }
  let bundles = profile.bundles
  bundles = insertAfter(bundles, COPYMONSTER_BUNDLE, WEB_APP_BUNDLE)
  bundles = insertAfter(bundles, VOICE_BUNDLE, COPYMONSTER_BUNDLE)
  const changed = bundles.length !== profile.bundles.length
  if (!changed) return { changed: false, manifest }
  return {
    changed: true,
    manifest: {
      ...manifest,
      dsh: { ...manifest.dsh, profile: { ...profile, bundles } },
    },
  }
}

function userProfilePaths(dataRoot, onlyUser) {
  const usersRoot = join(dataRoot, 'users')
  let entries
  try {
    entries = readdirSync(usersRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((entry) => onlyUser === undefined || entry === onlyUser)
    .map((entry) => join(usersRoot, entry, 'home', 'profiles', 'web', 'package.json'))
    .filter((path) => {
      try { return statSync(path).isFile() } catch { return false }
    })
}

const options = parseArgs(process.argv.slice(2))
const profiles = userProfilePaths(options.dataRoot, options.user)
if (profiles.length === 0) {
  console.error(`no profiles found under ${join(options.dataRoot, 'users')}`)
  process.exit(1)
}

let changed = 0
for (const path of profiles) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const result = seedManifest(manifest)
  if (!result.changed) {
    console.log(`unchanged ${path}`)
    continue
  }
  changed += 1
  if (options.dryRun) {
    console.log(`would seed ${path}: ${result.manifest.dsh.profile.bundles.join(', ')}`)
    continue
  }
  writeFileSync(path, `${JSON.stringify(result.manifest, undefined, 2)}\n`)
  console.log(`seeded ${path}`)
}

console.log(`${changed} profile(s) ${options.dryRun ? 'would change' : 'changed'} of ${profiles.length}`)
