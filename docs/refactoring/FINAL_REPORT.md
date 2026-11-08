# Final modernization report

Branch codex/hafiz-modernization, started 2026-10-15 from main's e5020b3, finished 2026-11-08 with about 528 commits ahead of main. 197 of 200 backlog tasks are verified; three are deferred with reasons (RF042 iOS, RF197 Expo SDK upgrade, RF198 ESLint 10).

## What changed for users

- **Account sync keeps the newest data.** A server-side guard keeps the newer row when two devices write, deletes no longer remove newer edits, account switches and sign-out no longer leak late results into the next account, and restore runs in one transaction. Server rows from sync, leaderboard, reflections and Quran Foundation are checked before use.
- **Android works properly.** Words in both reader views no longer render in fragments or clipped glyphs, onboarding buttons and surah rows render, and the app is far smaller and faster to install.
- **Web works properly in Arabic.** Press-state styles were dropped on the web; menus now mirror correctly and selections show.
- **Reliability.** Deep links opened while the app runs no longer pile up copies of the app; flashcard actions on a deleted card skip it instead of failing; Home shows a retry when it cannot load; cached lists refresh on reconnect and resume.
- **Accessibility and language.** Radio groups, labels and bilingual strings were added where controls lacked them.

## Comparable measurements

| Measure                         | Start (2026-10-15 and RF041)     | Now                                                                                                  |
| ------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Unit tests                      | 251 (3 failing)                  | 3,202 passing, plus 35 Chrome tests                                                                  |
| Lint warnings                   | 71                               | 26 (hook-dependency warnings, listed in LINT.md)                                                     |
| Duplicated code (same scope)    | 31 groups, 707 lines             | 15 groups, 295 lines                                                                                 |
| Unused-code records (Knip)      | 18                               | 5, all documented                                                                                    |
| npm audit                       | 80 findings, 2 critical, 60 high | 36 findings, 0 critical, 7 high, none in shipped code except one low-impact URL parser (needs RF197) |
| Android JavaScript bundle       | 530 MB (380 MB Hermes)           | 7.6 MB (10.8 MB Hermes)                                                                              |
| QA APK                          | 660 MB                           | 373 MB                                                                                               |
| QA build time                   | 860 s                            | 112 s                                                                                                |
| First-run import on the phone   | 207 s                            | 42 s, same rows                                                                                      |
| Translation switch on the phone | 2 to 4 s                         | 0.2 to 0.4 s                                                                                         |
| Memory after seven verse links  | 1.35 GB                          | about 250 MB                                                                                         |

## Decisions

Keep Expo, the existing UI system and the current state, query and form libraries (ADR 0001). Defer the Expo SDK upgrade to its own branch after the merge, going straight to the current SDK (ADR 0002). Local data belongs to the device (RF025). Discussion follows reflection visibility (RF170). Hook-dependency warnings get separate behavior-tested fixes (LINT.md).

## Checks

Every batch of three to five tasks ran the 20-check gate: whitespace, scoped format and lint, typecheck, unused-code baseline, postinstall and dependency tree, full lint, all unit tests, script tests, runner tests, native config, web/Android/iOS dependency boundaries, web export, Android and iOS exports, and 35 Chrome tests. The last gate passed at the final commit. Device checks ran on a Samsung SM-A546E (Android 16) with the isolated QA build; web checks ran in Chrome at 360 to 1440 px in both languages and five themes. Details are in PERFORMANCE.md, UI_VERIFICATION.md and each task's evidence in backlog.json.

Production: with Ehab's approval the three database migrations (RF166, RF170, RF169) were applied to the Hetzner database on 2026-11-07 after a verified backup. No app deployment was made; the branch is pushed but not merged.

## Risks and open items

- iOS was not built or run (RF042).
- Expo SDK 58 upgrade (RF197) and ESLint 10 (RF198) are deferred.
- 25 hook-dependency lint warnings remain for separate tasks.
- Strict decoders fail closed on a malformed server row (FINAL_REVIEW.md).
- Merge preparation from the final review: remove the branch-only rules from AGENTS.md and RUNBOOK.md, decide on the committed skill symlinks, and move loop tooling and ledgers out of the repository. Merging to main deploys production.
