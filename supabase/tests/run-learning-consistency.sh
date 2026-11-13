#!/usr/bin/env bash
# Disposable check of supabase/migrations/20261113120000_learning_consistency.sql. Starts its own
# network-less Supabase Postgres containers with synthetic users, never touches production or any other
# container, and removes each container when it is done.
#
# 1. Migration path: schema.sql at BASE_REF, the review-aggregate migrations it lacks, then this
#    migration. Runs learning_consistency.test.sql there (merge parity, RLS as several users, every RPC),
#    then learning_consistency_races.sh (two-session races on the board, halaqa and encouragement locks).
# 2. Parity: a second pristine container built from the current schema.sql must dump the same public
#    and private schemas, including privileges.
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
GRANT USAGE ON SCHEMA storage TO postgres;
SQL
}

pg() { local name="$1"; shift; docker exec -i "$name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
# Applies a file quietly but still shows warnings and errors.
apply() {
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$1" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q >/dev/null
}

dump() {
  docker exec "$1" pg_dump -U supabase_admin -d postgres --schema-only --no-owner --schema=public --schema=private |
    grep -v '^--' | grep -v '^SET \|^SELECT pg_catalog.set_config\|^\\restrict \|^\\unrestrict ' | sed '/^$/d'
}

MIGRATED="$PREFIX-migrated"
echo "== migration path in $MIGRATED (schema.sql at $BASE_REF + aggregate migrations + this migration)"
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
  echo "parity: schema.sql matches the migrated public and private schemas ($(wc -l <"$WORK/fresh.sql") dump lines)"
else
  echo "parity: differences between the migrated database and schema.sql"
  cat "$WORK/parity.diff"
  exit 1
fi
echo "== all checks passed"
