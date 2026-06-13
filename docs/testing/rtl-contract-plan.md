# Hafiz RTL Contract Test Plan

This plan is aligned to the current Hafiz repo as of this pass. It replaces the earlier broad draft with an implementation sequence that fits the existing Jest, Playwright, provider, and component structure.

The product rule remains:

**Mirror layout, not content.**

Rows, tabs, controls, overlay chrome, form chrome, menus, and action placement should mirror. Qur'an text, QCF/PUA glyphs, provider logos, brand marks, page images, and neutral icons should not be mirrored.

## Current Repo Facts

- Unit tests use `jest-expo` through `jest.config.js`.
- Jest already matches `tests/**/*.test.ts` and `tests/**/*.test.tsx`, excluding `tests/e2e`.
- The current unit tests live in `tests/unit` and are mostly source/data contract tests.
- `@testing-library/react-native` is installed, but there are currently no RNTL component render tests.
- `tests/jest/setup.ts` only mocks `react-native/Libraries/Animated/NativeAnimatedHelper`.
- Playwright tests live under `tests/e2e`.
- Strict route smoke is `tests/e2e/smoke.spec.ts`.
- Report-only UI checks live under `tests/e2e/report-only`.
- Shared Playwright helpers already exist in `tests/e2e/helpers.ts`: `captureConsole`, `waitForQaReady`, and `assertHealthyPage`.
- `scripts/run-ui-phase.mjs` owns report-only phase routing; a new RTL report-only spec needs to be added there if it should run through `npm run test:ui:phase -- rtl-ui-contract`.
- `tests/ui/ui-manual-matrix.ts` and `docs/agent/UI_MANUAL_TESTING_META.md` already provide a maintained route/component/flow inventory.
- Direction state is already centralized in `lib/ui/direction.tsx` through `DirectionProvider`, `useUIDirection`, and `textAlignForDirection`.
- `SettingsProvider` in `lib/settings/context.tsx` wraps children in `DirectionProvider` based on `uiLanguage === "ar"`.
- Web Arabic mode can be seeded before app boot through `localStorage.hafiz_ui_language = "ar"`.
- Several primitive components already accept a `dir` prop or read `useUIDirection`: `Button`, `Text`, `Field`, `FormTextField`, `Input`, `ToggleGroup`, `ResponsiveOverlay`, and `AuthScreenShell`.
- Many higher-level components depend on Settings, Database, TanStack Query, Expo Router, Supabase state, safe-area, Modal, FlatList/FlashList, fonts, or web-only DOM behavior. They should not be the first RNTL targets.

## Files To Create Or Edit Later

No files besides this plan should be edited in the current planning pass.

When implementation starts, use this file list.

### Create

```text
tests/rtl/rtl-contract-types.ts
tests/rtl/rtl-component-registry.ts
tests/rtl/rtl-style-allowlist.ts
tests/rtl/rtl-test-utils.tsx
tests/unit/rtl-style-contract.test.ts
tests/unit/rtl-component-registry-coverage.test.ts
tests/unit/rtl-component-contracts.test.tsx
tests/e2e/report-only/rtl-ui-contract.spec.ts
docs/testing/rtl-contract.md
```

### Edit

```text
tests/e2e/helpers.ts
scripts/run-ui-phase.mjs
tests/jest/setup.ts
package.json
docs/agent/UI_MANUAL_TESTING_META.md
tests/ui/ui-manual-matrix.ts
```

Edit notes:

- `tests/e2e/helpers.ts`: add reusable helpers only if they are shared by more than the RTL spec, such as no-overflow and framework-overlay assertions.
- `scripts/run-ui-phase.mjs`: add a `rtl-ui-contract` phase entry.
- `tests/jest/setup.ts`: add mocks only as component tests require them. Start without broad mocks.
- `package.json`: do not add a Jest `test:rtl` script at first. `npm run test:unit` already picks up `tests/unit/rtl-*.test.ts(x)`. Add `test:ui:rtl` only if the RTL Playwright phase proves useful.
- `docs/agent/UI_MANUAL_TESTING_META.md` and `tests/ui/ui-manual-matrix.ts`: update only when the RTL contract becomes an official maintained UI phase, not during the first source-guard PR.

## Helpers And Providers To Reuse

### Unit/RNTL

- Reuse `DirectionProvider` from `lib/ui/direction.tsx`.
- Reuse `textAlignForDirection` for direct utility tests.
- Prefer explicit component `dir` props for primitive component tests.
- Use the default `useSettings()` context values when a component only reads harmless defaults.
- Avoid wrapping `SettingsProvider` in early tests unless a real settings behavior must be verified. It reads SQLite through `useDatabase()` and creates unnecessary setup friction.
- If a component needs safe-area values, wrap it in `SafeAreaProvider` or add the smallest stable mock in `tests/jest/setup.ts`.
- For React Hook Form components, use real `useForm()` inside a tiny test component rather than mocking `Controller`.
- For Quran font components, mock `lib/fonts/loader` or test source-level invariants first. Do not load page fonts in Jest.

Suggested `rtl-test-utils.tsx` scope:

```text
renderWithDirection(ui, dir)
flattenStyle(style)
getStyleValue(node, key)
expectWritingDirection(node, dir)
expectTextAlignStart(node, dir)
expectFlexDirectionForDir(node, dir)
```

Do not try to prove real visual bounding boxes in RNTL. NativeWind class names are not computed layout in Jest. Use RNTL for explicit props/styles and Playwright for DOM geometry.

### Playwright

- Reuse `captureConsole`, `waitForQaReady`, and `assertHealthyPage` from `tests/e2e/helpers.ts`.
- Use `page.addInitScript(() => localStorage.setItem("hafiz_ui_language", "ar"))` before loading `/qa-ready` and routes.
- Use existing static export infrastructure from `playwright.config.ts`.
- Use the existing viewport projects instead of defining one-off viewport constants.
- Reuse route coverage ideas from `tests/e2e/smoke.spec.ts` and `tests/e2e/report-only/responsive-overflow.spec.ts`.

## Registry Design

Use a component registry, but align it to this repo's structure.

Do not rely on barrel exports. The repo does not expose every component through a central index. Prefer a file-based inventory built from:

- `components/**/*.tsx`
- selected user-visible route shells in `app/**/*.tsx`
- existing inventory in `docs/agent/UI_MANUAL_TESTING_META.md`

Registry entry shape:

```ts
export type RtlContractType =
  | "direction-neutral"
  | "app-shell"
  | "tab-segmented"
  | "overlay"
  | "button"
  | "form-field"
  | "card"
  | "quran-text"
  | "picker-menu"
  | "feedback"
  | "progress-chart"
  | "mushaf-reading"
  | "media-preview";

export type RtlComponentRegistryEntry = {
  path: string;
  contract: RtlContractType;
  testLevel: "source" | "rntl" | "playwright" | "manual";
  notes: string;
};
```

Coverage test behavior:

- Scan PascalCase `.tsx` component files under `components`.
- Compare by file path, not export name.
- Allow a small ignore list for files listed in the manual inventory but not present in the repo, such as stale references.
- Fail when a new component file appears without a registry entry.
- Keep route files out of the initial blocking registry unless they are stable shell components.

## Static RTL Style Guard

Add `tests/unit/rtl-style-contract.test.ts` to scan source for physical direction styles/classes.

Scan these roots first:

```text
components
app
lib/ui
```

Flag likely UI layout usage of:

```text
marginLeft
marginRight
paddingLeft
paddingRight
borderLeft
borderRight
left:
right:
textAlign: "left"
textAlign: "right"
textAlign: 'left'
textAlign: 'right'
ml-
mr-
pl-
pr-
left-
right-
text-left
text-right
rounded-l
rounded-r
border-l
border-r
origin-left
origin-right
```

Important current-state adjustment:

- This repo already contains many intentional `isRTL ? "right" : "left"` and `isRTL ? "row-reverse" : "row"` patterns.
- The guard must distinguish physical hardcoding from direction-aware branching.
- Start by failing only unconditional physical styles/classes.
- Use allowlist entries with `file`, `pattern`, and `reason`.
- Keep the allowlist close to the scanner in `tests/rtl/rtl-style-allowlist.ts`.

Valid exception categories:

- QCF/Qur'an glyph layout invariants: `direction: "ltr"` plus `flexDirection: "row-reverse"`.
- Canvas/Rive/internal coordinate positioning.
- Absolute overlay measurement where coordinates come from `measureInWindow`.
- Browser/DOM test harness code.
- Direction-aware ternaries that intentionally choose physical values by `isRTL` or `dir`.

## Components To Test First

These are realistic first targets because they are small, exported, and already direction-aware.

### Phase 1 RNTL targets

```text
components/ui/Text.tsx
components/ui/Button.tsx
components/ui/Field.tsx
components/ui/FormTextField.tsx
components/ui/Input.tsx
components/ui/ToggleGroup.tsx
components/ui/Progress.tsx
lib/ui/direction.tsx
```

Expected checks:

- `Text` aligns start for LTR and RTL.
- `Button` adds row reversal in RTL and keeps press transform non-mirroring.
- `Field`, `Label`, and `FieldMessage` align start and set writing direction.
- `FormTextField` passes `dir` to `Field`, `Input`, and `FieldMessage`.
- `Input` aligns text start, sets writing direction, and reverses start/end icon chrome.
- `ToggleGroup` sets row versus row-reverse based on direction.
- `Progress` has an explicit contract. If it does not fill from inline-start yet, record it as an implementation gap rather than faking a passing test.
- `textAlignForDirection` keeps `start`, `center`, and `end` stable.

### Phase 1 source-only targets

```text
components/mushaf/MushafPage.tsx
components/mushaf/AyahBlock.tsx
components/flashcards/Qcf2AyahText.tsx
components/mushaf/PageMushaf.tsx
components/mushaf/WordToken.tsx
```

Expected checks:

- QCF/Qur'an word containers keep `direction: "ltr"` and `flexDirection: "row-reverse"` where required.
- Quran glyph display does not use `scaleX(-1)`.
- Copy/share paths should remain outside PUA display tests.

### Good second-wave RNTL targets

```text
components/ui/ResponsiveOverlay.tsx
components/ui/ConfirmDialog.tsx
components/ui/DropdownMenu.tsx
components/auth/AuthScreenShell.tsx
components/mushaf/MushafIndicator.tsx
components/mushaf/FontSizeControl.tsx
components/mushaf/JuzNameText.tsx
```

These need safe-area, modal, settings defaults, window dimensions, or icon assertions, but they are still manageable.

### Defer from early RNTL

```text
components/mushaf/MushafSlider.tsx
components/mushaf/PageMushaf.tsx
components/mushaf/WordDetailSheet.tsx
components/mushaf/AyahDetailModal.tsx
components/mushaf/GoToNavigator.tsx
components/mushaf/BookmarksSheet.tsx
components/mushaf/RecitationRangeSheet.tsx
components/reflections/*.tsx
components/profile/*.tsx
components/flashcards/Deck*.tsx
components/flashcards/SmartDeckFilterSheet.tsx
components/auth/OAuthButtons.tsx
components/zayt/*.tsx
```

Reasons:

- Database/query dependencies.
- Supabase/auth feature flags.
- Portal/Modal behavior.
- FlatList/FlashList behavior.
- Web-only measurement.
- Font loading.
- Rive/native assets.
- OAuth provider logos and environment-dependent null rendering.

Cover these with source contracts and Playwright report-only checks first.

## Playwright RTL Report-Only Scope

Create `tests/e2e/report-only/rtl-ui-contract.spec.ts`.

Initial route set:

```text
/qa-ready
/auth/login
/auth/signup
/home
/mushaf
/settings
/progress
/leaderboard
/flashcards
/profile
```

Setup:

```text
1. Create a shared page.
2. Add an init script that sets localStorage.hafiz_ui_language = "ar".
3. Visit /qa-ready and wait for QA_READY.
4. Visit each route.
5. Reuse existing health/console checks.
```

Initial assertions:

- route is nonblank
- no framework error overlay
- no unexpected console/page errors
- document has no horizontal overflow
- `html`, `body`, or app root resolves to RTL where the route supports Settings
- forms have right/start-aligned labels or inputs on auth routes
- tab/sidebar/mobile navigation renders without overflow
- Mushaf route does not apply horizontal mirror transforms to Quran content

Do not add visual snapshots. Use computed styles, text direction, class/style attributes, and bounding boxes.

## Blocking Versus Report-Only

Initial blocking in `npm run test:unit`:

- direction helper tests
- registry coverage for component file paths
- conservative static physical-direction guard
- primitive RNTL contracts for `Text`, `Button`, `Field`, `Input`, and `ToggleGroup`
- source-level Quran no-mirror invariants

Initial report-only:

- full route RTL layout checks
- horizontal overflow in Arabic mode
- overlay geometry
- Mushaf slider/navigation behavior
- charts/grids
- OAuth/provider logo checks
- complex database-backed sheets

Promote checks from report-only to blocking only after they are stable across local static export and CI-like runs.

## Risks

- Static scanning can produce noisy failures because existing code uses many physical values behind `isRTL` ternaries. Start conservative.
- RNTL does not compute NativeWind classes into real layout. Assert explicit styles/props and class tokens, not pixel geometry.
- `SettingsProvider` reads SQLite and should not be the default unit-test wrapper.
- Some routes read cached language directly from `localStorage`, while tab routes read settings through `SettingsProvider`; Playwright setup must seed localStorage before app boot.
- Modals, portals, safe-area, Animated, and FlatList/FlashList may require targeted mocks. Do not add broad mocks until a real test needs them.
- `OAuthButtons` can render `null` when Supabase is not configured; do not make it an early required component test.
- Quran page fonts should not load in Jest. Mock loaders or test source invariants.
- `Progress` currently has no direction prop, so a true RTL fill contract may expose an implementation gap.
- Registry coverage based only on export parsing will miss components because the repo has no complete barrel export model.
- Report-only Playwright still builds the web export; failures may come from build/data setup rather than RTL behavior.

## Phased Todo List

### Phase 0: Plan Alignment

- [x] Read `docs/testing/rtl-contract-plan.md`.
- [x] Inspect Jest, Playwright, test helpers, providers, direction utilities, and component structure.
- [x] Rewrite this plan to match the current repo.
- [x] Do not edit implementation or test files in this phase.

### Phase 1: Source Contracts And Registry

- [x] Create RTL contract types, registry, and allowlist under `tests/rtl`.
- [x] Add `tests/unit/rtl-component-registry-coverage.test.ts`.
- [x] Add `tests/unit/rtl-style-contract.test.ts`.
- [x] Reuse existing fs/source-test style from `tests/unit/font-and-viewport-contract.test.ts`.
- [x] Keep the scanner conservative and document every allowlist reason.
- [x] Run `npm run test:unit` (RTL tests pass; full suite is blocked by unrelated public-page/manual-inventory failures).

### Phase 2: Primitive RNTL Contracts

- [x] Add `tests/rtl/rtl-test-utils.tsx`.
- [x] Add `tests/unit/rtl-component-contracts.test.tsx`.
- [x] Start with `Text`, `Button`, `Field`, `FormTextField`, `Input`, and `ToggleGroup`.
- [x] Add only the required mocks to `tests/jest/setup.ts`.
- [x] Record discovered implementation gaps instead of overfitting tests (no primitive implementation gaps found).
- [x] Run `npm run typecheck` and `npm run test:unit` (RTL tests and typecheck pass; full suite is blocked by unrelated public-page/manual-inventory failures).

### Phase 3: Quran Source Invariants

- [ ] Extend unit/source tests for QCF/Qur'an no-mirror behavior.
- [ ] Cover `MushafPage`, `AyahBlock`, `Qcf2AyahText`, and `PageMushaf`.
- [ ] Assert required `direction: "ltr"` plus `flexDirection: "row-reverse"` cases remain intact.
- [ ] Assert no Quran content uses horizontal mirror transforms.
- [ ] Run `npm run test:unit`.

### Phase 4: Playwright RTL Report-Only

- [ ] Add `tests/e2e/report-only/rtl-ui-contract.spec.ts`.
- [ ] Seed `hafiz_ui_language=ar` before app boot.
- [ ] Reuse `waitForQaReady`, `captureConsole`, and `assertHealthyPage`.
- [ ] Add RTL/no-overflow helpers to `tests/e2e/helpers.ts` only if shared.
- [ ] Add `rtl-ui-contract` to `scripts/run-ui-phase.mjs`.
- [ ] Optionally add `test:ui:rtl` to `package.json`.
- [ ] Run `npm run build:web`.
- [ ] Run `npm run test:ui:phase -- rtl-ui-contract`.

### Phase 5: Higher-Level Components

- [ ] Add second-wave RNTL tests for `ResponsiveOverlay`, `ConfirmDialog`, `DropdownMenu`, `AuthScreenShell`, `MushafIndicator`, `FontSizeControl`, and `JuzNameText`.
- [ ] Add source contracts for `Progress`, `AchievementProgressBar`, `ActivityHeatmap`, and chart/grid chronology decisions.
- [ ] Keep database-backed sheets and Supabase-backed surfaces report-only until stable mocks exist.
- [ ] Run `npm run typecheck`, `npm run test:unit`, and relevant UI phase checks.

### Phase 6: Promotion And Documentation

- [ ] Create `docs/testing/rtl-contract.md` from the stable contract.
- [ ] Update `docs/agent/UI_MANUAL_TESTING_META.md` and `tests/ui/ui-manual-matrix.ts` with the official RTL automation phase.
- [ ] Promote stable report-only checks into blocking test scripts only after repeated clean runs.
- [ ] Keep `npm run verify:quick` and `npm run verify:web` behavior intentional.

## Acceptance Criteria

- Every user-visible component file has an explicit RTL contract decision.
- New component files fail registry coverage until classified.
- Unconditional physical left/right styles are caught or allowlisted with reasons.
- Primitive direction behavior is covered by RNTL where it is actually observable.
- Quran/QCF/Mushaf content is protected against horizontal mirroring.
- Arabic web routes can be checked in report-only Playwright without visual snapshots.
- The plan and implementation reuse existing Hafiz test infrastructure instead of creating a parallel test universe.
