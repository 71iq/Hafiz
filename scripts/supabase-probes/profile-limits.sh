#!/usr/bin/env bash
# Probe for supabase/migrations/20261120185900_signup_display_name_limit.sql and
# 20261120190000_profile_field_limits.sql. Starts network-less Supabase
# Postgres containers with synthetic users, never touches production or any other container, and
# removes each container when it is done.
#
# 1. Migration path: schema.sql at BASE_REF with the sign-up trigger production runs
#    (001_handle_new_user_trigger.sql, 20261117213000), rows shaped like production's, then both
#    migrations, in order, twice in single transactions. Field writes as an account, with and without the
#    deployment's avatars prefix, a minor's photo, sign-ups through auth.users, and a violating row,
#    which must stop the migration and leave the database as it was.
# 2. Parity: a database built from the current schema.sql must define the same constraints, prefix
#    table, trigger and grants. handle_new_user is compared with 20261120185900's definition, because
#    schema.sql does not carry that auth trigger.
#
# Usage: bash scripts/supabase-probes/profile-limits.sh
#   BASE_REF  commit whose schema.sql predates the migration (default 286c3706)
#   IMAGE     Supabase Postgres image (default public.ecr.aws/supabase/postgres:17.6.1.166)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE_REF="${BASE_REF:-286c3706}"
IMAGE="${IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.166}"
SIGNUP="$ROOT/supabase/migrations/20261120185900_signup_display_name_limit.sql"
MIGRATION="$ROOT/supabase/migrations/20261120190000_profile_field_limits.sql"
PREFIX="hafiz-profile-limits-$$"
WORK="$(mktemp -d)"
STARTED=()
cleanup() {
  rm -rf "$WORK"
  for name in "${STARTED[@]}"; do docker rm -f "$name" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT

start() {
  docker run -d --name "$1" --network none --memory 1g -e POSTGRES_PASSWORD=synthetic "$IMAGE" >/dev/null
  STARTED+=("$1")
  for _ in $(seq 1 90); do
    if docker exec "$1" psql -U supabase_admin -d postgres -tAc "select 1" >/dev/null 2>&1; then break; fi
    sleep 2
  done
  sleep 2
  docker exec -i "$1" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT, allowed_mime_types TEXT[]
);
CREATE TABLE IF NOT EXISTS storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT, owner UUID);
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets OWNER TO postgres;
ALTER TABLE storage.objects OWNER TO postgres;
GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
SQL
}
pg() { local name="$1"; shift; docker exec -i "$name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
apply() {
  local name="$1"; shift
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@" >/dev/null
}
FAILED=0
check() { # $1 label, $2 expected, $3 actual
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2], got [$3]"; FAILED=1; fi
}
API="https://api.hafizquran.app/storage/v1/object/public/avatars"
A=00000000-0000-4000-8000-00000000000a
B=00000000-0000-4000-8000-00000000000b
M=00000000-0000-4000-8000-00000000000c
# One statement as account $1. Prints "ok" or the error's constraint or message.
as_user() {
  local out
  if out=$(printf "SET ROLE authenticated;\nSELECT set_config('request.jwt.claim.sub', '%s', false) \\\\g /dev/null\n%s\n" "$1" "$2" |
    docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA 2>&1 >/dev/null); then
    echo ok
  else
    sed -n -E 's/.*violates check constraint "([^"]+)".*/\1/p; s/.*ERROR: +(A profile photo must be in this project.s avatars bucket).*/\1/p' <<<"$out" | head -1
  fi
}

NAME="$PREFIX-migrated"
echo "== migration path in $NAME (schema.sql at $BASE_REF, sign-up trigger, both migrations twice)"
start "$NAME"
git -C "$ROOT" show "$BASE_REF:supabase/schema.sql" | apply "$NAME"
apply "$NAME" <"$ROOT/supabase/migrations/001_handle_new_user_trigger.sql"
apply "$NAME" <"$ROOT/supabase/migrations/20261117213000_provider_signup_username.sql"
pg "$NAME" >/dev/null <<SQL
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('$A', 'a@example.invalid', '{"username": "user_a", "display_name": "Account A"}'),
  ('$B', 'b@example.invalid', '{"username": "user_b"}'),
  ('$M', 'm@example.invalid', '{"username": "user_m"}');
UPDATE public.profiles SET avatar_url = '$API/$A/1763000000000.jpg' WHERE id = '$A';
SQL

echo "== a violating row stops the migration and changes nothing"
fail_out=$( { echo "UPDATE public.profiles SET display_name = repeat('x', 61) WHERE id = '$B';"; cat "$MIGRATION"; } |
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q --single-transaction 2>&1 >/dev/null || true)
check "violating row stops the migration" "profiles_display_name_length" \
  "$(sed -n -E 's/.*check constraint "([^"]+)".*/\1/p' <<<"$fail_out" | head -1)"
check "rolled back: no new constraint" "0" "$(pg "$NAME" -c "SELECT count(*) FROM pg_constraint WHERE conname = 'profiles_display_name_length'")"
check "rolled back: display name kept" "" "$(pg "$NAME" -c "SELECT coalesce(display_name, '') FROM public.profiles WHERE id = '$B'")"

for run in first second; do
  apply "$NAME" --single-transaction <"$SIGNUP"
  apply "$NAME" --single-transaction <"$MIGRATION"
  echo "applied 20261120185900 and 20261120190000 ($run run)"
done
check "existing production-shaped rows kept" "3|1" "$(pg "$NAME" -c "SELECT count(*), count(avatar_url) FROM public.profiles")"

echo "== field writes by an account"
check "username with a space" "profiles_username_format" "$(as_user "$A" "UPDATE public.profiles SET username = 'user a' WHERE id = '$A';")"
check "username with a lookalike letter" "profiles_username_format" "$(as_user "$A" "UPDATE public.profiles SET username = 'usеr_a' WHERE id = '$A';")"
check "username of 21 characters (the existing length check)" "profiles_username_check" "$(as_user "$A" "UPDATE public.profiles SET username = repeat('a', 21) WHERE id = '$A';")"
check "valid username" "ok" "$(as_user "$A" "UPDATE public.profiles SET username = 'User_A2' WHERE id = '$A';")"
check "display name of 61 characters" "profiles_display_name_length" "$(as_user "$A" "UPDATE public.profiles SET display_name = repeat('n', 61) WHERE id = '$A';")"
check "display name of 60 Arabic characters" "ok" "$(as_user "$A" "UPDATE public.profiles SET display_name = repeat('ح', 60) WHERE id = '$A';")"
check "no display name" "ok" "$(as_user "$A" "UPDATE public.profiles SET display_name = NULL WHERE id = '$A';")"
check "photo on another site" "profiles_avatar_url_own_file" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = 'https://tracker.example/pixel.gif' WHERE id = '$A';")"
check "photo in another account's folder" "profiles_avatar_url_own_file" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = '$API/$B/1763000000000.jpg' WHERE id = '$A';")"
check "photo with a query" "profiles_avatar_url_own_file" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = '$API/$A/1763000000000.jpg?x=1' WHERE id = '$A';")"
check "photo with user info in the host" "profiles_avatar_url_own_file" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = 'https://api.hafizquran.app@tracker.example/storage/v1/object/public/avatars/$A/1.jpg' WHERE id = '$A';")"
check "photo of an unsupported type" "profiles_avatar_url_own_file" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = '$API/$A/1763000000000.svg' WHERE id = '$A';")"
check "own photo on the API host" "ok" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = '$API/$A/1763000000001.webp' WHERE id = '$A';")"
check "own-folder path on another host, no prefix row" "ok" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = 'https://other.example/storage/v1/object/public/avatars/$A/1.png' WHERE id = '$A';")"
check "local development host, no prefix row" "ok" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = 'http://127.0.0.1:54321/storage/v1/object/public/avatars/$A/1.png' WHERE id = '$A';")"

echo "== with the deployment's avatars prefix"
check "the prefix table is not readable by accounts" "permission denied" \
  "$(printf "SET ROLE authenticated;\nSELECT * FROM private.avatar_public_prefix;\n" | docker exec -i "$NAME" psql -U postgres -d postgres -qtA 2>&1 | grep -o 'permission denied' | head -1)"
pg "$NAME" -c "INSERT INTO private.avatar_public_prefix (prefix) VALUES ('$API/') ON CONFLICT (only_row) DO UPDATE SET prefix = EXCLUDED.prefix" >/dev/null
check "a second prefix row is refused" "refused" "$(pg "$NAME" -c "INSERT INTO private.avatar_public_prefix (only_row, prefix) VALUES (false, '$API/')" >/dev/null 2>&1 && echo stored || echo refused)"
check "own-folder path on another host" "A profile photo must be in this project's avatars bucket" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = 'https://other.example/storage/v1/object/public/avatars/$A/1.png' WHERE id = '$A';")"
check "own photo on the API host" "ok" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = '$API/$A/1763000000002.png' WHERE id = '$A';")"
check "other fields still save with the photo in the row" "ok" "$(as_user "$A" "UPDATE public.profiles SET display_name = 'Account A', avatar_url = avatar_url WHERE id = '$A';")"
check "removing the photo" "ok" "$(as_user "$A" "UPDATE public.profiles SET avatar_url = NULL WHERE id = '$A';")"
pg "$NAME" -c "INSERT INTO public.profile_privacy (user_id, is_minor) VALUES ('$M', true) ON CONFLICT (user_id) DO UPDATE SET is_minor = true" >/dev/null
check "a minor's off-host photo is cleared, not an error" "ok" "$(as_user "$M" "UPDATE public.profiles SET avatar_url = 'https://other.example/storage/v1/object/public/avatars/$M/1.jpg' WHERE id = '$M';")"
check "a minor keeps no photo" "" "$(pg "$NAME" -c "SELECT coalesce(avatar_url, '') FROM public.profiles WHERE id = '$M'")"

echo "== sign-up through auth.users"
pg "$NAME" >/dev/null <<SQL
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000000d1', 'd1@example.invalid', jsonb_build_object('username', 'long_name', 'display_name', repeat('d', 75))),
  ('00000000-0000-4000-8000-0000000000d2', 'd2@example.invalid', '{"username": "bad name", "display_name": "Fine"}'),
  ('00000000-0000-4000-8000-0000000000d3', 'd3@example.invalid', '{}');
SQL
check "long sign-up display name is cut to 60" "long_name|60" "$(pg "$NAME" -c "SELECT username || '|' || char_length(display_name) FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000d1'")"
check "invalid requested username gets the neutral handle" "user_00000000|Fine" "$(pg "$NAME" -c "SELECT username || '|' || display_name FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000d2'")"
check "provider sign-up without metadata" "user_00000000" "$(pg "$NAME" -c "SELECT left(username, 13) FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000d3'")"

catalog() {
  pg "$1" <<'SQL'
SELECT 'constraint ' || conname || ': ' || pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conrelid IN ('public.profiles'::regclass, 'private.avatar_public_prefix'::regclass) ORDER BY conname;
SELECT 'trigger ' || tgname || ': ' || pg_get_triggerdef(oid) FROM pg_trigger
  WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal ORDER BY tgname;
SELECT 'column ' || attname || ' ' || format_type(atttypid, atttypmod) || ' ' || attnotnull FROM pg_attribute
  WHERE attrelid = 'private.avatar_public_prefix'::regclass AND attnum > 0 ORDER BY attnum;
SELECT 'table acl ' || coalesce(relacl::text, 'default') FROM pg_class WHERE oid = 'private.avatar_public_prefix'::regclass;
SELECT 'function ' || p.oid::regprocedure || ' definer=' || prosecdef || ' config=' || coalesce(proconfig::text, '') || ' acl=' || coalesce(proacl::text, 'default')
  || E'\n' || prosrc FROM pg_proc p WHERE p.oid = 'private.profiles_photo_host()'::regprocedure;
SQL
}
catalog "$NAME" >"$WORK/migrated.txt"
pg "$NAME" -c "SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure" >"$WORK/handle-migrated.txt"
docker rm -f "$NAME" >/dev/null

NAME="$PREFIX-fresh"
echo "== schema.sql parity in $NAME"
start "$NAME"
apply "$NAME" <"$ROOT/supabase/schema.sql"
catalog "$NAME" >"$WORK/fresh.txt"
# handle_new_user lives only in migrations: its body must be the one 20261120185900 defines.
apply "$NAME" <"$SIGNUP"
pg "$NAME" -c "SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure" >"$WORK/handle-fresh.txt"
if diff -u "$WORK/migrated.txt" "$WORK/fresh.txt" && diff -u "$WORK/handle-migrated.txt" "$WORK/handle-fresh.txt"; then
  echo "ok   schema.sql defines the same constraints, prefix table, trigger and grants ($(wc -l <"$WORK/fresh.txt") catalog lines)"
else
  echo "FAIL schema.sql differs from the migrated database"; FAILED=1
fi

if [ "$FAILED" = 0 ]; then echo "== all checks passed"; else echo "== some checks failed"; exit 1; fi
