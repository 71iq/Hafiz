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
