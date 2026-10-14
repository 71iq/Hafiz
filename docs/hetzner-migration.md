# Hafiz on the existing Hetzner VM

Production cutover is pending. The apex still points to Vercel. Do not disable
the source backend until the checks below pass and client compatibility has
been confirmed.

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

## Credentials and source backups

Local migration files live in
`/home/ehab/.local/share/hafiz-hetzner-migration`, mode 0700. SQL, archives,
inventories and credentials stay there, with mode 0600. On the VM, use
`/etc/hafiz` and `/root/hafiz-migration`, also mode 0700.

The source is Supabase project `frzewjaxijhtezfvcgll`. It was paused at the
start of the migration and has been restored for export. The source backups
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

The changes add nullable columns and an empty vocabulary table with ownership
policies. They preserve existing records. Compare original columns when
repeating source fingerprints after these migrations.

Profile counters update the existing account row; an upsert with only counters
fails the required username check before conflict handling. Automatic sync
waits for initial settings and translation import. It acquires its guard before
the asynchronous connectivity check, which previously allowed simultaneous
startup runs and overlapping SQLite transactions. The review upload checks
whether any matching event exists, including when the source has duplicates.
It preserves those historical rows.

Hafiz's original symmetric signing secret is retained, with a new private EC
signing key and the source EC public key for verifying existing tokens. Never
copy any El Psy Congroo credential into this stack. GoTrue selects its signer
using `key_ops: ["sign", "verify"]`; other keys use `key_ops: ["verify"]`.
The web build sets `EXPO_PUBLIC_SUPABASE_AUTH_STORAGE_KEY` to
`sb-frzewjaxijhtezfvcgll-auth-token` to preserve the original browser session
storage entry. Verify a real session refresh before accepting continuity.

Supabase exposes function-secret hashes, not their original values. The
existing Quran Foundation content/user credentials and token encryption key
must be supplied privately and checked against those hashes. Preserve the
encryption key so the migrated connection can decrypt its saved tokens.
The source uses Supabase's shared email sender. Supply an existing SMTP
service before testing confirmation and password reset. Keep email
confirmation enabled.

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
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_QF_USER_AUTH_ENABLED` and
`HAFIZ_HETZNER_HOST`. CI secrets are `HAFIZ_HETZNER_DEPLOY_KEY` and
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
   redirect URLs. Preserve its old callback. Check the custom Quran Foundation
   OAuth provider and its allowed callback in the same way.
6. Test the real VM web export at phone, tablet and desktop widths, both
   languages and the relevant themes. Verify Quran rendering, fonts, SQLite
   startup, deep links, reading, review, login, private access and two-client
   sync. Verify actual email delivery and the Quran Foundation actions.
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

Installed native clients have the old Supabase URL embedded. The observed
source sessions were browser sessions, but that does not prove there are no
installed native apps. Rebuild native clients with the new public backend
settings and verify them before retiring the old endpoint. Do not allow both
backends to accept independent production writes after cutover. A temporary
compatibility plan must preserve queued local writes and prevent split data.

## Backup and recovery

The root-owned backup script shares `/run/hafiz/operation.lock` with deployment.
It stops only Hafiz Auth, REST, Storage and Functions while taking a consistent
database and file snapshot, then restarts those services even on failure.
Reading the static site remains available. Backups include a PostgreSQL custom
dump, storage archive, private configuration, release pointer and SHA-256
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
Inspect the storage archive and verify every file hash. Do not restore over
the running production database during a drill.

For real recovery, stop Hafiz writers, restore the matched database, storage
and private configuration into the pinned initialized stack, and verify
private access and checksums before enabling writes. On a replacement VM,
recreate the isolated project and restore its named database configuration
volume as required. Restore Caddy's Hafiz import without replacing the other
site's configuration.

To roll back the web release, atomically point `/opt/hafiz/current` at a retained
verified release and run the local health check. A rollback to Vercel also
needs source data reconciliation for any post-cutover writes, source jobs
disabled on one side, the original DNS record and restored Vercel deployment
settings. Changing DNS alone can lose newer writes.

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

Real browser checks covered SQLite initialization, Quran glyphs and fonts,
the `2:255` deep link, English and Arabic direction, phone, tablet and desktop
widths, and white, beige, dark, AMOLED and system themes. Sanitized VM-only
accounts passed password sign-in, token refresh, owned bookmark/vocabulary
access and isolation from another account and anonymous access. Separate
Chrome and in-app browser clients signed in successfully. The review reveal
and grading flow saved a test result. These fixtures must be removed before
the final source snapshot.

An original imported account refresh token was accepted by the VM and kept
its original user ID. Browser continuity at the production origin still needs
verification after cutover.

Email delivery, Quran Foundation actions and installed native clients remain
acceptance checks. The source hosting and
backend remain available, and the apex DNS record remains unchanged.

Supabase's [platform restore guide](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
documents the separate storage, function, OAuth and SMTP configuration needed
for self-hosting. Its [signing-key guide](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys)
describes verification of symmetric and asymmetric tokens.
