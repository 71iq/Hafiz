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

The latest full suite is RF-083's 66 suites and 374 tests, with its six fresh gates passing. The latest 35 Chrome cases and rendered UI acceptance remain RF-078's run. Subsequent small deletions use their focused suites, strict types, scoped lint, real analysis and separate Astra review. Thirty-four of 86 items are verified.

RF-009 calibrates platform roots. RF-010 removes the unused AuthGate. RF-082 keeps internally used helpers/types private. RF-083 deletes the unreachable retention cluster and RF-084 removes the unused registry index. RF-085 removes the unused Locale line. The current report has zero unused files, exports and exported types. Two deliberate aliases, five unlisted dependency findings and one external binary remain visible. No dependency removal is justified by the report.

The repeat duplicate scan reports the same 26 fragment/file pairs and 563 duplicated lines, 1.07055 percent across 180 files and 52,590 source lines. The percentage rises as unreachable code is deleted. Scope and exclusions remain unchanged. The date/answer-editor footer remains for contextual review; do not merge it merely to lower a score.

Session and deck error ownership/recovery repairs are accepted. RF-080's causal test gate detects four original revealed failures while three front cases pass. RF-086 is next for primary diagnosis of an intermittent existing Reset retry test failure; no cause or repair is established. The original failed verification and spent retry remain preserved.

## Completion condition

All in-scope items must be verified with evidence or have an exact documented external blocker. Required quality checks must pass, significant regressions and in-scope high-severity findings must be resolved, and an independent final architecture/behavior review must pass. Deliberate data/platform duplication must be documented. Literal zero text similarity is not a useful acceptance criterion for generated Quran inputs or platform adapters.

A batch ending, no currently ready task, or a scanner exit code cannot mark the project complete. The final report must compare the same scan scope, list actual checks and native limits, and link remaining blocked items.
