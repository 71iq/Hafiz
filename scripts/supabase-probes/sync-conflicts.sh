#!/usr/bin/env bash
# RF169 probe: isolated PostgreSQL 17 container with no network and synthetic users; never touches
# production. Replays the client's upload and delete statements as the authenticated role to show
# whether a newer write from another device survives an older one that arrives later, including the
# case where the older write waits on the newer one's row lock.
# Requires Docker and a cached postgres:17 image. Usage: SCHEMA=<old schema.sql> bash scripts/supabase-probes/sync-conflicts.sh
set -euo pipefail
WT="$(cd "$(dirname "$0")/../.." && pwd)"
SCHEMA="${SCHEMA:-$WT/supabase/schema.sql}"
NAME="hafiz-rf169-probe-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" --network none --memory 512m --memory-swap 512m \
  -e POSTGRES_PASSWORD=synthetic postgres:17 >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -q 2>/dev/null &&
     docker exec "$NAME" sh -c 'test "$(cat /proc/1/comm)" = postgres' &&
     docker exec "$NAME" psql -U postgres -tAc "select 1" >/dev/null 2>&1; then
    sleep 1
    docker exec "$NAME" psql -U postgres -tAc "select 1" >/dev/null 2>&1 && break
  fi
  sleep 1
done

psql() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, raw_user_meta_data JSONB DEFAULT '{}'::jsonb);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT, allowed_mime_types TEXT[]);
CREATE TABLE storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT, owner UUID);
CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
SQL
psql < "$SCHEMA" >/dev/null 2>&1
psql <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
SQL

A=00000000-0000-4000-8000-000000000001
OLD=2026-01-01T00:00:00.000Z
MID=2026-01-15T00:00:00.000Z
NEW=2026-02-01T00:00:00.000Z

echo "guard triggers: $(psql -tAc "SELECT count(*) FROM pg_trigger WHERE tgname = 'sync_keep_newer_row'")"

as_user() { { echo "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$A', false) \\g /dev/null"; cat; } | psql -tA; }

seed() {
psql >/dev/null <<SQL
TRUNCATE public.user_settings, public.bookmarks, public.highlights, public.private_notes, public.study_cards,
  public.achievement_unlocks;
DELETE FROM public.profiles; DELETE FROM auth.users;
INSERT INTO auth.users (id, email) VALUES ('$A', 'a@example.invalid');
INSERT INTO public.profiles (id, username) VALUES ('$A', 'usera') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_settings (user_id, key, value, created_at, updated_at) VALUES ('$A', 'daily_review_limit', 'base', '$OLD', '$OLD');
INSERT INTO public.bookmarks (user_id, surah, ayah, created_at, updated_at) VALUES ('$A', 2, 255, '$OLD', '$OLD');
INSERT INTO public.highlights (user_id, sync_id, surah, ayah, color, created_at, updated_at)
  VALUES ('$A', 'highlight:2:255:ayah:ayah:yellow', 2, 255, 'yellow', '$OLD', NULL);
SQL
}

# Device upload as PostgREST sends it: INSERT ... ON CONFLICT DO UPDATE with every column.
upsert_setting() { # $1 value, $2 updated_at
  echo "INSERT INTO public.user_settings (user_id, key, value, updated_at, deleted_at, synced_at)
        VALUES ('$A', 'daily_review_limit', '$1', '$2', NULL, now())
        ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at, synced_at = EXCLUDED.synced_at;"
}
setting() { psql -tAc "SELECT value || ' ' || to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM public.user_settings"; }

echo "== sequential: newer device B write, then older device A write"
seed
upsert_setting device-b "$NEW" | as_user >/dev/null
upsert_setting device-a "$MID" | as_user >/dev/null
echo "setting after: $(setting)"

echo "== concurrent: A's older write waits on B's uncommitted newer write"
seed
{ echo "BEGIN;"; upsert_setting device-b "$NEW"; echo "SELECT pg_sleep(2); COMMIT;"; } | as_user >/dev/null &
B=$!
sleep 0.7
upsert_setting device-a "$MID" | as_user >/dev/null
wait "$B"
echo "setting after: $(setting)"

echo "== controls"
seed
upsert_setting same-time "$OLD" | as_user >/dev/null
echo "equal time updates: $(setting)"
upsert_setting newer "$MID" | as_user >/dev/null
echo "newer time updates: $(setting)"
echo "INSERT INTO public.user_settings (user_id, key, value, updated_at) VALUES ('$A', 'last_mushaf_position', 'x', '$OLD');" | as_user >/dev/null
echo "insert works: $(psql -tAc "SELECT count(*) FROM public.user_settings")"
echo "UPDATE public.bookmarks SET qf_synced_at = now() WHERE surah = 2;" | as_user >/dev/null
echo "metadata update with unchanged time: $(psql -tAc "SELECT qf_synced_at IS NOT NULL FROM public.bookmarks")"
echo "INSERT INTO public.highlights (user_id, sync_id, surah, ayah, color, created_at, updated_at, synced_at)
      VALUES ('$A', 'highlight:2:255:ayah:ayah:yellow', 2, 255, 'yellow', '$OLD', '$MID', now())
      ON CONFLICT (user_id, sync_id) DO UPDATE SET updated_at = EXCLUDED.updated_at;" | as_user >/dev/null
echo "null-time highlight takes an upload: $(psql -tAc "SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM public.highlights")"

echo "== conditional hard delete (client filter updated_at <= deleted time)"
seed
echo "UPDATE public.bookmarks SET updated_at = '$NEW';" | as_user >/dev/null
echo "DELETE FROM public.bookmarks WHERE user_id = '$A' AND surah = 2 AND ayah = 255 AND updated_at <= '$MID';" | as_user >/dev/null
echo "newer bookmark kept by stale delete: $(psql -tAc "SELECT count(*) FROM public.bookmarks")"
echo "DELETE FROM public.bookmarks WHERE user_id = '$A' AND surah = 2 AND ayah = 255 AND updated_at <= '$NEW';" | as_user >/dev/null
echo "bookmark removed by current delete: $(psql -tAc "SELECT count(*) FROM public.bookmarks")"
seed
{ echo "BEGIN; UPDATE public.bookmarks SET updated_at = '$NEW'; SELECT pg_sleep(2); COMMIT;"; } | as_user >/dev/null &
B=$!
sleep 0.7
echo "DELETE FROM public.bookmarks WHERE user_id = '$A' AND surah = 2 AND ayah = 255 AND updated_at <= '$MID';" | as_user >/dev/null
wait "$B"
echo "bookmark kept when the delete waits on a newer edit: $(psql -tAc "SELECT count(*) FROM public.bookmarks")"
