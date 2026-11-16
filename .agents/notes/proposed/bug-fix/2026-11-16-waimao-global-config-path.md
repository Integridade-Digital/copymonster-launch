# Agent Note: dsh-waimao stores state outside the DSH home

Status: proposed

English | [中文](2026-11-16-waimao-global-config-path.zh.md)

## Problem

`dsh-waimao` keeps every piece of durable state under `WAIMAO_DIR`, which
`dsh/config.js` resolves as:

```js
export const WAIMAO_DIR = process.env.WAIMAO_HOME
  ? join(process.env.WAIMAO_HOME)
  : join(homedir(), '.waimao');
```

The package never reads the profile name, `DSH_PROFILE`, or `profileContext`, and
its own README names `~/.waimao/config.json` as the configuration file
([package](../../../../.dsh/profiles/web/node_modules/dsh-waimao/README.md)).

The default therefore sits **beside** `$DSH_HOME`, not inside it:

| Path | Owner |
| --- | --- |
| `~/.dsh/profiles/<name>/` | one DSH profile, its bundles, manifest, and patch layer |
| `~/.dsh/profiles/<name>/settings.yaml` | that profile's user settings |
| `~/.waimao/` | every `dsh-waimao` instance on the machine |

Everything the plugin persists shares that one global directory: `config.json`,
`data/audit.jsonl`, `data/templates.json`, `data/kb.json`, `data/warmup.json`,
`data/monitor.json`, and the verification cache. `DATA_DIR` derives from the same
constant, so the CRM, the audit trail, and the suppression list are global too.

A second DSH home, a second profile, or a second machine user of the same OS
account reads and writes the same address book, the same SMTP credentials, the
same audit log, and the same suppression list. Two people moving the same lead
through the pipeline, or one profile's `dryRun` master gate covering another
profile's real sends, follow directly from the shared path.

`WAIMAO_HOME` is the only escape, and a deployment must set it per profile
process to regain isolation. Nothing in the profile bundle sets it, so the
default is the shared directory.

The plugin is installed as a bundle layer of the `web` profile, which other
profiles and other DSH homes on the same account do not share. The mismatch is
between that per-profile install and the per-machine state root.

## Proposal

Treat the shared root as a blocker before a second profile or a second DSH home
uses the plugin, and fix the default upstream: `dsh-waimao` derives
`WAIMAO_DIR` from the active profile, for example
`join(resolveDshHome(), 'waimao', profileName)`, and keeps `WAIMAO_HOME` as the
explicit override. That is the only option that makes the default correct for
every consumer, and it belongs to the package author because the path is the
package's own state contract.

Until the package changes, a deployment that needs isolation sets
`WAIMAO_HOME` explicitly to a profile-local path and copies the existing
`~/.waimao` contents into it once. A `cordis.patch.yml` entry can set that
variable before the plugin reads `config.js`, so isolating a deployment needs no
fork.

## Alternatives considered

- **Set `WAIMAO_HOME` in the profile patch layer and call it done.** It isolates
  a deployment without forking the package and points each profile at its own
  CRM, but it still moves data that already exists in `~/.waimao`, so it needs a
  one-time copy step and must not be adopted silently.
- **Rewrite the constant from a rebrand script.** The
  `scripts/apply-*-rebrand.mjs` family already patches installed packages. Doing
  the same here would hardcode a profile-relative path into vendor code that the
  package re-overwrites on every update, and the script would have to know the
  profile name at install time.
- **Accept the shared directory.** That keeps the package unchanged and makes
  two profiles on one machine silently share credentials, CRM, and audit state,
  which is the failure this note reports.

## Acceptance criteria

- `WAIMAO_DIR`, `CONFIG_PATH`, and `DATA_DIR` resolve under the active profile's
  home when no `WAIMAO_HOME` is set.
- Two profiles in one DSH home, and two DSH homes on one OS account, keep
  separate configuration, CRM, audit, and template state.
- `WAIMAO_HOME` still overrides the default, so the package's e2e isolation keeps
  working.

## Risks

Changing the default moves every existing user's data on upgrade: a profile that
already wrote to `~/.waimao` starts from an empty state unless the migration
copies it first. A migration that guesses wrong can drop a live CRM, so the copy
step needs to be explicit and reversible. The override also has to stay
honoured, because the package's own e2e suite relocates the directory with
`WAIMAO_HOME`, and a fix that resolves the profile unconditionally would break
it.
