-- Tests for 20261113120000_learning_consistency.sql. Run by run-learning-consistency.sh as postgres in a
-- disposable database with synthetic users. Any failed assertion raises and stops psql.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset pager off

SET client_min_messages = warning;
DROP SCHEMA IF EXISTS hz_test CASCADE;
SET client_min_messages = notice;
CREATE SCHEMA hz_test;
GRANT USAGE ON SCHEMA hz_test TO anon, authenticated;

-- ─── Helpers ─────────────────────────────────────────────────────────────────
CREATE FUNCTION hz_test.login(uid UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN '' ELSE jsonb_build_object('sub', uid, 'role', 'authenticated')::TEXT END, false);
$$;

CREATE FUNCTION hz_test.utc_today() RETURNS DATE LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'UTC')::DATE $$;
CREATE FUNCTION hz_test.today_text() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT to_char(hz_test.utc_today(), 'YYYY-MM-DD') $$;
CREATE FUNCTION hz_test.week_start() RETURNS DATE LANGUAGE sql STABLE AS $$ SELECT date_trunc('week', hz_test.utc_today())::DATE $$;
CREATE FUNCTION hz_test.d(day DATE) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT to_char(day, 'YYYY-MM-DD') $$;

-- Runs a statement that must fail with a message containing `fragment`.
CREATE FUNCTION hz_test.expect_error(stmt TEXT, fragment TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF position(fragment IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'expected error containing "%" from [%], got "%"', fragment, stmt, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected error containing "%" from [%], but it succeeded', fragment, stmt;
END;
$$;

CREATE FUNCTION hz_test.eq(label TEXT, actual ANYELEMENT, expected ANYELEMENT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$$;

CREATE FUNCTION hz_test.make_user(uid UUID, username TEXT, display_name TEXT, avatar TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (uid, username || '@example.invalid');
  INSERT INTO public.profiles (id, username, display_name, avatar_url) VALUES (uid, username, display_name, avatar);
$$;

-- A recorded wird day, written as the server would store it (status derived by the trigger).
CREATE FUNCTION hz_test.day(uid UUID, day DATE, earned TEXT, reason TEXT DEFAULT NULL,
  minimum_met BOOLEAN DEFAULT true, full_met BOOLEAN DEFAULT false, manzil BOOLEAN DEFAULT false)
RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO public.habit_days (user_id, local_date, earned_status, reason, excuse_updated_at, minimum_met, full_met,
    manzil_cycle_completed, tz, created_at, updated_at)
  VALUES (uid, to_char(day, 'YYYY-MM-DD'), earned, reason, CASE WHEN reason IS NULL THEN NULL ELSE now() END,
    minimum_met, full_met, manzil, 'UTC', now(), now())
  ON CONFLICT (user_id, local_date) DO UPDATE SET earned_status = EXCLUDED.earned_status, reason = EXCLUDED.reason,
    excuse_updated_at = EXCLUDED.excuse_updated_at, minimum_met = EXCLUDED.minimum_met, full_met = EXCLUDED.full_met,
    manzil_cycle_completed = EXCLUDED.manzil_cycle_completed, updated_at = EXCLUDED.updated_at
$$;

-- Fixture row (lib/habit/types.ts HabitDayRow, flags as 0/1) as a server row for one user.
CREATE FUNCTION hz_test.to_row(uid UUID, j JSONB) RETURNS public.habit_days LANGUAGE sql STABLE AS $$
  SELECT jsonb_populate_record(NULL::public.habit_days, j || jsonb_build_object(
    'user_id', uid,
    'minimum_met', (j->>'minimum_met')::INTEGER = 1,
    'full_met', (j->>'full_met')::INTEGER = 1,
    'manzil_cycle_completed', (j->>'manzil_cycle_completed')::INTEGER = 1,
    'synced_at', '2026-11-13T12:00:00.000Z'
  ));
$$;

CREATE FUNCTION hz_test.check_row(label TEXT, actual public.habit_days, expected JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  want public.habit_days := hz_test.to_row(actual.user_id, expected);
BEGIN
  IF actual.status IS DISTINCT FROM want.status
    OR actual.earned_status IS DISTINCT FROM want.earned_status
    OR actual.reason IS DISTINCT FROM want.reason
    OR actual.excuse_updated_at IS DISTINCT FROM want.excuse_updated_at
    OR actual.minimum_met IS DISTINCT FROM want.minimum_met
    OR actual.full_met IS DISTINCT FROM want.full_met
    OR actual.manzil_cycle_completed IS DISTINCT FROM want.manzil_cycle_completed
    OR actual.source_session_id IS DISTINCT FROM want.source_session_id
    OR actual.credited_through IS DISTINCT FROM want.credited_through
    OR actual.tz IS DISTINCT FROM want.tz
    OR actual.created_at IS DISTINCT FROM want.created_at
    OR actual.updated_at IS DISTINCT FROM want.updated_at THEN
    RAISE EXCEPTION E'%: server merge differs from the TypeScript merge\n  expected %\n  got      %',
      label, row_to_json(want), row_to_json(actual);
  END IF;
END;
$$;

CREATE TABLE hz_test.orders (n INTEGER, ord INTEGER[]);
INSERT INTO hz_test.orders VALUES
  (2, '{1,2}'), (2, '{2,1}'),
  (3, '{1,2,3}'), (3, '{1,3,2}'), (3, '{2,1,3}'), (3, '{2,3,1}'), (3, '{3,1,2}'), (3, '{3,2,1}');

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hz_test TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA hz_test TO authenticated;

-- Synthetic users.
SELECT hz_test.make_user('00000000-0000-4000-8000-00000000000a', 'teacher_a', 'Teacher A', 'https://example.invalid/a.png');
SELECT hz_test.make_user('00000000-0000-4000-8000-00000000000b', 'member_b', 'Member B', 'https://example.invalid/b.png');
SELECT hz_test.make_user('00000000-0000-4000-8000-00000000000c', 'outsider_c', 'Outsider C', NULL);
SELECT hz_test.make_user('00000000-0000-4000-8000-0000000000aa', 'merge_user', NULL, NULL);

-- ─── 1. Schema reshape ───────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hz_test.eq('daily_scores dropped', to_regclass('public.daily_scores'), NULL::regclass);
  PERFORM hz_test.eq('public_review_activity dropped', to_regclass('public.public_review_activity'), NULL::regclass);
  PERFORM hz_test.eq('public_review_stats dropped', to_regclass('public.public_review_stats'), NULL::regclass);
  PERFORM hz_test.eq('profile totals dropped', (
    SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name IN ('total_score', 'cards_reviewed', 'current_streak', 'longest_streak', 'last_review_date')
  ), 0::BIGINT);
  PERFORM hz_test.eq('study_log detail columns', (
    SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'study_log'
      AND column_name IN ('session_id', 'duration_ms', 'support_level', 'proposed_rating', 'grader', 'local_date', 'tz', 'error_count')
  ), 8::BIGINT);
  PERFORM hz_test.eq('study_cards tier columns', (
    SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'study_cards'
      AND column_name IN ('tier', 'tier_changed_at')
  ), 2::BIGINT);
  PERFORM hz_test.eq('keep-newer trigger on sessions and errors', (
    SELECT count(*) FROM pg_trigger WHERE tgname = 'sync_keep_newer_row'
      AND tgrelid IN ('public.review_sessions'::regclass, 'public.recitation_errors'::regclass)
  ), 2::BIGINT);
  -- Every SECURITY DEFINER function pins an empty search_path.
  PERFORM hz_test.eq('definer functions pin search_path', (
    SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.prosecdef
      AND p.proname IN ('get_board', 'join_board', 'leave_board', 'get_my_halaqas', 'create_invite_halaqa',
        'join_halaqa_by_code', 'leave_halaqa', 'join_matched_halaqa', 'set_halaqa_sharing', 'set_halaqa_member_role',
        'get_halaqa_goal', 'get_halaqa_detail', 'send_halaqa_encouragement', 'get_halaqa_teacher_view',
        'get_profile_privacy', 'set_profile_privacy', 'get_profile_summary', 'halaqa_shares_with_me',
        'habit_days_before_write')
      AND NOT (COALESCE(p.proconfig, '{}') @> ARRAY['search_path=""'])
  ), 0::BIGINT);
END $$;

-- ─── 2. Wird-day merge equals lib/habit/merge.ts (fixture from the TypeScript merge) ─────
\set cases `cat /tmp/habit-merge-cases.json`
CREATE TABLE hz_test.cases AS
  SELECT ordinality AS n, value AS c FROM jsonb_array_elements(:'cases'::JSONB) WITH ORDINALITY;
GRANT SELECT ON hz_test.cases TO authenticated;

-- Pure function, every order of every case.
DO $$
DECLARE
  entry RECORD;
  ord RECORD;
  merged public.habit_days;
  i INTEGER;
  uid CONSTANT UUID := '00000000-0000-4000-8000-0000000000aa';
  checked INTEGER := 0;
BEGIN
  FOR entry IN SELECT * FROM hz_test.cases ORDER BY n LOOP
    FOR ord IN SELECT o.ord FROM hz_test.orders AS o WHERE o.n = jsonb_array_length(entry.c->'rows') LOOP
      merged := hz_test.to_row(uid, entry.c->'rows'->(ord.ord[1] - 1));
      FOR i IN 2 .. array_length(ord.ord, 1) LOOP
        merged := private.merge_habit_day(merged, hz_test.to_row(uid, entry.c->'rows'->(ord.ord[i] - 1)));
      END LOOP;
      PERFORM hz_test.check_row(format('%s %s (function)', entry.c->>'name', ord.ord), merged, entry.c->'expected');
      checked := checked + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'merge function: % ordered merges match the TypeScript merge', checked;
END $$;

-- Through the trigger, as the owner uploading with PostgREST's upsert, every order of every case.
SELECT hz_test.login('00000000-0000-4000-8000-0000000000aa');
SET ROLE authenticated;
DO $$
DECLARE
  entry RECORD;
  ord RECORD;
  incoming public.habit_days;
  stored public.habit_days;
  i INTEGER;
  uid CONSTANT UUID := '00000000-0000-4000-8000-0000000000aa';
  checked INTEGER := 0;
BEGIN
  FOR entry IN SELECT * FROM hz_test.cases ORDER BY n LOOP
    FOR ord IN SELECT o.ord FROM hz_test.orders AS o WHERE o.n = jsonb_array_length(entry.c->'rows') LOOP
      DELETE FROM public.habit_days WHERE user_id = uid;
      FOR i IN 1 .. array_length(ord.ord, 1) LOOP
        incoming := hz_test.to_row(uid, entry.c->'rows'->(ord.ord[i] - 1));
        INSERT INTO public.habit_days SELECT incoming.*
        ON CONFLICT (user_id, local_date) DO UPDATE SET
          status = EXCLUDED.status, earned_status = EXCLUDED.earned_status, reason = EXCLUDED.reason,
          excuse_updated_at = EXCLUDED.excuse_updated_at, minimum_met = EXCLUDED.minimum_met,
          full_met = EXCLUDED.full_met, manzil_cycle_completed = EXCLUDED.manzil_cycle_completed,
          source_session_id = EXCLUDED.source_session_id, credited_through = EXCLUDED.credited_through,
          tz = EXCLUDED.tz, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
          synced_at = EXCLUDED.synced_at;
      END LOOP;
      SELECT * INTO stored FROM public.habit_days WHERE user_id = uid;
      PERFORM hz_test.check_row(format('%s %s (upsert trigger)', entry.c->>'name', ord.ord), stored, entry.c->'expected');
      checked := checked + 1;
    END LOOP;
  END LOOP;
  DELETE FROM public.habit_days WHERE user_id = uid;
  RAISE NOTICE 'upsert trigger: % ordered uploads match the TypeScript merge', checked;
END $$;

-- An insert stores the effective status of its own parts, whatever status the client sent.
DO $$
DECLARE
  stored TEXT;
BEGIN
  INSERT INTO public.habit_days (user_id, local_date, status, earned_status, reason, excuse_updated_at, created_at, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000000aa', '2026-11-10', 'done', 'grace', 'travel', now(), now(), now());
  SELECT status INTO stored FROM public.habit_days WHERE local_date = '2026-11-10';
  PERFORM hz_test.eq('insert derives status', stored, 'excused');
  PERFORM hz_test.expect_error(
    $q$INSERT INTO public.habit_days (user_id, local_date, created_at, updated_at)
       VALUES ('00000000-0000-4000-8000-0000000000aa', '2026-02-30', now(), now())$q$, 'out of range');
  PERFORM hz_test.expect_error(
    $q$INSERT INTO public.habit_days (user_id, local_date, created_at, updated_at)
       VALUES ('00000000-0000-4000-8000-0000000000aa', '13-11-2026', now(), now())$q$, 'check constraint');
  DELETE FROM public.habit_days WHERE user_id = '00000000-0000-4000-8000-0000000000aa';
END $$;
RESET ROLE;

-- ─── 3. Owner-only sync tables (two users) ───────────────────────────────────
SELECT hz_test.login('00000000-0000-4000-8000-00000000000b');
SET ROLE authenticated;
DO $$
DECLARE
  pages INTEGER;
BEGIN
  -- Last week, so it never meets this week's rows below.
  PERFORM hz_test.day('00000000-0000-4000-8000-00000000000b', hz_test.week_start() - 3, 'done');
  INSERT INTO public.review_sessions (user_id, id, kind, started_at, local_date, tz, pages_reviewed, minimum_met,
    created_at, updated_at)
  VALUES ('00000000-0000-4000-8000-00000000000b', 'session-1', 'wird', now(), hz_test.today_text(), 'UTC', 3, true,
    '2026-11-13T09:00:00Z', '2026-11-13T09:00:00Z');
  -- An older upload from another device does not replace the newer row.
  INSERT INTO public.review_sessions (user_id, id, kind, started_at, local_date, tz, pages_reviewed, created_at, updated_at)
  VALUES ('00000000-0000-4000-8000-00000000000b', 'session-1', 'wird', now(), hz_test.today_text(), 'UTC', 1,
    '2026-11-13T08:00:00Z', '2026-11-13T08:00:00Z')
  ON CONFLICT (user_id, id) DO UPDATE SET pages_reviewed = EXCLUDED.pages_reviewed, updated_at = EXCLUDED.updated_at;
  SELECT pages_reviewed INTO pages FROM public.review_sessions WHERE id = 'session-1';
  PERFORM hz_test.eq('older session upload skipped', pages, 3);
  INSERT INTO public.recitation_errors (user_id, id, card_id, surah, ayah, type, severity, corrected, local_date,
    created_at, updated_at)
  VALUES ('00000000-0000-4000-8000-00000000000b', 'error-1', '2:255', 2, 255, 'wrong_word', 'jali', 'tanbih',
    hz_test.today_text(), now(), now());
  INSERT INTO public.study_log (user_id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days,
    reviewed_at, session_id, duration_ms, support_level, proposed_rating, grader, local_date, tz, error_count)
  VALUES ('00000000-0000-4000-8000-00000000000b', '2:255', 3, 2, now(), 5, 5, 1, 3, now(), 'session-1', 42000, 4, 3,
    'self', hz_test.today_text(), 'UTC', 1);
  INSERT INTO public.study_log (user_id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
  VALUES ('00000000-0000-4000-8000-00000000000b', '2:256', 3, 2, now(), 5, 5, 1, 3, now());
  PERFORM hz_test.expect_error($q$INSERT INTO public.study_log (user_id, card_id, rating, state, due, stability, difficulty,
    elapsed_days, scheduled_days, reviewed_at, grader) VALUES ('00000000-0000-4000-8000-00000000000b', '1:1', 3, 2, now(),
    1, 1, 0, 0, now(), 'robot')$q$, 'check constraint');
  PERFORM hz_test.expect_error($q$INSERT INTO public.habit_days (user_id, local_date, created_at, updated_at)
    VALUES ('00000000-0000-4000-8000-00000000000a', '2026-11-01', now(), now())$q$, 'row-level security');
  INSERT INTO public.study_cards (id, user_id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
    learning_steps, created_at, updated_at, tier, tier_changed_at)
  VALUES ('2:255', '00000000-0000-4000-8000-00000000000b', 'default', now(), 5, 5, 0, 0, 0, now(), now(), 'sabqi', now());
  INSERT INTO public.user_settings (user_id, key, value) VALUES ('00000000-0000-4000-8000-00000000000b', 'hifz_plan', '{"new_per_day":0.5}');
END $$;
RESET ROLE;

INSERT INTO public.achievement_unlocks (user_id, achievement_id, unlocked_at) VALUES
  ('00000000-0000-4000-8000-00000000000b', 'juz_30_completed', now()),
  ('00000000-0000-4000-8000-00000000000b', 'first_review', now());

SELECT hz_test.login('00000000-0000-4000-8000-00000000000c');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.eq('other user sees no habit days', (SELECT count(*) FROM public.habit_days), 0::BIGINT);
  PERFORM hz_test.eq('other user sees no sessions', (SELECT count(*) FROM public.review_sessions), 0::BIGINT);
  PERFORM hz_test.eq('other user sees no errors', (SELECT count(*) FROM public.recitation_errors), 0::BIGINT);
  PERFORM hz_test.eq('other user sees no badges', (SELECT count(*) FROM public.achievement_unlocks), 0::BIGINT);
  PERFORM hz_test.eq('other user sees no surah progress', (SELECT count(*) FROM public.public_surah_progress), 0::BIGINT);
  PERFORM hz_test.eq('other user sees no privacy rows', (SELECT count(*) FROM public.profile_privacy), 0::BIGINT);
  UPDATE public.habit_days SET full_met = true WHERE user_id = '00000000-0000-4000-8000-00000000000b';
  PERFORM hz_test.expect_error('SELECT * FROM public.halaqa_groups', 'permission denied');
  PERFORM hz_test.expect_error('SELECT * FROM public.halaqa_members', 'permission denied');
  PERFORM hz_test.expect_error('SELECT * FROM public.board_members', 'permission denied');
  PERFORM hz_test.expect_error($q$INSERT INTO public.board_cohorts (week_start, level_band, pace_band, utc_offset_band)
    VALUES (date_trunc('week', now())::date, 'starting', 'light', 0)$q$, 'permission denied');
  PERFORM hz_test.expect_error($q$INSERT INTO public.profile_privacy (user_id, board_joined)
    VALUES ('00000000-0000-4000-8000-00000000000c', true)$q$, 'permission denied');
  PERFORM hz_test.expect_error('SELECT private.board_points(auth.uid(), current_date)', 'permission denied');
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_test.eq('other user could not update', (
    SELECT bool_or(full_met) FROM public.habit_days WHERE user_id = '00000000-0000-4000-8000-00000000000b'), false);
END $$;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000b');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.eq('owner sees own badges', (SELECT count(*) FROM public.achievement_unlocks), 2::BIGINT);
  PERFORM hz_test.eq('owner sees own surah progress', (SELECT count(*) FROM public.public_surah_progress), 1::BIGINT);
  PERFORM hz_test.eq('owner sees own habit days', (SELECT count(*) FROM public.habit_days), 1::BIGINT);
END $$;
RESET ROLE;

SELECT hz_test.login(NULL);
SET ROLE anon;
DO $$
BEGIN
  PERFORM hz_test.eq('anon reads public identity', (SELECT username FROM public.profiles WHERE username = 'member_b'), 'member_b');
  PERFORM hz_test.expect_error('SELECT * FROM public.habit_days', 'permission denied');
  PERFORM hz_test.expect_error('SELECT * FROM public.achievement_unlocks', 'permission denied');
  PERFORM hz_test.expect_error('SELECT * FROM public.public_surah_progress', 'permission denied');
  PERFORM hz_test.expect_error('SELECT * FROM public.profile_privacy', 'permission denied');
  PERFORM hz_test.expect_error($q$SELECT public.get_board('starting', 'light', 0, '2026-11-13')$q$, 'permission denied');
  PERFORM hz_test.expect_error('SELECT public.get_my_halaqas()', 'permission denied');
END $$;
RESET ROLE;

-- ─── 4. Invite halaqa, sharing, encouragement, teacher view ──────────────────
CREATE TABLE hz_test.state (key TEXT PRIMARY KEY, value TEXT);
GRANT SELECT, INSERT, UPDATE ON hz_test.state TO anon, authenticated;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000a');
SET ROLE authenticated;
DO $$
DECLARE
  created JSONB;
BEGIN
  created := public.create_invite_halaqa('  Family halaqa  ', true);
  PERFORM hz_test.eq('name trimmed', created->>'name', 'Family halaqa');
  PERFORM hz_test.eq('creator is teacher', created->>'role', 'teacher');
  PERFORM hz_test.eq('invite code shape', (created->>'invite_code') ~ '^[A-HJ-NP-Z2-9]{8}$', true);
  INSERT INTO hz_test.state VALUES ('group', created->>'id'), ('code', created->>'invite_code');
  PERFORM hz_test.expect_error($q$SELECT public.create_invite_halaqa('   ')$q$, 'invalid_name');
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000b');
SET ROLE authenticated;
DO $$
DECLARE
  joined JSONB;
  code TEXT := (SELECT value FROM hz_test.state WHERE key = 'code');
BEGIN
  PERFORM hz_test.expect_error($q$SELECT public.join_halaqa_by_code('NOTACODE')$q$, 'invalid_code');
  joined := public.join_halaqa_by_code(lower(code));
  PERFORM hz_test.eq('joined as member', joined->>'role', 'member');
  PERFORM hz_test.eq('two members', (joined->>'member_count')::INTEGER, 2);
  PERFORM hz_test.eq('joining twice is idempotent', (public.join_halaqa_by_code(code)->>'member_count')::INTEGER, 2);
  PERFORM hz_test.eq('consistency shared by default', (joined->>'share_consistency')::BOOLEAN, true);
  PERFORM hz_test.eq('teacher sharing off by default', (joined->>'share_plan_with_teachers')::BOOLEAN, false);
  PERFORM hz_test.eq('listed in my halaqas', jsonb_array_length(public.get_my_halaqas()), 1);
END $$;
RESET ROLE;

-- B's week: a wird day, an excused day with a flag, and a grace day. Only the wird day is visible.
SELECT hz_test.day('00000000-0000-4000-8000-00000000000b', hz_test.week_start(), 'done', NULL, true, true, true);
SELECT hz_test.day('00000000-0000-4000-8000-00000000000b', hz_test.week_start() + 1, NULL, 'illness', true);
SELECT hz_test.day('00000000-0000-4000-8000-00000000000b', hz_test.week_start() + 2, 'grace', NULL, true);

SELECT hz_test.login('00000000-0000-4000-8000-00000000000a');
SET ROLE authenticated;
DO $$
DECLARE
  gid UUID := (SELECT value FROM hz_test.state WHERE key = 'group')::UUID;
  detail JSONB;
  member_b JSONB;
  goal JSONB;
BEGIN
  detail := public.get_halaqa_detail(gid, hz_test.today_text());
  SELECT m INTO member_b FROM jsonb_array_elements(detail->'members') AS m WHERE m->>'username' = 'member_b';
  PERFORM hz_test.eq('teacher listed first', detail->'members'->0->>'role', 'teacher');
  PERFORM hz_test.eq('week dots: wird, excused and grace show alike as no wird', member_b->'week',
    '[true, false, false, false, false, false, false]'::JSONB);
  PERFORM hz_test.eq('juz completions shared', (member_b->>'juz_completions')::INTEGER, 1);
  PERFORM hz_test.eq('no reasons in the payload', position('illness' IN detail::TEXT), 0);
  PERFORM hz_test.eq('no grades in the payload', detail ? 'grades', false);
  PERFORM hz_test.eq('teacher view not offered without consent', (member_b->>'teacher_view')::BOOLEAN, false);
  goal := public.get_halaqa_goal(gid, hz_test.today_text());
  PERFORM hz_test.eq('goal counts wird days of sharing members', (goal->>'wird_days')::INTEGER, 1);
  PERFORM hz_test.eq('goal target is five per contributor', (goal->>'target')::INTEGER, 10);
  PERFORM hz_test.eq('goal has no per-member breakdown', goal ? 'members', false);
  -- Co-member reads B's shared juz completion, but not B's other badges.
  PERFORM hz_test.eq('co-member reads shared juz badge only',
    (SELECT string_agg(achievement_id, ',') FROM public.achievement_unlocks
      WHERE user_id = '00000000-0000-4000-8000-00000000000b'), 'juz_30_completed');
  PERFORM hz_test.eq('co-member cannot read surah progress',
    (SELECT count(*) FROM public.public_surah_progress WHERE user_id = '00000000-0000-4000-8000-00000000000b'), 0::BIGINT);
  -- Teacher view without consent returns nothing private.
  detail := public.get_halaqa_teacher_view(gid, '00000000-0000-4000-8000-00000000000b', hz_test.today_text());
  PERFORM hz_test.eq('plan hidden without consent', detail->'plan', 'null'::JSONB);
  PERFORM hz_test.eq('grades hidden without consent', detail->'grades', 'null'::JSONB);
  -- Encouragement: one per day per group, fixed templates, free text allowed in invite halaqas.
  PERFORM public.send_halaqa_encouragement(gid, '00000000-0000-4000-8000-00000000000b', 'ease', NULL, hz_test.today_text());
  PERFORM hz_test.expect_error(format($q$SELECT public.send_halaqa_encouragement(%L, %L, 'keep_going', NULL, %L)$q$,
    gid, '00000000-0000-4000-8000-00000000000b', hz_test.today_text()), 'already_encouraged_today');
  PERFORM hz_test.expect_error(format($q$SELECT public.send_halaqa_encouragement(%L, %L, 'ease', NULL, %L)$q$,
    gid, '00000000-0000-4000-8000-00000000000a', hz_test.today_text()), 'invalid_recipient');
  PERFORM hz_test.expect_error(format($q$SELECT public.send_halaqa_encouragement(%L, %L, 'ease', NULL, %L)$q$,
    gid, '00000000-0000-4000-8000-00000000000c', hz_test.today_text()), 'invalid_recipient');
  PERFORM hz_test.expect_error(format($q$SELECT public.send_halaqa_encouragement(%L, %L, 'ease', NULL, '2001-01-01')$q$,
    gid, '00000000-0000-4000-8000-00000000000b'), 'invalid_local_date');
  PERFORM hz_test.eq('marked as encouraged today', (
    SELECT (m->>'encouraged_today')::BOOLEAN FROM jsonb_array_elements(public.get_halaqa_detail(gid, hz_test.today_text())->'members') AS m
    WHERE m->>'username' = 'member_b'), true);
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000b');
SET ROLE authenticated;
DO $$
DECLARE
  gid UUID := (SELECT value FROM hz_test.state WHERE key = 'group')::UUID;
  detail JSONB;
BEGIN
  detail := public.get_halaqa_detail(gid, hz_test.today_text());
  PERFORM hz_test.eq('encouragement received', detail->'received'->0->>'template_id', 'ease');
  PERFORM hz_test.eq('sender named', detail->'received'->0->>'from_name', 'Teacher A');
  PERFORM public.send_halaqa_encouragement(gid, '00000000-0000-4000-8000-00000000000a', NULL, 'Jazakum Allahu khayran', hz_test.today_text());
  PERFORM hz_test.expect_error(format($q$SELECT public.get_halaqa_teacher_view(%L, %L, %L)$q$,
    gid, '00000000-0000-4000-8000-00000000000a', hz_test.today_text()), 'not_allowed');
  PERFORM hz_test.expect_error(format($q$SELECT public.set_halaqa_member_role(%L, %L, 'teacher')$q$,
    gid, '00000000-0000-4000-8000-00000000000b'), 'not_allowed');
  -- B shares plan and grades with teachers, and stops sharing consistency.
  PERFORM public.set_halaqa_sharing(gid, false, true, true, true);
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000a');
SET ROLE authenticated;
DO $$
DECLARE
  gid UUID := (SELECT value FROM hz_test.state WHERE key = 'group')::UUID;
  detail JSONB;
  member_b JSONB;
  view JSONB;
BEGIN
  detail := public.get_halaqa_detail(gid, hz_test.today_text());
  SELECT m INTO member_b FROM jsonb_array_elements(detail->'members') AS m WHERE m->>'username' = 'member_b';
  PERFORM hz_test.eq('unshared week hidden', member_b->'week', 'null'::JSONB);
  PERFORM hz_test.eq('unshared streak hidden', member_b->'streak', 'null'::JSONB);
  PERFORM hz_test.eq('teacher view offered with consent', (member_b->>'teacher_view')::BOOLEAN, true);
  PERFORM hz_test.eq('goal leaves out unshared members', (detail->'goal'->>'contributors')::INTEGER, 1);
  PERFORM hz_test.eq('goal total leaves out unshared days', (detail->'goal'->>'wird_days')::INTEGER, 0);
  view := public.get_halaqa_teacher_view(gid, '00000000-0000-4000-8000-00000000000b', hz_test.today_text());
  PERFORM hz_test.eq('plan shared', view->'plan'->>'hifz_plan', '{"new_per_day":0.5}');
  PERFORM hz_test.eq('tiers shared', view->'plan'->'tiers'->>'sabqi', '1');
  PERFORM hz_test.eq('recent grades shared', jsonb_array_length(view->'grades'->'recent'), 2);
  PERFORM hz_test.eq('mistake inbox count shared', (view->'grades'->>'mistake_inbox_count')::INTEGER, 1);
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000c');
SET ROLE authenticated;
DO $$
DECLARE
  gid UUID := (SELECT value FROM hz_test.state WHERE key = 'group')::UUID;
BEGIN
  PERFORM hz_test.expect_error(format($q$SELECT public.get_halaqa_detail(%L, %L)$q$, gid, hz_test.today_text()), 'not_a_member');
  PERFORM hz_test.expect_error(format($q$SELECT public.get_halaqa_teacher_view(%L, %L, %L)$q$,
    gid, '00000000-0000-4000-8000-00000000000b', hz_test.today_text()), 'not_a_member');
  PERFORM hz_test.expect_error(format($q$SELECT public.leave_halaqa(%L)$q$, gid), 'not_a_member');
END $$;
RESET ROLE;

-- Group cap of 50 and a member limit of 10 halaqas.
SELECT hz_test.make_user(('00000000-0000-4000-8001-' || lpad(i::TEXT, 12, '0'))::UUID, 'cap_user_' || i, NULL)
FROM generate_series(1, 49) AS i;
SET ROLE authenticated;
DO $$
DECLARE
  code TEXT := (SELECT value FROM hz_test.state WHERE key = 'code');
  i INTEGER;
BEGIN
  FOR i IN 1 .. 48 LOOP
    PERFORM hz_test.login(('00000000-0000-4000-8001-' || lpad(i::TEXT, 12, '0'))::UUID);
    PERFORM public.join_halaqa_by_code(code);
  END LOOP;
  PERFORM hz_test.login('00000000-0000-4000-8001-000000000049');
  PERFORM hz_test.expect_error(format($q$SELECT public.join_halaqa_by_code(%L)$q$, code), 'halaqa_full');
  FOR i IN 1 .. 10 LOOP
    PERFORM public.create_invite_halaqa('Group ' || i);
  END LOOP;
  PERFORM hz_test.expect_error($q$SELECT public.create_invite_halaqa('One too many')$q$, 'halaqa_limit');
  -- Leaving frees a place.
  PERFORM hz_test.login('00000000-0000-4000-8001-000000000001');
  PERFORM public.leave_halaqa((SELECT value FROM hz_test.state WHERE key = 'group')::UUID);
  PERFORM hz_test.login('00000000-0000-4000-8000-00000000000c');
  PERFORM hz_test.eq('joins after a member leaves', (public.join_halaqa_by_code(code)->>'member_count')::INTEGER, 50);
  PERFORM public.leave_halaqa((SELECT value FROM hz_test.state WHERE key = 'group')::UUID);
END $$;
RESET ROLE;

-- ─── 5. Matched halaqas (SOC-04, MAT-01..03) ─────────────────────────────────
SELECT hz_test.make_user(('00000000-0000-4000-8002-' || lpad(i::TEXT, 12, '0'))::UUID, 'match_user_' || i, NULL)
FROM generate_series(1, 6) AS i;
INSERT INTO public.profile_privacy (user_id, is_minor) VALUES ('00000000-0000-4000-8002-000000000006', true);
SET ROLE authenticated;
DO $$
DECLARE
  first_group JSONB;
  g JSONB;
BEGIN
  PERFORM hz_test.login('00000000-0000-4000-8002-000000000001');
  first_group := public.join_matched_halaqa('juz_amma', 'light', 180);
  PERFORM hz_test.eq('matched halaqa has no code', first_group->'invite_code', 'null'::JSONB);
  PERFORM hz_test.eq('matched join is idempotent', public.join_matched_halaqa('juz_amma', 'light', 180)->>'id', first_group->>'id');
  PERFORM hz_test.login('00000000-0000-4000-8002-000000000002');
  PERFORM hz_test.eq('same bands share a halaqa', public.join_matched_halaqa('juz_amma', 'light', 120)->>'id', first_group->>'id');
  PERFORM hz_test.login('00000000-0000-4000-8002-000000000003');
  PERFORM hz_test.eq('adjacent level widens into a small halaqa', public.join_matched_halaqa('juz_4_15', 'page_plus', 300)->>'id', first_group->>'id');
  PERFORM hz_test.login('00000000-0000-4000-8002-000000000004');
  g := public.join_matched_halaqa('hafiz', 'light', 180);
  PERFORM hz_test.eq('distant level starts a new halaqa', g->>'id' <> first_group->>'id', true);
  PERFORM hz_test.login('00000000-0000-4000-8002-000000000005');
  g := public.join_matched_halaqa('juz_amma', 'light', -300);
  PERFORM hz_test.eq('distant zone starts a new halaqa', g->>'id' <> first_group->>'id', true);
  PERFORM hz_test.expect_error(format($q$SELECT public.send_halaqa_encouragement(%L, %L, NULL, 'free text', %L)$q$,
    first_group->>'id', '00000000-0000-4000-8002-000000000001', hz_test.today_text()), 'not_a_member');
  PERFORM hz_test.login('00000000-0000-4000-8002-000000000002');
  PERFORM hz_test.expect_error(format($q$SELECT public.send_halaqa_encouragement(%L, %L, NULL, 'free text', %L)$q$,
    first_group->>'id', '00000000-0000-4000-8002-000000000001', hz_test.today_text()), 'free_text_invite_only');
  PERFORM hz_test.expect_error(format($q$SELECT public.send_halaqa_encouragement(%L, %L, 'not_a_template', NULL, %L)$q$,
    first_group->>'id', '00000000-0000-4000-8002-000000000001', hz_test.today_text()), 'invalid_template');
  PERFORM public.send_halaqa_encouragement((first_group->>'id')::UUID, '00000000-0000-4000-8002-000000000001', 'together', NULL, hz_test.today_text());
  -- A re-match never returns the user to the halaqa they left.
  PERFORM public.leave_halaqa((first_group->>'id')::UUID);
  g := public.join_matched_halaqa('juz_amma', 'light', 120);
  PERFORM hz_test.eq('re-match finds another halaqa', g->>'id' <> first_group->>'id', true);
  PERFORM hz_test.expect_error($q$SELECT public.join_matched_halaqa('juz_amma', 'warp', 0)$q$, 'invalid_bands');
  PERFORM hz_test.login('00000000-0000-4000-8002-000000000006');
  PERFORM hz_test.expect_error($q$SELECT public.join_matched_halaqa('juz_amma', 'light', 180)$q$, 'minor_not_allowed');
END $$;
RESET ROLE;

DO $$
BEGIN
  -- MAT-03: the match rule is a pure function.
  PERFORM hz_test.eq('exact match', private.match_tier('juz_amma', 'light', 2, 29, 30, 'juz_amma', 'light', 180), 1);
  PERFORM hz_test.eq('full group', private.match_tier('juz_amma', 'light', 2, 30, 30, 'juz_amma', 'light', 180), NULL::INTEGER);
  PERFORM hz_test.eq('3 h widening', private.match_tier('juz_amma', 'light', 2, 9, 30, 'juz_amma', 'light', 360), 2);
  PERFORM hz_test.eq('no widening into a group of 10', private.match_tier('juz_amma', 'light', 2, 10, 30, 'juz_amma', 'light', 360), NULL::INTEGER);
  PERFORM hz_test.eq('pace widening', private.match_tier('juz_amma', 'page_plus', 2, 3, 30, 'juz_amma', 'light', 180), 3);
  PERFORM hz_test.eq('one level band', private.match_tier('juz_4_15', 'light', 2, 3, 30, 'juz_amma', 'light', 180), 4);
  PERFORM hz_test.eq('two level bands', private.match_tier('juz_16_29', 'light', 2, 3, 30, 'juz_amma', 'light', 180), NULL::INTEGER);
  PERFORM hz_test.eq('beyond 3 h', private.match_tier('juz_amma', 'light', 2, 3, 30, 'juz_amma', 'light', 480), NULL::INTEGER);
  -- offsetBand rounds halves up, like Math.round.
  PERFORM hz_test.eq('offset band -1 h', private.offset_band(-60), 0);
  PERFORM hz_test.eq('offset band +1 h', private.offset_band(60), 1);
  PERFORM hz_test.eq('offset band -3 h', private.offset_band(-180), -1);
  PERFORM hz_test.eq('offset band +14 h', private.offset_band(840), 7);
END $$;

-- ─── 6. Board (BRD-01..08, PTS-02, SB-03, SB-04) ────────────────────────────
SELECT hz_test.make_user(('00000000-0000-4000-8003-' || lpad(i::TEXT, 12, '0'))::UUID, 'board_user_' || i,
  'Board ' || i, 'https://example.invalid/board' || i || '.png')
FROM generate_series(1, 40) AS i;
-- Board 1: 3 points (minimum, full and manzil on one day); last week's and future days never count.
SELECT hz_test.day('00000000-0000-4000-8003-000000000001', hz_test.week_start(), 'done', NULL, true, true, true);
SELECT hz_test.day('00000000-0000-4000-8003-000000000001', hz_test.week_start() - 1, 'done', NULL, true, true, true);
SELECT hz_test.day('00000000-0000-4000-8003-000000000001', hz_test.utc_today() + 2, 'done', NULL, true, true, true);
-- Board 2: excused and grace days with flags set add nothing (SB-03).
SELECT hz_test.day('00000000-0000-4000-8003-000000000002', hz_test.week_start(), NULL, 'travel', true, true, true);
SELECT hz_test.day('00000000-0000-4000-8003-000000000002', hz_test.week_start() + 1, 'grace', NULL, true, true, false);
-- Board 3: made_up with the full wird (2) and earned_back with the minimum (1).
SELECT hz_test.day('00000000-0000-4000-8003-000000000003', hz_test.week_start(), 'made_up', NULL, true, true, false);
SELECT hz_test.day('00000000-0000-4000-8003-000000000003', hz_test.week_start() + 1, 'earned_back', NULL, true, false, false);
-- Board 4: streak of 3 through yesterday; the paused day keeps the run without adding to it.
SELECT hz_test.day('00000000-0000-4000-8003-000000000004', hz_test.utc_today() - 1, 'done');
SELECT hz_test.day('00000000-0000-4000-8003-000000000004', hz_test.utc_today() - 2, 'paused');
SELECT hz_test.day('00000000-0000-4000-8003-000000000004', hz_test.utc_today() - 3, NULL, 'illness');
SELECT hz_test.day('00000000-0000-4000-8003-000000000004', hz_test.utc_today() - 4, 'grace');
SELECT hz_test.day('00000000-0000-4000-8003-000000000004', hz_test.utc_today() - 6, 'done');

DO $$
BEGIN
  PERFORM hz_test.eq('points: 3 a day at most, this week only', private.board_points('00000000-0000-4000-8003-000000000001', hz_test.week_start()), 3);
  PERFORM hz_test.eq('points: excused and grace add nothing', private.board_points('00000000-0000-4000-8003-000000000002', hz_test.week_start()), 0);
  PERFORM hz_test.eq('points: made up and earned back count', private.board_points('00000000-0000-4000-8003-000000000003', hz_test.week_start()), 3);
  PERFORM hz_test.eq('streak through yesterday, paused not counted', private.habit_streak('00000000-0000-4000-8003-000000000004', hz_test.utc_today()), 3);
  PERFORM hz_test.eq('no streak two days later', private.habit_streak('00000000-0000-4000-8003-000000000004', hz_test.utc_today() + 2), 0);
END $$;
SELECT hz_test.day('00000000-0000-4000-8003-000000000004', hz_test.utc_today(), 'done');
DO $$
BEGIN
  PERFORM hz_test.eq('streak includes today', private.habit_streak('00000000-0000-4000-8003-000000000004', hz_test.utc_today()), 4);
END $$;

SET ROLE authenticated;
DO $$
DECLARE
  board JSONB;
  i INTEGER;
  me JSONB;
  first_cohort UUID;
BEGIN
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000001');
  board := public.get_board('juz_amma', 'light', 180, hz_test.today_text());
  PERFORM hz_test.eq('board is opt-in', board->>'status', 'not_joined');
  PERFORM hz_test.expect_error(format($q$SELECT public.join_board(NULL, true, 'juz_amma', 'light', 180, %L)$q$, hz_test.today_text()), 'nickname_required');
  PERFORM hz_test.expect_error(format($q$SELECT public.join_board('ab', false, 'juz_amma', 'light', 180, %L)$q$, hz_test.today_text()), 'invalid_nickname');
  PERFORM hz_test.expect_error($q$SELECT public.join_board(NULL, false, 'juz_amma', 'light', 180, '1999-01-01')$q$, 'invalid_local_date');
  board := public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text());
  PERFORM hz_test.eq('alone: gathering', board->>'status', 'gathering');
  PERFORM hz_test.eq('gathering shows no standings', board ? 'standings', false);
  PERFORM hz_test.eq('board week starts Monday', board->>'week_start', hz_test.d(hz_test.week_start()));
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000002');
  PERFORM public.join_board('Quiet Reader', false, 'juz_amma', 'light', 180, hz_test.today_text());
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000003');
  PERFORM public.join_board('Little Star', true, 'juz_amma', 'light', 120, hz_test.today_text());
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000004');
  board := public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text());
  PERFORM hz_test.eq('four members: still gathering', board->>'member_count', '4');
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000005');
  board := public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text());
  PERFORM hz_test.eq('five members: standings', board->>'status', 'ready');
  PERFORM hz_test.eq('five rows', jsonb_array_length(board->'standings'), 5);
  PERFORM hz_test.eq('no user ids in standings', position('00000000-0000-4000' IN board::TEXT), 0);
  PERFORM hz_test.eq('no reasons in standings', position('travel' IN board::TEXT), 0);
  SELECT s INTO me FROM jsonb_array_elements(board->'standings') AS s WHERE s->>'name' = 'Little Star';
  PERFORM hz_test.eq('minor under nickname without photo', me->'avatar_url', 'null'::JSONB);
  PERFORM hz_test.eq('minor points', (me->>'points')::INTEGER, 3);
  SELECT s INTO me FROM jsonb_array_elements(board->'standings') AS s WHERE s->>'name' = 'Quiet Reader';
  PERFORM hz_test.eq('nickname hides the photo', me->'avatar_url', 'null'::JSONB);
  PERFORM hz_test.eq('excused days score 0', (me->>'points')::INTEGER, 0);
  SELECT s INTO me FROM jsonb_array_elements(board->'standings') AS s WHERE s->>'name' = 'Board 1';
  PERFORM hz_test.eq('display name with photo', me->>'avatar_url', 'https://example.invalid/board1.png');
  PERFORM hz_test.eq('top rank shared on a tie', (me->>'rank')::INTEGER, 1);
  SELECT s INTO me FROM jsonb_array_elements(board->'standings') AS s WHERE s->>'name' = 'Board 4';
  PERFORM hz_test.eq('server streak', (me->>'streak')::INTEGER, 4);
  SELECT s INTO me FROM jsonb_array_elements(board->'standings') AS s WHERE (s->>'is_me')::BOOLEAN;
  PERFORM hz_test.eq('caller marked', me->>'name', 'Board 5');
  -- Opening the tab again is idempotent.
  PERFORM hz_test.eq('lazy placement is idempotent', public.get_board('juz_amma', 'light', 180, hz_test.today_text())->>'member_count', '5');
  -- Leaving is one tap; rejoining the same week returns to the same cohort.
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000002');
  PERFORM public.leave_board();
  PERFORM hz_test.eq('left: not joined', public.get_board('juz_amma', 'light', 180, hz_test.today_text())->>'status', 'not_joined');
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000005');
  PERFORM hz_test.eq('leaver removed from standings', public.get_board('juz_amma', 'light', 180, hz_test.today_text())->>'status', 'gathering');
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000002');
  PERFORM hz_test.eq('rejoin returns to the cohort', public.join_board('Quiet Reader', false, 'hafiz', 'maintenance', -600, hz_test.today_text())->>'member_count', '5');
  -- Fill the cohort to 30; the next exact match starts a new cohort.
  FOR i IN 6 .. 30 LOOP
    PERFORM hz_test.login(('00000000-0000-4000-8003-' || lpad(i::TEXT, 12, '0'))::UUID);
    PERFORM public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text());
  END LOOP;
  PERFORM hz_test.eq('cohort holds 30', (public.get_board('juz_amma', 'light', 180, hz_test.today_text())->>'member_count')::INTEGER, 30);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000031');
  PERFORM hz_test.eq('31st starts a cohort', (public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text())->>'member_count')::INTEGER, 1);
  -- Widening (BRD-08): adjacent level and a 3 h zone join the small cohort; two bands away starts another.
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000032');
  PERFORM hz_test.eq('adjacent level joins small cohort', (public.join_board(NULL, false, 'juz_4_15', 'light', 180, hz_test.today_text())->>'member_count')::INTEGER, 2);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000033');
  PERFORM hz_test.eq('3 h zone joins small cohort', (public.join_board(NULL, false, 'juz_amma', 'light', 360, hz_test.today_text())->>'member_count')::INTEGER, 3);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000034');
  PERFORM hz_test.eq('two level bands away starts a cohort', (public.join_board(NULL, false, 'juz_16_29', 'light', 180, hz_test.today_text())->>'member_count')::INTEGER, 1);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000035');
  PERFORM hz_test.eq('far zone starts a cohort', (public.join_board(NULL, false, 'juz_amma', 'light', -300, hz_test.today_text())->>'member_count')::INTEGER, 1);
END $$;
RESET ROLE;

DO $$
BEGIN
  PERFORM hz_test.eq('one cohort per user per week', (
    SELECT count(*) FROM (SELECT user_id FROM public.board_members GROUP BY user_id, week_start HAVING count(*) > 1) AS dupes
  ), 0::BIGINT);
  PERFORM hz_test.eq('cohorts this week', (SELECT count(*) FROM public.board_cohorts WHERE week_start = hz_test.week_start()), 4::BIGINT);
END $$;

-- ─── 7. Profile visibility (SOC-01, ETH-07) ──────────────────────────────────
-- The streak algorithm is checked above; here only who may see it.
INSERT INTO hz_test.state
  SELECT 'b_streak', private.habit_streak('00000000-0000-4000-8000-00000000000b', hz_test.utc_today())::TEXT;
SELECT hz_test.login(NULL);
SET ROLE anon;
DO $$
BEGIN
  PERFORM hz_test.eq('private by default', public.get_profile_summary('00000000-0000-4000-8000-00000000000b'),
    '{"streak": null, "juz_completed": null}'::JSONB);
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000a');
SET ROLE authenticated;
DO $$
BEGIN
  -- B stopped sharing consistency with the halaqa but still shares juz completions.
  PERFORM hz_test.eq('co-member sees shared juz only', public.get_profile_summary('00000000-0000-4000-8000-00000000000b'),
    '{"streak": null, "juz_completed": [30]}'::JSONB);
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000b');
SET ROLE authenticated;
DO $$
DECLARE
  privacy JSONB;
BEGIN
  PERFORM hz_test.eq('owner sees own streak', public.get_profile_summary(auth.uid())->>'streak',
    (SELECT value FROM hz_test.state WHERE key = 'b_streak'));
  privacy := public.set_profile_privacy(true, true, false);
  PERFORM hz_test.eq('privacy saved', privacy->>'show_streak', 'true');
END $$;
RESET ROLE;

SELECT hz_test.login(NULL);
SET ROLE anon;
DO $$
BEGIN
  PERFORM hz_test.eq('opted-in profile is public', public.get_profile_summary('00000000-0000-4000-8000-00000000000b'),
    jsonb_build_object('streak', (SELECT value FROM hz_test.state WHERE key = 'b_streak')::INTEGER, 'juz_completed', '[30]'::JSONB));
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000b');
SET ROLE authenticated;
SELECT public.set_profile_privacy(true, true, true);
RESET ROLE;
SELECT hz_test.login(NULL);
SET ROLE anon;
DO $$
BEGIN
  PERFORM hz_test.eq('a minor never goes public', public.get_profile_summary('00000000-0000-4000-8000-00000000000b'),
    '{"streak": null, "juz_completed": null}'::JSONB);
END $$;
RESET ROLE;

-- A minor already on the board without a nickname cannot be recorded (BRD-07).
SELECT hz_test.login('00000000-0000-4000-8003-000000000001');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.expect_error('SELECT public.set_profile_privacy(false, false, true)', 'nickname_required');
END $$;
RESET ROLE;

SELECT hz_test.login(NULL);
SET client_min_messages = warning;
DROP SCHEMA hz_test CASCADE;
SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'learning_consistency.test.sql: all assertions passed'; END $$;
