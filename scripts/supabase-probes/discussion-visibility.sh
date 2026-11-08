#!/usr/bin/env bash
# RF170 probe: isolated PostgreSQL 17 container with no network and synthetic users; never touches
# production. Shows discussion visibility for anon, another user and the author across active,
# hidden, deleted, reactivated and hard-deleted reflections, before and after the RF170 migration.
# Requires Docker and a cached postgres:17 image. Usage: SCHEMA=<old schema.sql> bash scripts/supabase-probes/discussion-visibility.sh
set -euo pipefail
WT="$(cd "$(dirname "$0")/../.." && pwd)"
SCHEMA="${SCHEMA:-$WT/supabase/schema.sql}"
NAME="hafiz-rf170-probe-$$"
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
psql < "$WT/supabase/migrations/20260614214500_reflection_comment_likes.sql" >/dev/null 2>&1
psql < "$WT/supabase/migrations/20261107180000_definer_reaction_counters.sql" >/dev/null 2>&1
psql <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
SQL

A=00000000-0000-4000-8000-000000000001
B=00000000-0000-4000-8000-000000000002
R=10000000-0000-4000-8000-000000000001
C=20000000-0000-4000-8000-000000000001

seed() {
psql >/dev/null <<SQL
TRUNCATE public.reflection_comment_likes, public.reflection_comments, public.reflection_likes, public.reflections CASCADE;
DELETE FROM public.profiles; DELETE FROM auth.users;
INSERT INTO auth.users (id, email) VALUES ('$A', 'a@example.invalid'), ('$B', 'b@example.invalid');
INSERT INTO public.profiles (id, username) VALUES ('$A', 'usera'), ('$B', 'userb') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.reflections (id, user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content)
  VALUES ('$R', '$A', 2, 255, 255, 3, 3, 'synthetic reflection text');
INSERT INTO public.reflection_comments (id, reflection_id, user_id, content) VALUES ('$C', '$R', '$A', 'author comment');
INSERT INTO public.reflection_comments (reflection_id, user_id, content) VALUES ('$R', '$B', 'reader comment');
INSERT INTO public.reflection_likes (user_id, reflection_id) VALUES ('$B', '$R');
INSERT INTO public.reflection_comment_likes (user_id, comment_id) VALUES ('$B', '$C');
SQL
}

# Prints "reflections/comments/likes/comment_likes" visible to a role ($1 = anon or a user id).
visible() {
  local prefix
  if [ "$1" = anon ]; then prefix="SET ROLE anon;"; else prefix="SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$1', false);"; fi
  { echo "$prefix"; echo "SELECT (SELECT count(*) FROM public.reflections) || '/' || (SELECT count(*) FROM public.reflection_comments) || '/' || (SELECT count(*) FROM public.reflection_likes) || '/' || (SELECT count(*) FROM public.reflection_comment_likes);"; } | psql -tA | tail -1
}

as_user_try() { # $1 user, $2 SQL; prints allowed, refused-by-rls (SQLSTATE 42501) or the other error
  local out
  if out=$({ echo "\set VERBOSITY verbose"; echo "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$1', false);"; echo "$2"; } | psql -tA 2>&1); then
    echo allowed
  elif echo "$out" | grep -q "42501"; then echo refused-by-rls
  else echo "other-error: $(echo "$out" | grep -m1 ERROR)"; fi
}

report() {
  echo "  active:  anon $(visible anon)  B $(visible $B)  A $(visible $A)"
  psql -c "UPDATE public.reflections SET status = 'hidden' WHERE id = '$R';" >/dev/null
  echo "  hidden:  anon $(visible anon)  B $(visible $B)  A $(visible $A)"
  echo "  hidden:  A new like $(as_user_try $A "INSERT INTO public.reflection_likes (user_id, reflection_id) VALUES ('$A', '$R');")"
  echo "  hidden:  A new comment like $(as_user_try $A "INSERT INTO public.reflection_comment_likes (user_id, comment_id) VALUES ('$A', '$C');")"
  echo "  hidden:  B new comment $(as_user_try $B "INSERT INTO public.reflection_comments (reflection_id, user_id, content) VALUES ('$R', '$B', 'late comment');")"
  psql -c "UPDATE public.reflections SET status = 'deleted' WHERE id = '$R';" >/dev/null
  echo "  deleted: anon $(visible anon)  B $(visible $B)"
  psql -c "UPDATE public.reflections SET status = 'active' WHERE id = '$R';" >/dev/null
  echo "  reactivated: anon $(visible anon)"
  psql -c "DELETE FROM public.reflections WHERE id = '$R';" >/dev/null
  echo "  hard delete: rows left $(psql -tAc "SELECT (SELECT count(*) FROM public.reflection_comments) + (SELECT count(*) FROM public.reflection_likes) + (SELECT count(*) FROM public.reflection_comment_likes);")"
}

echo "before RF170 (reflections/comments/likes/comment_likes visible):"
seed; report
psql < "$WT/supabase/migrations/20261107190000_discussion_follows_reflection_visibility.sql" >/dev/null
echo "after RF170:"
seed; report
