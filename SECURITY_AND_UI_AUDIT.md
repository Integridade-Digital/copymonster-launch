# Security, Privacy and UI Audit

Date: 2026-11-06
Scope: frontend only — `apps/web/src/` and `packages/client/`, plus
`packages/experimental/client-ui-agent-team/`.

No backend, database, migration, infrastructure, or business-logic file was
touched. No port, process, systemd unit, or server configuration was read or
changed.

## 1. Plugin Market: dangerous categories hidden

`packages/client/ui-plugin-market/src/client/presentation.ts`

- Added `HIDDEN_CATEGORY_KEYS` with `themes-appearance`, `models-providers`,
  `security-permissions`, `development-runtime`, `browser-web`.
- Added `hiddenCategory(id, title)`: a market index declares its own category
  ids, so the id **and** the declared English title are normalized
  (lowercase, non-alphanumerics collapsed to `-`) and matched. A source that
  renames the id but keeps the title is still hidden.
- Added `visibleDeclarations()` and used it for the category chips.
- `declaredQuery()` now drops an active filter whose category is hidden, so a
  stale query cannot resurrect it.
- The entry detail panel no longer prints a hidden category in its facts.

`packages/client/ui-plugin-market/src/client/DiscoverSection.tsx`

- Category chips render from `visibleDeclarations` (search bar and filter menu
  unchanged; they never listed categories).
- The per-entry `factCategory` row is suppressed for a hidden category.

Visible categories are unchanged: `UI Enhancements`, `Workflow & Automation`,
`Notifications & Integrations`, `Sessions & Messages`, and any other
market-declared category outside the hidden set.

## 2. Settings: Profile and My DNA stay in the rail

`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`

An earlier revision of this audit hid both tabs. That change is reverted: the
section ledger is rendered in full again, so **Profile** and **My DNA** appear
in the Settings navigation exactly as before. The regression test now asserts
that both rows are present.

## 2b. Vercel MCP card: technical copy removed

`scripts/apply-dsh-plugins-rebrand.mjs`

The Vercel MCP panel is a delivery plugin patched at install time by this
script, not a file in this repository. Added `stripVercelHint()`, applied by
`translateVercelClient`, which removes two nodes from the rendered card:

- the description paragraph naming `mcp.vercel.com`, the `mcp__vercel__*` tool
  prefix, the token path, and `(mode 0600)`;
- the raw connection-status line (`Authorized · token updated … · MCP
  connected · N tools`).

The card now shows the **Vercel MCP** title and the action buttons
(Authorize, Refresh token, Test connection, Clear credentials). The manual
callback-URL row, the discovered-tools list, and the action feedback message
remain, because they are functional rather than descriptive. No click,
authorization, or navigation behavior changed.

## 3. Members card: model no longer exposed

`packages/experimental/client-ui-agent-team/src/client/TeamAction.tsx`

- Removed the `modelSelection` lookup and the `· Model: <id>` line from the
  roster row. Name, status dot, activity label, Current tag, and diagnostics
  are unchanged.

`TeamAction.module.css`

- Removed the now-unused `.memberModel` rules (hover, focus-visible, and the
  `(hover: none)` override).

`locales.ts`

- Removed the `model` key from all eight dictionaries.

## 4. Trajectory: workspace path masked

`packages/client/ui-trajectory/src/client/workspace-mask.ts` (new)

- `workspaceMask(cwd)` replaces every recorded spelling of the session's
  workspace directory (POSIX, Windows separators, trailing slash) with
  `[Workspace path hidden]`.

`packages/client/ui-trajectory/src/client/layout.ts`

- `TrajectoryLayoutInput` gained an optional `mask`.
- `toTurnModel` applies it to every derived cell string: summary text, preview
  markdown, input/output/thinking details, system-prompt detail, result,
  schema detail, source and output blocks, and the full `promptDetail` /
  `previousPromptDetail` snapshots (deep string map), which covers the system
  prompt, tool catalog, diff, and JSON trees parsed from those strings.
- `appendTrajectoryPartialLayout` forwards the mask to the streamed cells.

`packages/client/ui-trajectory/src/client/TrajectoryView.tsx`

- Reads the session `cwd` through the `useSessions` seat and builds the mask
  once per workspace change.

The Session log itself is untouched: masking happens only on derived display
strings, so copy actions and search operate on the masked text.

## 5. Admin panel localized

New module `apps/web/src/locales/admin.ts` with four dictionaries
(`adminEn`, `adminPt`, `adminZh`, `adminEs`, 127 keys each) spread into
`en.ts`, `pt.ts`, `zh.ts`, and `es.ts`. `TranslationKey` still derives from
`en`, so key parity is compiler-checked.

Converted every hardcoded string in:

| File | Strings |
| --- | --- |
| `pages/admin/tabs/AdminOverviewTab.tsx` | 33 |
| `pages/admin/tabs/AdminUsersTab.tsx` | 60 |
| `pages/admin/tabs/AdminBillingTab.tsx` | 70 |
| `pages/admin/tabs/AdminSessionsTab.tsx` | 66 |
| `pages/admin/tabs/AdminSystemTab.tsx` | 92 |
| `pages/admin/AdminAuditPage.tsx` | 31 |
| `pages/admin/AdminTenantsPage.tsx` | 33 |
| `components/layout/AdminModal.tsx` | tab config reduced to keys |

This includes headers, KPI labels, table headers, filters and their options,
empty/loading/error states, pagination lines, status and plan badges,
confirmation dialogs, validation messages, `alert()` text, placeholders, and
`aria-label`s. Portuguese strings that were mixed into the English UI
(`Users Ativos (Hoje)`, `Carregando…`, `Ações`, …) are gone.

Kept verbatim as data or proper nouns: plan names (`Starter`, `Pro`,
`Legend`), model ids, `feature.*` / `limit.*` / `quota.*` /
`storage.workspaces_root` tokens, `CopyMonster Web Frontend` product label,
status values returned by the API, and `console.*` diagnostics (now English).

`pnpm run verify-client-ui-i18n` reports **zero** violations under
`apps/web/src/pages/admin` and `AdminModal.tsx`.

## 6. Loading screen logo

`apps/web/src/auth.css`

- `.auth-logo` `max-width: 180px` → `120px`. The mark now stays a header
  accent above the card copy instead of overlapping the preparation text, and
  occupies well under a third of the viewport height.

## Verification

| Check | Result |
| --- | --- |
| `tsc -p apps/web/tsconfig.json --noEmit` | clean |
| `tsc -p packages/client/ui-plugin-market/tsconfig.json` | clean |
| `tsc -p packages/client/ui-trajectory/tsconfig.json` | clean |
| `tsc -p packages/experimental/client-ui-agent-team/tsconfig.json` | clean |
| `vitest packages/client/ui-plugin-market/tests` | 57 passed |
| `vitest packages/client/ui-trajectory/tests` | 217 passed |
| `vitest packages/experimental/client-ui-agent-team/tests` | 31 passed |
| `vitest packages/client/ui-settings-general/tests` | 61 passed, 28 pre-existing failures |
| `verify-client-ui-i18n` (admin scope) | 0 violations |

Pre-existing failures confirmed by stashing the changed source and re-running:
`ui-settings-general/tests/apply.client.spec.ts` (26) and
`settings-root.client.spec.tsx` (9) fail identically without these edits.
The rail test (`keeps Profile and My DNA in the navigation rail`) passes.

## Not changed

- Backend: `billing.ts`, `affiliate-processor.ts`, `paypal-payout.ts`,
  `payout-executor.ts`, Stripe, Supabase, PayPal calls.
- Migrations `052`/`053`, database schemas.
- Cloudflare Tunnel `config.yml`, DNS, Zero Trust, nginx/apache/hestia.
- Ports, processes, systemd units, deploy scripts.
- i18n lookup logic (`getActiveLocale`, `t`, storage keys).
- Click, navigation, and loading behavior of every component above.
