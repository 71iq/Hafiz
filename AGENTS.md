# Hafiz

Offline-first Quran memorization app at hafizquran.app, built with Expo Router and React Native for web, Android and iOS. Read package.json and current source for installed versions and commands.

## What must remain true

Quran content must remain accurate. Reading and local progress must work offline. Optional account sync must preserve the user's data and ownership. Arabic and English, touch and keyboard, web and native are part of the same product contract.

Choose simple ownership over more layers. Reuse the established feature component or platform adapter before adding another wrapper. Derive values instead of maintaining duplicate state, and reserve React effects for external synchronization or genuine lifecycle work. Keep domain logic testable without making local reading depend on the network.

## Project map

- app/ owns routes and layouts. components/ owns feature UI and components/ui/ owns reusable controls.
- lib/ owns the local database, sync, themes, bilingual strings, navigation and platform adapters.
- assets/data/ contains protected datasets and a generated Quran database. supabase/ contains schema, migrations and functions.
- tests/ and scripts/ contain focused checks. Generated dist/, public/data/ and native build output are not source edits.
- `user cases.md` lists user-facing behavior. docs/feature-tree.json maps each screen, widget, transition and shared flow to those cases; docs/feature-tree.md explains its fields.

Check the active branch and worktree before edits. Preserve the existing AppNavigation.tsx change in the original checkout. Modernization work has a separate checkout and runbook. Work there only when the task selects it, and follow its local instructions without merging or publishing it as incidental setup work.

## Product and content constraints

Keep local reading independent of network services. Preserve sync IDs, timestamps, soft deletes and conflict semantics. Read the affected local schema, server policies and sync callers before changing persistence.

Quran text, identifiers, verse/word positions, page mappings, Arabic assets, fonts and generated databases need explicit data-change authorization. Preserve licenses in NOTICE.md. Copy/share Unicode Quran text, not display glyph data such as text_qcf2. Preserve v2_page and page-font navigation. A page source replacement requires validation of all 604 pages. Runtime assets need both native require maps and web copy/fetch handling.

Use existing components/ui/ controls and ResponsiveOverlay. Preserve dismissal, focus restoration, scrolling, safe areas and keyboard avoidance. Use semantic theme tokens. Fix overflow through sizing and wrapping rather than shrinking typography unless requested.

Arabic RTL and English LTR are first-class. Put changed user-facing strings in both locales. Use lib/ui/viewport.ts for responsive checks. Expand themes, locales and input checks when the change affects them. Theme-sensitive work covers light/white, beige, dark, AMOLED and system behavior.

## Trace the whole affected flow

Before finishing behavior changes, identify which of these paths apply:

- Entry points include tab navigation, the reader, search results, bookmarks and cold/warm deep links. Check the shared navigation helper rather than fixing only one caller.
- Clients include Expo web, Android and iOS. Separate platform files can implement the same contract differently. Verify the affected platform and state any untested target.
- Locales include Arabic RTL and English LTR. Check direction-sensitive ordering, gestures and translated strings where the change affects them.
- State includes startup, loading, empty/error recovery, offline use, account restore, reconnect and app resume. Persisted state must survive reload without accepting stale asynchronous results.
- Account work includes local SQLite, optional remote sync and the returned UI state. Check the intended merge/restore policy and cross-user isolation before changing it.

Update docs/feature-tree.json in the same change when you add, remove, rename, merge or split a screen, widget, transition or shared flow, or move a user case. tests/unit/feature-tree.test.ts checks it against `user cases.md`.

## Local development and focused checks

Read package.json before choosing commands. npm run start starts Expo; npm run web starts the web client. npm run android and npm run ios run native targets and can rebuild/install them, so inspect the target first and preserve the installed app's data.

Use npm run test:unit -- --runTestsByPath <test-file> for the nearest Jest case, npm run typecheck for type and import changes, and npm run build:web for the static export. The test:ui:phase script selects report-only UI contract phases. It can exit 0 after Playwright test failures. Inspect its failure summary and report; exit code 0 alone is not a passing check. Aggregate verify scripts can repeat exports, so inspect their constituents and reuse checks already passed.

npm run format writes across the project. Prefer targeted formatting for scoped edits. npm run build:db regenerates protected Quran data and requires an authorized data-pipeline task. Use the existing ESLint/Prettier configuration rather than introducing a second style policy.

## Production

Before infrastructure, deployment or database operations, read docs/hetzner-migration.md and the relevant deploy/hetzner/ files. Production is a static Expo export served by Caddy with its own self-hosted Supabase stack. Keep database, storage, keys and service configuration separate from ElPsyCongroo. Former Vercel and Supabase Cloud projects are retired. Follow the private administrator procedure rather than old cloud links or invented CLI workflows. Keep secret keys server-side and use only intended public values in client bundles.

## Verification and delivery

Choose checks from package.json that can catch the actual regression. Documentation and agent setup need path/instruction validation and git diff --check. Localized source work needs the nearest meaningful check. Add typecheck for changed types, imports or logic. Shared navigation, data pipelines, database or configuration changes need relevant tests and npm run build:web. Avoid repeating constituents through aggregate commands.

For visible behavior use ui-visual-verification, and for native behavior use react-native-skills. Exercise the affected state with sanitized fixtures. Report browser and native evidence separately. Device work must preserve the installed app and its data.

Review the full scoped diff and preserve unrelated work. For completed product changes, commit and push the current branch unless the task or runbook says otherwise. Local agent-environment maintenance stays local unless publication is requested. Verify remote HEAD after a product push. Report changed behavior, checks and material unverified areas concisely.

## Safe development and documentation

Use sanitized, isolated fixtures for writes. Never point a preview, migration experiment or reset command at production. Preserve other checkouts and services. Stop only processes you started and whose PID you recorded, not processes selected by a broad name or path match.

For a logic or state bug, prefer a focused regression that fails for the original cause and passes with the fix. Extend an existing case where it fits. Test the owning behavior at one useful layer; add integration coverage only for a boundary that can fail independently. Pure spacing or color fixes need rendered evidence, not tests that mirror markup. Do not stack unrelated full suites or repeat equivalent checks.

Document durable constraints and the reasons a future maintainer would miss. Update the existing paragraph when a decision changes. Keep temporary plans, research notes, review ledgers and PR evidence outside the repository. User-facing documentation explains the user's task without contributor tooling or implementation details.

AGENTS.md is the canonical project guide. CLAUDE.md imports it. Keep project rules in this file and shared personal workflows in ~/.agents/skills. Use council when requested; its model order and review gate live in that skill, not in project copies.
