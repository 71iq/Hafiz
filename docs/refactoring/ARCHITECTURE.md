# Architecture

Hafiz has two data paths. Offline reading, study scheduling and private local content use SQLite. Optional account/community features use remote services. Keeping these paths separate lets the reader boot without credentials or network access.

## Ownership

| Directory                                                     | Owns                                                                        | Allowed dependencies                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| app                                                           | Route parameters, navigation, feature composition and screen lifecycle      | Feature components, domain interfaces, shared UI           |
| components/ui                                                 | Generic accessible controls, responsive layout and overlays                 | RN/platform APIs, semantic theme/direction interfaces      |
| components/mushaf and other feature folders                   | Feature interaction and rendering                                           | Their domain functions and shared UI                       |
| lib/fsrs, mushaf, notes, selection, vocab, reflection-journey | Domain rules, typed queries and content relationships                       | Local database interfaces, relevant pure helpers           |
| lib/habit, lib/hifz                                           | Wird days, streak rules and the settle pass; hifz plan, pages, tiers, daily plan, recitation grading, half-page and seam remediation, sabaq and the mistake inbox | Local database interfaces, lib/fsrs queries, pure helpers |
| lib/database                                                  | SQLite readiness, schema/init, parameterized execution and sync persistence | Expo SQLite, protected asset loaders                       |
| lib/reflections, profile, leaderboard, quran-foundation       | Domain service adapters and validated remote results                        | Existing Supabase/QF clients and domain types              |
| lib/auth, settings, sync                                      | Session, persisted settings, synchronization orchestration                  | Their storage/service adapters and platform lifecycle APIs |
| supabase                                                      | Server schema, migrations and Edge Functions                                | Reviewed separately, no loop execution                     |

The existing folders already carry useful ownership. Move a file when it crosses a demonstrated boundary, not to impose a new src/features tree. Keep route files cohesive; a private extraction can improve a test seam without creating a shared library. Do not replace large screens with equally large hooks.

Database startup gates remain in their routes. `components/ui/DatabaseErrorState.tsx` owns only title/message presentation and the existing startup/profile typography variants. Routes retain language lookup, loading progress and provider placement.

`components/mushaf/QiraatBlocks.tsx` renders supplied heading/body rows only. QiraatTab and the session QiraatAnswer retain parsing, loading, group labels, headers and scrolling. The presenter does not interpret source content. `lib/qiraat/parse.ts` owns the established marker and line-formatting rules. It preserves ordered reading bodies and applies the initial heading to the first retained body. It does not infer later headings after the source pipeline removes HTML boundaries.

`lib/fonts/use-surah-name-font.ts` owns only the shared boolean readiness lifecycle for SurahHeader and MushafPage. The existing font loader owns assets, native/web loading, cache and in-flight deduplication. Parents retain their needed predicates, rendering and page/word loading.

`lib/mushaf/page-layout.ts` owns the existing pure page clamping, typography fitting, line widths, rendered-line counts and cumulative page heights/offsets. Its private structural input contains only layout rows, page-word line numbers and the word-mode flag. It imports no UI or data loader. PageMushaf retains data/font loading, gestures, Hifz/timers, navigation, hooks and rendering. RF016 preserves all seven moved function bodies and six constants.

`lib/mushaf/position.ts` shares inclusive first-match juz range selection. It returns the original row in input order. The reader retains default-one and last-preceding-row fallback; PageMushaf retains null metadata for no match. ReflectionFeedScreen retains ordered parent groups and uses their juz value. The shared search does not sort, flatten groups, load data or choose a fallback.

`lib/search/results.ts` owns consecutive-surah text grouping and root-lemma result grouping. It preserves row references, duplicate occurrences, input order and stable descending root counts. SearchCommand retains normalization, root-index cache, SQL execution, request generations/debounce, history, keyboard/focus, selection and delayed navigation.

`lib/search/root-candidates.ts` owns ordered direct, exact lemma/word and prefix root matching. It takes the already-trimmed and diacritic-stripped terms plus a read-only index, preserves insertion order and removes duplicate or empty roots. SearchCommand owns stripping, index construction/cache, SQL and request lifecycle. The helper does not fold Arabic letters or load data.

## State and data flow

SQLite is authoritative for offline personal data. Sync restores account state before upload and preserves queue ordering, timestamps and soft deletion. TanStack Query owns remote response caching; it must not become a second durable store for local review state. Zustand owns session state. Feature UI state stays near its interaction.

`lib/settings/use-tafsir-source-selection.ts` owns the shared import/selection lifecycle for SettingsScreen and ReadingSettingsSheet. Explicit db, onSelected and onError inputs preserve each caller's settings subscription, setter and warning/toast handling. The hook rejects overlapping callbacks with a per-instance ref before React renders busy state, then releases state and ref in finally. The existing importer still owns data access. This guard does not serialize database work between different owners.

AyahDetailModal keeps its own selection coordinator because it also owns a cached-source shortcut, local selected source and reload key. Its synchronous per-instance guard runs before that shortcut, while React state controls displayed busy rows. The modal preserves its selection/reload ordering and releases ref and state in finally.

Each remote query key includes every result-changing input, including viewer identity for personalized output. Feature-local key factories belong beside their service only after multiple consumers need the same keys. Public data can share cache only when its output is truly viewer-independent. Account switch must cancel old work and remove private cached data before another account can see it.

Mutations preserve existing server semantics. Use item-local optimistic updates only where rollback and concurrent writes are defined. Invalidate the smallest correct key family after success. Do not retry writes automatically unless the operation has a proven idempotency contract.

The web database bridge owns host election, request IDs, timeout rejection, tab handoff and SQL result serialization. Parse incoming messages before execution. UI callers receive typed domain results, not unvalidated wire objects. Native SQLite and web OPFS have separate adapters and both remain supported.

## Boundaries that stay fixed

Quran text, glyphs, 604-page mappings, word positions, fonts, imported content and generated require maps are protected. Structural refactoring cannot change them. Copy/share uses Unicode text. UI changes preserve Arabic/English, RTL/LTR, theme semantics, safe areas, gestures and keyboard behavior. ResponsiveOverlay remains the overlay owner.

No task changes production infrastructure, server RLS, deployed functions, signing material or production data. The modernization branch has no push/deployment step. The original user checkout is outside the writer's working directory.

## Evaluation

A task is verified only when its controller-run commands pass and a separate read-only agent passes its specification and complete diff. Behavior-sensitive tasks also require recorded rendered/native checks. Missing infrastructure is a blocker with a recovery command. A task cannot certify itself by writing a completion marker.

## Dependency analysis

`npm run analyze:boundaries` checks web source dependencies. `npm run analyze:boundaries:android` and `npm run analyze:boundaries:ios` check each native target. All three use the same rules and installed Expo source-extension order, with platform-specific and native fallbacks. Opposite-platform entry files stay outside that target graph. Protected directories remain excluded; authored files containing words such as public or supabase remain visible.

Routes may compose domain and shared UI code. Domain modules and components/ui cannot import app routes. `npm run check:boundaries` fails on forbidden imports, cycles and unresolved modules across all three targets. The current graphs have none. Reports and checks run without caches or ignored-violation baselines. JSON analysis is report-only because dependency-cruiser 18.6.0 does not propagate violations through that reporter exit code. `npm run test:boundaries` exercises these rules and actual file resolution in isolated fixtures. Reports cover authored source relationships. They do not execute platform branches, traverse external packages, validate RLS or replace Metro exports, native compilation or device checks.

`lib/fsrs/persist-review.ts` owns the writes for an already calculated transition: the updated card, its review log with the session, timing, support level and proposed grade, the attempt's recitation errors, the inbox progress of a clean recall, the review-session counters and the day's wird status, plus any grade-specific work such as a manzil cycle completing or similar-verse cards coming due. All of them and their upload queue entries commit in one transaction, so a failed grade leaves the card, the streak and the inbox as they were; achievements and review listeners run after commit.

Wird days (`habit_days`) merge by status precedence on every device and on the server: an earned status that only rises (done, made up, earned back, paused, grace) and an excuse register that is last write wins, so a withdrawn excused day never returns whatever order rows arrive in. Streak length, grace balance, tiers and the daily plan are derived, never stored as truth. Grace and paused days are recorded by an idempotent settle pass on app open, Home focus and after sync, never by a background job. Each review stores the local date and zone it happened in, and past events are never re-dated. Local mutations follow the same rule: a row and the queue entries that upload it commit together, and side effects run after commit. The pure transition module still owns scheduling policy. The session route retains grading guards, queue/requeue, counts, scoring, achievements, sync, errors and rendering.

The database provider now exposes a stable `AppDatabase` facade over one private SQLite handle opened with `useNewConnection:true`. The owner serializes each complete ordinary operation and transaction, including statement finalization. Transaction callbacks receive a scoped executor; retained scopes and prepared commands reject after settlement. Ambiguous BEGIN and failed cleanup quarantine that handle. Close retires admission and drains work before releasing the file lock.

The versioned web bridge reserves the same owner for a remote callback. Reservations bind client, nonce, host generation and token, with a 60-second lease and 15-second heartbeat. Cleanup joins the actual owner outcome, including SQL failure after commit admission. Aborted cleanup receipts last at most 60 seconds and 64 entries; missing receipts mean unknown settlement. SQL/renew/commit never revive an expired reservation. Lost acknowledgements are not replayed. An ordinary RPC waiting behind another peer's long transaction can still time out after 60 seconds. JavaScript exports and Node/Chrome tests do not establish native SDK runtime behavior; RF041 retains that check.

Old tabs must reload before joining the new bridge protocol.
