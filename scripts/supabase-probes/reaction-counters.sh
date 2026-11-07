#!/usr/bin/env bash
# RF166 probe: isolated PostgreSQL 17 container with no network and synthetic users; never touches
# production. Loads schema.sql (or SCHEMA=<file>), shows counter drift, applies the RF166 migration
# and checks cross-author counts, the like-move exploit, privileges and 20 concurrent likes.
# Requires Docker and a cached postgres:17 image. Usage: bash scripts/supabase-probes/reaction-counters.sh
set -euo pipefail
WT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="hafiz-rf166-probe-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" --network none --memory 512m --memory-swap 512m \
  -e POSTGRES_PASSWORD=synthetic postgres:17 >/dev/null
# Wait for the final server (the image restarts once after initialization).
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

psql < "${SCHEMA:-$WT/supabase/schema.sql}" >/dev/null
psql < "$WT/supabase/migrations/20260614214500_reflection_comment_likes.sql" >/dev/null
psql <<'SQL'
-- Supabase grants table privileges to API roles by default; RLS decides row access.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
SQL

seed() {
psql <<'SQL'
TRUNCATE public.reflection_comment_likes, public.reflection_comments, public.reflection_likes, public.reflections CASCADE;
DELETE FROM public.profiles; DELETE FROM auth.users;
INSERT INTO auth.users (id, email) SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@example.invalid' FROM generate_series(1, 22) AS n;
INSERT INTO public.profiles (id, username) SELECT id, 'user' || substr(id::text, 25) FROM auth.users ON CONFLICT (id) DO NOTHING;
INSERT INTO public.reflections (id, user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content)
  VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 2, 255, 255, 3, 3, 'synthetic reflection text'),
         ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 2, 256, 256, 3, 3, 'attacker reflection text');
SQL
}

as_user() { # $1 = user number, stdin = SQL
  local sub="00000000-0000-4000-8000-$(printf '%012d' "$1")"
  { echo "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$sub', false);"; cat; } | psql -tA >/dev/null
}

react() { # user A comments; user B likes A's reflection, comments, and likes A's comment
as_user 1 <<'SQL'
INSERT INTO public.reflection_comments (id, reflection_id, user_id, content)
  VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'author comment');
SQL
as_user 2 <<'SQL'
INSERT INTO public.reflection_likes (user_id, reflection_id) VALUES ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
INSERT INTO public.reflection_comments (reflection_id, user_id, content) VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'reader comment');
INSERT INTO public.reflection_comment_likes (user_id, comment_id) VALUES ('00000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001');
SQL
}

counts() {
psql -tA <<'SQL'
SELECT 'likes ' || r.likes_count || '/' || (SELECT count(*) FROM public.reflection_likes WHERE reflection_id = r.id)
  || ' comments ' || r.comments_count || '/' || (SELECT count(*) FROM public.reflection_comments WHERE reflection_id = r.id)
  || ' comment_likes ' || c.likes_count || '/' || (SELECT count(*) FROM public.reflection_comment_likes)
FROM public.reflections r, public.reflection_comments c
WHERE r.id = '10000000-0000-4000-8000-000000000001' AND c.id = '20000000-0000-4000-8000-000000000001';
SQL
}

seed; react
echo "before migration (stored/actual): $(counts)"

psql < "$WT/supabase/migrations/20261107180000_definer_reaction_counters.sql" >/dev/null
echo "after migration recount: $(counts)"

seed; react
echo "fresh reactions after migration: $(counts)"

as_user 2 <<'SQL'
DELETE FROM public.reflection_likes WHERE user_id = '00000000-0000-4000-8000-000000000002';
DELETE FROM public.reflection_comment_likes WHERE user_id = '00000000-0000-4000-8000-000000000002';
DELETE FROM public.reflection_comments WHERE user_id = '00000000-0000-4000-8000-000000000002';
SQL
echo "after cross-author deletes: $(counts)"

as_user 2 <<'SQL'
UPDATE public.reflections SET likes_count = 999 WHERE id = '10000000-0000-4000-8000-000000000001';
SQL
echo "after direct count update by another user: $(counts)"

if as_user 2 <<<"SELECT public.update_reflection_likes_count();" 2>/dev/null; then
  echo "direct trigger-function call: ALLOWED (unexpected)"
else
  echo "direct trigger-function call: refused"
fi

guard=$(psql -tA 2>&1 <<'SQL' || true
CREATE TABLE public.not_a_reaction (reflection_id UUID);
CREATE TRIGGER misuse AFTER INSERT ON public.not_a_reaction FOR EACH ROW EXECUTE FUNCTION public.update_reflection_likes_count();
INSERT INTO public.not_a_reaction VALUES ('10000000-0000-4000-8000-000000000001');
SQL
)
echo "trigger attached to another table: $(echo "$guard" | grep -o 'only maintains public.reflection_likes' || echo "NOT refused")"
echo "likes after refused misuse: $(counts)"

as_user 2 <<'SQL'
INSERT INTO public.reflection_likes (user_id, reflection_id) VALUES ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');
SQL
if as_user 2 2>/dev/null <<'SQL'
UPDATE public.reflection_likes SET reflection_id = '10000000-0000-4000-8000-000000000001'
WHERE user_id = '00000000-0000-4000-8000-000000000002' AND reflection_id = '10000000-0000-4000-8000-000000000002';
SQL
then echo "moving a like by UPDATE: ALLOWED (unexpected)"; else echo "moving a like by UPDATE: refused"; fi
if as_user 2 2>/dev/null <<'SQL'
UPDATE public.reflection_comment_likes SET comment_id = comment_id WHERE user_id = '00000000-0000-4000-8000-000000000002';
SQL
then echo "updating a comment like: ALLOWED (unexpected)"; else echo "updating a comment like: refused"; fi
psql -tA <<'SQL'
SELECT 'attacker reflection likes ' || likes_count || '/' || (SELECT count(*) FROM public.reflection_likes WHERE reflection_id = r.id)
FROM public.reflections r WHERE r.id = '10000000-0000-4000-8000-000000000002';
SQL
as_user 2 <<'SQL'
DELETE FROM public.reflection_likes WHERE user_id = '00000000-0000-4000-8000-000000000002';
SQL
echo "after like/move attempt/delete cycle: $(counts)"
psql -tA <<'SQL'
SELECT 'authenticated EXECUTE ' || p.proname || '=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
  || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'update_reflection%count' ORDER BY p.proname;
SELECT 'authenticated UPDATE reflection_likes=' || has_table_privilege('authenticated', 'public.reflection_likes', 'UPDATE')
  || ' reflection_comment_likes=' || has_table_privilege('authenticated', 'public.reflection_comment_likes', 'UPDATE');
SQL

# Concurrent likes from 20 users on the same reflection.
pids=()
for n in $(seq 3 22); do
  as_user "$n" <<SQL &
INSERT INTO public.reflection_likes (user_id, reflection_id) VALUES ('00000000-0000-4000-8000-$(printf '%012d' "$n")', '10000000-0000-4000-8000-000000000001');
SQL
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
echo "after 20 concurrent likes: $(counts)"

psql -tA <<'SQL'
SELECT 'definer=' || p.prosecdef || ' config=' || array_to_string(p.proconfig, ',') || ' ' || p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'update_reflection%count' ORDER BY p.proname;
SQL
