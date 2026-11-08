# TypeScript escape inventory

Snapshot of `lib/`, `app/` and `components/` on 2026-11-08 (RF043). Counts come from grep, so they are approximate: 201 explicit `any` (including `as any`), 106 non-`const` assertions, 19 `catch (err: any)` and 5 `@ts-ignore`. There are no `@ts-expect-error`, `@ts-nocheck`, `as unknown as` or `eslint-disable` comments.

## Remote boundaries (fix first)

Data from Supabase and the Quran Foundation edge function is untrusted. Sync rows already pass through Zod decoders in `lib/database/sync-payloads.ts`; these readers do not.

| Owner                          | Escapes                                                                                                    | Risk                                                                                         | Task  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----- |
| `lib/leaderboard/api.ts`       | 12 `as any` / `row: any` over public stats, activity and leaderboard rows                                  | A missing or mistyped field renders `undefined`, `NaN` or a wrong streak instead of an error | RF191 |
| `lib/fsrs/leaderboard-sync.ts` | `statsResult.data as any`, `(row as any).date`                                                             | Same values feed the account's own stats upsert                                              | RF191 |
| `lib/reflections/api.ts`       | 8 `as Reflection` / `as ReflectionComment` page casts                                                      | A shape change reaches feed, comment and count UI unchecked                                  | RF192 |
| `lib/quran-foundation/user.ts` | 10 assertions keyed only on `"status" in response` and similar; `(supabase.auth as any).getUserIdentities` | A partial response is treated as a full one; the identity call has no SDK type               | RF193 |

## Local storage and protected data (keep, typed at the import step)

- `lib/database/init.ts` (37) and `lib/database/native-loaders.native.ts` (3): loaders for bundled Quran, tafsir and translation JSON return `any`. These are protected, versioned assets checked by data-pipeline tests, and each import function maps them into typed SQLite rows. Typing the loaders would duplicate the dataset schemas without catching a real failure. RF188 moved native loading to asset files read through `readBundledJson`, which still returns parsed JSON for the same import functions, so this reasoning holds.
- `lib/fsrs/smart-decks.ts` (7) and `lib/database/sync.ts` (3 `highlightSyncId(row as any)`): SQL parameter arrays and a narrow helper call. Low risk; fold into a later cleanup only together with a behavior change there.

## Platform typings (keep)

- Web-only style keys (`cursor`, `position: "fixed"`, `whiteSpace`) cast or `@ts-ignore`d in `components/mushaf/*`, `components/public/PublicPage.tsx` and `components/ui/AppNavigation.tsx`. React Native's style types do not include them; react-native-web supports them. Keep until a shared typed web-style helper exists.
- `router.push(href as any)` in `components/public/PublicPage.tsx` and navigation callers: Expo Router typed-route casts for runtime-built paths.

## Error handling (low)

Done in RF194. Every `catch (err: any)` is now `catch (err)` with `errorMessage` from `lib/error-message.ts`, which reads any object's text `message` (Supabase can reject with plain objects) and otherwise returns undefined so the caller's fallback applies. Messages for real errors are unchanged.
