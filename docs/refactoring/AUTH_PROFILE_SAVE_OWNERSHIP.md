# Profile save ownership investigation

RF125 is verified and primary accepted at ece140a. It repairs password/reset ownership, not all account publishers. RF025 remains unapproved. Its next bounded repair is the profile editor/store save pair.

## Reproduced failures

The actual current Zustand store runs with the existing profile request fixture and deferred service responses. Of20 diagnostic cases,16 safety assertions fail and four controls pass. Twelve cases cover late success, error packets and promise rejection after user switch, signout, same-ID new login or an away/back cycle. Late success replaces the current profile. Late failures overwrite the current error, and every old completion clears the current loading state. Four more cases change the owner during ensureProfile. The store still starts the old explicit-ID update after that lookup becomes obsolete.

The current-owner success, error/rejection and signed-out controls pass. The probe uses synthetic legacy IDs and session strings with a mocked profile service. It is actual store behavior, not actual AuthClient, server RLS, browser or native evidence. Future repair tests need valid synthetic UUID/JWT session identities and real coordinator behavior. Evidence is .refactor-baseline/rf025-owner-audit-v1/receipt.json and profile-update-probe.log. The initial fixture's Haste naming warning and corrected repeat remain preserved. No source changed.

## Next exact scope

RF127 is unapproved and has five proposed paths. lib/auth/store.ts and types.ts must give the only updateProfile caller an explicit completed/superseded result using the accepted auth coordinator. components/profile/ProfileModalContent.tsx owns the mounted edit attempt, avatar-upload continuation, draft/status/cache effects and duplicate-submit guard. The new auth-profile-update-owner and profile-save-lifecycle tests must exercise the actual store and rendered caller. Do not approve copying until primary-authored exact artifacts pass these contracts.

Reuse authCommands, AuthOwner/AuthCommandResult and validated session identity. Do not add another global revision or interpret USER_UPDATED/TOKEN_REFRESHED as a new login. Keep the existing profile queries, patch construction, trimming, clear-versus-undefined fields, avatar API, editor controls and bilingual messages. Preserve current error identity and signed-out rejection. Do not dispatch a new update after an obsolete ensure/upload step. An issued remote write cannot be rolled back by ignoring its result.

Define same-owner ordering before implementation. Prefer the existing FIFO coordinator for store commands and a synchronous per-editor submission guard. Suppress old profile, loading, error, avatar/draft/status and Query cache/invalidation continuations after genuine replacement, newer explicit auth intent, editor disposal or superseded edit attempt. Bind callbacks to their rendered operation so delayed A callbacks cannot act on B. Same-session metadata/token refresh must preserve legitimate current operations. Account replacement must clear the old editor draft without clearing a current draft on token refresh.

## Parent work still open

The root currently creates QueryClient inline and has no auth cache bridge. There is no lib/query directory or auth-query-lifecycle test yet. Reflections query functions also write component-local pagination state after awaiting service results. These paths need an actual QueryClient and rendered lifecycle investigation; this probe does not prove cache isolation.

Leaderboard sync has an unguarded response assignment to auth profile and later remote phases after awaits. The root initializes auth on mount without owning a returned listener disposer. Those are inspected leads, not additional reproduced failures in this receipt. Main SDK background/initialization attribution, PKCE/auxiliary/channel lifetime, offline restore and wider account isolation remain RF025. RF127 cannot close the parent. No personal SQLite deletion, server policy, production, dependency or protected-content change is authorized.

This document records primary diagnosis and a proposed repair scope. No implementation, controller acceptance, full application test/build, browser or device result is claimed for RF127.

## Primary candidate, not approved

The five-path candidate is .refactor-baseline/rf127-profile-save-v1/manifest.json. It reuses the accepted FIFO owner and adds an optional owner to ensureProfile. Profile saves now use the existing editor-local profileSaving state instead of writing global auth isLoading. This intentional loading change avoids leaving cancelled saves globally busy or clearing unrelated auth work. The sole caller retains its visible busy state and a synchronous duplicate guard. Current error identity and field patching remain covered.

A memoized edit lifetime keeps a render-origin owner and an effect owner. Cleanup cancels the effect owner; StrictMode setup can replace it only while the origin remains current. Captured input/save/close/picker/upload continuations check that lifetime. Store notifications close obsolete edits. Completion also closes a still-mounted obsolete edit when a newer explicit intent produced no store notification. Query cache and invalidation callbacks receive intervening owner checks. Already-invoked avatar API work has no new cancellation, rollback or storage HTTP/RLS attribution guarantee here.

Primary preflight passes strict types,119 suites/1677 tests with no skips, five-file zero-warning lint, four-file formatting, three platform graphs and synthetic web export. ProfileModalContent keeps its existing whole-file formatting debt. The new tests include32 actual store/coordinator cases and23 rendered-caller cases with real Query cache callbacks. Three real Chrome flows pass through the built app at390x844: English and Arabic current save, and an already-issued A save completing after actual SDK BroadcastChannel notification of B. All other remote hosts are blocked. Settled English/Arabic editor screenshots were inspected; the first animation captures remain preserved.

The first StrictMode failure, silent-intent cleanup failure, old input callback failure, fixture setup/lint/syntax failures and original comparisons remain in the evidence directory. All3631 tracked inputs restore exactly. No source is installed or accepted. Final bounded contract review, exact Knip parity, frozen handoff, fresh controller verification, separate stronger review and primary acceptance remain. RF127 stays unapproved.

## Frozen V2 handoff

Primary prepares RF127 V2 for the pinned loop. A new actual-editor regression reproduces blocked user dismissal after silent auth supersession during a pending upload. closeEdit now revokes only its active mounted edit scope, allowing dismissal even after that auth owner expires. Old close callbacks remain inactive after replacement/reopen. Mutation guards stay intact. Current avatar upload/removal/retry and late-picker controls pass. The wrong localized test key and both failing probes remain preserved.

Ten canonical temporary-install checks pass,119 suites/1682 cases without skips, types, five-file zero-warning lint, four-file format, three graphs, synthetic export, exact five-record Knip debt and three real Chrome phone flows. Fresh settled English/Arabic editor screenshots were inspected. All3631 tracked inputs restore exactly. Evidence .refactor-baseline/rf127-profile-save-v2/preparation-receipt.json. The five-path copy-only handoff is .refactor-baseline/rf127-handoff-v1/readiness.md. Fresh controller gates, separate stronger review and primary acceptance remain mandatory. No native/device/live-service, avatar transport rollback/RLS or parent RF025 completion claim.
