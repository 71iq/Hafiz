# Architecture

Hafiz has two data paths. Offline reading, study scheduling and private local content use SQLite. Optional account/community features use remote services. Keeping these paths separate lets the reader boot without credentials or network access.

## Ownership

| Directory                                                     | Owns                                                                        | Allowed dependencies                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| app                                                           | Route parameters, navigation, feature composition and screen lifecycle      | Feature components, domain interfaces, shared UI           |
| components/ui                                                 | Generic accessible controls, responsive layout and overlays                 | RN/platform APIs, semantic theme/direction interfaces      |
| components/mushaf and other feature folders                   | Feature interaction and rendering                                           | Their domain functions and shared UI                       |
| lib/fsrs, mushaf, notes, selection, vocab, reflection-journey | Domain rules, typed queries and content relationships                       | Local database interfaces, relevant pure helpers           |
| lib/database                                                  | SQLite readiness, schema/init, parameterized execution and sync persistence | Expo SQLite, protected asset loaders                       |
| lib/reflections, profile, leaderboard, quran-foundation       | Domain service adapters and validated remote results                        | Existing Supabase/QF clients and domain types              |
| lib/auth, settings, sync                                      | Session, persisted settings, synchronization orchestration                  | Their storage/service adapters and platform lifecycle APIs |
| supabase                                                      | Server schema, migrations and Edge Functions                                | Reviewed separately, no loop execution                     |

The existing folders already carry useful ownership. Move a file when it crosses a demonstrated boundary, not to impose a new src/features tree. Keep route files cohesive; a private extraction can improve a test seam without creating a shared library. Do not replace large screens with equally large hooks.

Database startup gates remain in their routes. `components/ui/DatabaseErrorState.tsx` owns only title/message presentation and the existing startup/profile typography variants. Routes retain language lookup, loading progress and provider placement.

`components/mushaf/QiraatBlocks.tsx` renders supplied heading/body rows only. QiraatTab and the session QiraatAnswer retain parsing, loading, group labels, headers and scrolling. The presenter does not interpret source content. `lib/qiraat/parse.ts` owns the established marker and line-formatting rules. It preserves ordered reading bodies and applies the initial heading to the first retained body. It does not infer later headings after the source pipeline removes HTML boundaries.

## State and data flow

SQLite is authoritative for offline personal data. Sync restores account state before upload and preserves queue ordering, timestamps and soft deletion. TanStack Query owns remote response caching; it must not become a second durable store for local review state. Zustand owns session state. Feature UI state stays near its interaction.

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
