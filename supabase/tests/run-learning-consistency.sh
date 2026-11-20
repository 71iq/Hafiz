#!/usr/bin/env bash
# Disposable check of supabase/migrations/20261113120000_learning_consistency.sql,
# 20261120120000_drop_halaqa.sql and 20261120200000_remove_minor_setting.sql. Starts its own
# network-less Supabase Postgres containers with synthetic users, never touches production or any other
# container, and removes each container when it is done.
#
# 1. Migration path: schema.sql at BASE_REF, the review-aggregate migrations it lacks, then
#    20261113120000. drop_halaqa.test.sql writes Halaqa rows, the drop migration runs twice in single
#    transactions, and drop_halaqa.test.sql checks the result. remove_minor_setting.test.sql then writes
#    a former minor's hidden rows, a minor on the Board and an adult's photo with the old functions; the
#    under-18 removal must refuse to run over a row written privately and leave the database as it was,
#    then runs twice in single transactions, and remove_minor_setting.test.sql checks the result. Then
#    learning_consistency.test.sql (merge parity, RLS as several users, every RPC) and
#    learning_consistency_races.sh (two-session races on the board, reflection counts and account
#    deletion). 20261117213000 is not applied: it replaces public.handle_new_user, an auth trigger
#    function that schema.sql does not carry.
# 2. Parity: a second pristine container built from the current schema.sql must dump the same public,
#    private and rls schemas, including privileges, and the same storage policies. Neither side should
#    have an rls schema any more; it stays in the dump so a leftover one shows as a difference.
#
# Usage: bash supabase/tests/run-learning-consistency.sh
#   BASE_REF  commit whose schema.sql predates the migration (default 1980757e)
#   IMAGE     Supabase Postgres image (default public.ecr.aws/supabase/postgres:17.6.1.166)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE_REF="${BASE_REF:-1980757e}"
IMAGE="${IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.166}"
PREFIX="hafiz-lc-sqltest-$$"
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
  # Platform pieces the bare image lacks: GoTrue's auth.uid() reading request.jwt.claims, and the
  # storage tables the schema's avatar policies need.
  docker exec -i "$1" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
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

pg() { local name="$1"; shift; docker exec -i "$name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
# Applies a file quietly but still shows warnings and errors. Extra arguments go to psql.
apply() {
  local name="$1"; shift
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@" >/dev/null
}

dump() {
  docker exec "$1" pg_dump -U supabase_admin -d postgres --schema-only --no-owner --schema=public --schema=private --schema=rls |
    grep -v '^--' | grep -v '^SET \|^SELECT pg_catalog.set_config\|^\\restrict \|^\\unrestrict ' | sed '/^$/d'
  # The avatar policies live on storage.objects, outside the dumped schemas.
  docker exec "$1" psql -U supabase_admin -d postgres -qtA -c \
    "SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname = 'storage' ORDER BY policyname"
}

MIGRATED="$PREFIX-migrated"
echo "== migration path in $MIGRATED (schema.sql at $BASE_REF + aggregate migrations + 20261113120000)"
start "$MIGRATED"
git -C "$ROOT" show "$BASE_REF:supabase/schema.sql" | apply "$MIGRATED"
for migration in \
  20260614181311_public_profile_review_activity_from_study_log.sql \
  20260614182342_count_distinct_public_review_events.sql \
  20261014104500_serialize_public_aggregate_refresh.sql \
  20261113120000_learning_consistency.sql; do
  apply "$MIGRATED" <"$ROOT/supabase/migrations/$migration"
  echo "applied $migration"
done

echo "== drop_halaqa over existing Halaqa rows"
pg "$MIGRATED" -v phase=before <"$ROOT/supabase/tests/drop_halaqa.test.sql" >/dev/null
# Twice, as production would run it once and a second run must change nothing.
for run in first second; do
  apply "$MIGRATED" --single-transaction <"$ROOT/supabase/migrations/20261120120000_drop_halaqa.sql"
  echo "applied 20261120120000_drop_halaqa.sql ($run run)"
done
pg "$MIGRATED" -v phase=after <"$ROOT/supabase/tests/drop_halaqa.test.sql" >/dev/null

echo "== remove_minor_setting over a former minor's hidden rows, a minor on the Board and an adult's photo"
MINOR_MIGRATION="$ROOT/supabase/migrations/20261120200000_remove_minor_setting.sql"
pg "$MIGRATED" -v phase=before <"$ROOT/supabase/tests/remove_minor_setting.test.sql" >/dev/null
# A row written privately was promised to stay private, so the migration must refuse to drop the flag
# that hides it, and its single transaction must leave the database as it was.
PRIVATE_ROW="$(pg "$MIGRATED" -tA -c "INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start,
  juz_end, content, is_private) SELECT id, 4, 9, 9, 4, 4, 'Written privately by a minor', true FROM public.profiles
  WHERE username = 'remove_user_4' RETURNING id")"
if apply "$MIGRATED" --single-transaction <"$MINOR_MIGRATION" 2>"$WORK/guard.err"; then
  echo "remove_minor_setting ran over a row written privately"
  exit 1
fi
if ! grep -q 'written privately' "$WORK/guard.err"; then
  echo "remove_minor_setting failed for another reason:"
  cat "$WORK/guard.err"
  exit 1
fi
GUARD_STATE="$(pg "$MIGRATED" -tA -c "SELECT (SELECT count(*) FROM public.reflections WHERE is_private) || '/' ||
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('is_minor', 'is_private'))
  || '/' || (SELECT count(*) FROM pg_namespace WHERE nspname = 'rls')")"
if [ "$GUARD_STATE" != "1/5/1" ]; then
  echo "the refused migration changed the database (private rows/flag columns/rls schema: $GUARD_STATE, expected 1/5/1)"
  exit 1
fi
echo "refused 20261120200000_remove_minor_setting.sql over a row written privately, database unchanged"
pg "$MIGRATED" -c "DELETE FROM public.reflections WHERE id = '$PRIVATE_ROW'"
for run in first second; do
  apply "$MIGRATED" --single-transaction <"$MINOR_MIGRATION"
  echo "applied 20261120200000_remove_minor_setting.sql ($run run)"
done
pg "$MIGRATED" -v phase=after <"$ROOT/supabase/tests/remove_minor_setting.test.sql" >/dev/null
dump "$MIGRATED" >"$WORK/migrated.sql"

echo "== SQL tests"
docker cp "$ROOT/supabase/tests/habit-merge-cases.json" "$MIGRATED:/tmp/habit-merge-cases.json" >/dev/null
# Query results go to /dev/null; assertion notices and failures arrive on stderr.
pg "$MIGRATED" <"$ROOT/supabase/tests/learning_consistency.test.sql" >/dev/null
echo "== race tests"
bash "$ROOT/supabase/tests/learning_consistency_races.sh" "$MIGRATED"
docker rm -f "$MIGRATED" >/dev/null

FRESH="$PREFIX-fresh"
echo "== schema.sql parity in $FRESH"
start "$FRESH"
apply "$FRESH" <"$ROOT/supabase/schema.sql"
dump "$FRESH" >"$WORK/fresh.sql"
docker rm -f "$FRESH" >/dev/null
if diff -u "$WORK/migrated.sql" "$WORK/fresh.sql" >"$WORK/parity.diff"; then
  echo "parity: schema.sql matches the migrated public, private and rls schemas and storage policies ($(wc -l <"$WORK/fresh.sql") dump lines)"
else
  echo "parity: differences between the migrated database and schema.sql"
  cat "$WORK/parity.diff"
  exit 1
fi
echo "== all checks passed"
