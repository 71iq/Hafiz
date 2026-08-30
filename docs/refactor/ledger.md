# Refactor ledger

This ledger tracks the guided Hafiz refactor. Each slice must preserve behavior, finish green, and leave one authoritative path.

## Live baseline, 2026-08-30

- Commit and branch: `1a7e32d` on `main`, tracking `origin/main`.
- Authored JavaScript and TypeScript surface under `app`, `components`, `lib`, `scripts`, `tests`, and `supabase`: 273 files and 63,938 lines.
- Existing user work: `components/ui/AppNavigation.tsx` has 23 insertions and 36 deletions. The change includes formatting and a `w-max` class. Refactor slices must not stage or alter it.
- Existing suppressions: five `@ts-ignore` comments, all in Mushaf web-style code. This baseline does not justify adding another suppression.
- Platform forks: the Zayt preview, database native loaders, and QPC font loading have native or web files. The generated native require map is protected input, even though it is large.
- Baseline failures: none in the required checks below. Expo printed `NO_COLOR` warnings during the web export and smoke run.

### Baseline checks

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run test:unit -- --runTestsByPath tests/unit/fsrs-scoring.test.ts` | 3 tests passed |
| `npm exec jest --runInBand tests/unit/sync-restore-contract.test.ts tests/unit/settings-contract.test.ts` | 15 tests passed in the database candidate audit |
| `npm run build:web` | Passed, 39 static routes exported |
| `npx playwright test --project=smoke-chromium tests/e2e/smoke.spec.ts` | 27 tests passed |

### Protected inputs

Do not change Quran text, Ayah identifiers, word positions, page mappings, page fonts, Arabic assets, bundled datasets, `assets/data/quran.db`, native require maps, generated web data, native generated output, or Supabase production state as part of a structural slice.

## Ownership map

| Domain | Owner | Caller-facing interface and invariant | External edge |
|---|---|---|---|
| Routes and screen orchestration | `app/` | Routes coordinate providers, domain modules, and focused views. They do not own reusable policy. | Expo Router and React Native lifecycle |
| Mushaf reading | `lib/mushaf/` and `components/mushaf/` | Surah, Ayah, word, page, Juz, and Hizb mappings keep their established meaning across every caller. | Bundled Quran data, fonts, audio, and Quran Foundation content |
| Memorization review | `lib/fsrs/` | Study card scheduling, deck policy, queue selection, scoring, and smart-deck rules sit behind typed functions. Views consume domain results, not storage rows from other domains. | `ts-fsrs`, SQLite, achievements, and leaderboard sync |
| Local persistence | `lib/database/` | The provider owns database readiness. Schema, initialization, migrations, queueing, and account restore have separate responsibilities even where legacy files still combine them. | Expo SQLite, OPFS, browser locks, and bundled data |
| Settings and themes | `lib/settings/` | One provider owns loaded settings, direction, themes, and semantic color behavior. | Async storage and synchronized user settings |
| Selection and personal notes | `lib/selection/` and `lib/notes/` | Selection actions preserve Unicode Quran text for copying. Private notes remain distinct from public reflections. | SQLite and optional account sync |
| Reflections and journeys | `lib/reflections/` and `lib/reflection-journey/` | Feed interactions, journey entries, and their persistence rules remain separate from private notes. | Supabase and SQLite |
| Account sync | `lib/database/sync.ts`, `lib/sync/`, and `lib/quran-foundation/` | Remote values are untrusted at entry. Account restore finishes before normal queued uploads. Local reading remains available without the network. | Supabase, Quran Foundation, NetInfo, and auth sessions |
| Language and direction | `lib/i18n/` and `lib/ui/direction.tsx` | Arabic and English stay complete. RTL and LTR behavior is explicit at the UI edge. | Locale and platform direction APIs |

## Candidate ranking

1. Flashcard review transition. `app/flashcards/session.tsx` is 2,318 lines with 4,580 changed lines across 50 history entries in the six-month sample. Two app entry paths reach a leaf route, but no test directly exercises its card conversion, review log mapping, or same-day requeue rule. A pure module can hide those rules without changing persistence order or product policy.
2. User setting sync. `lib/database/init.ts` is 1,427 lines and `lib/database/sync.ts` is 1,053 lines. They contain 38 and 36 measured `any`-style escapes. A typed user-setting slice is narrow, but it crosses SQLite, queue, restore, and Supabase semantics, so it follows the safer review transition slice.
3. Mushaf orchestration. `app/(tabs)/mushaf.tsx` and `components/mushaf/PageMushaf.tsx` total 3,360 lines and are high churn. They also touch protected mappings and the widest RTL, theme, viewport, web, and native matrix.
4. Settings orchestration. `app/(tabs)/settings.tsx` has the highest measured churn, 7,731 changed lines across 99 history entries. Recent theme work and broad UI contracts make it a poor first structural move.

Churn is a prompt to inspect, not a reason to split a file by itself.

## Quality floor

Every slice must satisfy these checks or record the exact exception.

| Rule | Reproducible check |
|---|---|
| No new TypeScript suppression or `any` escape | `git diff --cached --unified=0 -- '*.ts' '*.tsx' | rg '^\+.*(@ts-ignore|@ts-expect-error|\bany\b|as unknown as)'` returns no added match |
| No skipped test or unfinished stub | `git diff --cached --unified=0 -- tests lib app components | rg '^\+.*(\.skip\(|\.todo\(|TODO|throw new Error\("Not implemented)'` returns no added match |
| Type contracts remain valid | `npm run typecheck` passes |
| The moved behavior has a red-capable check | A focused Jest file fails before implementation and passes after it |
| Protected inputs stay untouched | `git diff --cached --name-only -- assets/data public/data android lib/database/native-loaders.native.ts` returns no file |
| Dependencies stay stable unless the slice requires one | `git diff --cached --name-only -- package.json package-lock.json` returns no file |
| Secrets stay out of the change | `git diff --cached --name-only | rg '(^|/)\.env($|\.)|credential|secret|signing'` returns no match, then the staged diff is read in full |
| Patch structure is clean | `git diff --check` passes and the full task diff is reviewed |

## Slice 001, flashcard review transition

Status: completed and pushed in `0cf8b24`.

Goal: move FSRS card conversion, transition mapping, review-log mapping, and same-day requeue eligibility from the route into one pure module under `lib/fsrs/`.

The caller should provide a study card, rating, time, and optional deck review policy. It should receive the updated study card, the review record fields needed for persistence, and a requeue decision. The route keeps persistence order, review counters, points, achievements, navigation, and rendering.

Non-goals:

- Do not change whether points use the card's pre-review difficulty and stability.
- Do not make card update and study-log insertion atomic in this slice.
- Do not change queue ordering, daily limits, smart-deck materialization, scheduler defaults, or review labels.
- Do not touch Quran content, mappings, settings UI, sync behavior, or the existing navigation change.

Open product decisions:

- Decide whether leaderboard points should use pre-review or post-review scheduling values.
- Decide whether a review must persist its card update and study log in one atomic operation.

### Outcome

- Added `lib/fsrs/review-transition.ts` with one pure interface for saved reviews and schedule previews.
- Moved scheduler-card conversion, updated-row mapping, review-record mapping, state validation, and same-day requeue eligibility out of `app/flashcards/session.tsx`.
- Deleted the route's `toFSRSCard` and `isCardDueThroughToday` copies. Two production callers remain, both in the session route.
- Replaced the persisted-state cast with an explicit check for the four supported scheduler states.
- Preserved card-update then study-log ordering, pre-review point inputs, queue ordering, scheduler defaults, and all route rendering.

### Characterization and verification

- The focused Jest file first failed because `lib/fsrs/review-transition.ts` did not exist.
- The completed interface has 12 transition cases. Together with existing FSRS scoring coverage, 15 focused tests passed.
- `npm run typecheck` passed.
- ESLint on the three changed TypeScript files reported 0 errors and 5 pre-existing warnings in the session route.
- `npm run build:web` passed and exported 39 routes.
- The Chromium smoke suite passed all 27 routes.
- No manual seeded-database grade, native device run, or visual comparison was performed. The route smoke test checks startup only.

### Sibling result

`app/flashcards/vocab.tsx` remains a separate raw `ts-fsrs` path. It uses the `vocab_cards` schema, different scheduler setup, no study log, and two casts. Treat it as a separate characterization slice before changing its defaults or persistence behavior.

The full security-focused patch review is in [HAFIZ_DIFFERENTIAL_REVIEW_2026-08-30.md](../../HAFIZ_DIFFERENTIAL_REVIEW_2026-08-30.md). It found no security regression and records the history, blast radius, test limits, and remaining product decisions.
