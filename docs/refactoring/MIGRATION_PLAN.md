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

## Current bounded step, 2026-10-18

RF-067 is accepted after fifteen fresh gates, independent evaluation and primary artifact/hash review. RF-008 still owns the two remaining Expo diagnostics; neither a lint downgrade nor native regeneration is approved. RF-068 characterized both actual account callouts before RF-053 extracted their shared inner row while retaining distinct containers. RF-069 and RF-070 characterized both date-editor callers. RF-072 repaired inline session date-save failure visibility with ordered red/green evidence. RF-055 then extracted the controlled sheet using existing Input/Button/overlay primitives and caller-owned native options. All six gates, independent Astra review and primary acceptance pass, local commit9828164. Existing caller tests are unchanged.

The latest accepted full controller gate is RF-092's 66 suites and 374 tests, with all 12 fresh gates passing, including nine security cases and 28 Chrome smoke cases. RF-091 remains the latest Android/iOS JavaScript export verification. Primary RF-086 diagnosis also reruns the unchanged cold full suite with all 374 cases passing. The latest 35 Chrome cases and rendered UI acceptance remain RF-078's run. Subsequent small deletions use their focused suites, strict types, scoped lint, real analysis and separate Astra review. Thirty-eight of 94 items are verified.

RF-009 calibrates platform roots. RF-010 removes the unused AuthGate. RF-082 keeps internally used helpers/types private. RF-083 deletes the unreachable retention cluster and RF-084 removes the unused registry index. RF-085 removes the unused Locale line. The current report has zero unused files, exports and exported types. RF-011 declares the existing bottom-tabs dependency without resolved-package changes. Two deliberate aliases, four unlisted dependency findings and one external binary remain visible. No dependency removal is justified by the report.

The repeat duplicate scan reports the same 26 fragment/file pairs and 563 duplicated lines, 1.07055 percent across 180 files and 52,590 source lines. The percentage rises as unreachable code is deleted. Scope and exclusions remain unchanged. The date/answer-editor footer remains for contextual review; do not merge it merely to lower a score.

Session and deck error ownership/recovery repairs are accepted. RF-080's causal test gate detects four original revealed failures while three front cases pass. RF-086 is ready for the exact four-line test repair after actual Reset/Delete reproductions show pending React commits after completed writes. Awaited act dismisses without extra calls. A first async candidate reveals the same date-save retry gap; the final candidate passes all 125 repeated persistence cases and 374 full cold cases, then restores the original source. Fresh Ralph commands and stronger review are still required. RF-094 separately owns the invalid framework clock; clock restoration did not repair dismissal. Original failures and retry counts remain preserved.

RF-089 is accepted after actual local red/green proof, all 12 controller checks, separate Astra and primary final scope/hash inspection. The fresh audit drops from 74 package findings/59 high/zero critical to 71/56/zero, with no remaining brace-expansion finding. RF-090 owns remaining audit families before final completion. No new Sharp dependency is approved.

## Completion condition

All in-scope items must be verified with evidence or have an exact documented external blocker. Required quality checks must pass, significant regressions and in-scope high-severity findings must be resolved, and an independent final architecture/behavior review must pass. Deliberate data/platform duplication must be documented. Literal zero text similarity is not a useful acceptance criterion for generated Quran inputs or platform adapters.

A batch ending, no currently ready task, or a scanner exit code cannot mark the project complete. The final report must compare the same scan scope, list actual checks and native limits, and link remaining blocked items.

RF-091 is accepted after all 15 controller commands, independent Astra review and primary final scope/hash inspection. It patches only nanoid to 3.3.20 and preserves literal Unicode in the existing Metro minifier output to prevent native bundle string overflow. All 2,421 protected inputs remain identical. Both native JavaScript exports match the successful preflight hashes; these exports do not verify bytecode, native compilation or device behavior. Installed audit has 72 package findings/57 high, lock-only has 70/55, both zero critical and the same 30 advisory sources. RF-090 retains remaining security families, RF-039 owns measured native payload/runtime profiling, and RF-086 remains unresolved. Refresh exact dependency preflights before approving another family or RF-087 tooling.

RF-092 is accepted after all 12 controller gates, independent Astra and primary final scope/hash checks, local commit f1bb169. Exactly two compatible YAML legacy-line updates remove seven direct advisory records without a new source. Both fresh audit scopes report 72 package findings/54 high/zero critical and 23 advisory sources. Inherited argparse/sprintf debt stays RF-090. RF-093 owns the generated-fixture module collision found during cold verification; its candidate preserves the complete test inventory. RF-086 remains unresolved.

RF-093 is blocked after two ordinary attempts. Primary rejected the first unescaped regex specification; the second passes literal-boundary/discovery gates but fails on the independently reproduced async fixture. The corrected config is a local checkpoint and has no final acceptance. Retry counts remain unchanged. RF-086 is the next approved prerequisite. After its acceptance, primary must prepare RF-093 recovery and a permanent boundary regression with fresh controller checks and stronger review. No blind retry reset is authorized.
