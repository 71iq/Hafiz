# Executable migration plan

`backlog.json` is the ordered task record. Every item has a stable ID, rationale, modules, dependencies, acceptance criteria, verification argv, risk, approval flag and status. Ready tasks have bounded paths and commands; larger workstream items remain pending until the primary engineer breaks down or characterizes the next slice. Approval here means engineering readiness under the user's existing authorization, not a new permission request.

## Order

1. Establish recovery, baseline, independent review and immutable input safeguards. Complete three small reuse/deletion slices to prove the real loop.
2. Repair the pre-existing test failures without reducing coverage. Triage dependency advisories, align Expo-compatible patches and calibrate native/web unused-code analysis.
3. Remove verified dead code and measured accidental duplication in independent small commits. Record justified deliberate duplicates.
4. Add tests at risky boundaries, then simplify settings, search, FSRS orchestration, reader policy and geometry. Keep protected data and existing behavior fixed.
5. Consolidate remote query keys, account cache lifecycle, mutations and pagination. Preserve local-first SQLite and existing sync ordering.
6. Standardize forms and UI where a demonstrated inconsistency exists. Verify direction, themes, touch, keyboard and accessibility on relevant platforms.
7. Re-run audits after each workstream. Upgrade Expo majors only when both compatibility and native verification are available. Run final full checks and an independent repository review, add justified findings, and repeat.

No task may delete a platform variant based on Knip alone. No duplicate block is merged solely to reduce a percentage. No SDK upgrade is combined with a UI migration or database change.

## Current bounded step, 2026-10-16

RF-067 is accepted after fifteen fresh gates, independent evaluation and primary artifact/hash review. RF-008 still owns the two remaining Expo diagnostics; neither a lint downgrade nor native regeneration is approved. RF-068 characterized both actual account callouts before RF-053 extracted their shared inner row while retaining distinct containers. RF-069 and RF-070 characterized both date-editor callers. RF-072 repaired inline session date-save failure visibility with ordered red/green evidence. RF-055 then extracted the controlled sheet using existing Input/Button/overlay primitives and caller-owned native options. All six gates, independent Astra review and primary acceptance pass, local commit9828164. Existing caller tests are unchanged.

The latest full suite is RF-083's 66 suites and 374 tests, with its six fresh gates passing. The latest 35 Chrome cases remain RF-078's run. Independent Astra review and primary rendered/hash acceptance pass. Thirty-two of 86 items are verified. The repeat duplicate scan reports 26 groups/563 lines, 1.06807 percent across 180 files after the unused-module deletion, with all clone fragments unchanged. The one-line increase is the existing date/answer-editor footer match and remains for contextual review. Session and deck error ownership/recovery repairs are accepted. RF-080's test-only causal gate detects four original revealed failures while three front cases pass. RF-009 root calibration is accepted. RF-010 removes the verified unused AuthGate module. The calibrated report has zero unused files. RF-082 removes only three internal export keywords. RF-083 removes the unreachable retention cluster. RF-084 and RF-085 own the remaining registry index and Locale alias after exact primary scoping. RF-086 tracks an intermittent existing Reset retry test failure; no cause or repair is established. No dependency removal is justified by the calibrated report. No source regression is claimed by the phase test finding.

## Completion condition

All in-scope items must be verified with evidence or have an exact documented external blocker. Required quality checks must pass, significant regressions and in-scope high-severity findings must be resolved, and an independent final architecture/behavior review must pass. Deliberate data/platform duplication must be documented. Literal zero text similarity is not a useful acceptance criterion for generated Quran inputs or platform adapters.

A batch ending, no currently ready task, or a scanner exit code cannot mark the project complete. The final report must compare the same scan scope, list actual checks and native limits, and link remaining blocked items.
