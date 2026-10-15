# Hafiz on the existing Hetzner VM

## Current status, 15 October 2026

The former Vercel project and Supabase Cloud project were deleted after the
recorded migration signoff. Both inventories now return zero projects, and the
Hetzner HTTPS endpoints still pass. Retained source exports and VM/local
backups are the recovery source. The deleted projects cannot be resumed. Do
not use the ignored Supabase CLI link or any linked-cloud command for
production. Account and Supabase organization closure remains separate work.
The migration acceptance records below describe the 14 October cutover.

Production moved to this VM on 2026-10-14. `hafizquran.app`, `www.hafizquran.app`,
`api.hafizquran.app` and `staging.hafizquran.app` use automatic HTTPS. The
former source hosting and cloud project were deleted after signoff. Their final
export and original configuration remain in retained backups.

## Deployment

Use `elpsycongro-production`, `159.69.191.148`, through the existing verified
SSH configuration at
`/home/ehab/.local/share/elpsy-hetzner-migration/ssh_config`.

Caddy serves the static Expo export. Hafiz has its own Compose project,
Docker network, containers, database, storage, signing keys and deploy account.
The API gateway binds to `127.0.0.1:8100`. The existing application and its
ports `3000`, `8000`, `5432` and `6543` are unchanged.

Use the official Supabase `self-hosted/v0.8.2` configuration at commit
`564eab8ad7840b13324f68b1bfac074ef8d51c21`, then layer
`deploy/hetzner/docker-compose.private.yml` over it. Seven services run.
Studio, metadata, Realtime and the pooler require the explicit `operator`
profile. Hafiz uses REST sync and has no Realtime subscriptions or server
reminder jobs. FSRS review scheduling runs in the client database.

The running images have been checked on the VM and are ARM64. The seven
container memory limits total 2 GiB. The initial VM measurement was 5.8 GB
available RAM and 58 GB available disk. The source database was about 35 MB,
with 12 users, 13 sessions and four avatar files totaling 5,096,256 bytes.
Builds run outside the VM. Five retained exports use about 2.2 GB at the
current export size. Deployment refuses to start below 5 GiB free disk and
limits both compressed and expanded archives. Nightly backups run at 04:00 UTC,
after the existing application's backup and cleanup jobs.

During a CI deployment, one-second samples recorded at least 5,236 MiB
available RAM and 55.47 GiB free disk. A backup run recorded at least
5,299 MiB available RAM and 55.99 GiB free disk. Peak one-minute loads were
1.90 and 1.06 respectively on four vCPUs. These measurements describe the
current 12-account dataset; monitor growth before raising service limits.

## Credentials and source backups

Local migration files live in
`/home/ehab/.local/share/hafiz-hetzner-migration`, mode 0700. SQL, archives,
inventories and credentials stay there, with mode 0600. On the VM, use
`/etc/hafiz` and `/root/hafiz-migration`, also mode 0700.

The source was Supabase project `frzewjaxijhtezfvcgll`. It was paused and
restored for export during the migration. The source backups
include a full PostgreSQL custom dump, application schema and data, auth
configuration, both deployed Edge Functions, all four storage downloads and
their SHA-256 manifest. `source-dns.txt` is the original Cloudflare zone export.

The restore includes the `public` schema and the `private` functions used by
review and progress triggers. It preserves user IDs, password hashes,
identities, sessions, refresh tokens, timestamps and soft deletes. The target
keeps its own managed Auth migration history. Empty Auth tables unavailable
in the pinned image are omitted; nonempty incompatible tables must stop the
restore. The signup trigger on `auth.users` is restored separately.

The cloud schema is missing fields that the current client uses. After the
restore, apply these existing migrations to the VM and reload the PostgREST
schema cache:

- `supabase/migrations/20260523142000_study_card_statuses.sql`
- `supabase/migrations/20260524062349_add_profile_bio.sql`
- `supabase/migrations/20260524065455_add_profile_country.sql`
- `supabase/migrations/20260526153500_user_word_meanings.sql`
- `supabase/migrations/20261014104500_serialize_public_aggregate_refresh.sql`

The changes add nullable columns and an empty vocabulary table with ownership
policies. The new aggregate migration serializes refreshes per account and
handles competing inserts into public progress and review activity. It changes
the two existing trigger functions without rewriting historical rows.
Compare original columns when
repeating source fingerprints after these migrations.

Profile counters update the existing account row; an upsert with only counters
fails the required username check before conflict handling. Automatic sync
waits for initial settings and translation import. It acquires its guard before
the asynchronous connectivity check, which previously allowed simultaneous
startup runs and overlapping SQLite transactions. The review upload checks
whether any matching event exists, including when the source has duplicates.
It preserves those historical rows.

The Mushaf records a consumed deep link before navigation. Saved-position
restoration checks that record before scheduling or executing a scroll, so
restoration cannot move the reader away from the requested ayah.

Hafiz's original symmetric signing secret is retained, with a new private EC
signing key and the source EC public key for verifying existing tokens. Never
copy any El Psy Congroo credential into this stack. GoTrue selects its signer
using `key_ops: ["sign", "verify"]`; other keys use `key_ops: ["verify"]`.
The web build sets `EXPO_PUBLIC_SUPABASE_AUTH_STORAGE_KEY` to
`sb-frzewjaxijhtezfvcgll-auth-token` to preserve the original browser session
storage entry. Verify a real session refresh before accepting continuity.

Supabase exposes secret hashes, not their original values. Its Auth config
also returns a hash for the Google client secret. Use the original credential
or a new second secret from the existing Google OAuth client, while preserving
the first secret for the old hosting.

The owner confirmed that the original Quran Foundation encryption key is
unavailable and requested disabling the integration for now. Set
`EXPO_PUBLIC_QF_USER_AUTH_ENABLED=false` and
`EXPO_PUBLIC_QF_CONTENT_ENABLED=false` in the web build. Login, connection,
external sync, audio and remote hadith controls are hidden, content requests
stop before calling Supabase, and Caddy has no public function route.
All connection records, identities, cached content and original deployed
functions remain in the migration backups. Do not generate a replacement key
and assume it can decrypt the old connection. Re-enabling the integration
requires credentials and reauthorization of the affected connection.
The owner requested temporarily disabling signup, password reset and Google
login. Build with `EXPO_PUBLIC_EMAIL_AUTH_FLOWS_ENABLED=false` and
`EXPO_PUBLIC_SOCIAL_AUTH_ENABLED=false`. The app hides those actions and redirects
direct signup/recovery routes to login. Caddy rejects email-dependent endpoints.
GoTrue has `GOTRUE_DISABLE_SIGNUP=true` and `GOTRUE_EXTERNAL_GOOGLE_ENABLED=false`.
Existing password login, session refresh and account sync remain enabled.
Keep email confirmation enabled. To restore the disabled flows, supply SMTP and
a valid Google client secret, update the server settings and CI variables, then
verify email delivery and OAuth before re-enabling the controls.

## Automatic releases

`.github/workflows/hetzner-deploy.yml` builds reviewed `main` commits with
Node 24, typecheck, relevant unit tests, archive tests and browser smoke tests.
It packages only the static export, attribution file, release commit and a
checksum manifest. The deploy step has a separate Hafiz SSH key. Its forced
command accepts `deploy <40-character-commit>` and a bounded archive.
It does not allow an interactive shell or forwarding.

The archive permits Expo's exact `dist/_expo/.routes.json` path. Other hidden
files remain forbidden. Caddy caches hashed bundles under `/_expo/static`
and bundled assets, while HTML and the route manifest require revalidation.
The Quran Foundation connection flow returns to its initiating web origin,
so staging can test the callback without sending it to the old production app.
Native clients retain the canonical HTTPS callback.

`hafiz-promote` validates paths, entry types, file counts, size limits and every
file checksum, then swaps `/opt/hafiz/current` atomically. If the HTTP check
fails, it restores the previous link. Five releases remain under
`/opt/hafiz/releases`. A repeated deployment of the active commit checks
health and exits without replacing it.

Public CI variables are `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_QF_USER_AUTH_ENABLED`,
`EXPO_PUBLIC_QF_CONTENT_ENABLED`, `EXPO_PUBLIC_EMAIL_AUTH_FLOWS_ENABLED`,
`EXPO_PUBLIC_SOCIAL_AUTH_ENABLED` and `HAFIZ_HETZNER_HOST`. CI secrets are `HAFIZ_HETZNER_DEPLOY_KEY` and
`HAFIZ_HETZNER_KNOWN_HOSTS`. Server secrets never enter the web build or Git.
Infrastructure, database migrations and Edge Function source changes require
an administrator deployment. The web deploy key cannot modify them.

## Staging and cutover

1. Verify table counts and SHA-256 fingerprints before adding QA records.
   The first restore matched 28 application/Auth tables and 6,541 rows.
2. Restore the original avatar bucket settings and storage policies. Download
   every destination object and compare its SHA-256 with the source manifest.
3. Add `api.hafizquran.app` and `staging.hafizquran.app` A records for the VM,
   with DNS proxying off. Keep all existing apex, www, mail and TXT records.
4. Import `/etc/caddy/hafiz.caddy` from the existing Caddyfile. Initially load
   only the staging/API domains and loopback port 8081. Validate the combined
   configuration before every reload. Preserve the existing file's contents
   and save its pre-migration copy at `/root/hafiz-migration/Caddyfile.before`.
5. Add the new API callback to the existing Google OAuth client's authorized
   redirect URLs. Preserve its old callback and original client secret.
6. Test the real VM web export at phone, tablet and desktop widths, both
   languages and the relevant themes. Verify Quran rendering, fonts, SQLite
   startup, deep links, reading, review, login, private access and two-client
   sync. Confirm signup, recovery, Google and Quran Foundation controls and routes
   stay unavailable, while password login and refresh still work.
7. Test backup restoration and restart recovery. Repeat ehabmaali.com checks.
8. Stop source writers for the final snapshot. Repeat export, restore and
   fingerprint checks. Reconcile avatar URLs and source storage ownership.
   Remove all staged QA rows before the final restore.
9. Install the complete Hafiz Caddy configuration, validate it with the existing
   configuration, then change only the apex hosting A record. Its original
   value was `216.198.79.1`; `www` already points to the apex. Verify public
   DNS, automatic HTTPS, redirect behavior and the deployed commit.
10. Verify the already enabled backup and health timers. Retain Vercel and the source data for
    rollback until production acceptance and native compatibility are confirmed.

The owner confirmed that Hafiz is currently used only on the web. No installed
native clients require a migration. Future native builds must use the new public backend
settings and verify them before retiring the old endpoint. Do not allow both
backends to accept independent production writes after cutover. A temporary
compatibility plan must preserve queued local writes and prevent split data.

## Backup and recovery

The root-owned backup script shares `/run/hafiz/operation.lock` with deployment.
It stops only Hafiz Auth, REST, Storage and Functions while taking a consistent
database and file snapshot, then restarts those services even on failure.
Reading the static site remains available. Backups include a PostgreSQL custom
dump, database roles, the private database configuration volume, storage,
Edge Function code, private configuration, release pointer, row fingerprints
captured while writers are stopped and a SHA-256
manifest. Complete backups retain seven days under `/var/backups/hafiz`.
Partial backups remain for operator review. Copy completed backups off the VM
into the local private migration directory. Existing Hetzner VM backups also
cover Hafiz; no additional server or backup subscription is required.

Use these commands on the VM:

```sh
systemctl status hafiz-backend.service hafiz-backup.timer hafiz-health.timer
/usr/local/sbin/hafiz-health
/usr/local/sbin/hafiz-backup
/usr/local/sbin/hafiz-compose ps
```

For a restore drill, verify the manifest, create a separate database in
`hafiz-db`, and restore with `supabase_admin` and `pg_restore --exit-on-error`.
Compare counts and fingerprints before removing the disposable database.
Use the backup's `fingerprints.jsonl`, since the running database may have
received new writes after the backup.
Inspect the storage archive and verify every file hash. Do not restore over
the running production database during a drill.

For real recovery, stop Hafiz writers, restore the matched database, storage
and private configuration into the pinned initialized stack, and verify
private access and checksums before enabling writes. On a replacement VM,
recreate the isolated project, restore `roles.sql` and unpack
`database-config.tar.gz` into Hafiz's own `hafiz_db-config` volume at
`/etc/postgresql-custom`. Restore the backed-up Edge Function files before
starting the runtime. Restore Caddy's Hafiz import without replacing the
other site's configuration.

To roll back the web release, atomically point `/opt/hafiz/current` at a retained
verified release and run the local health check. Recovery from a wider failure
uses the retained VM and local backups. Stop writers, restore the matched
database, storage archive and private configuration on a replacement VM, then
route traffic after health checks. The deleted Vercel and Supabase Cloud
projects cannot be restored or resumed.

The health timer runs every five minutes and reports failures through systemd
and the journal. It checks static HTTP, the Auth endpoint, database readiness
and Docker health. No external alert destination is configured.

## Verification recorded during staging

The first restore matched 28 source tables and all 6,541 rows. All four restored
avatar objects matched their original hashes. A completed VM backup restored
into the separate `hafiz_restore_check` database with matching fingerprints,
12 original accounts and 2,482 review-log rows. The storage archive also passed
path, size and SHA-256 checks. Restarting `hafiz-backend.service` brought all
seven containers back healthy while Caddy and ehabmaali.com remained active.

The revised backup also restored into `hafiz_restore_verified`. All 54 tables
and 6,756 rows matched the fingerprints captured while backup writers were
stopped. This count includes managed tables and sanitized staging fixtures.

Real browser checks covered SQLite initialization, Quran glyphs and fonts,
the `2:255` deep link, English and Arabic direction, phone, tablet and desktop
widths, and white, beige, dark, AMOLED and system themes. Sanitized VM-only
accounts passed password sign-in, token refresh, owned bookmark/vocabulary
access and isolation from another account and anonymous access. Separate
Chrome and in-app browser clients signed in successfully. The review reveal
and grading flow saved a test result. Both disposable production test accounts and their data were removed after
verification. The final database retains all 12 original accounts.

An original imported account refresh token was accepted by the VM and kept
its original user ID. The web build keeps the original Auth storage key. Existing browser tabs that
still run the old bundle must reload to use the new API. Their local SQLite
files and queued changes are not reset by the migration.

Signup, password reset, Google login and Quran Foundation are intentionally
disabled at the owner's request. The owner confirmed web-only usage. Restoring
Google login requires a valid client secret; restoring signup and recovery
requires SMTP. Quran Foundation also needs credentials and reauthorization.

Supabase's [platform restore guide](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
documents the separate storage, function, OAuth and SMTP configuration needed
for self-hosting. Its [signing-key guide](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys)
describes verification of symmetric and asymmetric tokens.

## Production verification and recovery points

The final source snapshot contains 28 application/Auth tables and 6,541 rows.
Every table fingerprint matched the candidate database before reconciling one
profile avatar URL to the new API. All four avatar files, their ownership and
source timestamps were verified. Empty managed Auth tables with incompatible
versions were skipped; nonempty incompatible data causes the import to stop.
The generated Quran database retained SHA-256
`1c849fad2ddb62408f68d80acc804f44249071c16f41fbb20cc9bf5f11adeb9f`.
Quran text, page mappings, fonts, datasets and licenses were not regenerated.

The final snapshot and verification manifests are under
`/root/hafiz-migration/final-source` on the VM and
`/home/ehab/.local/share/hafiz-hetzner-migration/final-source` locally.
The saved staging database is `hafiz_staging_before_cutover`; the running
application database remains `postgres`. It contains the original 12 accounts,
102 private notes and 2,482 review rows after removing test accounts.

The clean backup `20261014T162113Z` restored into
`hafiz_restore_final_20261014`. All 54 tables and 6,718 rows matched the frozen
backup fingerprints. The four storage archive paths, sizes and SHA-256 hashes
also matched. A private copy is under the local migration directory's
`vm-backups/20261014T162113Z` folder. Additional backups taken after the final
web release use the same verified backup procedure.

Restarting only `hafiz-backend.service` recovered all seven healthy containers.
Caddy and El Psy Congroo stayed active. The existing site's authenticated browser
session loaded and reported that all device changes had synced; its private
localhost health endpoint also returned `status: ok`. Hafiz still has roughly
5.3 GiB of available RAM and 56 GiB of free disk on this VM.

Production checks verified automatic HTTPS, HTTP redirects, the www redirect
with its query string, password login, original-token refresh, private-note
ownership and isolation, and review persistence. A note written in the main
production app arrived in a second browser using the same API and export on
staging. Reading, translation and review reveal/grading worked. The same export
was checked at phone, tablet and desktop sizes, in English and Arabic, and in
white, beige, dark, AMOLED and system themes.

Cold Arabic phone deep links exposed a list-positioning issue during verification.
The reader now waits for settings and the requested page font before positioning
a deep link, and uses an immediate scroll. It awaits FlashList's asynchronous
scroll, checks the visible index range and retries missed targets. A new
request or unmount cancels further attempts. The Chromium regression test
checks that 2:255 is actually in the viewport, rather than only checking that the
route renders. It covers a cold link and navigation from a saved position.
It failed before the change and passed after it.

The static export still emits an occasional recoverable React hydration warning
and the existing React Native web animation fallback warning. No blank screen or
failed tested flow resulted. These warnings remain separate application issues.
No native build was tested because no installed native clients are in use.

The apex A record is now `159.69.191.148`, with DNS proxying off. The www CNAME,
five mail MX records and SPF TXT record were preserved. At cutover, Vercel
retained its deployments with `git.deploymentEnabled=false`, build-ignore command
`exit 0` and `gitProviderOptions.createDeployments=disabled`. Those projects
were deleted on 15 October. Recovery uses retained VM and local backups.
The previous apex A record was `216.198.79.1`.

The ignored Supabase CLI link still names the deleted source cloud project. Do
not use `supabase db push --linked` for production. Apply reviewed migrations
through Hafiz's private VM database connection. Do not rerun the private
bootstrap credential generator against an existing stack.
