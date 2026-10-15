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

Android SDK 36, ADB, and Java are available. No connected device was listed. Android compilation was launched separately; see PROGRESS for the actual result. Linux cannot run Xcode or an iOS simulator, and no iOS build passed here. No cloud build or paid service was started. Browser smoke and native runtime verification must have their own outcomes recorded, independently of the web export.
