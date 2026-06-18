---
name: hafiz-testing
description: Use when writing or running tests, verifying changes, debugging Playwright failures, or interpreting Jest contract test failures in the Hafiz project.
---

# Hafiz Testing Skill

## Default verification path

Start with `npm run typecheck`. Do not start Metro or browser dev servers unless explicitly asked for visual testing.

## Command reference

- `npm run test:unit` — Jest contract tests, runs serially (`--runInBand`).
- `npm run test:e2e:smoke` — builds web, then runs strict Playwright smoke routes.
- `npm run verify:quick` — `typecheck` + `test:unit` + `test:e2e:smoke`.
- `npm run test:ui:phase -- <phase|all>` — focused report-only Playwright suites.
- `npm run test:ui:baseline` — all report-only suites + summary JSON.
- `npm run test:ui:rtl` — RTL UI contract only.

## Important conventions

- **No mock data.** Tests must read real data from `assets/data/`.
- **Bilingual parity.** `tests/unit/i18n-strings.test.ts` enforces en/ar key parity and non-empty values.
- **RTL contracts.** `tests/rtl/` and `tests/unit/rtl-*` define layout rules. Changing UI components may require updating these.
- **Playwright gate.** `/qa-ready` waits for `QA_READY` before navigating in tests. Web DB uses a single OPFS host tab, so keep e2e navigation in one page context or re-enter via `/qa-ready`.
