# Re-audit

RF046, 2026-11-08, at commit 74033a8, with the same scanner scopes as the earlier records in AUDIT.md.

| Scan                                              | Earlier record                                      | Now                                                                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplication (`.jscpd.json`, app, components, lib) | 19 groups, 386 lines, 184 sources (RF060)           | 15 groups, 295 lines, 227 sources, 0.51% of 58,405 lines                                                                                                                                             |
| Unused code (Knip)                                | 5 issue records, zero unused files                  | the same 5 records: two unlisted Expo config plugins in app.json, the `sqlite3` binary used by the data build script, one re-exported helper and two intentional constant aliases; zero unused files |
| Dependency graph, web                             | 206 modules, 865 dependencies, 0 violations (RF012) | 252 modules, 1,047 dependencies, 0 violations                                                                                                                                                        |
| Dependency graph, Android and iOS                 | 205 modules, 866 dependencies each                  | 252 modules, 1,049 dependencies each, 0 violations                                                                                                                                                   |
| `npm audit`                                       | 74 package findings, 59 high (2026-10-18)           | 36 findings: 7 high, 20 moderate, 9 low, 0 critical, from 12 direct advisories                                                                                                                       |

Module counts grew with new owners from this branch: bundled JSON loading, bulk inserts, row decoders, error messages and the deep-link route test. The remaining clone groups are short presentation fragments reviewed in earlier tasks; none is a shared behavior worth extracting now.

Security follow-up from the audit: shipped zod 4.3.6 was affected by a memory-exhaustion advisory and is fixed in RF200. The rest is triaged in DEPENDENCY_SECURITY.md under RF090. No new actionable child task beyond RF200; RF197 (Expo SDK) carries the decode-uri-component fix.

Not repeated: native runtime diagnostics and device checks are recorded per task and in PERFORMANCE.md and UI_VERIFICATION.md. JSON report exit codes do not enforce failures; `check:boundaries` and `check:analysis` do.
