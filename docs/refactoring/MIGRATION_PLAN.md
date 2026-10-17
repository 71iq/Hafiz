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

The latest full suite is RF-075's 66 suites and 365 tests, with 33 Chrome cases and all six fresh gates passing. Independent Astra review and primary rendered/hash acceptance pass. Twenty-four of 80 items are verified. The latest duplicate scan remains RF-055's 26 groups and 562 lines. Session date, direct-action, confirmation and answer-editor error ownership repairs are accepted. RF-080 is ready as a bounded test-only phase-proof repair. Deck date/confirmation findings RF-077/RF-078 remain unapproved. Primary RF-080 calibration proves four older revealed tests miss an exact phase-reset mutant; its frozen verification must detect all four after the assertion repair. No source regression is claimed by that test finding.

## Completion condition

All in-scope items must be verified with evidence or have an exact documented external blocker. Required quality checks must pass, significant regressions and in-scope high-severity findings must be resolved, and an independent final architecture/behavior review must pass. Deliberate data/platform duplication must be documented. Literal zero text similarity is not a useful acceptance criterion for generated Quran inputs or platform adapters.

A batch ending, no currently ready task, or a scanner exit code cannot mark the project complete. The final report must compare the same scan scope, list actual checks and native limits, and link remaining blocked items.
