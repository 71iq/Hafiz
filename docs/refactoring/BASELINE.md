# Modernization baseline

Captured 2026-10-15 from committed `e5020b3` on `codex/hafiz-modernization`. The original `/home/ehab/code/Hafiz` checkout stays on main with its uncommitted AppNavigation change intact. The isolated worktree is `/home/ehab/.codex/worktrees/hafiz-modernization/Hafiz`. No environment files or production credentials were copied.

## Measured checks

| Check                         | Result                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci --no-audit --no-fund` | Passed. Existing CSS interop patch applied. npm reported unapproved install scripts for supabase and unrs-resolver. No blanket approval applied. |
| `npm run typecheck`           | Passed. Strict mode already enabled.                                                                                                             |
| `npm run lint`                | Exit 0, 71 warnings, zero errors.                                                                                                                |
| `npm run test:unit`           | 54 suites passed, three failed. 248 tests passed, three failed, 251 total.                                                                       |
| `npm run build:web`           | Passed. Static output in ignored dist.                                                                                                           |
| `npx expo install --check`    | Failed. Nineteen compatibility mismatches, including ESLint config major 56 against SDK 55.                                                      |
| `npm run diagnose:expo`       | 16 of 20 checks passed. Direct expo-modules-core, duplicate native @expo/log-box, committed-native config drift, package alignment.              |
| `npm run analyze:duplicates`  | 178 authored files scanned. 31 clone groups, 707 duplicated lines, 1.34 percent of 52,887 scanned lines.                                         |
| `npm run analyze:unused`      | Nonzero findings. Eighteen issue-bearing records. Platform variants are known false-positive candidates.                                         |
| `npm run analyze:boundaries`  | 203 modules, 850 dependencies, no reported cycles or configured boundary violations. Web-preferred resolution, not proof of the native graph.    |
| `npm run audit:dependencies`  | 80 advisories at capture. One low, 17 moderate, 60 high, two critical. Counts are dependency findings, not demonstrated production exploits.     |

The full authored JS/TS inventory includes scripts, tests and Edge Functions, plus protected generated TS maps. It contains 288 files and 65,685 lines. `inventory.json` lists the largest modules. The narrower duplication denominator intentionally excludes datasets, generated require/font maps, translations and language-label tables. Report those exclusions with every comparison.

## Pre-existing unit failures

- `rtl-higher-level-source-contract.test.ts` expects a particular `as const` spelling in the progress route. Inspect current direction behavior before replacing this formatting-sensitive assertion with a behavior assertion.
- `rtl-style-contract.test.ts` reports physical `right: 5` in `ThemeColorSwatch.tsx`. Establish whether it is a directional overlay before using `end` or documenting a justified exception.
- `rtl-component-registry-coverage.test.ts` reports ThemeColorSwatch missing from classification. Add the proper rendered fixture and classification, preserving registry coverage.

No tests or rules were disabled to establish this baseline. Source-text tests comprise 32 of the 57 test files; they do not prove runtime behavior.

## Evidence and platform limits

Raw stdout, exit files, scanner JSON, Android output and browser reports live under ignored `.refactor-baseline/`. `analysis-summary.json`, `inventory.json`, and `registry-versions.json` retain scoped summaries in Git. Subsequent results must append to PROGRESS and update this table with dates rather than erase the initial failure record.

Android SDK 36, ADB, and Java are available. No connected device was listed. Android debug compilation passed in 15m55s with 564 tasks executed. No APK was installed. See PROGRESS for evidence. Linux cannot run Xcode or an iOS simulator, and no iOS build passed here. No cloud build or paid service was started. Browser smoke and native runtime verification must have their own outcomes recorded, independently of the web export.

## Comparison after RF-057, 2026-10-16

| Check              | Original capture                   | Current measurement                   |
| ------------------ | ---------------------------------- | ------------------------------------- |
| Full unit suite    | 248 pass, three fail in 57 suites  | 310 pass, zero fail in 61 suites      |
| Duplication        | 31 groups, 707 lines, 1.34 percent | 29 groups, 669 lines, 1.27 percent    |
| Duplication scope  | 178 sources, 52,887 lines          | 179 sources, 52,833 lines             |
| Expo package check | 19 mismatches                      | 19 mismatches, unchanged dependencies |
| Expo Doctor        | 16 of 20 pass                      | 16 of 20 pass, same four findings     |

The duplication command used the same .jscpd.json thresholds and exclusions: datasets, generated require/font maps, translations and language-label tables. The new output is .refactor-baseline/jscpd-after-rf057/jscpd-report.json. Unit and package-check argv, exits and log paths are recorded in .refactor-baseline/checks-after-rf057.json. Doctor output is .refactor-baseline/expo-doctor-after-rf057.log. The frozen analysis-summary.json and initial failures above remain intact. This comparison includes no new browser, physical-device or iOS checks.

## Comparison after RF-067, 2026-10-16

| Check                   | Original capture                              | Accepted measurement                                 |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Full unit suite         | 248 pass, three fail in 57 suites             | 322 pass, zero fail in 62 suites                     |
| Expo package check      | 19 mismatches                                 | One lint-preset mismatch                             |
| Expo Doctor             | 16 of 20 pass                                 | 18 of 20 pass                                        |
| Native dependency graph | Duplicate log-box and direct core declaration | Both Android/iOS graphs pass, zero duplicates        |
| Browser smoke           | Not recorded in the initial table             | 28 installed-Chrome tests pass at 390 by 844         |
| Android debug           | Initial build 15m55s                          | Accepted incremental build 36s, all four ABIs in APK |

The Android times compare different cache states, not runtime performance. The native cold/incremental recovery history is retained in SDK55_ALIGNMENT.md. The final fifteen command records and independent review are .ralph/runs/RF-067-2-1792148137863851616. Primary artifact/hash acceptance is .refactor-baseline/rf067-primary-acceptance.json. Repeated diagnostic argv/exits are expo-install-after-rf067.json and expo-doctor-after-rf067.json under .refactor-baseline. The two remaining Doctor findings are lint-preset compatibility and native/app-config ownership. No diagnostic was excluded. No duplicate scan was repeated for this dependency-only slice; the last measured 29 groups and 669 duplicated lines remain RF-057's snapshot. No iOS build, device installation or native runtime verification ran.

## Test isolation after RF-068, 2026-10-16

The full unit suite passes63suites333tests with normal process exit, versus62suites322tests after RF-067. All five focused controller commands and separate evaluation pass. The six leaderboard open-handle diagnostic tests also exit normally. This test-only slice adds no application behavior, browser/native/device/iOS verification or new duplication measurement. Existing frozen captures above remain intact. Evidence .refactor-baseline/rf068-unit-full.json and rf068-primary-acceptance.json.
