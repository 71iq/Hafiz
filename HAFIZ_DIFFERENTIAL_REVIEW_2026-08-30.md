# Hafiz differential review, flashcard review transition

## Executive summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

Overall inherent risk: Medium. The patch moves review scheduling business logic that changes persisted card state.

Residual risk: Low. The new module is pure, has two callers in one route, preserves persistence order, and has direct tests for the moved invariants.

Recommendation: Approve.

Key metrics:

- Files analyzed: 3 of 3 task source and test files.
- Production callers of `calculateReviewTransition`: 2, both in `app/flashcards/session.tsx`.
- Direct test cases: 12 transition cases plus 3 existing scoring cases.
- Security regressions: 0.
- Blocking test gaps: 0.

## What changed

Review range: `a043db8` to the working tree on 2026-08-30.

| File | Added | Removed | Risk | Blast radius |
|---|---:|---:|---|---|
| `app/flashcards/session.tsx` | 33 | 61 | Medium | Low |
| `lib/fsrs/review-transition.ts` | 106 | 0 | Medium | Low |
| `tests/unit/fsrs-review-transition.test.ts` | 251 | 0 | Low | Test only |

The route no longer converts `StudyCardRow` values into `ts-fsrs` cards or maps scheduler output back into persistence fields. `calculateReviewTransition` now owns that work and the same-day requeue decision. Button previews and committed reviews cross the same interface.

The route still owns SQLite writes, study-log ordering, counters, achievements, leaderboard points, navigation, and rendering. No database interface, auth flow, network call, Quran content, package, lockfile, or generated input changed.

## Findings

No critical, high, medium, or low security finding was found in the task diff.

The patch adds a state check at `lib/fsrs/review-transition.ts:83`. Persisted scheduler states outside `New`, `Learning`, `Review`, and `Relearning` now fail with a `RangeError` instead of crossing a TypeScript cast. The route's existing error path catches that failure and reports a review-save error.

## Test coverage analysis

`tests/unit/fsrs-review-transition.test.ts` calls the new interface directly. It covers:

- all four ratings and every persisted scheduler field;
- review-record field mapping and the supplied review timestamp;
- input immutability;
- custom learning-step policy;
- same-day learning requeue;
- suspended, deleted, future-buried, and expired-burial states;
- scheduling after the local review day;
- invalid persisted scheduler state.

Fresh verification results:

| Command | Result |
|---|---|
| `npm run test:unit -- --runTestsByPath tests/unit/fsrs-review-transition.test.ts tests/unit/fsrs-scoring.test.ts` | 15 tests passed |
| `npm run typecheck` | Passed |
| `npx eslint app/flashcards/session.tsx lib/fsrs/review-transition.ts tests/unit/fsrs-review-transition.test.ts` | 0 errors, 5 pre-existing route warnings |
| `npm run build:web` | Passed, 39 routes exported |
| `npx playwright test --project=smoke-chromium tests/e2e/smoke.spec.ts` | 27 tests passed |

The smoke suite proves route startup, not a review against a seeded SQLite database. No native device run or manual grade interaction was performed. The focused unit tests cover the moved behavior without SQLite or React.

## Blast radius analysis

| Function | Production callers | Risk | Notes |
|---|---:|---|---|
| `calculateReviewTransition` | 2 | Low | Grade preview and saved review in one route |
| `gradeCard` | 1 | Low | Called by the new transition module |
| `updateCard` | Unchanged | Medium | Interface and call order unchanged |
| `insertStudyLog` | Unchanged | Medium | Interface and call order unchanged |

The session route has two app entry paths, from Home and Onboarding, plus its root stack registration. The new interface does not add another route or external caller.

## Historical context

- Commit `f9b9119`, "Fix review session progress counter", added the saved-review mapping on 2026-05-16.
- Commit `7d6de6d`, "Show return timing on review buttons", added the duplicate preview calculation and card conversion on 2026-05-21.
- Commit `26b44bf`, "Fix flashcard session relearning queue", added the active same-day requeue rule on 2026-05-28.

The last item was a regression fix, so the review treated requeue behavior as the highest-risk invariant. The new tests preserve active same-day requeue and every status exclusion from that fix. No removed line came from a security, CVE, auth, or validation-hardening commit.

## Sibling-pattern search

Root cause: Review scheduling can diverge when a route constructs a scheduler card, invokes `ts-fsrs`, and maps the result into persistence itself.

| Search | Scope | Matches | Verdict |
|---|---|---:|---|
| `gradeCard(toFSRSCard` | Baseline session route | 2 | The two known copies moved behind the new interface |
| `gradeCard(` | Current production tree | 2 | One definition and one authoritative transition call |
| `fsrs(` or `.repeat(` | Current production tree | 5 | Two scheduler internals, two lines in the legacy vocab path, one unrelated string repeat |
| Scheduler result field mapping | Current production tree | 9 | All fields are in `review-transition.ts` |

`app/flashcards/vocab.tsx` is a confirmed sibling pattern with medium refactor risk and high confidence. It uses a different `vocab_cards` schema, a raw scheduler configuration, no study log, and two casts. Migrating it in this slice could change scheduler defaults and persistence behavior. Characterize that route before sharing a lower-level scheduling interface.

A future regression guard should reject new direct `ts-fsrs` imports outside `lib/fsrs/scheduler.ts`. Keep a temporary explicit exception for the vocab route until its behavior is characterized and migrated.

## Residual risks and decisions

- Card update still precedes study-log insertion. A log failure can leave the card advanced. This behavior predates the patch and remains an open product and persistence decision.
- Leaderboard points still use pre-review difficulty and stability. The patch intentionally leaves that policy unchanged.
- The vocab route remains a separate scheduler path until a dedicated slice proves its current defaults and storage behavior.
- Web export and route smoke passed. Native scheduling behavior was not run on a device, although the moved module uses no platform API beyond JavaScript `Date`.

## Methodology

Strategy: Surgical. The repository has 273 authored JavaScript and TypeScript files, while the task changes one business-logic path.

The review read the baseline and changed code, inspected blame and pickaxe history for every removed helper, counted production callers, traced the unchanged persistence calls, checked direct test coverage, ran a sibling-pattern search, and reviewed the fresh command output above.

Confidence: High for the changed pure transition and its two route callers. Medium for end-to-end review persistence because no seeded SQLite interaction or native device run was performed.
