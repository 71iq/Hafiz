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

## Comparison after RF-053, 2026-10-16

The shared account-sync row passed all six controller checks, including15 unchanged route/registry tests, strict types, scoped lint, new-file format, web export and28 Chrome smoke tests. Independent Astra review and primary hash/diff acceptance pass. The same duplication configuration now reports28 groups,628 lines and1.1894percent across180 sources and52,798 lines. The immediately preceding RF-057 scan reported29 groups and669 lines. The original capture remains31 groups and707 lines. Snapshot .refactor-baseline/jscpd-after-rf053/jscpd-report.json. Acceptance .refactor-baseline/rf053-primary-acceptance.json. The full333-test suite was last run for RF-068; it was not repeated for this bounded extraction. No Android/iOS build or physical-device check ran for RF-053.

## Test isolation after RF-069, 2026-10-16

All64 unit suites and336 tests pass in a fresh full run, with normal process exit and no unfinished-async warning. Four focused gates and independent Astra review pass after the measurement/warning/deferred-cleanup repair. Native View and dimension fixture changes do not regress the wider suite. Evidence .refactor-baseline/rf069-unit-full.json and rf069-primary-acceptance.json. Application source, dependencies and datasets remain unchanged. No browser/native/device/iOS check or new duplication scan ran for this test-only slice.

## Session characterization after RF-070, 2026-10-16

Four focused controller gates and independent Astra review pass, including12 tests in3 suites with normal open-handle detection exit. The corrected busy check targets the visible date-editor modal. Actual session tests preserve native input differences, haptics and current-card removal/advance; failure coverage uses the revealed state. Front-state error visibility remains a separate finding. The last full-suite measurement remains336 tests in64 suites after RF-069; no full/native/browser/duplicate scan was repeated here. Evidence .refactor-baseline/rf070-primary-acceptance.json.

## Date failure visibility after RF-072, 2026-10-16

The front-state date-save regression failed before the source edit and passes afterward in Arabic/light and English/dark. All six gates and independent evaluation pass, including14 focused tests and28 Chrome smoke tests. Scoped lint retains5 existing warnings. No full-unit/native/device/iOS or duplicate scan was repeated for the two-line state/error-prop repair. The last full-unit capture is336 tests after RF-069; the last duplication capture is28 groups/628 lines after RF-053. Evidence .refactor-baseline/rf072-primary-acceptance.json. Remaining non-date action visibility stays open in RF-073.

## Shared date editor after RF-055, 2026-10-16

Local commit9828164 replaces both private date-sheet presenters with components/flashcards/DueDateSheet.tsx. All existing caller tests remain unchanged. Six controller gates and independent Astra review pass, including19 focused tests, strict types, scoped lint with5 existing warnings, new-component formatting, web export and28 Chrome smoke tests. Primary reviewed exact file hashes, complete diff and commit scope. A fresh full unit run passes65 suites and341 tests with normal exit.

The same .jscpd.json scope and exclusions now report26 groups,562 duplicated lines and1.0655percent across181 sources and52,747 lines. The previous RF-053 measurement was28 groups and628 lines; the original capture was31 groups and707 lines. One11-line footer match remains between DueDateSheet and the answer editor. This bounded extraction does not justify another generic overlay abstraction. Reports are .refactor-baseline/jscpd-after-rf055/jscpd-report.json and rf055-unit-full.json; primary acceptance is rf055-primary-acceptance.json. No scanner exclusion changed. No physical-device, Android or iOS verification ran for this slice.

## Button semantics after RF-071, 2026-10-17

Local commit a6e0d9a repairs the missing default accessibilityRole in the existing shared Button. Explicit roles and actual Slot child ownership remain unchanged. Jest derives its existing Expo transform exclusions and adds only the installed Slot package. Six native regressions use the real Slot rather than the global test stand-in. The fresh full suite passes 66 suites and 347 tests. Strict types, scoped lint with zero warnings, scoped format, web export and all 30 Chrome tests pass. The two new browser cases focus and activate the actual donor-footer button with Enter and Space. Independent Astra review and primary exact hash/diff acceptance pass.

Evidence is .refactor-baseline/rf071-primary-acceptance.json and .ralph/runs/RF-071-2-1792190642483378210. The original sandbox bind failure and cold full-suite timeout remain in earlier logs. No existing assertion, retry limit or native interaction was weakened. The latest duplication measurement remains RF-055's 26 groups and 562 lines; no new scan, physical-device, Android or iOS check ran for this semantic slice.

## Direct action errors after RF-073, 2026-10-17

Commit 8618270 moves the existing error label outside the grading-only condition. All 14 focused tests and 31 Chrome cases pass, with strict types, web export, scoped format and five existing lint warnings. Fresh independent review and primary exact hash/scope acceptance pass. The final fixture against the prior source fails exactly three front-state error assertions and passes eight other cases. The changed-state browser fixture uses an isolated empty local profile, personal study rows and a targeted rejection trigger. Its English/dark390x844 screenshot shows 12px between the readable error and unobstructed Reveal button. Source database/content inputs and production remain unchanged. Evidence .refactor-baseline/rf073-primary-acceptance.json and rf073-controller-visual.png.

The full unit suite and duplicate scan were not repeated here. Cold first-session timing remains an open RF-076 finding; initial cold and succeeding warm counterfactual outputs are both preserved. This task does not certify cold-run reliability or the separate open-dialog/answer-editor error owners. No new native build or physical-device/iOS verification ran.

## Cold fixture verification after RF-076, 2026-10-17

Local commit 82ae45a resolves the existing public Native Modal reference during fixture setup and reuses it in the ancestor comparison. Both fresh no-cache runs pass 11 cases with zero skips, in 17.366s and 17.594s. The normal full suite passes 66 suites/353 tests. All six controller gates and separate Astra review pass. Primary inspected the exact fixture-only change, committed scope, retained logs and matching hash. No deadline, assertion, mock or production behavior changed. Evidence .refactor-baseline/rf076-primary-acceptance.json.

The previous cold failures remain in diagnostic logs. Total CLI initialization is not claimed faster. No browser, native build, physical-device or iOS verification was repeated for this fixture change. The latest duplication measurement remains 26 groups/562 lines after RF-055. RF-079 will clarify worker and evaluator ownership before the next implementation task.

## Confirmation errors after RF-074, 2026-10-17

Local commit 8e2f9a1 extends ConfirmDialog with a controlled FieldMessage error. The session clears stale errors when opening Delete/Reset and passes its existing error state. Every service, handler and other caller stays unchanged. All six fresh gates pass: 66 suites/359 tests, strict types, scoped format/lint with five existing warnings, web export and 32 Chrome cases. Independent Astra passes the repaired test evidence and fresh screenshot. Primary verifies exact file hashes, complete scope and the byte-identical inspected image. The error sits 37px above unobstructed Cancel/Delete controls at 390x844 in English/dark. Evidence .refactor-baseline/rf074-primary-acceptance.json.

The final fixture against pre-fix source fails exactly six modal-feedback assertions and passes 11 earlier cases. A phase-reset mutant proves the two revealed guards. Both ordinary failures and one bounded primary recovery remain documented. No duplication scan, native build, physical-device or iOS verification was repeated. Last comparable duplication remains 26 groups/562 lines after RF-055.

## Answer editor errors after RF-075, 2026-10-17

Local commit 2620a8c routes existing sessionError into the private AnswerEditSheet through FieldMessage and clears stale error on a fresh opening. The save handler, override keys, persistence, phase, textarea and keyboard behavior stay unchanged. All six fresh controller gates pass, including 66 suites and 365 unit tests, strict types, scoped formatting/lint with five existing warnings, web export and 33 Chrome cases. Separate Astra review passes. Primary inspects matching hashes, complete diff and the fresh English/dark 390x844 screenshot. The entered answer remains visible and both footer buttons remain unobstructed. Six added route cases detect missing feedback against exact pre-fix source; the real old-export browser failure also remains preserved. Evidence .refactor-baseline/rf075-primary-acceptance.json. No new duplication scan, native build, device or iOS verification ran.

## Revealed-phase test evidence after RF-080, 2026-10-17

Local commit 61e8716 adds eight assertions to four existing test locations, preserving all 23 cases and application code. The original seven selected cases passed an exact phase-reset mutant. After repair, all four revealed cases detect missing comparison content while three front cases still pass, with 16 unrelated cases intentionally filtered. Normal focused tests pass all 23 with zero skips. All five fresh controller gates and separate Astra review pass; primary accepts matching hash and exact diff. Record .refactor-baseline/rf080-primary-acceptance.json. No full-suite, browser, duplication or native/device/iOS check was repeated. The latest full suite and browser evidence remain RF-075, 365 unit tests and 33 Chrome cases.

## Deck date errors after RF-077, 2026-10-17

Local commit 50cbc3c clears stale deck errors on opening the date editor and passes validation-or-action error to the existing DueDateSheet. Shared UI and persistence handlers remain unchanged. Six fresh controller gates and independent Astra pass, including 66 suites/366 tests and 34 Chrome cases. Primary verifies exact hashes/scope and inspects the fresh English/dark 390x844 image with retained date, readable inline error and unobstructed footer. Final unchanged four-case fixture against exact pre-fix component fails only the two English/Arabic modal-feedback checks and passes the two non-rejection cases, zero skips. Preparation conflicts, selector failures and actual before image remain preserved. Record .refactor-baseline/rf077-primary-acceptance.json. No new duplication, native build, device or iOS verification ran.

## Date-validation recovery after RF-081, 2026-10-17

Local commit 882817c clears obsolete validation immediately after a valid parse in the session and deck date-save handlers. Four new Arabic/light and English/dark cases cover invalid/past input, deferred valid writes, busy guards, rejected persistence and clean cancel/reopen. All 27 previous focused cases remain. All six fresh controller gates pass, including 66 suites/370 unit tests and 34 Chrome cases. Separate Astra review passes after primary records the exact five hashes, full diff and inspected 390x844 image. The retained valid date and current failure are readable; obsolete validation is absent and both footer buttons are unobstructed. The first review rejection for missing primary acceptance remains recorded and consumed one attempt. Evidence .refactor-baseline/rf081-primary-acceptance.json. No new duplication, Android, device or iOS verification ran.

## Deck confirmation recovery after RF-078, 2026-10-17

Local commit 189cb4b clears errors on opening Delete/Reset and passes the existing deck error to ConfirmDialog. Four new actual-owner cases cover Arabic/light and English/dark failures, busy guards, cancel/reopen, successful retry and absence of unrelated writes throughout recovery. All six fresh gates and separate Astra pass, including 66 suites/374 unit tests and 35 Chrome cases. Primary inspects exact scope/hashes and the fresh English/dark 390x844 image with readable dialog error and unobstructed footer. The final unchanged ten-case fixture against the exact pre-fix component fails only four missing-message checks and passes six earlier cases, zero skips. Formatting failure and the review coverage finding remain recorded; primary granted one bounded assertion-only recovery. Evidence .refactor-baseline/rf078-primary-acceptance.json. No new Android/device/iOS verification ran.

The repeat scan uses the unchanged jscpd scope and thresholds. It reports 26 groups, 563 duplicated lines, 1.06653 percent across 181 files and 52,788 lines. RF-055 reported 26 groups/562 lines. File pairs are unchanged; the short date/answer-editor footer match grew by one line after answer feedback. Keep it for contextual review before designing a shared footer. Original baseline was 31 groups/707 lines. Report .refactor-baseline/rf078-duplication/jscpd-report.json.

RF-009 is verified and accepted, local commit be56d6c. Four exact platform roots and recursive CJS tooling remove false unused reports for four live files and four dependencies. AuthGate remains the one unused-file candidate. Five export, two type, two alias-group, five unlisted-dependency and one external-binary findings remain visible. Two fresh controller gates and independent Astra pass; primary checks exact config/report hashes and commit scope. The read-only reviewer could not rerun Metro cache writes, so controller execution supplies that evidence. No application or native/device/security check was repeated. Evidence .refactor-baseline/rf009-primary-acceptance.json.

RF-010 is verified and accepted, local commit 01b5401. The unreachable 76-line AuthGate module and one RTL registry entry are removed. Five fresh controller gates and independent Astra pass, including the unchanged three-case inventory suite, strict types, scoped lint, document format and real Knip report with zero unused files. Primary verifies the deleted source hash, complete commit scope and exact remaining registry/document bytes. Open export/type/dependency findings remain. No runtime UI replacement, dependency or protected-input change. Record .refactor-baseline/rf010-primary-acceptance.json. No new browser, full unit suite, app/native build or device/iOS check ran.

The repeat jscpd scan retains all 26 identical fragments and 563 duplicated lines. It now scans 180 files and 52,712 lines, exactly 76 fewer source lines, at 1.06807 percent. The percentage rises because the removed file had no detected clone. Scope and exclusions remain unchanged. Report .refactor-baseline/rf010-duplication/jscpd-report.json.

RF-082 is verified and accepted, local commit 100c5b7. Exactly three export keywords are removed while all implementation and existing test bytes remain. Five fresh controller gates and separate Astra pass, including the unchanged two-suite, 20-case RTL/review-transition run, strict types, scoped lint and real analysis. Knip retains zero unused files with three unused exports and one unused type, no analysis suppression or dependency change. Record .refactor-baseline/rf082-primary-acceptance.json. No new browser, full-unit, app/native build, device or iOS check ran.

RF-083 is verified and accepted, local commit 80ad8f5. Exactly four unreachable retention functions and 122 lines are removed; all remaining query bytes/imports, caller, schema, migration and queue modules match their previous versions. All six fresh controller gates and separate Astra pass, including 66 suites/374 tests, strict types, scoped lint, web export and real analysis. One unused registry export and Locale type remain. Original Reset retry failure, spent first attempt and invalid checkpoint remain; passing replays do not establish a fixture repair. RF-086 owns that unresolved finding. Record .refactor-baseline/rf083-primary-acceptance.json. No new browser/native/device/iOS/database/production check.

RF-084 is verified and accepted, local commit 104c7c0. Only the unused four-line registry lookup and unsafe cast are removed. Every live registry entry, helper, import and existing test remains byte-identical. A matching checkpoint resumes after a bounded resource stop; all five fresh controller gates and separate Astra pass, including three inventory cases, strict types, scoped lint, document format and real analysis. Knip now reports zero unused files/exports and one unused Locale type. Record .refactor-baseline/rf084-primary-acceptance.json. No new full-unit/browser/app/native/device/iOS check. Repeat duplication retains all 26 identical fragments/563 lines across 180 files and 52,590 lines, 1.07055 percent. No scanner scope/exclusion change or clone removal.

RF-085 is verified and accepted, local commit e1c4fc5. Exactly the unused Locale type line is deleted; both dictionaries, used types and existing test bytes remain. Five fresh controller gates and separate Astra pass after generation and account-limit review interruptions. No missing verdict or exhausted batch is counted as success. The unchanged UI-string contract passes, alongside strict types, scoped lint, doc format and real analysis. Current Knip has zero unused files, exports and exported types, with two intentional aliases, five unlisted dependencies and one binary still visible. Record .refactor-baseline/rf085-primary-acceptance.json. No new full-unit/browser/app/native/device/iOS check. RF-084 clone metrics remain applicable because this type-only i18n file is already outside that unchanged scope.

Primary RF-086 diagnosis reruns the unchanged full suite with a cold Jest cache. All 66 suites and 374 cases pass in 34.476 seconds. Five equivalent instrumented complete-suite cold replays also pass, but are diagnostic evidence, not acceptance gates. No cause or repair of the original intermittent Reset failure is established. Tracked tests/components/configuration remain unchanged. Record .refactor-baseline/rf086-reproduction.json.

RF-011 is verified and accepted, local commit f5d1dc0. The root manifest and lock now declare already-used bottom-tabs 7.21.0. All 1,371 resolved package entries, app/test source, navigation and native packages remain unchanged. Six fresh controller gates and separate Astra pass, including strict offline lock-only resolution, installed graph/actual analysis, strict types, 66 suites/374 tests, web export and formatting. Unlisted dependencies drop from five to four, with zero unused files/exports/types/packages. Record .refactor-baseline/rf011-primary-acceptance.json. No new browser/native/device/iOS/security audit or asset generation. RF-086 stays open; remaining tooling ownership is RF-087/RF-088.
