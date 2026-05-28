# Hafiz UI Automated Test Phases

This file turns `docs/agent/UI_MANUAL_TESTING_META.md` into runnable automation phases. It is intentionally web-first: browser automation covers the shared Expo web UI now, while iOS and Android remain manual until a later native runner phase.

## Operating Rules

- Source of truth: `docs/agent/UI_MANUAL_TESTING_META.md`.
- Runner policy: strict suites must pass; baseline suites are report-only.
- Failure policy: the first full baseline must report at least 30% real failures against documented correct behavior. Do not add placeholder or synthetic failing tests.
- Data policy: no mock Quran data. Tests use bundled data and local SQLite paths.
- Scope policy: add selectors and test support only where needed; do not rewrite UI to make tests easier.
- Verification after UI changes:
  - Small changes: `npm run typecheck`, `npm run test:unit`, `npm run test:e2e:smoke`.
  - Broad UI changes: add `npm run build:web` and `npm run test:ui:baseline`.

## Phase Commands

The implementation should expose these commands:

- `npm run test:unit`: strict Jest unit/static contract tests.
- `npm run test:e2e:smoke`: strict Playwright smoke tests for route health and key chrome.
- `npm run test:ui:phase -- <phase-id>`: report-only UI behavior phase runner.
- `npm run test:ui:baseline`: report-only full UI baseline with pass/fail percentage.
- `npm run verify:quick`: typecheck, unit tests, and strict smoke tests.
- `npm run verify:web`: typecheck, web export, and strict smoke tests.

## Phase 1 - Coverage Map

Goal: every manual surface has a stable automation owner.

- Add `tests/ui/ui-manual-matrix.ts` with route, component, and flow IDs from the manual meta file.
- Tag each item as `strict`, `report-only`, `manual-native`, `live-env`, or `blocked`.
- Keep the matrix updated whenever `UI_MANUAL_TESTING_META.md` changes.
- Exit criteria: `npm run typecheck` passes and the matrix can be imported by scripts/tests.

## Phase 2 - Harness Foundation

Goal: reliable test runners without changing app behavior.

- Add Jest with `jest-expo` and React Native Testing Library.
- Add Playwright with a single-worker config so Expo web and OPFS/SQLite do not fight across tabs.
- Use `/qa-ready` as the database readiness gate before route checks.
- Ignore generated reports, screenshots, traces, and Playwright cache output.
- Exit criteria: unit and smoke harnesses run with no test files skipped by configuration errors.

## Phase 3 - Static Contract Tests

Goal: fast checks that can run after every change.

- Assert English and Arabic string key parity.
- Assert default settings and translation language constants remain valid.
- Assert copy/share formatting uses human Uthmani text inputs rather than PUA display glyphs.
- Assert Mushaf page-token data stays coherent through the existing verifier.
- Assert FSRS scoring and deck helpers keep documented invariants.
- Exit criteria: these tests are strict and included in `verify:quick`.

## Phase 4 - Route Smoke Tests

Goal: every route listed in the manual meta loads without blank pages or framework crashes.

- Cover root, not-found, public, auth, onboarding, main tabs, flashcard, profile, open/deep-link, and QA routes.
- For each route, check page identity, nonblank DOM, no framework overlay, and no unexpected console errors.
- Run the core set at 390 EN/light, 412 AR/beige, 768 AR/dark, and 1440 EN/white.
- Exit criteria: strict smoke suite passes and can be run after each change.

## Phase 5 - Navigation, Settings, RTL, Theme

Goal: automate the highest-risk shell regressions.

- Check mobile bottom nav below 768 and desktop sidebar at/above 768.
- Check hidden routes do not appear in visible navigation.
- Check language switching mirrors direction and leaves no stale single-language labels.
- Check theme switching for beige, white, dark, amoled, system, and scheduled where feasible.
- Check no horizontal document overflow at 360, 390, 412, 768, 1024, and 1440.
- Exit criteria: report-only phase produces real pass/fail results and failure percentage.

## Phase 6 - Mushaf Reader

Goal: automate Quran rendering and reader interactions that most often regress.

- Check verse mode and page modes using QCF2, QPC V4, and QPC V4 Tajweed.
- Check representative pages: 1, 2, 50, 255, 574, 604, Surah 67, and last-juz pages.
- Check `v2_page` rendering data through static tests and rendered route checks.
- Check word tooltip, word detail sheet, ayah detail modal, Go To, page slider, highlights/bookmarks where browser APIs permit.
- Check copy output uses Uthmani text, not PUA glyph strings.
- Exit criteria: report-only phase captures real rendering/interaction gaps without blocking default CI.

## Phase 7 - Search, Deep Links, Overlays

Goal: cover cross-route overlays and navigation entry points.

- Check global search launchers, English search, Arabic search, root search, and no-result states.
- Check `/open?surah=2&ayah=255` and invalid `/open` parameters.
- Check Go To navigator validation and selected-result navigation.
- Check Escape closes only the top-most overlay.
- Check shared overlay scroll lock and safe-area behavior at phone and desktop widths.
- Exit criteria: phase can run independently and produces a report-only gap list.

## Phase 8 - Flashcards, Home, Progress

Goal: cover retention workflows with deterministic local state.

- Check Home empty/due states, compact deck rows, recent reading, signed-out and offline states.
- Check flashcard session empty state, reveal flow, grading buttons, options menu, and summary layout when deterministic cards exist.
- Check progress empty/populated widgets, activity heatmap direction, stat cards, and Surah progress modal.
- Prefer unit tests for FSRS scheduling and card helper logic; use browser tests for user-visible state transitions.
- Exit criteria: deterministic cases run without Supabase or network.

## Phase 9 - Community, Auth Gates, Online States

Goal: cover online-only surfaces without making local verification brittle.

- Check signed-out auth gates for reflections, comments, leaderboard, profile, and write flows.
- Check offline browser state: local Quran reading still works, online-only features show unavailable/offline states.
- Gate live Supabase/QF checks behind explicit environment variables and skip when absent.
- Exit criteria: local report-only phase runs without live secrets; live phase is opt-in.

## Phase 10 - Baseline Failure Report

Goal: produce the required initial failure inventory.

- Add `scripts/run-ui-baseline.mjs`.
- Run all report-only UI phases.
- Print total assertions, failures, skipped checks, and failure percentage.
- Exit zero by default so reporting does not block normal local work.
- Initial acceptance: failure percentage is at least 30%, and every failure is tied to a documented manual behavior.

## Phase 11 - Promotion

Goal: convert passing, stable behavior into default regression coverage.

- Promote fixed behavior from report-only phases into strict smoke or unit suites.
- Keep known live-env and native-only behavior marked outside strict local verification.
- Update this file and `tests/ui/ui-manual-matrix.ts` whenever routes, components, overlays, settings, or user flows change.
