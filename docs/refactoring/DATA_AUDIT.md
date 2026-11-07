# Offline data audit

Audited on 2026-11-07 in the isolated modernization worktree. This is a checked-in source audit and synthetic local database evidence, not a production assessment.

The review covers [schema.sql](../../supabase/schema.sql), all 20 files in [migrations](../../supabase/migrations/), [SQLite schema](../../lib/database/schema.ts), [sync](../../lib/database/sync.ts), its [payload validation](../../lib/database/sync-payloads.ts), and both checked-in Quran Foundation Edge Functions. Protected content and deployed services were unchanged.

## Sync contracts

Remote personal rows carry user_id and owner policies. SQLite keeps one local dataset; persistent account ownership remains RF025. The table identities below include user_id remotely.

| Table                      | Remote conflict identity        | Deliberate boundary                                                                                                                 |
| -------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| user_settings              | key                             | Only the existing setting allowlist syncs; caches and local import markers stay local.                                              |
| user_word_meanings         | surah, ayah, word_pos           | Remote deletion uses a tombstone; local application removes the override.                                                           |
| study_cards                | id                              | Scheduling fields, timestamps and status/tombstone columns are present.                                                             |
| study_log                  | generated int8 id               | The client deduplicates by card_id/reviewed_at; public aggregates count distinct events. Historical duplicate rows remain possible. |
| bookmarks                  | surah, ayah                     | SQLite 0/1 and remote boolean collection flags are intentional representations.                                                     |
| highlights                 | sync_id, with legacy id support | The remote unique index supports user_id/sync_id; local integer identity is separate.                                               |
| private_notes              | id                              | QF range JSON text and remote JSONB are decoded at the existing boundary.                                                           |
| reflection_journey_entries | level_id                        | Draft/completed state, response and completion timestamps have matching remote columns.                                             |
| achievement_unlocks        | achievement_id                  | Public badge payloads are intentionally public; local seen/notification state is not synced.                                        |

No missing required sync column was identified after considering the migration history. This does not establish server installation state, race safety or lossless retry.

The 20 migration files cover auth profile creation; community tables and feed ranges; notes, achievements and journey entries; QF connection/state/nonce fields; avatar storage; public profile aggregates; card statuses and profile fields; settings/meaning sync; distinct review events; comment likes; and serialized aggregate refreshes. Some history is not idempotent. The base schema omits public_review_activity/public_review_stats and the latest aggregate implementations. It is not the complete current installer. Follow the reviewed [administrator procedure](../hetzner-migration.md), not the old SQL-editor header or a linked cloud CLI.

## Confirmed local database behavior

A cached PostgreSQL 17 container ran with no network or exposed ports, 512 MiB memory and no swap. Unchanged schema.sql and the current comment-like migration were supplied over stdin. Auth/storage stubs and explicit fixture table grants are assumptions, not Supabase gateway, JWT or Storage verification. The owned container and temporary storage were removed.

- **RF166, count drift:** after user B reacted to A's post/comment, stored/actual counts were likes 0/1, comments 1/2 and comment likes 0/1. A's seed comment explains the initial 1. The three trigger functions use invoker permissions, while RLS prevents B updating A's parent. Repaired in source by [20261107180000_definer_reaction_counters.sql](../../supabase/migrations/20261107180000_definer_reaction_counters.sql) and the matching schema.sql functions: the three functions run as their owner with an empty search path, refuse to run for any other table, have EXECUTE revoked, and the migration recounts existing totals. PostgreSQL documents [safe definer functions](https://www.postgresql.org/docs/17/sql-createfunction.html). Because the counters fire only on insert and delete, likes now have separate insert and delete policies and no UPDATE privilege; otherwise moving a like by UPDATE could shift any reflection's count. The recount holds share locks so a reaction committed during it is not lost. The same isolated PostgreSQL 17 probe then showed correct counts for cross-author inserts and deletes and for 20 concurrent likes, an unchanged count after another user's direct UPDATE, a refused like move, no EXECUTE or likes UPDATE privilege for anon or authenticated, and a refused trigger on an unrelated table. It ran as a superuser through stubs, not PostgREST, so a non-superuser owner and concurrent writes during the recount were not exercised. The functions must be owned by the migration role that owns these tables. A fresh install still needs every migration in order, because 002_reflections_tables.sql and the comment-likes migration re-create the old functions and the old likes policy. Not applied to any deployed database.
- **RF170, access choice:** for hidden and soft-deleted parents, anonymous and B queries saw zero parents but two comments, one like and one comment like. A physical parent delete cascaded all children. Existing child policies are unconditionally public. The user has been asked whether discussion/reactions should follow parent visibility; no access policy changed.
- **Owner controls:** B saw zero of A's note, journey, setting and meaning rows; A saw one of each. These four controls support their tested RLS paths, not every policy or service.
- **RF168, timestamp boundary:** PostgreSQL rejected an empty TIMESTAMPTZ with SQLSTATE 22007. The legacy highlight wire schema admits empty updated_at and outgoing normalization preserves it. An actual queued transport regression and a compatible fallback remain required.

Two probe setup failures were preserved: text interpolation damaged SQL dollar quoting, then readiness briefly matched the image's initialization server. Literal payload substitution and final postgres-process readiness corrected the harness. Neither was an application failure.

## Other repair candidates

These are source findings awaiting focused causal fixtures and exact implementation scopes.

- **RF167:** initial and settings-only backfills catch queue INSERT failures and still write completion markers. A missing queue entry can then be skipped permanently.
- **RF171:** notes, selections, meanings, reviews, settings and smart-deck paths can persist local changes before detached queue writes fail. With completed backfill, ordinary upload has no missing entry to retry. Reuse existing transactions, include required queue writes, and keep achievement/review notifications after commit. Prepare feature-sized repairs.
- **RF169:** a remote freshness SELECT precedes an unconditional upsert or deletion write. Another device can write in that interval. Rechecking on the client cannot make the write atomic. Establish the server conflict contract before repair.

## Edge Function and deployment boundaries

[qf-user](../../supabase/functions/qf-user/index.ts) validates the caller through server Auth and filters service-role operations by the verified user. Credentials are encrypted server-side; QF connection/state tables enable RLS without client policies. The OAuth completion path reads an unused state before exchange/storage and marks it consumed afterward. Atomic claim behavior is a re-enable review item; upstream one-use codes/PKCE mean an exploit is not established here.

[qf-content](../../supabase/functions/qf-content/index.ts) validates actions/configuration/ayah inputs but has no handler-level caller authentication or local rate limit. Wildcard CORS is not admission control. No checked-in Supabase config defines the deployed gateway JWT setting. Deno and live upstream flows were not exercised.

The recorded [Hetzner procedure](../hetzner-migration.md) disables QF and public function routing pending credentials/reauthorization. It also records disabled signup, recovery and Google login pending SMTP/OAuth configuration. No current live state was inferred or contacted. Production SQL, credentials, account changes and deployment remain outside this task. The audit accepts no proposed repair and does not close RF025 or native/device verification.
