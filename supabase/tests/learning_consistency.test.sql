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
    WHERE n.nspname IN ('public', 'private', 'rls') AND p.prosecdef
      AND p.proname IN ('get_board', 'join_board', 'leave_board', 'get_my_halaqas', 'create_invite_halaqa',
        'join_halaqa_by_code', 'leave_halaqa', 'join_matched_halaqa', 'set_halaqa_sharing', 'set_halaqa_member_role',
        'get_halaqa_goal', 'get_halaqa_detail', 'send_halaqa_encouragement', 'get_halaqa_teacher_view',
        'get_profile_privacy', 'set_profile_privacy', 'get_profile_summary', 'halaqa_shares_with_me',
        'habit_days_before_write', 'profile_identity_visible', 'caller_is_minor', 'get_received_encouragements',
        'refresh_board_bands', 'requeue_board_after_wird_day')
      AND NOT (COALESCE(p.proconfig, '{}') @> ARRAY['search_path=""'])
  ), 0::BIGINT);
  PERFORM hz_test.eq('every definer function above exists', (
    SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND (n.nspname, p.proname) IN (('rls', 'profile_identity_visible'), ('rls', 'caller_is_minor'),
      ('public', 'get_received_encouragements'), ('public', 'refresh_board_bands'), ('private', 'requeue_board_after_wird_day'))
  ), 5::BIGINT);
  -- Finding 8 (second review): the RLS helpers live outside public, which is the only schema PostgREST
  -- serves as RPCs, so no endpoint reveals who is a minor.
  PERFORM hz_test.eq('no public RLS helper', (
    SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('profile_identity_visible', 'caller_is_minor')
  ), 0::BIGINT);
  PERFORM hz_test.eq('profiles policy uses the rls helper', (
    SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT'
  ), 'rls.profile_identity_visible(id)');
  PERFORM hz_test.eq('PUBLIC cannot run the rls helpers', (
    SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'rls' AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) AS acl WHERE acl.grantee = 0))
  ), 0::BIGINT);
  -- Finding 15: board weeks follow each user's week start, so cohorts are not limited to Mondays.
  PERFORM hz_test.eq('no Monday-only cohort check', (
    SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.board_cohorts'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%isodow%'
  ), 0::BIGINT);
  -- Finding 16: the weekly pass finds pending users through an index.
  PERFORM hz_test.eq('board pending index', to_regclass('public.idx_profile_privacy_board_pending') IS NOT NULL, true);
  -- Finding 9: one active matched halaqa per user is a constraint.
  PERFORM hz_test.eq('one matched membership index', (
    SELECT indisunique FROM pg_index WHERE indexrelid = 'public.idx_halaqa_members_one_matched'::regclass
  ), true);
  -- Finding 11: the caller's date no longer decides the one-a-day limit.
  PERFORM hz_test.eq('no unique key on the caller date', (
    SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.halaqa_encouragements'::regclass AND contype = 'u'
  ), 0::BIGINT);
  -- Finding 5 (second review): one send per group, sender and server-derived calendar day.
  PERFORM hz_test.eq('unique key on the server day', (
    SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid = 'public.idx_halaqa_encouragements_sender_day'::regclass
  ), 'CREATE UNIQUE INDEX idx_halaqa_encouragements_sender_day ON public.halaqa_encouragements USING btree (group_id, from_user, sent_on)');
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

-- Finding 8: two excuses written at the same instant but spelled differently ("Z" and ".000Z") are
-- the same instant to the server, so the reason decides, in both orders, as lib/habit/merge.ts does.
DO $$
DECLARE
  uid CONSTANT UUID := '00000000-0000-4000-8000-0000000000aa';
  plain public.habit_days := hz_test.to_row(uid, jsonb_build_object('local_date', '2026-11-13', 'reason', 'illness',
    'excuse_updated_at', '2026-11-13T12:00:00Z', 'created_at', '2026-11-13T12:00:00Z', 'updated_at', '2026-11-13T12:00:00Z'));
  millis public.habit_days := hz_test.to_row(uid, jsonb_build_object('local_date', '2026-11-13', 'reason', 'travel',
    'excuse_updated_at', '2026-11-13T12:00:00.000Z', 'created_at', '2026-11-13T12:00:00.000Z', 'updated_at', '2026-11-13T12:00:00.000Z'));
  withdrawal public.habit_days := hz_test.to_row(uid, jsonb_build_object('local_date', '2026-11-13',
    'excuse_updated_at', '2026-11-13T12:00:00.000Z', 'created_at', '2026-11-13T12:00:00.000Z', 'updated_at', '2026-11-13T12:00:00.000Z'));
BEGIN
  PERFORM hz_test.eq('same instant, two spellings', plain.excuse_updated_at, millis.excuse_updated_at);
  PERFORM hz_test.eq('reason decides (plain first)', (private.merge_habit_day(plain, millis)).reason, 'travel');
  PERFORM hz_test.eq('reason decides (millis first)', (private.merge_habit_day(millis, plain)).reason, 'travel');
  PERFORM hz_test.eq('status follows the reason', (private.merge_habit_day(plain, millis)).status, 'excused');
  PERFORM hz_test.eq('an excuse beats a same-instant withdrawal', (private.merge_habit_day(withdrawal, plain)).reason, 'illness');
  PERFORM hz_test.eq('in either order', (private.merge_habit_day(plain, withdrawal)).reason, 'illness');
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
  PERFORM hz_test.expect_error($q$SELECT public.get_board('starting', 'light', 0, '2026-11-13', 1)$q$, 'permission denied');
  PERFORM hz_test.expect_error('SELECT public.get_my_halaqas()', 'permission denied');
  -- Finding 8 (second review): the profiles policy helper is no RPC anon can call.
  PERFORM hz_test.expect_error($q$SELECT public.profile_identity_visible('00000000-0000-4000-8000-00000000000b')$q$,
    'does not exist');
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
  -- Finding 11: yesterday's or tomorrow's date (both valid somewhere on Earth) opens no second send.
  PERFORM hz_test.expect_error(format($q$SELECT public.send_halaqa_encouragement(%L, %L, 'keep_going', NULL, %L)$q$,
    gid, '00000000-0000-4000-8000-00000000000b', hz_test.d(hz_test.utc_today() + 1)), 'already_encouraged_today');
  PERFORM hz_test.expect_error(format($q$SELECT public.send_halaqa_encouragement(%L, %L, 'keep_going', NULL, %L)$q$,
    gid, '00000000-0000-4000-8000-00000000000b', hz_test.d(hz_test.utc_today() - 1)), 'already_encouraged_today');
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
  inbox JSONB;
BEGIN
  detail := public.get_halaqa_detail(gid, hz_test.today_text());
  PERFORM hz_test.eq('encouragement received', detail->'received'->0->>'template_id', 'ease');
  PERFORM hz_test.eq('sender named', detail->'received'->0->>'from_name', 'Teacher A');
  -- The notification inbox lists ids the device acknowledges, not a time watermark.
  inbox := public.get_received_encouragements();
  PERFORM hz_test.eq('inbox lists the encouragement', inbox->'items',
    jsonb_build_array(jsonb_build_object('id', detail->'received'->0->'id', 'created_at', detail->'received'->0->'created_at')));
  PERFORM hz_test.eq('inbox reports server time', (inbox->>'checked_at')::TIMESTAMPTZ IS NOT NULL, true);
  INSERT INTO hz_test.state VALUES ('first_encouragement', detail->'received'->0->>'id');
  PERFORM public.send_halaqa_encouragement(gid, '00000000-0000-4000-8000-00000000000a', NULL, 'Jazakum Allahu khayran', hz_test.today_text());
  PERFORM hz_test.expect_error(format($q$SELECT public.get_halaqa_teacher_view(%L, %L, %L)$q$,
    gid, '00000000-0000-4000-8000-00000000000a', hz_test.today_text()), 'not_allowed');
  PERFORM hz_test.expect_error(format($q$SELECT public.set_halaqa_member_role(%L, %L, 'teacher')$q$,
    gid, '00000000-0000-4000-8000-00000000000b'), 'not_allowed');
  -- B shares plan and grades with teachers, and stops sharing consistency.
  PERFORM public.set_halaqa_sharing(gid, false, true, true, true);
END $$;
RESET ROLE;

-- Finding 9 (second review): a send that commits after a later one carries an earlier created_at. A
-- watermark already past it would never return it; the 7-day id list does. Rows older than 7 days
-- are not listed.
INSERT INTO public.halaqa_encouragements (group_id, from_user, to_user, template_id, local_date, sent_on, created_at)
SELECT value::UUID, '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', 'dua',
  hz_test.d(hz_test.utc_today() - 1), hz_test.utc_today() - 1,
  (SELECT created_at FROM public.halaqa_encouragements WHERE id = (SELECT value FROM hz_test.state WHERE key = 'first_encouragement')::UUID)
    - INTERVAL '1 hour'
FROM hz_test.state WHERE key = 'group';
INSERT INTO public.halaqa_encouragements (group_id, from_user, to_user, template_id, local_date, sent_on, created_at)
SELECT value::UUID, '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', 'dua',
  hz_test.d(hz_test.utc_today() - 9), hz_test.utc_today() - 9, now() - INTERVAL '8 days'
FROM hz_test.state WHERE key = 'group';
SELECT hz_test.login('00000000-0000-4000-8000-00000000000b');
SET ROLE authenticated;
DO $$
DECLARE
  inbox JSONB := public.get_received_encouragements();
  items JSONB := inbox->'items';
BEGIN
  PERFORM hz_test.eq('late commit is listed', jsonb_array_length(items), 2);
  PERFORM hz_test.eq('oldest first', items->1->>'id', (SELECT value FROM hz_test.state WHERE key = 'first_encouragement'));
  PERFORM hz_test.eq('a single page', (inbox->>'more')::BOOLEAN, false);
  PERFORM hz_test.eq('older than 7 days is not listed', (
    SELECT count(*) FROM jsonb_array_elements(items) AS i WHERE (i->>'created_at')::TIMESTAMPTZ < now() - INTERVAL '7 days'
  ), 0::BIGINT);
END $$;
RESET ROLE;

-- Third review, finding 5: the inbox pages the whole 7-day window by a (created_at, id) cursor, so
-- more arrivals than one page are all listed and the oldest is never stuck behind the newest. 230
-- encouragements, three sharing the time that falls on the first page boundary.
SELECT hz_test.make_user(('00000000-0000-4000-8007-' || lpad(i::TEXT, 12, '0'))::UUID, 'inbox_user_' || i, NULL)
FROM generate_series(1, 2) AS i;
SELECT hz_test.login('00000000-0000-4000-8007-000000000001');
SET ROLE authenticated;
DO $$
BEGIN
  INSERT INTO hz_test.state VALUES ('inbox_code', public.create_invite_halaqa('Busy inbox')->>'invite_code');
  PERFORM hz_test.login('00000000-0000-4000-8007-000000000002');
  INSERT INTO hz_test.state VALUES ('inbox_group', public.join_halaqa_by_code((SELECT value FROM hz_test.state WHERE key = 'inbox_code'))->>'id');
END $$;
RESET ROLE;
INSERT INTO public.halaqa_encouragements (group_id, from_user, to_user, template_id, local_date, sent_on, created_at)
SELECT (SELECT value FROM hz_test.state WHERE key = 'inbox_group')::UUID, '00000000-0000-4000-8007-000000000001',
  '00000000-0000-4000-8007-000000000002', 'dua', hz_test.d(hz_test.utc_today() - i), hz_test.utc_today() - i,
  now() - (CASE WHEN i BETWEEN 129 AND 131 THEN 130 ELSE i END) * INTERVAL '30 seconds'
FROM generate_series(1, 230) AS i;
INSERT INTO hz_test.state
SELECT 'inbox_oldest', id FROM public.halaqa_encouragements
WHERE to_user = '00000000-0000-4000-8007-000000000002' ORDER BY created_at, id LIMIT 1;
SELECT hz_test.login('00000000-0000-4000-8007-000000000002');
SET ROLE authenticated;
DO $$
DECLARE
  page JSONB := public.get_received_encouragements();
  item JSONB;
  pages INTEGER := 0;
  seen UUID[] := '{}';
  last_at TIMESTAMPTZ;
  last_id UUID;
BEGIN
  PERFORM hz_test.eq('a page holds 100', jsonb_array_length(page->'items'), 100);
  PERFORM hz_test.eq('another page follows', (page->>'more')::BOOLEAN, true);
  LOOP
    pages := pages + 1;
    FOR item IN SELECT value FROM jsonb_array_elements(page->'items') LOOP
      IF last_at IS NOT NULL AND NOT (((item->>'created_at')::TIMESTAMPTZ, (item->>'id')::UUID) > (last_at, last_id)) THEN
        RAISE EXCEPTION 'inbox pages out of cursor order at %', item;
      END IF;
      last_at := (item->>'created_at')::TIMESTAMPTZ;
      last_id := (item->>'id')::UUID;
      seen := seen || last_id;
    END LOOP;
    EXIT WHEN NOT (page->>'more')::BOOLEAN OR pages >= 10;
    page := public.get_received_encouragements(last_at, last_id);
  END LOOP;
  PERFORM hz_test.eq('three pages', pages, 3);
  PERFORM hz_test.eq('every encouragement listed once', (SELECT count(DISTINCT id) FROM unnest(seen) AS id), 230::BIGINT);
  PERFORM hz_test.eq('no encouragement listed twice', cardinality(seen), 230);
  PERFORM hz_test.eq('the oldest is listed first', seen[1], (SELECT value FROM hz_test.state WHERE key = 'inbox_oldest')::UUID);
  PERFORM hz_test.expect_error('SELECT public.get_received_encouragements(now(), NULL)', 'invalid_cursor');
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
  INSERT INTO hz_test.state VALUES ('matched_group', first_group->>'id');
END $$;
RESET ROLE;

-- Finding 9: the database itself refuses a second active matched halaqa, and a member row always
-- carries its group's kind.
DO $$
DECLARE
  other_group UUID := (SELECT group_id FROM public.halaqa_members WHERE user_id = '00000000-0000-4000-8002-000000000004');
BEGIN
  PERFORM hz_test.expect_error(format($q$INSERT INTO public.halaqa_members (group_id, kind, user_id)
    VALUES (%L, 'matched', '00000000-0000-4000-8002-000000000001')$q$, other_group), 'idx_halaqa_members_one_matched');
  PERFORM hz_test.expect_error(format($q$INSERT INTO public.halaqa_members (group_id, kind, user_id)
    VALUES (%L, 'invite', '00000000-0000-4000-8002-000000000001')$q$, other_group), 'halaqa_members_group_kind_fkey');
END $$;

-- Finding 18: the inbox lists encouragements only from halaqas the reader is still in.
SELECT hz_test.login('00000000-0000-4000-8002-000000000001');
SET ROLE authenticated;
DO $$
DECLARE
  gid UUID := (SELECT value FROM hz_test.state WHERE key = 'matched_group')::UUID;
BEGIN
  PERFORM hz_test.eq('inbox lists an active halaqa', jsonb_array_length(public.get_received_encouragements()->'items'), 1);
  PERFORM public.leave_halaqa(gid);
  PERFORM hz_test.eq('inbox skips a left halaqa', public.get_received_encouragements()->'items', '[]'::JSONB);
END $$;
RESET ROLE;

-- Finding 5 (second review): the limit is one send per calendar day of the sender, by the server's
-- clock in their stored zone, not one per 20 hours.
SELECT hz_test.make_user(('00000000-0000-4000-8005-' || lpad(i::TEXT, 12, '0'))::UUID, 'enc_user_' || i, NULL)
FROM generate_series(1, 2) AS i;
SELECT hz_test.login('00000000-0000-4000-8005-000000000001');
SET ROLE authenticated;
DO $$
BEGIN
  INSERT INTO hz_test.state VALUES ('enc_code', public.create_invite_halaqa('Daily limit')->>'invite_code');
  PERFORM hz_test.login('00000000-0000-4000-8005-000000000002');
  INSERT INTO hz_test.state VALUES ('enc_group', public.join_halaqa_by_code((SELECT value FROM hz_test.state WHERE key = 'enc_code'))->>'id');
  PERFORM hz_test.login('00000000-0000-4000-8005-000000000001');
  PERFORM public.send_halaqa_encouragement((SELECT value FROM hz_test.state WHERE key = 'enc_group')::UUID,
    '00000000-0000-4000-8005-000000000002', 'ease', NULL, hz_test.today_text());
END $$;
RESET ROLE;
-- The first send was 21 hours ago, earlier the same day.
UPDATE public.halaqa_encouragements SET created_at = now() - INTERVAL '21 hours'
WHERE from_user = '00000000-0000-4000-8005-000000000001';
CREATE FUNCTION hz_test.send_enc() RETURNS JSONB LANGUAGE sql AS $$
  SELECT public.send_halaqa_encouragement((SELECT value FROM hz_test.state WHERE key = 'enc_group')::UUID,
    '00000000-0000-4000-8005-000000000002', 'dua', NULL, hz_test.today_text())
$$;
GRANT EXECUTE ON FUNCTION hz_test.send_enc() TO authenticated;
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.expect_error('SELECT hz_test.send_enc()', 'already_encouraged_today');
END $$;
RESET ROLE;
-- A send on a later day of the sender's (a stored zone further east) still counts as today.
UPDATE public.halaqa_encouragements SET sent_on = sent_on + 1 WHERE from_user = '00000000-0000-4000-8005-000000000001';
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.expect_error('SELECT hz_test.send_enc()', 'already_encouraged_today');
END $$;
RESET ROLE;
-- Yesterday's send, three hours ago, leaves today open. The day comes from the sender's stored zone.
UPDATE public.halaqa_encouragements SET sent_on = sent_on - 2, created_at = now() - INTERVAL '3 hours'
WHERE from_user = '00000000-0000-4000-8005-000000000001';
INSERT INTO public.habit_days (user_id, local_date, earned_status, minimum_met, tz, created_at, updated_at)
VALUES ('00000000-0000-4000-8005-000000000001', hz_test.d(hz_test.utc_today() - 20), 'done', true, 'Pacific/Kiritimati',
  now(), now());
SET ROLE authenticated;
DO $$
DECLARE
  sent UUID := (hz_test.send_enc()->>'id')::UUID;
BEGIN
  PERFORM hz_test.expect_error('SELECT hz_test.send_enc()', 'already_encouraged_today');
  INSERT INTO hz_test.state VALUES ('enc_sent', sent);
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_test.eq('day from the stored zone', (
    SELECT sent_on FROM public.halaqa_encouragements WHERE id = (SELECT value FROM hz_test.state WHERE key = 'enc_sent')::UUID
  ), (now() AT TIME ZONE 'Pacific/Kiritimati')::DATE);
END $$;

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
  board := public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 1);
  PERFORM hz_test.eq('board is opt-in', board->>'status', 'not_joined');
  PERFORM hz_test.expect_error(format($q$SELECT public.join_board(NULL, true, 'juz_amma', 'light', 180, %L, 1)$q$, hz_test.today_text()), 'nickname_required');
  PERFORM hz_test.expect_error(format($q$SELECT public.join_board('ab', false, 'juz_amma', 'light', 180, %L, 1)$q$, hz_test.today_text()), 'invalid_nickname');
  PERFORM hz_test.expect_error($q$SELECT public.join_board(NULL, false, 'juz_amma', 'light', 180, '1999-01-01', 1)$q$, 'invalid_local_date');
  board := public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 1);
  PERFORM hz_test.eq('alone: gathering', board->>'status', 'gathering');
  PERFORM hz_test.eq('gathering shows no standings', board ? 'standings', false);
  PERFORM hz_test.eq('board week starts Monday', board->>'week_start', hz_test.d(hz_test.week_start()));
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000002');
  PERFORM public.join_board('Quiet Reader', false, 'juz_amma', 'light', 180, hz_test.today_text(), 1);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000003');
  PERFORM public.join_board('Little Star', true, 'juz_amma', 'light', 120, hz_test.today_text(), 1);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000004');
  board := public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 1);
  PERFORM hz_test.eq('four members: still gathering', board->>'member_count', '4');
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000005');
  board := public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 1);
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
  PERFORM hz_test.eq('lazy placement is idempotent', public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 1)->>'member_count', '5');
  -- Leaving is one tap; rejoining the same week returns to the same cohort.
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000002');
  PERFORM public.leave_board();
  PERFORM hz_test.eq('left: not joined', public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 1)->>'status', 'not_joined');
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000005');
  PERFORM hz_test.eq('leaver removed from standings', public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 1)->>'status', 'gathering');
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000002');
  PERFORM hz_test.eq('rejoin returns to the cohort', public.join_board('Quiet Reader', false, 'hafiz', 'maintenance', -600, hz_test.today_text(), 1)->>'member_count', '5');
  -- Fill the cohort to 30; the next exact match starts a new cohort.
  FOR i IN 6 .. 30 LOOP
    PERFORM hz_test.login(('00000000-0000-4000-8003-' || lpad(i::TEXT, 12, '0'))::UUID);
    PERFORM public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 1);
  END LOOP;
  PERFORM hz_test.eq('cohort holds 30', (public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 1)->>'member_count')::INTEGER, 30);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000031');
  PERFORM hz_test.eq('31st starts a cohort', (public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 1)->>'member_count')::INTEGER, 1);
  -- Widening (BRD-08): adjacent level and a 3 h zone join the small cohort; two bands away starts another.
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000032');
  PERFORM hz_test.eq('adjacent level joins small cohort', (public.join_board(NULL, false, 'juz_4_15', 'light', 180, hz_test.today_text(), 1)->>'member_count')::INTEGER, 2);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000033');
  PERFORM hz_test.eq('3 h zone joins small cohort', (public.join_board(NULL, false, 'juz_amma', 'light', 360, hz_test.today_text(), 1)->>'member_count')::INTEGER, 3);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000034');
  PERFORM hz_test.eq('two level bands away starts a cohort', (public.join_board(NULL, false, 'juz_16_29', 'light', 180, hz_test.today_text(), 1)->>'member_count')::INTEGER, 1);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000035');
  PERFORM hz_test.eq('far zone starts a cohort', (public.join_board(NULL, false, 'juz_amma', 'light', -300, hz_test.today_text(), 1)->>'member_count')::INTEGER, 1);
END $$;
RESET ROLE;

DO $$
BEGIN
  PERFORM hz_test.eq('one cohort per user per week', (
    SELECT count(*) FROM (SELECT user_id FROM public.board_members GROUP BY user_id, week_start HAVING count(*) > 1) AS dupes
  ), 0::BIGINT);
  PERFORM hz_test.eq('cohorts this week', (SELECT count(*) FROM public.board_cohorts WHERE week_start = hz_test.week_start()), 4::BIGINT);
  INSERT INTO hz_test.state
    SELECT 'full_cohort', cohort_id FROM public.board_members WHERE user_id = '00000000-0000-4000-8003-000000000001';
  INSERT INTO hz_test.state
    SELECT 'small_cohort', cohort_id FROM public.board_members WHERE user_id = '00000000-0000-4000-8003-000000000031';
END $$;

-- Finding 17: a member who left a full cohort and rejoins never pushes it past 30. Their one row for
-- the week moves to another cohort chosen by the normal rules.
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000007');
  PERFORM public.leave_board();
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000036');
  PERFORM hz_test.eq('replacement fills the free place',
    (public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 1)->>'member_count')::INTEGER, 30);
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000007');
  PERFORM hz_test.eq('returning member is placed elsewhere',
    (public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 1)->>'member_count')::INTEGER, 4);
END $$;
RESET ROLE;
DO $$
DECLARE
  full_cohort UUID := (SELECT value FROM hz_test.state WHERE key = 'full_cohort')::UUID;
  small_cohort UUID := (SELECT value FROM hz_test.state WHERE key = 'small_cohort')::UUID;
BEGIN
  PERFORM hz_test.eq('full cohort stays at 30', private.board_cohort_size(full_cohort), 30);
  PERFORM hz_test.eq('moved to the small cohort', (
    SELECT cohort_id FROM public.board_members
    WHERE user_id = '00000000-0000-4000-8003-000000000007' AND week_start = hz_test.week_start()
  ), small_cohort);
END $$;

-- Finding 3: standings and sizes count only members still on the board, even while a leave is
-- committing (simulated here by clearing board_joined alone).
UPDATE public.profile_privacy SET board_joined = false WHERE user_id = '00000000-0000-4000-8003-000000000010';
SELECT hz_test.login('00000000-0000-4000-8003-000000000005');
SET ROLE authenticated;
DO $$
DECLARE
  board JSONB := public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 1);
BEGIN
  PERFORM hz_test.eq('opted-out member not counted', (board->>'member_count')::INTEGER, 29);
  PERFORM hz_test.eq('opted-out member not listed', (
    SELECT count(*) FROM jsonb_array_elements(board->'standings') AS s WHERE s->>'name' = 'Board 10'
  ), 0::BIGINT);
END $$;
RESET ROLE;
UPDATE public.profile_privacy SET board_joined = true WHERE user_id = '00000000-0000-4000-8003-000000000010';

DO $$
BEGIN
  PERFORM hz_test.eq('every cohort at most 30', (
    SELECT max(private.board_cohort_size(id)) FROM public.board_cohorts WHERE week_start = hz_test.week_start()
  ), 30);
  PERFORM hz_test.eq('still one cohort per user per week', (
    SELECT count(*) FROM (SELECT user_id FROM public.board_members GROUP BY user_id, week_start HAVING count(*) > 1) AS dupes
  ), 0::BIGINT);
END $$;

-- Finding 15: a board week starts on the user's own week start (STR-28), and users with different
-- week starts never share a cohort. Saturday is 6, as in lib/habit/settings.ts.
SELECT hz_test.make_user(('00000000-0000-4000-8003-' || lpad(i::TEXT, 12, '0'))::UUID, 'board_user_' || i, 'Board ' || i)
FROM generate_series(41, 45) AS i;
CREATE FUNCTION hz_test.saturday_week() RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT hz_test.utc_today() - ((extract(dow FROM hz_test.utc_today())::INTEGER + 1) % 7)
$$;
GRANT EXECUTE ON FUNCTION hz_test.saturday_week() TO authenticated;
-- Board 41: one wird day on the Saturday that starts the week, and one the day before it.
SELECT hz_test.day('00000000-0000-4000-8003-000000000041', hz_test.saturday_week(), 'done', NULL, true, true, false);
SELECT hz_test.day('00000000-0000-4000-8003-000000000041', hz_test.saturday_week() - 1, 'done', NULL, true, true, true);
SET ROLE authenticated;
DO $$
DECLARE
  board JSONB;
  i INTEGER;
  me JSONB;
BEGIN
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000041');
  PERFORM hz_test.expect_error(format($q$SELECT public.get_board('juz_amma', 'light', 180, %L, 7)$q$, hz_test.today_text()), 'invalid_week_start');
  PERFORM hz_test.expect_error(format($q$SELECT public.join_board(NULL, false, 'juz_amma', 'light', 180, %L, NULL)$q$, hz_test.today_text()), 'invalid_week_start');
  board := public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 6);
  PERFORM hz_test.eq('Saturday week start', board->>'week_start', hz_test.d(hz_test.saturday_week()));
  PERFORM hz_test.eq('week start is a Saturday', extract(dow FROM (board->>'week_start')::DATE)::INTEGER, 6);
  PERFORM hz_test.eq('not mixed with Monday cohorts of the same bands', (board->>'member_count')::INTEGER, 1);
  FOR i IN 42 .. 45 LOOP
    PERFORM hz_test.login(('00000000-0000-4000-8003-' || lpad(i::TEXT, 12, '0'))::UUID);
    board := public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 6);
  END LOOP;
  PERFORM hz_test.eq('Saturday cohort ready', board->>'status', 'ready');
  SELECT s INTO me FROM jsonb_array_elements(board->'standings') AS s WHERE s->>'name' = 'Board 41';
  PERFORM hz_test.eq('points from Saturday to Friday only', (me->>'points')::INTEGER, 2);
  -- Changing the week start mid-week moves the user; they never hold two active cohorts at once.
  PERFORM hz_test.login('00000000-0000-4000-8003-000000000040');
  PERFORM public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 1);
  board := public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 6);
  PERFORM hz_test.eq('moved to the Saturday cohort', board->>'member_count', '6');
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_test.eq('one active cohort after the change', (
    SELECT count(*) FROM public.board_members AS bm
    WHERE bm.user_id = '00000000-0000-4000-8003-000000000040' AND bm.left_at IS NULL
  ), 1::BIGINT);
  PERFORM hz_test.eq('stored week start', (
    SELECT board_week_start FROM public.profile_privacy WHERE user_id = '00000000-0000-4000-8003-000000000040'
  ), 6::SMALLINT);
  PERFORM hz_test.eq('Saturday cohort keyed by its Saturday', (
    SELECT count(*) FROM public.board_cohorts WHERE week_start = hz_test.saturday_week()
  ), 1::BIGINT);
END $$;

-- Finding 16: without cron, a board read places the other joined users of its week who keep
-- studying, in bounded batches of 100, from the bands they last reported. Wednesday (3) is used by
-- no other test. 8004-...1 to 103 studied recently, 104 did not, 105 left the board.
SELECT hz_test.make_user(('00000000-0000-4000-8004-' || lpad(i::TEXT, 12, '0'))::UUID, 'pass_user_' || i, NULL)
FROM generate_series(1, 105) AS i;
CREATE FUNCTION hz_test.wednesday_week() RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT hz_test.utc_today() - ((extract(dow FROM hz_test.utc_today())::INTEGER - 3 + 7) % 7)
$$;
GRANT EXECUTE ON FUNCTION hz_test.wednesday_week() TO authenticated;
INSERT INTO public.profile_privacy (user_id, board_joined, board_week_start, board_level_band, board_pace_band,
  board_utc_offset_minutes, board_enrolled_week)
SELECT ('00000000-0000-4000-8004-' || lpad(i::TEXT, 12, '0'))::UUID, i <> 105, 3, 'juz_amma', 'light', 180,
  hz_test.wednesday_week() - 7
FROM generate_series(1, 105) AS i;
SELECT hz_test.day(('00000000-0000-4000-8004-' || lpad(i::TEXT, 12, '0'))::UUID, hz_test.wednesday_week() - 3, 'done')
FROM generate_series(1, 103) AS i;
SELECT hz_test.day('00000000-0000-4000-8004-000000000105', hz_test.wednesday_week() - 3, 'done');
-- 104's only wird day is a month old.
SELECT hz_test.day('00000000-0000-4000-8004-000000000104', hz_test.wednesday_week() - 30, 'done');

-- Definer, so the count sees board_members, which has no client policies.
CREATE FUNCTION hz_test.placed_this_wednesday_week() RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT count(*) FROM public.board_members WHERE week_start = hz_test.wednesday_week() AND left_at IS NULL
$$;
GRANT EXECUTE ON FUNCTION hz_test.placed_this_wednesday_week() TO authenticated;

SELECT hz_test.login('00000000-0000-4000-8004-000000000001');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 3);
  PERFORM hz_test.eq('first read places the reader and a batch of 100', hz_test.placed_this_wednesday_week(), 101::BIGINT);
  PERFORM public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 3);
  PERFORM hz_test.eq('next read places the rest who keep studying', hz_test.placed_this_wednesday_week(), 103::BIGINT);
  PERFORM public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 3);
  PERFORM hz_test.eq('the pass is idempotent', hz_test.placed_this_wednesday_week(), 103::BIGINT);
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_test.eq('inactive user considered but not placed', (
    SELECT board_enrolled_week FROM public.profile_privacy WHERE user_id = '00000000-0000-4000-8004-000000000104'
  ), hz_test.wednesday_week());
  PERFORM hz_test.eq('inactive user has no cohort', (
    SELECT count(*) FROM public.board_members WHERE user_id = '00000000-0000-4000-8004-000000000104'
  ), 0::BIGINT);
  PERFORM hz_test.eq('user who left the board is not placed', (
    SELECT count(*) FROM public.board_members WHERE user_id = '00000000-0000-4000-8004-000000000105'
  ), 0::BIGINT);
  PERFORM hz_test.eq('batch placement respects capacity', (
    SELECT max(private.board_cohort_size(id)) FROM public.board_cohorts WHERE week_start = hz_test.wednesday_week()
  ), 30);
  PERFORM hz_test.eq('103 people make four cohorts', (
    SELECT count(*) FROM public.board_cohorts WHERE week_start = hz_test.wednesday_week()
  ), 4::BIGINT);
  PERFORM hz_test.eq('inactive user is waiting', (
    SELECT board_waiting FROM public.profile_privacy WHERE user_id = '00000000-0000-4000-8004-000000000104'
  ), true);
END $$;

-- Finding 6 (second review): a user a pass left waiting returns to the queue with their next synced
-- wird day, and passes place users from the bands the app last reported (refresh_board_bands).
SELECT hz_test.day('00000000-0000-4000-8004-000000000104', hz_test.utc_today(), 'done');
DO $$
BEGIN
  PERFORM hz_test.eq('a synced wird day requeues the waiting user', (
    SELECT NOT board_waiting AND board_enrolled_week < hz_test.wednesday_week()
    FROM public.profile_privacy WHERE user_id = '00000000-0000-4000-8004-000000000104'
  ), true);
END $$;
-- 106 joined with juz_amma bands and now reports hafiz; 107 moves its week start to Saturday.
SELECT hz_test.make_user(('00000000-0000-4000-8004-' || lpad(i::TEXT, 12, '0'))::UUID, 'pass_user_' || i, NULL)
FROM generate_series(106, 107) AS i;
INSERT INTO public.profile_privacy (user_id, board_joined, board_week_start, board_level_band, board_pace_band,
  board_utc_offset_minutes, board_enrolled_week)
SELECT ('00000000-0000-4000-8004-' || lpad(i::TEXT, 12, '0'))::UUID, true, 3, 'juz_amma', 'light', 180,
  hz_test.wednesday_week() - CASE WHEN i = 106 THEN 7 ELSE 0 END
FROM generate_series(106, 107) AS i;
SELECT hz_test.day('00000000-0000-4000-8004-000000000106', hz_test.utc_today() - 1, 'done');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.login('00000000-0000-4000-8004-000000000106');
  PERFORM public.refresh_board_bands('hafiz', 'light', 180, hz_test.today_text(), 3);
  PERFORM hz_test.expect_error(format($q$SELECT public.refresh_board_bands('hafiz', 'warp', 180, %L, 3)$q$,
    hz_test.today_text()), 'invalid_bands');
  PERFORM hz_test.login('00000000-0000-4000-8004-000000000107');
  PERFORM public.refresh_board_bands('juz_amma', 'light', 180, hz_test.today_text(), 6);
  PERFORM hz_test.login('00000000-0000-4000-8004-000000000105');
  PERFORM public.refresh_board_bands('hafiz', 'light', 180, hz_test.today_text(), 3);
  PERFORM hz_test.login('00000000-0000-4000-8004-000000000001');
  PERFORM public.get_board('juz_amma', 'light', 180, hz_test.today_text(), 3);
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_test.eq('the requeued user is placed by the next pass', (
    SELECT count(*) FROM public.board_members
    WHERE user_id = '00000000-0000-4000-8004-000000000104' AND week_start = hz_test.wednesday_week() AND left_at IS NULL
  ), 1::BIGINT);
  PERFORM hz_test.eq('the pass uses the reported bands', (
    SELECT bc.level_band FROM public.board_members AS bm JOIN public.board_cohorts AS bc ON bc.id = bm.cohort_id
    WHERE bm.user_id = '00000000-0000-4000-8004-000000000106' AND bm.week_start = hz_test.wednesday_week()
  ), 'hafiz');
  PERFORM hz_test.eq('a new week start returns the user to the queue for it', (
    SELECT board_week_start = 6 AND board_enrolled_week < hz_test.saturday_week() AND NOT board_waiting
    FROM public.profile_privacy WHERE user_id = '00000000-0000-4000-8004-000000000107'
  ), true);
  PERFORM hz_test.eq('bands of a user off the board stay as they were', (
    SELECT board_level_band FROM public.profile_privacy WHERE user_id = '00000000-0000-4000-8004-000000000105'
  ), 'juz_amma');
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

-- Finding 1 (second review): stating minority clears the profile photo in the same transaction, and
-- the public avatars bucket refuses a minor's uploads and replacements. Deleting stays allowed.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('avatars', '00000000-0000-4000-8000-00000000000b/old.png', '00000000-0000-4000-8000-00000000000b'),
  ('avatars', '00000000-0000-4000-8000-00000000000a/old.png', '00000000-0000-4000-8000-00000000000a');
DO $$
BEGIN
  PERFORM hz_test.eq('a minor''s photo is cleared', (SELECT avatar_url FROM public.profiles WHERE id = '00000000-0000-4000-8000-00000000000b'), NULL::TEXT);
  PERFORM hz_test.eq('an adult keeps their photo', (SELECT avatar_url FROM public.profiles WHERE id = '00000000-0000-4000-8000-00000000000a'),
    'https://example.invalid/a.png');
  PERFORM hz_test.eq('joining the board as a minor clears the photo too', (
    SELECT avatar_url FROM public.profiles WHERE id = '00000000-0000-4000-8003-000000000003'
  ), NULL::TEXT);
END $$;
SET ROLE authenticated;
-- A minor setting an outside image URL on their own profile keeps no photo.
UPDATE public.profiles SET avatar_url = 'https://example.invalid/outside.png' WHERE id = '00000000-0000-4000-8000-00000000000b';
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_test.eq('a minor cannot set an outside photo URL', (SELECT avatar_url FROM public.profiles WHERE id = '00000000-0000-4000-8000-00000000000b'), NULL::TEXT);
END $$;
SET ROLE authenticated;
-- Fourth review, finding 2: a file the app has not deleted yet sits in a folder named after the
-- minor's id. Only the minor lists it, which they need to delete it.
DO $$
BEGIN
  PERFORM hz_test.eq('a minor lists their own leftover photo', (
    SELECT count(*) FROM storage.objects WHERE name LIKE '00000000-0000-4000-8000-00000000000b/%'
  ), 1::BIGINT);
  PERFORM hz_test.login('00000000-0000-4000-8000-00000000000c');
  PERFORM hz_test.eq('a stranger cannot list a minor''s photo', (
    SELECT count(*) FROM storage.objects WHERE name LIKE '00000000-0000-4000-8000-00000000000b/%'
  ), 0::BIGINT);
  PERFORM hz_test.eq('a stranger still lists an adult''s photo', (
    SELECT count(*) FROM storage.objects WHERE name LIKE '00000000-0000-4000-8000-00000000000a/%'
  ), 1::BIGINT);
  PERFORM hz_test.login('00000000-0000-4000-8000-00000000000b');
END $$;
DO $$
BEGIN
  PERFORM hz_test.expect_error($q$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('avatars', '00000000-0000-4000-8000-00000000000b/new.png', '00000000-0000-4000-8000-00000000000b')$q$, 'row-level security');
  PERFORM hz_test.expect_error($q$UPDATE storage.objects SET name = '00000000-0000-4000-8000-00000000000b/renamed.png'
    WHERE name = '00000000-0000-4000-8000-00000000000b/old.png'$q$, 'row-level security');
  DELETE FROM storage.objects WHERE name = '00000000-0000-4000-8000-00000000000b/old.png';
  PERFORM hz_test.eq('a minor deletes their own photo', (
    SELECT count(*) FROM storage.objects WHERE name LIKE '00000000-0000-4000-8000-00000000000b/%'
  ), 0::BIGINT);
  PERFORM hz_test.login('00000000-0000-4000-8000-00000000000a');
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', '00000000-0000-4000-8000-00000000000a/new.png', '00000000-0000-4000-8000-00000000000a');
  UPDATE storage.objects SET name = '00000000-0000-4000-8000-00000000000a/renamed.png' WHERE name = '00000000-0000-4000-8000-00000000000a/old.png';
  PERFORM hz_test.eq('an adult uploads and replaces', (
    SELECT count(*) FROM storage.objects WHERE name IN ('00000000-0000-4000-8000-00000000000a/new.png', '00000000-0000-4000-8000-00000000000a/renamed.png')
  ), 2::BIGINT);
  PERFORM hz_test.expect_error($q$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('avatars', '00000000-0000-4000-8000-00000000000b/x.png', '00000000-0000-4000-8000-00000000000a')$q$, 'row-level security');
END $$;
RESET ROLE;

-- Finding 1: once B states they are a minor, their identity row is hidden from everyone but B. The
-- reflection feed embeds authors through the same policy, so other authors still show. Fourth review,
-- finding 2: B's reflection itself is hidden too, since it carries B's id and words.
INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content) VALUES
  ('00000000-0000-4000-8000-00000000000a', 1, 1, 1, 1, 1, 'A reflection by an adult author'),
  ('00000000-0000-4000-8000-00000000000b', 1, 2, 2, 1, 1, 'A reflection by a minor author');
CREATE FUNCTION hz_test.feed_authors() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT string_agg(r.content || '=' || COALESCE(p.username, '(hidden)'), '; ' ORDER BY r.content)
  FROM public.reflections AS r LEFT JOIN public.profiles AS p ON p.id = r.user_id
$$;
GRANT EXECUTE ON FUNCTION hz_test.feed_authors() TO anon, authenticated;

SELECT hz_test.login(NULL);
SET ROLE anon;
DO $$
BEGIN
  PERFORM hz_test.eq('a minor never goes public', public.get_profile_summary('00000000-0000-4000-8000-00000000000b'),
    NULL::JSONB);
  PERFORM hz_test.eq('anon cannot read a minor''s identity', (
    SELECT count(*) FROM public.profiles WHERE id = '00000000-0000-4000-8000-00000000000b' OR username = 'member_b'
  ), 0::BIGINT);
  PERFORM hz_test.eq('anon cannot read a board minor''s identity', (
    SELECT count(*) FROM public.profiles WHERE id = '00000000-0000-4000-8003-000000000003'
  ), 0::BIGINT);
  PERFORM hz_test.eq('anon still reads adult identity', (
    SELECT display_name FROM public.profiles WHERE id = '00000000-0000-4000-8000-00000000000a'
  ), 'Teacher A');
  PERFORM hz_test.eq('feed keeps adult authors and hides the minor', hz_test.feed_authors(),
    'A reflection by an adult author=teacher_a');
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000c');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.eq('signed-in outsider cannot read a minor''s identity', (
    SELECT count(*) FROM public.profiles WHERE id = '00000000-0000-4000-8000-00000000000b'
  ), 0::BIGINT);
  PERFORM hz_test.eq('outsider gets no summary for a minor', public.get_profile_summary('00000000-0000-4000-8000-00000000000b'),
    NULL::JSONB);
  PERFORM hz_test.eq('outsider feed hides the minor too', hz_test.feed_authors(),
    'A reflection by an adult author=teacher_a');
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8000-00000000000b');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.eq('the minor reads their own identity', (
    SELECT username FROM public.profiles WHERE id = auth.uid()
  ), 'member_b');
  PERFORM hz_test.eq('the minor reads their own reflection in the feed', hz_test.feed_authors(),
    'A reflection by a minor author=member_b; A reflection by an adult author=teacher_a');
  PERFORM hz_test.eq('the minor sees their own streak', public.get_profile_summary(auth.uid())->>'streak',
    (SELECT value FROM hz_test.state WHERE key = 'b_streak'));
END $$;
RESET ROLE;

-- SOC-02: halaqa co-members still see the minor's name and what they shared, through the RPCs.
SELECT hz_test.login('00000000-0000-4000-8000-00000000000a');
SET ROLE authenticated;
DO $$
DECLARE
  gid UUID := (SELECT value FROM hz_test.state WHERE key = 'group')::UUID;
BEGIN
  PERFORM hz_test.eq('co-member sees the minor in the halaqa', (
    SELECT m->>'name' FROM jsonb_array_elements(public.get_halaqa_detail(gid, hz_test.today_text())->'members') AS m
    WHERE m->>'user_id' = '00000000-0000-4000-8000-00000000000b'
  ), 'Member B');
  PERFORM hz_test.eq('co-member still sees what the minor shared', public.get_profile_summary('00000000-0000-4000-8000-00000000000b'),
    '{"streak": null, "juz_completed": [30]}'::JSONB);
  PERFORM hz_test.eq('co-member cannot read the identity row directly', (
    SELECT count(*) FROM public.profiles WHERE id = '00000000-0000-4000-8000-00000000000b'
  ), 0::BIGINT);
END $$;
RESET ROLE;

-- Third review, finding 3: recording minority leaves matched halaqas, whose members are strangers,
-- the way leaving does, and keeps invite halaqas. 8006-1 is in a matched halaqa with 8006-2 and an
-- invite halaqa with 8006-3; 8006-4 is alone in a matched halaqa and joins the board as a minor.
SELECT hz_test.make_user(('00000000-0000-4000-8006-' || lpad(i::TEXT, 12, '0'))::UUID, 'third_user_' || i, 'Third ' || i,
  'https://example.invalid/third' || i || '.png')
FROM generate_series(1, 4) AS i;
SET ROLE authenticated;
DO $$
DECLARE
  matched JSONB;
  invite JSONB;
  detail JSONB;
  member JSONB;
BEGIN
  PERFORM hz_test.login('00000000-0000-4000-8006-000000000001');
  matched := public.join_matched_halaqa('juz_16_29', 'maintenance', 600);
  invite := public.create_invite_halaqa('Third family');
  PERFORM hz_test.login('00000000-0000-4000-8006-000000000002');
  PERFORM hz_test.eq('a stranger is matched into the halaqa',
    public.join_matched_halaqa('juz_16_29', 'maintenance', 600)->>'id', matched->>'id');
  PERFORM hz_test.login('00000000-0000-4000-8006-000000000003');
  PERFORM public.join_halaqa_by_code(invite->>'invite_code');
  PERFORM hz_test.login('00000000-0000-4000-8006-000000000001');
  PERFORM public.send_halaqa_encouragement((matched->>'id')::UUID, '00000000-0000-4000-8006-000000000002', 'together',
    NULL, hz_test.today_text());
  PERFORM public.set_profile_privacy(false, false, true);
  PERFORM hz_test.eq('only the invite halaqa stays', (
    SELECT string_agg(h->>'id', ',') FROM jsonb_array_elements(public.get_my_halaqas()) AS h
  ), invite->>'id');
  PERFORM hz_test.expect_error(format($q$SELECT public.get_halaqa_detail(%L, %L)$q$, matched->>'id', hz_test.today_text()),
    'not_a_member');

  -- The stranger keeps the encouragement but no longer sees who the minor is.
  PERFORM hz_test.login('00000000-0000-4000-8006-000000000002');
  detail := public.get_halaqa_detail((matched->>'id')::UUID, hz_test.today_text());
  PERFORM hz_test.eq('the matched halaqa counts the stranger alone', (detail->'group'->>'member_count')::INTEGER, 1);
  PERFORM hz_test.eq('the encouragement stays', jsonb_array_length(detail->'received'), 1);
  PERFORM hz_test.eq('without the sender''s name', detail->'received'->0->'from_name', 'null'::JSONB);
  PERFORM hz_test.eq('no minor id in the matched halaqa', position('00000000-0000-4000-8006-000000000001' IN detail::TEXT), 0);
  PERFORM hz_test.eq('no minor username in the matched halaqa', position('third_user_1' IN detail::TEXT), 0);
  PERFORM hz_test.eq('no minor name in the matched halaqa', position('Third 1' IN detail::TEXT), 0);

  -- The invite halaqa keeps the minor, without a photo.
  PERFORM hz_test.login('00000000-0000-4000-8006-000000000003');
  SELECT m INTO member FROM jsonb_array_elements(public.get_halaqa_detail((invite->>'id')::UUID, hz_test.today_text())->'members') AS m
  WHERE m->>'username' = 'third_user_1';
  PERFORM hz_test.eq('the invite halaqa keeps the minor', member->>'name', 'Third 1');
  PERFORM hz_test.eq('the invite halaqa shows no photo of the minor', member->'avatar_url', 'null'::JSONB);
  INSERT INTO hz_test.state VALUES ('third_invite', invite->>'id');

  -- Joining the board as a minor leaves a matched halaqa too, and closes it once it is empty.
  PERFORM hz_test.login('00000000-0000-4000-8006-000000000004');
  matched := public.join_matched_halaqa('starting', 'maintenance', -720);
  INSERT INTO hz_test.state VALUES ('third_alone', matched->>'id');
  PERFORM public.join_board('Quiet Kid', true, 'starting', 'maintenance', -720, hz_test.today_text(), 0);
  PERFORM hz_test.eq('a board minor keeps no matched halaqa', public.get_my_halaqas(), '[]'::JSONB);
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_test.eq('an emptied matched halaqa is closed', (
    SELECT deleted_at IS NOT NULL FROM public.halaqa_groups WHERE id = (SELECT value FROM hz_test.state WHERE key = 'third_alone')::UUID
  ), true);
  PERFORM hz_test.eq('both minors have no photo', (
    SELECT count(*) FROM public.profiles
    WHERE id IN ('00000000-0000-4000-8006-000000000001', '00000000-0000-4000-8006-000000000004') AND avatar_url IS NOT NULL
  ), 0::BIGINT);
END $$;

-- Third review, finding 2, defense in depth: even a photo stored for a minor by mistake (here with
-- the profile trigger switched off) never reaches another member.
ALTER TABLE public.profiles DISABLE TRIGGER profiles_minor_photo;
UPDATE public.profiles SET avatar_url = 'https://example.invalid/stored-by-mistake.png'
WHERE id = '00000000-0000-4000-8006-000000000001';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_minor_photo;
SELECT hz_test.login('00000000-0000-4000-8006-000000000003');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.eq('a stored photo of a minor is not returned', (
    SELECT m->'avatar_url'
    FROM jsonb_array_elements(public.get_halaqa_detail((SELECT value FROM hz_test.state WHERE key = 'third_invite')::UUID,
      hz_test.today_text())->'members') AS m
    WHERE m->>'username' = 'third_user_1'
  ), 'null'::JSONB);
END $$;
RESET ROLE;
UPDATE public.profiles SET avatar_url = NULL WHERE id = '00000000-0000-4000-8006-000000000001';

-- A minor already on the board without a nickname cannot be recorded (BRD-07).
SELECT hz_test.login('00000000-0000-4000-8003-000000000001');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.expect_error('SELECT public.set_profile_privacy(false, false, true)', 'nickname_required');
END $$;
RESET ROLE;

-- Fourth review, finding 2: a minor's reflections, comments and likes are readable only by that
-- minor, and the public counts leave them out. 8008-1 is active as an adult and then states
-- minority; 8008-2 is an adult. Both react to Teacher A's reflection above.
SELECT hz_test.make_user(('00000000-0000-4000-8008-' || lpad(i::TEXT, 12, '0'))::UUID, 'fourth_user_' || i, 'Fourth ' || i)
FROM generate_series(1, 2) AS i;
INSERT INTO hz_test.state SELECT 'adult_reflection', id::TEXT FROM public.reflections WHERE content = 'A reflection by an adult author';
-- The counts on Teacher A's reflection and on 8008-2's comment there, as the caller reads them.
CREATE FUNCTION hz_test.adult_counts() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT r.likes_count || ' likes, ' || r.comments_count || ' comments, comment liked ' || COALESCE((
    SELECT c.likes_count FROM public.reflection_comments AS c WHERE c.content = 'An adult comment'
  )::TEXT, '-')
  FROM public.reflections AS r WHERE r.content = 'A reflection by an adult author'
$$;
-- Every reflection, comment and like row the caller can read, as text.
CREATE FUNCTION hz_test.public_activity() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT concat_ws(' | ',
    (SELECT string_agg(to_jsonb(r)::TEXT, ',') FROM public.reflections AS r),
    (SELECT string_agg(to_jsonb(c)::TEXT, ',') FROM public.reflection_comments AS c),
    (SELECT string_agg(to_jsonb(l)::TEXT, ',') FROM public.reflection_likes AS l),
    (SELECT string_agg(to_jsonb(cl)::TEXT, ',') FROM public.reflection_comment_likes AS cl))
$$;
GRANT EXECUTE ON FUNCTION hz_test.adult_counts(), hz_test.public_activity() TO anon, authenticated;

SET ROLE authenticated;
DO $$
DECLARE
  adult_reflection UUID := (SELECT value FROM hz_test.state WHERE key = 'adult_reflection')::UUID;
  adult_comment UUID;
  minor_reflection UUID;
BEGIN
  PERFORM hz_test.login('00000000-0000-4000-8008-000000000002');
  PERFORM public.set_reflection_like(auth.uid(), adult_reflection, true);
  adult_comment := (public.add_reflection_comment(auth.uid(), adult_reflection, 'An adult comment', false)).id;

  PERFORM hz_test.login('00000000-0000-4000-8008-000000000001');
  PERFORM public.create_reflection(auth.uid(), 1, 3, 3, 1, 1, 'Written before minority', false);
  PERFORM public.set_reflection_like(auth.uid(), adult_reflection, true);
  PERFORM public.add_reflection_comment(auth.uid(), adult_reflection, 'Said before minority', false);
  PERFORM public.set_reflection_comment_like(auth.uid(), adult_comment, true);
  PERFORM hz_test.eq('an adult''s activity is counted', hz_test.adult_counts(), '2 likes, 2 comments, comment liked 1');

  -- Stating minority recounts what they touched. A minor still writes, and reads what they wrote.
  PERFORM public.set_profile_privacy(false, false, true);
  PERFORM hz_test.eq('stating minority leaves their activity out of the counts', hz_test.adult_counts(),
    '1 likes, 1 comments, comment liked 0');
  minor_reflection := (public.create_reflection(auth.uid(), 1, 4, 4, 1, 1, 'Written as a minor', true)).id;
  INSERT INTO hz_test.state VALUES ('minor_reflection', minor_reflection::TEXT);
  PERFORM public.add_reflection_comment(auth.uid(), adult_reflection, 'Said as a minor', true);
  PERFORM hz_test.eq('a minor''s new comment is not counted', hz_test.adult_counts(), '1 likes, 1 comments, comment liked 0');
  PERFORM hz_test.eq('the minor reads their own reflections', (
    SELECT string_agg(content, '; ' ORDER BY content) FROM public.reflections WHERE user_id = auth.uid()
  ), 'Written as a minor; Written before minority');
  PERFORM hz_test.eq('the minor reads their own comments', (
    SELECT string_agg(content, '; ' ORDER BY content) FROM public.reflection_comments WHERE user_id = auth.uid()
  ), 'Said as a minor; Said before minority');
  PERFORM hz_test.eq('the minor reads their own likes', (
    SELECT count(*) FROM public.reflection_likes WHERE user_id = auth.uid()
  ) + (SELECT count(*) FROM public.reflection_comment_likes WHERE user_id = auth.uid()), 2::BIGINT);
END $$;
RESET ROLE;

-- Strangers, signed out or in, read none of it: not the rows, the ids, the words, or the counts.
-- The probe of the review: B (8000-b) is a minor whose reflection used to stay readable.
SELECT hz_test.login(NULL);
SET ROLE anon;
DO $$
DECLARE
  visible TEXT := hz_test.public_activity();
BEGIN
  PERFORM hz_test.eq('anon reads no id of a minor', position('00000000-0000-4000-8008-000000000001' IN visible)
    + position('00000000-0000-4000-8000-00000000000b' IN visible), 0);
  PERFORM hz_test.eq('anon reads no words of a minor', visible ~ 'minority|as a minor|by a minor', false);
  PERFORM hz_test.eq('anon still reads adult activity', position('An adult comment' IN visible) > 0, true);
  PERFORM hz_test.eq('anon reads counts without the minor', hz_test.adult_counts(), '1 likes, 1 comments, comment liked 0');
  PERFORM hz_test.eq('anon reads as many likes and comments as the counts say', (
    SELECT count(*) FROM public.reflection_likes WHERE reflection_id = (SELECT value FROM hz_test.state WHERE key = 'adult_reflection')::UUID
  ) || '/' || (
    SELECT count(*) FROM public.reflection_comments WHERE reflection_id = (SELECT value FROM hz_test.state WHERE key = 'adult_reflection')::UUID
  ), '1/1');
END $$;
RESET ROLE;

SELECT hz_test.login('00000000-0000-4000-8008-000000000002');
SET ROLE authenticated;
DO $$
DECLARE
  visible TEXT := hz_test.public_activity();
  minor_reflection UUID := (SELECT value FROM hz_test.state WHERE key = 'minor_reflection')::UUID;
BEGIN
  PERFORM hz_test.eq('a signed-in stranger reads no id of a minor', position('00000000-0000-4000-8008-000000000001' IN visible)
    + position('00000000-0000-4000-8000-00000000000b' IN visible), 0);
  PERFORM hz_test.eq('a signed-in stranger reads no words of a minor', visible ~ 'minority|as a minor|by a minor', false);
  PERFORM hz_test.eq('a signed-in stranger reads counts without the minor', hz_test.adult_counts(),
    '1 likes, 1 comments, comment liked 0');
  PERFORM hz_test.expect_error(format('SELECT public.set_reflection_like(%L, %L, true)', auth.uid(), minor_reflection),
    'reflection_not_found');
  PERFORM hz_test.expect_error(format($q$SELECT public.add_reflection_comment(%L, %L, 'Hello there', false)$q$,
    auth.uid(), minor_reflection), 'reflection_not_found');
END $$;
RESET ROLE;

-- Withdrawing minority counts the activity again and stating it again leaves it out; removing a
-- like that was never counted, or the whole account, changes no count.
SELECT hz_test.login('00000000-0000-4000-8008-000000000001');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM public.set_profile_privacy(false, false, false);
  PERFORM hz_test.eq('withdrawing minority counts the activity again', hz_test.adult_counts(),
    '2 likes, 3 comments, comment liked 1');
  PERFORM public.set_profile_privacy(false, false, true);
  PERFORM hz_test.eq('stating it again leaves it out again', hz_test.adult_counts(), '1 likes, 1 comments, comment liked 0');
  PERFORM public.set_reflection_like(auth.uid(), (SELECT value FROM hz_test.state WHERE key = 'adult_reflection')::UUID, false);
  PERFORM hz_test.eq('removing a minor''s like changes no count', hz_test.adult_counts(), '1 likes, 1 comments, comment liked 0');
END $$;
RESET ROLE;
DELETE FROM public.profiles WHERE id = '00000000-0000-4000-8008-000000000001';
DO $$
BEGIN
  PERFORM hz_test.eq('deleting a minor''s account changes no count', hz_test.adult_counts(), '1 likes, 1 comments, comment liked 0');
END $$;
SELECT hz_test.login('00000000-0000-4000-8008-000000000002');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM public.set_reflection_like(auth.uid(), (SELECT value FROM hz_test.state WHERE key = 'adult_reflection')::UUID, false);
  PERFORM hz_test.eq('an adult''s unlike still counts down', hz_test.adult_counts(), '0 likes, 1 comments, comment liked 0');
END $$;
RESET ROLE;

-- Stored counts that differ from a full recount, as text, or 'none'.
CREATE FUNCTION hz_test.count_drift() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(drift, '; ' ORDER BY drift), 'none') FROM (
    SELECT format('reflection %s: %s likes stored, %s counted; %s comments stored, %s counted',
      r.content, r.likes_count, likes.n, r.comments_count, comments.n) AS drift
    FROM public.reflections AS r
    CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.reflection_likes AS l
      WHERE l.reflection_id = r.id AND NOT private.is_minor(l.user_id)) AS likes
    CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.reflection_comments AS c
      WHERE c.reflection_id = r.id AND NOT private.is_minor(c.user_id)) AS comments
    WHERE r.likes_count IS DISTINCT FROM likes.n OR r.comments_count IS DISTINCT FROM comments.n
    UNION ALL
    SELECT format('comment %s: %s likes stored, %s counted', c.content, c.likes_count, likes.n)
    FROM public.reflection_comments AS c
    CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.reflection_comment_likes AS cl
      WHERE cl.comment_id = c.id AND NOT private.is_minor(cl.user_id)) AS likes
    WHERE c.likes_count IS DISTINCT FROM likes.n
  ) AS d
$$;
-- Scans and row updates of a public table so far in this transaction.
CREATE FUNCTION hz_test.scans(rel TEXT) RETURNS BIGINT LANGUAGE sql VOLATILE AS $$
  SELECT COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0) FROM pg_stat_xact_user_tables
  WHERE schemaname = 'public' AND relname = rel
$$;
CREATE FUNCTION hz_test.updates(rel TEXT) RETURNS BIGINT LANGUAGE sql VOLATILE AS $$
  SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE schemaname = 'public' AND relname = rel
$$;
GRANT EXECUTE ON FUNCTION hz_test.scans(TEXT), hz_test.updates(TEXT) TO authenticated;

DO $$
BEGIN
  PERFORM hz_test.eq('counts so far match a full recount', hz_test.count_drift(), 'none');
END $$;

-- Fifth review, finding 1: the composer and the comment input promise a stated minor privacy from a
-- cached copy that another device may have changed. A write carries that promise, and one promised
-- private is refused once the writer is no longer a minor, so nothing is published that the screen
-- said would stay private. 8010-1 records minority and withdraws it as another device would.
SELECT hz_test.make_user(('00000000-0000-4000-8010-' || lpad(i::TEXT, 12, '0'))::UUID, 'fifth_user_' || i, 'Fifth ' || i)
FROM generate_series(1, 6) AS i;
INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content)
VALUES ('00000000-0000-4000-8010-000000000002', 2, 1, 1, 1, 1, 'A reflection by fifth user two');
INSERT INTO hz_test.state SELECT 'fifth_reflection', id::TEXT FROM public.reflections WHERE content = 'A reflection by fifth user two';

SELECT hz_test.login('00000000-0000-4000-8010-000000000001');
SET ROLE authenticated;
DO $$
DECLARE
  target UUID := (SELECT value FROM hz_test.state WHERE key = 'fifth_reflection')::UUID;
BEGIN
  PERFORM public.set_profile_privacy(false, false, true);
  PERFORM public.create_reflection(auth.uid(), 2, 2, 2, 1, 1, 'Kept private as promised', true);
  PERFORM public.add_reflection_comment(auth.uid(), target, 'A comment kept private as promised', true);

  -- Another device withdraws minority while this screen still promises privacy.
  PERFORM public.set_profile_privacy(false, false, false);
  PERFORM hz_test.expect_error(format($q$SELECT public.create_reflection(%L, 2, 3, 3, 1, 1,
    'Promised private after the withdrawal', true)$q$, auth.uid()), 'privacy_changed');
  PERFORM hz_test.expect_error(format($q$SELECT public.add_reflection_comment(%L, %L,
    'Promised private after the withdrawal', true)$q$, auth.uid(), target), 'privacy_changed');
  PERFORM hz_test.eq('a refused write stores nothing', (
    SELECT count(*) FROM public.reflections WHERE content = 'Promised private after the withdrawal'
  ) + (SELECT count(*) FROM public.reflection_comments WHERE content = 'Promised private after the withdrawal'), 0::BIGINT);
  -- Shown as public to an adult, it posts.
  PERFORM public.create_reflection(auth.uid(), 2, 4, 4, 1, 1, 'Shown as public to an adult', false);

  -- The reverse: the screen shows an adult, another device recorded minority. The text only becomes
  -- more private, so it is accepted.
  PERFORM public.set_profile_privacy(false, false, true);
  PERFORM public.create_reflection(auth.uid(), 2, 5, 5, 1, 1, 'Shown as public, kept private for a minor', false);
  PERFORM public.add_reflection_comment(auth.uid(), target, 'Shown as public, kept private for a minor', false);

  -- Every write states what the screen showed, for the signed-in account only, and only through the RPCs.
  PERFORM hz_test.expect_error(format($q$SELECT public.create_reflection(%L, 2, 6, 6, 1, 1, 'No promise given', NULL)$q$,
    auth.uid()), 'invalid_visibility');
  PERFORM hz_test.expect_error(format($q$SELECT public.add_reflection_comment(%L, %L, 'Written for another account', false)$q$,
    '00000000-0000-4000-8010-000000000002', target), 'account_mismatch');
  PERFORM hz_test.expect_error(format($q$INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start,
    juz_end, content) VALUES (%L, 2, 7, 7, 1, 1, 'A direct insert skips the promise')$q$, auth.uid()), 'permission denied');
  PERFORM hz_test.expect_error(format($q$INSERT INTO public.reflection_comments (user_id, reflection_id, content)
    VALUES (%L, %L, 'A direct insert skips the promise')$q$, auth.uid(), target), 'permission denied');
  PERFORM hz_test.expect_error(format($q$INSERT INTO public.reflection_likes (user_id, reflection_id) VALUES (%L, %L)$q$,
    auth.uid(), target), 'permission denied');
  PERFORM hz_test.expect_error('DELETE FROM public.reflection_comments WHERE user_id = auth.uid()', 'permission denied');
  PERFORM hz_test.expect_error('DELETE FROM public.reflections WHERE user_id = auth.uid()', 'permission denied');
  -- An owner cannot edit counts or un-hide a post either.
  PERFORM hz_test.expect_error('UPDATE public.reflections SET likes_count = 99 WHERE user_id = auth.uid()', 'permission denied');
  PERFORM hz_test.expect_error($q$UPDATE public.reflections SET status = 'active' WHERE user_id = auth.uid()$q$, 'permission denied');
  PERFORM hz_test.eq('the minor reads what they wrote', (
    SELECT string_agg(content, '; ' ORDER BY content) FROM public.reflections WHERE user_id = auth.uid()
  ), 'Kept private as promised; Shown as public to an adult; Shown as public, kept private for a minor');
END $$;
RESET ROLE;

SELECT hz_test.login(NULL);
SET ROLE anon;
DO $$
DECLARE
  visible TEXT := hz_test.public_activity();
BEGIN
  PERFORM hz_test.eq('anon reads nothing 8010-1 wrote', position('00000000-0000-4000-8010-000000000001' IN visible)
    + position('promised' IN visible) + position('kept private' IN visible), 0);
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_test.eq('promised writes leave the counts exact', hz_test.count_drift(), 'none');
END $$;

-- Fifth review, findings 3 and 4. A single like or comment moves its count by one and never reads the
-- rest of the discussion; a statement or cascade that changes many rows recounts each parent once;
-- and through likes, unlikes, comments, deletions, minority changes and account deletion every count
-- matches a full recount. 8010-3 wrote a reflection with many comments by 8010-4.
INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content)
VALUES ('00000000-0000-4000-8010-000000000003', 2, 10, 10, 1, 1, 'A busy reflection'),
  ('00000000-0000-4000-8010-000000000003', 2, 11, 11, 1, 1, 'A reflection its author deletes');
INSERT INTO hz_test.state SELECT 'busy', id::TEXT FROM public.reflections WHERE content = 'A busy reflection';
INSERT INTO hz_test.state SELECT 'doomed', id::TEXT FROM public.reflections WHERE content = 'A reflection its author deletes';
INSERT INTO public.reflection_comments (reflection_id, user_id, content)
SELECT (SELECT value FROM hz_test.state WHERE key = 'busy')::UUID, '00000000-0000-4000-8010-000000000004', 'Busy comment ' || i
FROM generate_series(1, 200) AS i;
INSERT INTO public.reflection_likes (user_id, reflection_id)
SELECT ('00000000-0000-4000-8008-' || lpad(i::TEXT, 12, '0'))::UUID, (SELECT value FROM hz_test.state WHERE key = 'busy')::UUID
FROM generate_series(2, 2) AS i;
DO $$
BEGIN
  PERFORM hz_test.eq('a many-row insert is counted', (
    SELECT likes_count || '/' || comments_count FROM public.reflections WHERE content = 'A busy reflection'
  ), '1/200');
END $$;

SELECT hz_test.login('00000000-0000-4000-8010-000000000005');
SET ROLE authenticated;
DO $$
DECLARE
  busy UUID := (SELECT value FROM hz_test.state WHERE key = 'busy')::UUID;
  comment_scans BIGINT := hz_test.scans('reflection_comments');
  like_scans BIGINT;
  updates BIGINT := hz_test.updates('reflections');
  mine UUID;
BEGIN
  PERFORM public.set_reflection_like(auth.uid(), busy, true);
  PERFORM hz_test.eq('a single like reads none of the 200 comments', hz_test.scans('reflection_comments') - comment_scans, 0::BIGINT);
  PERFORM hz_test.eq('a single like updates its reflection once', hz_test.updates('reflections') - updates, 1::BIGINT);
  like_scans := hz_test.scans('reflection_likes');
  mine := (public.add_reflection_comment(auth.uid(), busy, 'A comment by fifth user five', false)).id;
  PERFORM hz_test.eq('a single comment reads none of the likes', hz_test.scans('reflection_likes') - like_scans, 0::BIGINT);
  PERFORM hz_test.eq('a like and a comment count one each', (
    SELECT likes_count || '/' || comments_count FROM public.reflections WHERE id = busy
  ), '2/201');
  INSERT INTO hz_test.state VALUES ('five_comment', mine::TEXT);
  PERFORM hz_test.eq('liking twice is one like', public.set_reflection_like(auth.uid(), busy, true), true);
  PERFORM public.set_reflection_comment_like(auth.uid(), mine, true);
  PERFORM public.set_reflection_comment_like(auth.uid(), (SELECT id FROM public.reflection_comments WHERE content = 'Busy comment 1'), true);
  PERFORM public.set_reflection_like(auth.uid(), (SELECT value FROM hz_test.state WHERE key = 'doomed')::UUID, true);
  PERFORM public.add_reflection_comment(auth.uid(), (SELECT value FROM hz_test.state WHERE key = 'doomed')::UUID,
    'A comment on a reflection that goes away', false);
  PERFORM hz_test.eq('another account''s comment is not deleted', public.delete_reflection_comment(auth.uid(),
    (SELECT id FROM public.reflection_comments WHERE content = 'Busy comment 2')), false);
  PERFORM hz_test.eq('another account''s reflection is not deleted', public.delete_reflection(auth.uid(), busy), false);
END $$;

SELECT hz_test.login('00000000-0000-4000-8010-000000000006');
DO $$
DECLARE
  busy UUID := (SELECT value FROM hz_test.state WHERE key = 'busy')::UUID;
  five_comment UUID := (SELECT value FROM hz_test.state WHERE key = 'five_comment')::UUID;
  mine UUID;
BEGIN
  PERFORM public.set_reflection_like(auth.uid(), busy, true);
  mine := (public.add_reflection_comment(auth.uid(), busy, 'A comment fifth user six deletes', false)).id;
  PERFORM public.set_reflection_comment_like(auth.uid(), mine, true);
  PERFORM public.set_reflection_comment_like(auth.uid(), five_comment, true);
  PERFORM public.add_reflection_comment(auth.uid(), busy, 'A comment fifth user six keeps', false);
  PERFORM hz_test.eq('likes and comments are counted', (
    SELECT likes_count || '/' || comments_count FROM public.reflections WHERE id = busy
  ), '3/203');
  PERFORM hz_test.eq('an unlike counts down', public.set_reflection_like(auth.uid(), busy, false), false);
  PERFORM hz_test.eq('deleting an own self-liked comment', public.delete_reflection_comment(auth.uid(), mine), true);
  PERFORM hz_test.eq('the unlike and the deletion count down', (
    SELECT likes_count || '/' || comments_count FROM public.reflections WHERE id = busy
  ), '2/202');
  PERFORM hz_test.eq('the deleted comment''s likes went with it', (
    SELECT count(*) FROM public.reflection_comment_likes WHERE comment_id = mine
  ), 0::BIGINT);
  PERFORM hz_test.eq('a comment like counts', (SELECT likes_count FROM public.reflection_comments WHERE id = five_comment), 2);
END $$;

-- 8010-5 records minority and withdraws it, then records it again; each time the counts follow.
SELECT hz_test.login('00000000-0000-4000-8010-000000000005');
DO $$
BEGIN
  PERFORM public.set_profile_privacy(false, false, true);
  PERFORM hz_test.eq('minority leaves 8010-5 out', (
    SELECT likes_count || '/' || comments_count FROM public.reflections WHERE content = 'A busy reflection'
  ), '1/201');
  PERFORM public.set_reflection_comment_like(auth.uid(), (SELECT id FROM public.reflection_comments WHERE content = 'Busy comment 3'), true);
  PERFORM public.set_reflection_comment_like(auth.uid(), (SELECT id FROM public.reflection_comments WHERE content = 'Busy comment 1'), false);
  PERFORM public.set_profile_privacy(false, false, false);
  PERFORM hz_test.eq('withdrawing counts 8010-5 again', (
    SELECT likes_count || '/' || comments_count FROM public.reflections WHERE content = 'A busy reflection'
  ), '2/202');
  PERFORM public.set_profile_privacy(false, false, true);
END $$;

-- 8010-3 deletes their second reflection, with its comments and likes.
SELECT hz_test.login('00000000-0000-4000-8010-000000000003');
DO $$
BEGIN
  PERFORM hz_test.eq('an author deletes their reflection',
    public.delete_reflection(auth.uid(), (SELECT value FROM hz_test.state WHERE key = 'doomed')::UUID), true);
  PERFORM hz_test.eq('its comments and likes went with it', (
    SELECT count(*) FROM public.reflection_comments WHERE content = 'A comment on a reflection that goes away'
  ), 0::BIGINT);
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_test.eq('likes, unlikes, comments, deletions and minority changes keep counts exact',
    hz_test.count_drift(), 'none');
END $$;

-- One statement deleting 150 of 8010-4's comments recounts their reflection once, not once per row.
DO $$
DECLARE
  updates BIGINT := hz_test.updates('reflections');
BEGIN
  DELETE FROM public.reflection_comments
  WHERE user_id = '00000000-0000-4000-8010-000000000004' AND substring(content FROM '[0-9]+$')::INTEGER > 50;
  PERFORM hz_test.eq('150 deleted comments, one recount', hz_test.updates('reflections') - updates, 1::BIGINT);
  PERFORM hz_test.eq('the bulk deletion is counted', (
    SELECT comments_count FROM public.reflections WHERE content = 'A busy reflection'
  ), 51);
END $$;

-- Deleting the accounts of 8010-4 (an adult with 50 comments and their likes) and 8010-5 (a minor
-- with likes, a comment and comment likes) recounts once per cascade, and leaves every count exact.
DO $$
DECLARE
  updates BIGINT := hz_test.updates('reflections');
BEGIN
  DELETE FROM public.profiles WHERE id = '00000000-0000-4000-8010-000000000004';
  PERFORM hz_test.eq('an account with 50 comments recounts its reflection once', hz_test.updates('reflections') - updates, 1::BIGINT);
END $$;
DELETE FROM public.profiles WHERE id = '00000000-0000-4000-8010-000000000005';
DO $$
BEGIN
  PERFORM hz_test.eq('the counts after both deletions', (
    SELECT likes_count || '/' || comments_count FROM public.reflections WHERE content = 'A busy reflection'
  ), '1/1');
  PERFORM hz_test.eq('account deletion keeps every count exact', hz_test.count_drift(), 'none');
END $$;

-- Sixth review, finding 2: join_board says whether joining as a minor left a matched halaqa, decided
-- in its own transaction, so the screen can confirm it without reading halaqas first.
SELECT hz_test.make_user(('00000000-0000-4000-8020-' || lpad(i::TEXT, 12, '0'))::UUID, 'board_minor_' || i, 'Board minor ' || i)
FROM generate_series(1, 2) AS i;
SELECT hz_test.login('00000000-0000-4000-8020-000000000001');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM public.join_matched_halaqa('juz_amma', 'light', 180);
  PERFORM hz_test.eq('joining as a minor reports leaving the matched halaqa',
    public.join_board('Small Star', true, 'juz_amma', 'light', 180, hz_test.today_text(), 1)->>'left_matched', 'true');
END $$;
RESET ROLE;
-- Clients cannot read memberships directly; the owner checks that it really ended.
DO $$
BEGIN
  PERFORM hz_test.eq('and the matched membership has ended', (
    SELECT count(*) FROM public.halaqa_members
    WHERE user_id = '00000000-0000-4000-8020-000000000001' AND kind = 'matched' AND left_at IS NULL
  ), 0::BIGINT);
END $$;
SELECT hz_test.login('00000000-0000-4000-8020-000000000002');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_test.eq('an adult join reports no matched halaqa left',
    public.join_board(NULL, false, 'juz_amma', 'light', 180, hz_test.today_text(), 1)->>'left_matched', 'false');
  PERFORM hz_test.eq('a minor join without a matched halaqa reports none',
    public.join_board('Other Star', true, 'juz_amma', 'light', 180, hz_test.today_text(), 1)->>'left_matched', 'false');
END $$;
RESET ROLE;

SELECT hz_test.login(NULL);
SET client_min_messages = warning;
DROP SCHEMA hz_test CASCADE;
SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'learning_consistency.test.sql: all assertions passed'; END $$;
