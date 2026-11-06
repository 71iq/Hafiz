# Query cache detachment

Hafiz pins an additive patch for `@tanstack/query-core` 5.95.0 in `patches/@tanstack+query-core+5.95.0.patch`. Existing postinstall applies it through patch-package. Keep patch and locked version together. A future upgrade must reproduce these controls before removal or regeneration.

## Cause and repair

Installed QueryCache.remove destroys a query before deleting its matching entry. Destruction synchronously aborts pending work. Callbacks can reuse the old Query, including its data and rollback state. Detaching one object first fixes same-key admission but still lets a callback publish or fetch on another captured key awaiting removal. Later removal then erases or cancels that new work.

The patch adds QueryCache.removeMany for an exact-object snapshot. Its first loop detaches every currently matching object with no callbacks. Duplicate, stale and absent objects are ignored. Only then does it destroy and notify each detached object. Normal QueryClient calls from callbacks therefore build separate Queries for every selected key. Original remove and all other existing methods remain unchanged. Source, modern/legacy CJS/ESM, four declaration rollups and four corresponding source maps are patched.

The auth binding calls removeMany once for its four viewer/local roots. It then resets detached old objects to clear remaining mounted results, even after owner replacement or unbind. Migrated observers retain their new Query. Public roots are excluded. Successful same-owner rebinds retain fresh data, including a rebind inside a retirement callback. A QueryClient-owned status records refreshing, complete or incomplete; every same-owner binding shares the active boundary. Replacement owners start their own cleanup.

Both retirement and reset attempt later objects after a synchronous error, then propagate the first error. An error leaves the pass incomplete; later refresh or rebind retries conservatively and can evict fresh results from that failed pass. Fresh-result preservation does not extend across an error/retry path. A throwing observer can interrupt other observers of that same Query; later Queries still receive reset attempts. The patch does not suppress callback errors or claim recovery of arbitrary throwing application code.

## Verification and scope

Permanent tests exercise actual root, auth store/coordinator and Query runtime, all four viewer roots, public controls, session/ABA changes, abort/removal/reset notifications, stable-owner cross-key data and pending/paused work, late success/error, cancellation rollback, unbind/rebind, observer migration and explicit error policy. Original single-object removal retains separate characterization.

Controller checks must apply the patch with error-on-fail, match all 13 target hashes, execute the source QueryCache class and all four compiled formats, and check source maps. Full unit, types, zero-warning lint, formatting, platform graphs, web/Android/iOS JavaScript exports and browser gates remain mandatory. Native exports establish JavaScript bundling, not compilation or physical-device behavior.

The four auth roots currently have no initialData, placeholderData or cache hydration. Reset cannot promise to erase future initial-data options. Directly re-adding a detached object or using its Query methods bypasses normal client admission. Wider SDK publishers, shared SQLite ownership, later callback admission, server/RLS authorization and transport rollback remain separate work.
