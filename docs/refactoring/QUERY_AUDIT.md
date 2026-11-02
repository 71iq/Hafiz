# Account-dependent queries and auth lifecycle

Audited on 2026-11-02 at the accepted RF118 source. This is an offline audit, not a runtime repair. Two auth-store races and two rendered reflection-state failures reproduce with synthetic data. No live account, network service, production data or deployed policy was used.

## Scope and ownership

The inventory covers all authored query and prefetch declarations under app, components and lib. There are eleven key families across twelve declarations. Root owns one module-level QueryClient with five-minute default staleTime and retry one. Auth uses a separate Zustand store. No cancellation or private-cache removal is wired between these owners. The route and auth store do not recreate the client on identity change. A retained cache entry is not by itself proof that another viewer can read it.

Source owners are [root providers](../../app/_layout.tsx), [auth store](../../lib/auth/store.ts), [profile modal](../../components/profile/ProfileModalContent.tsx), [feed](<../../app/(tabs)/reflection-feed.tsx>), [leaderboard](<../../app/(tabs)/leaderboard.tsx>), [reflection section](../../components/reflections/ReflectionsSection.tsx), [comments](../../components/reflections/CommentsSheet.tsx) and [reflection writer](../../components/reflections/WriteReflectionSheet.tsx).

## Current keys

| Family                              | Key inputs after family                                | Result ownership and freshness                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reflectionFeedOptions               | uiLanguage                                             | Local SQLite surah and juz options. Explicit staleTime: Infinity. Elapsed time does not make these results stale. Database instance is captured but absent from the key. Review database lifecycle separately from remote identity. |
| reflectionFeed                      | filter, sort, viewer ID, juz ranges, normalized search | Two minutes. Public posts plus viewer likes. Infinite Query owns pageParam and page arrays.                                                                                                                                         |
| reflections                         | surah, ayah, first-page zero, viewer ID                | Five minutes. Public posts plus viewer likes. First-page Query also mutates local rows. Later pages bypass Query through the same service.                                                                                          |
| reflectionCount                     | surah, ayah                                            | Five minutes. Count of active public posts covering the ayah. No personalized field in this service.                                                                                                                                |
| reflectionComments                  | reflection ID, sort, viewer ID                         | One minute. Public comments plus viewer likes. Infinite Query owns pageParam.                                                                                                                                                       |
| leaderboard                         | tab                                                    | Two minutes. Both active query and four-tab prefetch use this family. Public aggregate loaders also await viewer-specific score/profile sync before reading.                                                                        |
| publicProfile                       | requested user ID                                      | Two minutes. Public profile and aggregate statistics. Own-profile UI instead uses the auth-store profile.                                                                                                                           |
| publicAchievementUnlocks            | requested user ID                                      | Two minutes. Remote public badge payload.                                                                                                                                                                                           |
| currentUserPublicAchievementUnlocks | viewer ID                                              | One minute. Local SQLite recent unlocks, not a remote read. A viewer key does not establish ownership of the underlying database.                                                                                                   |
| publicReviewActivity                | requested user ID                                      | Two minutes. Public activity with the service's fixed default90-day window. The service also reads the current date.                                                                                                                |
| publicSurahProgress                 | requested user ID                                      | Two minutes. Remote aggregate enriched with local surah names.                                                                                                                                                                      |

The three reflection/comment result keys already include user?.id. Their services attach user_has_liked using that viewer. Do not diagnose those current keys as missing identity. Key factories must preserve filter, sort, search, ranges, target and viewer semantics. PageParam belongs to infinite-query state rather than a separate top-level key for each page. If callers later expose a configurable activity window, that window must enter its key. Current date rollover and database replacement need explicit freshness tests.

## Public and personalized data

[Reflection services](../../lib/reflections/api.ts) select active public posts, public comments and joined public profile fields, then attach viewer likes in a separate query. Count has no viewer-dependent enrichment. [Leaderboard services](../../lib/leaderboard/api.ts) select target-specific public profile, badge and review aggregates. Public achievement mapping exposes publicPayload and creates an empty localPayload.

Checked-in policy intent supports viewer-independent reads for profiles and daily_scores in [schema.sql](../../supabase/schema.sql), active reflections and public likes/comments in [reflection migration](../../supabase/migrations/002_reflections_tables.sql), badges in [achievement migration](../../supabase/migrations/003_achievements_notes.sql), surah progress in [progress migration](../../supabase/migrations/20260523113645_public_profile_progress.sql), and review aggregates in [review migration](../../supabase/migrations/20260614181311_public_profile_review_activity_from_study_log.sql). This review does not prove live schema parity, column privacy or every migration's security. RF033 owns offline parity. No RLS or schema change is proposed here.

Keep truly public cache families shareable after their read contracts are verified. Keep viewer-enriched rows and local private results separate. Leaderboard data can be public while its query function still performs an account-dependent write. RF024/RF025 must separate that sync ownership without introducing duplicate writes or changing score policy.

## Confirmed findings

### Late profile response crosses identity

The actual auth store captures a user before awaiting fetchProfile or ensureProfile and later sets profile without an identity or generation check. Each isolated case starts under synthetic-a, switches store user/profile to synthetic-b, resolves A's request, and observes user B with profile A. These are two reproduced state-ownership failures. They are not evidence of unauthorized server reads.

RF025 must cover late success and fallback, updateProfile, sign-out, account replacement and sign-out followed by login with the same ID. An ID comparison alone cannot distinguish separate sessions for the same user. Review already-started writes separately from late UI state. Initialize also starts ensureProfile without awaiting it and retains no unsubscribe handle from onAuthStateChange. Duplicate initialization and stale listener ownership are static risks needing lifecycle tests, not reproduced failures in this audit.

### Correct Query keys do not isolate mirrored rows

The actual ReflectionsSection and real QueryClient run with mocked service and child-render boundaries. A has liked a synthetic post, B has not. With a fresh B cache entry, switching the same mounted section to B leaves A's like state on screen. B's cache remains correct and the fresh query does not rerun the callback that updates the local array.

A second case defers both viewers' requests, switches A to B, completes B first, then completes A. The rendered rows revert to A's like state even though B's cache remains correct. Query callbacks ignore cancellation signals and write local state after awaits. These are two reproduced native-tree state failures. They do not claim a browser screenshot, physical-device result or server-side data leak.

RF025 must make displayed state follow the active result owner, isolate manual pagination and prevent late callbacks from writing into a newer identity. Cancellation alone is insufficient when a service ignores its signal or a query callback performs unrelated state writes. Keep independent safety regressions when repairing; do not keep tests that expect these failures as product requirements.

## Other risks requiring fixtures

CommentsSheet resets local comments and like overrides on reflectionId only. Viewer change does not reset them. Feed comment deltas survive viewer/filter changes. Profile local overview awaits SQLite calls and sets local statistics without a generation check. Profile drafts reset on selected profile fields/user ID, and avatar drafts reset on user ID, but those resets do not cancel older async work. These are source findings, not additional reproduced leaks.

Auth initialization, direct sign-in, signup, OAuth/linking and auth notifications all assign user/session and can start profile loading. Sign-out clears auth state even after an external sign-out error, but does not clear Query cache. Audit error, same-ID reauthentication and multiple-listener paths before choosing the generation owner. Do not change offline personal-data ownership or destroy local SQLite content as a cache repair.

## Invalidation owners

| Trigger                          | Current owner and invalidation                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reflection creation              | WriteReflectionSheet invalidates reflections and reflectionCount for each affected ayah, plus reflectionFeed.                                                                                         |
| Section write completion         | ReflectionsSection invalidates its reflections and reflectionCount prefixes.                                                                                                                          |
| Feed comment completion          | Feed increments local comment deltas and invalidates reflectionFeed.                                                                                                                                  |
| Profile edits                    | ProfileModalContent invalidates publicProfile, reflectionFeed, reflections, reflectionComments and leaderboard prefixes.                                                                              |
| Local review activity            | ProfileModalContent reloads local overview and updates profile stats, then invalidates own publicReviewActivity/publicSurahProgress.                                                                  |
| Sync completion with pulled rows | ProfileModalContent reloads local overview, updates stats and invalidates own currentUserPublicAchievementUnlocks.                                                                                    |
| Likes/comments                   | ReflectionCard and CommentsSheet update local state or notify parents; do not assume they invalidate every matching query page. RF026 owns rollback, page reconciliation and late mutation callbacks. |

Prefix invalidation currently reaches multiple viewers, targets or sorts. Narrow it only after shared factories and pagination tests prove correct coverage. A successful write, later refresh and local optimistic state are separate owners. No mutation rollback repair is included here.

## Verification and follow-up

Evidence is under .refactor-baseline/rf023-account-audit-v3. The first independent review rejected the v2 feed-options freshness claim; it is corrected here to the explicit Infinity override and all declaration freshness options are now recorded from the TypeScript syntax tree. The isolated Jest configuration retains jest-expo transforms, mappings and normal setup, but discovers only the two audit probes. Four current-behavior cases pass because they observe the unwanted behavior. The auth-store probes execute the real Zustand store. The rendered probes execute the real QueryClient and ReflectionsSection, mock the auth selector, and explicitly rerender the same mounted component when the selected synthetic viewer changes. Supabase/OAuth/Quran Foundation, the rendered auth selector, reflection service, settings and child presentation are mocked boundaries. The Query implementation is not mocked. No unsafe expectation enters the permanent test suite.

The earlier two-case probe and partial inventory remain under .refactor-baseline/rf023-account-audit-v1. RF023 changes only this document. Fresh controller integrity, isolated four-case reproduction, formatting and whitespace checks plus stronger independent review are required. Full application unit suite, typecheck, web/native build, browser and device checks are not required for this document-only audit and are not claimed.

RF024 owns bounded feature-local key factories and matching invalidations. RF025 owns the confirmed profile/mirrored-state defects and identity, cancellation and late-work tests. RF026 owns mutation rollback and pagination. RF027 owns remaining manual fetch ownership, RF028 native focus/online lifecycle, RF029 local sync failure, and RF033 offline schema parity. Each needs exact preparation before approval. The findings remain open until separate repairs and independent acceptance pass. No push, merge, deployment, production operation or protected Quran-input change occurred.
