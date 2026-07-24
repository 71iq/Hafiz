# AGENTS.md — Hafiz

These instructions apply to the repository unless a more specific nested `AGENTS.md` exists.

## Project and repository map

Hafiz is an early-preview Quran memorization and retention app: Mushaf reading, reflection, word study, tafsir, translations, private notes, review scheduling, and optional account sync.

- The root package declares no npm workspaces. The app targets static web, Android, and iOS through Expo Router.
- Core stack: Expo SDK 55, React Native 0.83, React 19, strict TypeScript, NativeWind/Tailwind, Expo SQLite, Zustand, TanStack Query, Jest, Playwright, and optional Supabase services.
- `app/`: Expo Router screens and route layouts. `app/_layout.tsx` owns root providers; `app/(tabs)/_layout.tsx` owns settings, chrome, and tab navigation.
- `components/`: feature UI. Reuse `components/ui/` primitives before adding new controls; Mushaf-specific UI is under `components/mushaf/`.
- `lib/`: domain logic, local database, settings/themes, i18n, navigation helpers, sync, Supabase, Quran Foundation integrations, and platform adapters.
- `assets/`: bundled images, fonts, Quran datasets, tafsir/translations, and the generated runtime SQLite database. Treat third-party content and generated data as protected inputs, not ordinary source code.
- `scripts/`: build, data-generation, verification, and deployment helpers.
- `supabase/`: server schema, migrations, and Edge Functions; this is infrastructure code.
- `tests/`: Jest unit/contract tests, RTL registries, and Playwright smoke/report-only suites.
- `android/`: committed Expo-generated native project. Prefer Expo/config-level changes unless the task is specifically native.
- Generated or ignored output includes `dist/`, `.expo/`, `public/data/`, `test-results/`, `playwright-report/`, `web-build/`, and `supabase/.temp/`. Do not edit or commit it.
- If `quran.com-frontend-next/` exists locally, treat it as excluded reference code; it is not part of Hafiz typecheck, lint, or formatting scope.

## Important entry points

- Routes/providers: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`.
- Main reader: `app/(tabs)/mushaf.tsx` and `components/mushaf/`.
- Shared navigation/layout: `components/ui/AppNavigation.tsx`, `components/ui/ScreenContent.tsx`, `lib/ui/viewport.ts`, and `lib/ui/chrome.tsx`.
- Responsive overlays: `components/ui/ResponsiveOverlay.tsx`; use its overlay/header/body/footer variants instead of creating ad hoc modals or sheets.
- Themes: `lib/settings/context.tsx`, `tailwind.config.js`, and `global.css`. Use existing semantic surface/accent tokens and theme definitions.
- Bilingual strings/direction: `lib/i18n/strings.ts`, `lib/i18n/useStrings.ts`, and `lib/ui/direction.tsx`.
- Local Quran database: `lib/database/provider.tsx`, `lib/database/init.ts`, `lib/database/native-loaders.*`, and `lib/database/schema.ts`.
- Quran navigation/mapping: `lib/mushaf/` and the Mushaf components; preserve established surah, ayah, word-position, page, juz, and hizb mappings.
- Supabase client/sync: `lib/supabase.ts`, `lib/sync/`, `supabase/schema.sql`, `supabase/migrations/`, and `supabase/functions/`.

## Verified commands

Install and development:

- `npm install` — install dependencies; postinstall runs the React Native Gradle fix and `patch-package`.
- `npm run start` — start Expo.
- `npm run web` — start Expo web with dev tools disabled.
- `npm run android` — run the Android native project.
- `npm run ios` — run the iOS native project.

Checks and tests:

- `npm run typecheck` — strict TypeScript check, no emit.
- `npm run lint` — ESLint over JS/JSX/TS/TSX.
- `npm run format` — Prettier write mode; this modifies files, so use intentionally.
- `npm run test:unit` — Jest tests under `tests/`, serial execution.
- `npm run test:e2e:smoke` — build web, serve `dist/`, then run the Chromium smoke flow.
- `npm run test:ui:phase -- <provider-boundaries|responsive-overflow|route-inventory|rtl-ui-contract|sync-contract|ui-contract|all>` — targeted report-only Playwright suite.
- `npm run test:ui:rtl` — RTL UI contract at the 390 px Chromium project.
- `npm run test:ui:baseline` — full report-only UI baseline.
- `npm run verify:quick` — typecheck, unit tests, and Chromium smoke test.
- `npm run verify:web` — typecheck, web export, and smoke test.

Build and data:

- `npm run build:web` — production static Expo export to `dist/`; `prebuild:web` prepares runtime data in ignored `public/data/`.
- `bash scripts/vercel-build.sh` — deployment-equivalent web build with Vercel/Supabase environment mapping.
- `npm run validate:reflection-journey` — validate the reflection journey dataset.
- `npm run build:db` — regenerate `assets/data/quran.db`; do not run unless the task explicitly concerns the data pipeline and the resulting database change is intended.
- No repository-defined Supabase start/reset/push/deploy command or checked-in `supabase/config.toml` is present. Do not invent a Supabase workflow; follow an explicitly provided project procedure.

## Engineering workflow

1. Start with `git status --short` and inspect the related route, component, utility, tests, and recent implementation patterns. Do not overwrite unrelated user changes.
2. Identify the root cause before applying a nontrivial fix. Prefer the smallest coherent patch that addresses it.
3. Reuse existing components, utilities, data access patterns, responsive breakpoints, and theme tokens before creating abstractions.
4. Avoid unrelated refactors, broad formatting, dependency additions, or behavior changes outside the request. Add a dependency only when existing platform APIs and packages cannot reasonably solve the task.
5. Preserve offline-first behavior and web/native compatibility. Do not make local reading features depend on Supabase or another network service.
6. Use `@/` imports from the repository root. ESLint and Prettier are authoritative; do not hand-format protected datasets.

## UI and UX requirements

- Arabic RTL and English LTR are first-class modes. Add user-facing text to both locales and keep direction-sensitive alignment, icon order, gestures, and navigation correct.
- For affected UI, check phone widths, tablet/iPad behavior, and desktop layouts using the shared viewport contract in `lib/ui/viewport.ts`.
- Preserve React Native, web, and native/WebView interaction behavior. Avoid web-only fixes that break touch/native and native-only fixes that regress keyboard/mouse use.
- Use `ResponsiveOverlay` and existing overlay primitives. Preserve backdrop dismissal, Escape handling, body-scroll locking, keyboard avoidance, focus restoration, and safe-area spacing.
- Do not fix layout overflow by shrinking typography unless the request explicitly calls for smaller text. Correct sizing, wrapping, spacing, or container behavior instead.
- Use semantic theme colors and existing palettes. Verify light/white, beige, dark, AMOLED, and system behavior when theme-sensitive code changes.
- When relevant, verify accessibility labels/states, contrast, keyboard and focus behavior, touch targets, scrolling, safe areas, and reduced viewport height.

## Quran content and generated-data safety

- Do not modify Quran text, verse identifiers, surah/ayah/word positions, page mappings, Arabic assets, fonts, databases, or generated/imported content unless the task explicitly authorizes a data correction or pipeline change.
- Do not manually reformat `assets/data/**`; it is excluded from Prettier. Preserve source attribution and licenses in `NOTICE.md`.
- `assets/data/quran.db` is generated from schema and source datasets. A regenerated binary must be intentional and reviewed with its source changes.
- Quran display glyph data such as `text_qcf2` is display-specific; copying/sharing must continue to use Unicode Quran text such as `text_uthmani`.
- Preserve `v2_page` and the established page-font/navigation mappings. Do not substitute another page source without validating all 604 pages and navigation behavior.
- Runtime data has separate native require maps and web copy/fetch paths. When explicitly adding a runtime asset, update both sides and add verification; never silently omit one platform.

## Supabase and database safety

- Inspect `supabase/schema.sql`, existing migrations, RLS policies, local SQLite schema, and sync code before changing database behavior.
- Prefer a reviewed migration over undocumented dashboard/manual schema changes. Keep stable IDs, timestamps, soft-delete semantics, and sync conflict behavior intact.
- Never commit `.env`, `.env.local`, credentials, signing material, service-role keys, or Edge Function secrets. Only `EXPO_PUBLIC_*` values intended for clients may enter client bundles.
- Do not run destructive SQL, reset databases, drop tables, delete migrations, rewrite production data, or deploy functions without explicit authorization.

## Minimum verification

- Documentation-only: re-read changed instructions against current files, validate every path/command, and review the diff. State that application checks were not run.
- TypeScript or logic: `npm run typecheck`, `npm run lint`, and the relevant Jest test(s); run the full unit suite for cross-cutting changes.
- UI: TypeScript/lint plus relevant unit/contract tests, then browser verification of the changed behavior. Check Arabic/English, RTL/LTR, affected responsive widths, relevant themes, keyboard/mouse, and touch behavior.
- Configuration, data pipeline, database, navigation, or cross-cutting changes: run relevant unit tests and `npm run build:web`; use `npm run verify:quick` or `npm run verify:web` when scope warrants it.
- Native-specific changes: verify the affected native target when the environment permits. Never claim native verification from a web-only check.
- Clearly report every skipped, blocked, or unavailable check and the resulting risk.

## Git and completion rules

- Review `git diff --check`, `git diff --stat`, and the full task diff before finishing. Keep lockfile and generated-file changes intentional.
- Do not revert unrelated changes. Do not amend, commit, push, rebase, reset, force-update, delete files, or clean the worktree unless explicitly requested.
- Final response must include: root cause or implementation rationale; files changed; concise behavioral summary; commands/tests run; manual verification performed; and remaining risks or unverified areas.
