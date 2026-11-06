# Rebranding and Agent Presets Fix

Date: 2026-11-06
Branch: `master`
Scope: frontend copy only (`packages/client/*`, `packages/experimental/*`, `apps/web/tests`).

## 1. What changed

Every remaining user-visible "DeepSeek" / "DeepSeek Harness" / "DSH" reference in the Web client
copy was replaced with **CopyMonster**. Model identity, provider ids, environment variables and
model-facing prompts were deliberately left untouched (see §5).

The Settings → **Agent presets** page was restructured in copy only:

- the preset proper noun is now **Creator Monster** (was "Creator mode" / "创造模式" /
  "クリエイターモード" / "modo Creador" / "mode Créateur" / "Erstellermodus" / "Режим автора" /
  "modo Criador");
- preset card descriptions are visually shortened to **two lines**;
- the **Mode details** / **How to use** dialog copy was rebranded;
- **View configuration** was not modified.

No backend, no migrations (`052`/`053`), no DB schema, no Cloudflare Tunnel/DNS/Zero Trust, no
i18n logic, no navigation/click/loading behaviour, no new modal and no new style layer.

## 2. Preset cards

| Item | Before | After |
| --- | --- | --- |
| Card description height | `-webkit-line-clamp: 4` | `-webkit-line-clamp: 2` |
| Full text availability | tooltip on hover when cut | unchanged (tooltip on hover when cut) |
| Touch devices (`pointer: coarse`) | unclamped | unchanged (unclamped) |
| Card selection / navigation | — | unchanged |

`packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css:232-258` — only the clamp
constant and its comment changed. The clamping remains pure CSS: the full description stays in the
DOM for assistive tech, and `AgentPresetSection.tsx:37-55` measures `scrollHeight > clientHeight`
and shows the existing `Tooltip` with the complete text when the block is actually truncated.
No new component, class, or style layer was introduced.

Rendered effect: the four built-in cards (Standard Monster, PTC Monster, Minimal Monster,
Creator Monster) now occupy the same compact height instead of stretching their grid row, and long
custom descriptions no longer push neighbouring cards taller.

## 3. Preset modal copy

`packages/client/ui-agent-preset/src/client/locales.ts` (8 locales) and
`guide-locales.ts` (Mode details / How to use markdown, 8 locales):

| Key / section | Change |
| --- | --- |
| `presetCordisName` | "Creator mode" family → `Creator Monster` |
| `sectionIntro` | mentions the preset as `Creator Monster`; grammar adjusted per locale |
| `presetCordisDescription` (card body) | `DSH` → `CopyMonster` |
| `createPluginDescription` / `createPluginChecking` / `createPluginMissing` | preset name and brand updated, localized articles/spacing fixed |
| `guideCordisIntro` | invites the user into `Creator Monster` |
| `guideCordisExplanation` | "Creator Monster includes the standard task tools…", `DSH` → `CopyMonster` |
| `guideCordisUsage` examples | "Create a CopyMonster plugin…" |

Localization notes: `zh`/`ja` gained the usual space around the Latin proper noun; `es`/`fr`/`de`
dropped the definite article before a proper noun; `ru`/`pt` were rewritten where the old literal
translation ("Режим автора", "Modo criador") used a common noun.

`View configuration` (`view` key and its dialog) was **not** touched.

JSDoc mentions of the old name were updated for consistency in
`AgentPresetSection.tsx:60,83` and `index.ts:6`, plus `README.md` / `README.zh.md`
(preset name and "two lines" clamp).

## 4. Rebranded user-visible copy (file → lines)

| File | Lines | Copy |
| --- | --- | --- |
| `packages/client/ui-agent-preset/src/client/locales.ts` | 43, 91, 142, 177, 225, 273, 321, 369 (`sectionIntro`); 61, 106, 154, 195, 243, 291, 339, 387 (`presetCordisName`); 80-83, 124-127, 167-170, 214-217, 262-265, 310-313, 358-361, 399+ (`createPlugin*`) | preset name + brand, 8 locales |
| `packages/client/ui-agent-preset/src/client/guide-locales.ts` | 32 lines across 8 locales | `DSH` → `CopyMonster`, preset name, modal headings |
| `packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css` | 232-241 | clamp 4 → 2 |
| `packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx` | 60, 83 | doc/comment naming |
| `packages/client/ui-agent-preset/src/client/index.ts` | 6 | doc naming |
| `packages/client/ui-agent-preset/README.md` | 2, 12, 28, 36 | preset name, two-line clamp |
| `packages/client/ui-agent-preset/README.zh.md` | 2, 28, 36, 38, 50 | preset name, two-line clamp |
| `packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts` | 34, 43, 46 | "…signed out of CopyMonster", "The CopyMonster process exited…" |
| `packages/client/ui-settings-account/src/client/locales/onboarding.ts` | 5, 9, 22, 36, 48, 52, 65, 79 (8 locales) | "DeepSeek Harness charges credits" → CopyMonster |
| `packages/client/ui-sidebar-documentpreview/src/client/office/locales.ts` | 11, 33, 52, 71, 90, 109, 128, 147 | "…on the computer running CopyMonster" |
| `packages/client/ui-settings-session-log/src/client/locales.ts` | 4, 12, 20, 28, 36, 44, 52, 60 | "Help improve CopyMonster." |
| `packages/client/ui-settings-plugin-inventory/src/client/locales.ts` | 52-53, 107, 171-173, 227 | "CopyMonster Engine / 驱动", brand descriptions |
| `packages/client/ui-model-selection/src/client/locales.ts` | 13, 46, 76, 106, 136, 166, 196, 226 (`provider.account`) | "CopyMonster 账号 / Account / Konto…" |
| `packages/client/ui-settings-models/src/client/locales.ts` | 20, 151, 178, 309, 333, 464, 488, 619, 774, 929, 1084, 1239 | account label + onboarding description |
| `packages/client/ui-settings-web-search/src/client/locales.ts` | 16-24, 47-55, 87-95, 118-126, 149-157, 180-188, 211-219, 242-250 | search provider description, hint, API-key note |
| `packages/experimental/client-ui-cot-translation/src/client/locales.ts` | 12, 33, 63, 96, 114, 132, 150, 168 | provider-unavailable instruction |
| `packages/experimental/cua/src/locales.ts` | 6, 13, 20, 27, 34, 41, 48, 55 | "until CopyMonster restarts" |
| `packages/experimental/cua/src/application-access.ts` | 151 | same string in the host-side default |

## 5. Deliberate exclusions

These were reviewed and left unchanged because they are model/provider identity, protocol, or
model-facing text rather than product copy:

- Model names and ids: `DeepSeek-V4.1-Flash`, `deepseek-flash`, `deepseek-account`,
  `deepseek-official`, `api.deepseek.com`, `group "DeepSeek"`, `DeepSeek-V4-Flash` snapshot labels.
- Environment/config tokens: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `$DSH_HOME`,
  `window.__DSH_BOOT__`, `DSH_CLIENT_*`.
- Model-facing prompts: `scripts/gen-tool-catalog.ts:360`,
  `packages/context/harness-dev-context/src/index.ts:51,68`,
  `packages/experimental/creation-recommendations/src/index.ts:267,275`, plugin-recommendation and
  skill-badge prompts, `apps/web/tests/expected/web-runtime-context/web-surface-prompt.expected.md`.
- Code comments that reference the upstream design ("DeepSeek Chat rule",
  "DeepSeek Chat upload illustration").
- Backend files: `billing.ts`, `affiliate-processor.ts`, `paypal-payout.ts`, `payout-executor.ts`,
  Stripe/Supabase/PayPal calls, migrations `052`/`053`, Cloudflare Tunnel `config.yml`.

## 6. Tests and snapshots updated

Source-level expectations:

- `apps/web/tests/agent-preset-selection.e2e.ts` — `Creator mode` → `Creator Monster`.
- `apps/web/tests/developer-tools-settings.e2e.ts` — menu/button names.
- `apps/web/tests/interrupted-turn.e2e.ts` — "The CopyMonster process exited…".
- `packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts` — sign-out and
  interrupted notices.
- `packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts` — account group label.
- `packages/experimental/cua/tests/application-access.spec.ts` — approval copy (en/zh/ja).
- `packages/client/ui-settings-web-search/tests/card.client.spec.tsx` — search hint.
- `packages/client/ui-settings-account/tests/expected/*.txt` — 18 goldens regenerated with
  `vitest run -u`.
- `packages/client/ui-settings-session-log/tests/expected/upload-row.zh.txt` — one golden.
- `packages/client/ui-sidebar/tests/__snapshots__/sidebar-snapshot.client.spec.tsx.snap` — stale
  snapshot from the earlier native-SVG-glyph change (`e1f59b2d42`) refreshed; it failed at `HEAD`
  and passes now.
- `apps/web/tests/expected/**/*.md` — 31 browser goldens updated by hand (preset menu/section,
  session log, CUA approval, plugin manager/inventory/search, account onboarding, provider account,
  CoT translation, model label, settings chrome, desktop onboarding/locale).

`web-runtime-context/web-surface-prompt.expected.md` was intentionally reverted after a bulk
replace, because it pins model-facing prompt text (§5).

## 7. Verification

Passing locally:

| Suite | Result |
| --- | --- |
| `packages/client/ui-agent-preset/tests` | 220 passed |
| `packages/client/ui-settings-web-search/tests` + `ui-settings-session-log/tests` | 55 passed |
| `packages/client/ui-chat` + `ui-model-selection` + `experimental/cua` | 145 passed |
| `packages/client/ui-sidebar-documentpreview/tests` | passed |
| `packages/client/ui-settings-account/tests` (goldens) | goldens updated; `apply.client.spec.ts` fails pre-existing (see below) |
| `tsc -p apps/web/tsconfig.json --noEmit` | clean |
| `pnpm run verify-client-ui-i18n` | no new violations in touched files (fails on pre-existing `apps/web/src/pages/**`) |

Pre-existing failures verified by stashing the changed source and re-running:

- `ui-settings-account/tests/apply.client.spec.ts`: `remote-mock: no rule for workspace/ensureInitial`
  — 31/31 fail with or without these edits.
- `ui-settings-models/tests`: 38 failures with or without these edits.
- `ui-settings-plugin-inventory/tests/components.client.spec.tsx`: 20 failures with or without.
- `client-ui-cot-translation/tests/activation.host.spec.ts`: 1 failure with or without.
- `ui-sidebar/tests/panel-list.client.spec.tsx` + `sidebar-root.client.spec.tsx`: 25 failures from
  unrelated sidebar behaviour (no `ui-sidebar/src` file is touched here).

Browser e2e goldens could not be regenerated locally: `chromium.launch()` requires
`pnpm exec playwright install`, which is unavailable in this environment. The 31 goldens were
updated by hand against the rendered copy and should be re-recorded by CI/`DSH_SNAPSHOT=refresh`
when Playwright browsers are present.

## 8. Deploy

```
pnpm install
pnpm run build
systemctl restart copymonster.service
cd /opt/copymonster/dsh-server-login && npm run build
systemctl restart dsh-orchestrator.service
sleep 3
curl -sI http://127.0.0.1:3081/
```

Result: recorded after the run below.
