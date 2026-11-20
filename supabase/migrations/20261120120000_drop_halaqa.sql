-- Drops Halaqa (study groups, spec 5.7.1) from the server for good. The client lost Halaqa on
-- 2026-11-17 (release 1.0.3), and its code is archived at the tag archive/halaqa-2026-11-17. On
-- 2026-11-20 the owner decided to drop its tables. Every Halaqa table, function, policy and index
-- goes, with the rows in those tables. So does review_partners: it shipped in the Halaqa section of
-- 20261113120000_learning_consistency.sql for SOC-05, and no function or client ever used it. Every
-- other table keeps its rows, and the weekly Board, sync, study cards and reflections behave as before.
--
-- Four functions outside Halaqa read its tables. They are redefined first without that branch:
-- - private.lock_minor_change locks the profiles row only. The per-user halaqa lock existed so a
--   matched join could not slip past a minority write, and matched joins are gone.
-- - private.apply_minor_privacy only clears the photo. There are no matched halaqas left to leave.
-- - public.get_profile_summary hides a minor's profile from everyone but its owner, and shows a
--   streak or juz completions only to the owner or when the owner made them public.
-- - public.join_board no longer adds left_matched to its result. The current app does not read it,
--   and the 1.0.2 app treats a missing value as false.
-- public.set_profile_privacy is redefined too, with the same code, because a comment in its body still
-- said that recording minority leaves matched halaqas.
--
-- Nothing is dropped with CASCADE, so an object this file does not know about stops the migration
-- instead of disappearing with it. The check at the end refuses to commit while any table, function
-- or policy in public, private or rls still names Halaqa. Run it in one transaction (psql
-- --single-transaction), so a failure leaves the database as it was. Running it again changes nothing.

-- ─── 1. Functions outside Halaqa, without the Halaqa branch ─────────────────

-- Every write that can change is_minor (set_profile_privacy, join_board) calls this before it writes,
-- whichever way it changes, and holds the profiles row until it commits. A photo update in progress
-- holds it, so the minority write waits for that update to commit and then clears its photo. A photo
-- update that comes later waits on the row, and profiles_minor_photo then reads the committed
-- minority. A reflection write by this user takes the row FOR SHARE, so it either commits first and
-- is recounted (private.recount_minor_activity), or waits and reads the committed minority.
CREATE OR REPLACE FUNCTION private.lock_minor_change(member UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = member FOR NO KEY UPDATE;
END;
$$;

-- Runs for every write that sets is_minor (ETH-07). The photo is cleared without checking it first,
-- so the update waits on a photo update still in progress and clears the photo it commits.
CREATE OR REPLACE FUNCTION private.apply_minor_privacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles SET avatar_url = NULL WHERE id = NEW.user_id;
  RETURN NULL;
END;
$$;

-- p_expected_minor is the minority the form loaded. A form loaded before another device recorded
-- minority would otherwise clear it and make the profile public (ETH-07), so a stored value that
-- differs refuses the write with privacy_changed and the app reloads.
CREATE OR REPLACE FUNCTION public.set_profile_privacy(
  p_show_streak BOOLEAN,
  p_show_juz_completions BOOLEAN,
  p_is_minor BOOLEAN,
  p_expected_minor BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  current_row public.profile_privacy;
  -- Whether recording minority took a Board member without a nickname off the Board, for the screen
  -- to say so.
  leaves_board BOOLEAN;
BEGIN
  IF p_show_streak IS NULL OR p_show_juz_completions IS NULL OR p_is_minor IS NULL OR p_expected_minor IS NULL THEN
    RAISE EXCEPTION 'invalid_privacy';
  END IF;
  -- Recording minority clears the photo (private.apply_minor_privacy), and recording or withdrawing
  -- it recounts the person's likes and comments. Every minority write holds this lock, so the stored
  -- value compared below holds until this write commits.
  PERFORM private.lock_minor_change(uid);
  -- The row lock comes last, as in join_board. It waits for a board placement in progress, so the
  -- Board choice read here is the committed one.
  SELECT * INTO current_row FROM public.profile_privacy WHERE user_id = uid FOR UPDATE;
  IF COALESCE(current_row.is_minor, false) IS DISTINCT FROM p_expected_minor THEN
    RAISE EXCEPTION 'privacy_changed';
  END IF;
  -- Under 18s appear on the Board only under a nickname (BRD-07). Recording minority must not fail on
  -- that rule, so a member without one leaves the Board in this transaction, as leave_board does, and
  -- can join again with a nickname.
  leaves_board := p_is_minor AND COALESCE(current_row.board_joined, false) AND current_row.board_nickname IS NULL;
  INSERT INTO public.profile_privacy (user_id, show_streak, show_juz_completions, is_minor, updated_at)
  VALUES (uid, p_show_streak, p_show_juz_completions, p_is_minor, now())
  ON CONFLICT (user_id) DO UPDATE SET
    show_streak = EXCLUDED.show_streak,
    show_juz_completions = EXCLUDED.show_juz_completions,
    is_minor = EXCLUDED.is_minor,
    board_joined = public.profile_privacy.board_joined AND NOT leaves_board,
    updated_at = EXCLUDED.updated_at;
  IF leaves_board THEN
    UPDATE public.board_members SET left_at = now() WHERE user_id = uid AND left_at IS NULL;
  END IF;
  RETURN public.get_profile_privacy() || jsonb_build_object('left_board', leaves_board);
END;
$$;

-- What a viewer may see of another person's consistency: the owner always, and anyone when the
-- person turned it on for their profile, unless they stated they are a minor (ETH-07). Null fields
-- are hidden. A minor's profile is hidden as a whole from anyone but the owner, as the profiles
-- policy hides it.
CREATE OR REPLACE FUNCTION public.get_profile_summary(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  viewer UUID := auth.uid();
  privacy public.profile_privacy;
  is_owner BOOLEAN := viewer IS NOT NULL AND viewer = p_user_id;
  see_streak BOOLEAN;
  see_juz BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO privacy FROM public.profile_privacy WHERE user_id = p_user_id;
  IF COALESCE(privacy.is_minor, false) AND NOT is_owner THEN
    RETURN NULL;
  END IF;
  see_streak := is_owner
    OR (COALESCE(privacy.show_streak, false) AND NOT COALESCE(privacy.is_minor, false));
  see_juz := is_owner
    OR (COALESCE(privacy.show_juz_completions, false) AND NOT COALESCE(privacy.is_minor, false));
  RETURN jsonb_build_object(
    'streak', CASE WHEN see_streak THEN private.habit_streak(p_user_id, private.member_today(p_user_id)) END,
    'juz_completed', CASE WHEN see_juz THEN (
      SELECT COALESCE(jsonb_agg(substring(a.achievement_id FROM 5 FOR 2)::INTEGER ORDER BY a.achievement_id), '[]'::JSONB)
      FROM public.achievement_unlocks AS a
      WHERE a.user_id = p_user_id AND a.achievement_id ~ '^juz_[0-9]{2}_completed$'
    ) END
  );
END;
$$;

-- BRD-04: opt-in from the Board tab, optionally under a nickname. A minor must use one (BRD-07).
-- p_expected_minor is the minority the form loaded, compared as in set_profile_privacy.
CREATE OR REPLACE FUNCTION public.join_board(
  p_nickname TEXT,
  p_is_minor BOOLEAN,
  p_expected_minor BOOLEAN,
  p_level_band TEXT,
  p_pace_band TEXT,
  p_utc_offset_minutes INTEGER,
  p_today TEXT,
  p_week_start INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  today DATE := private.checked_local_date(p_today);
  clean_nickname TEXT := NULLIF(btrim(COALESCE(p_nickname, '')), '');
  minor BOOLEAN := p_is_minor;
BEGIN
  PERFORM private.check_bands(p_level_band, p_pace_band, p_utc_offset_minutes);
  PERFORM private.check_week_start(p_week_start);
  IF p_is_minor IS NULL OR p_expected_minor IS NULL THEN
    RAISE EXCEPTION 'invalid_privacy';
  END IF;
  IF clean_nickname IS NOT NULL AND (char_length(clean_nickname) NOT BETWEEN 3 AND 20 OR clean_nickname ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'invalid_nickname';
  END IF;
  IF minor AND clean_nickname IS NULL THEN
    RAISE EXCEPTION 'nickname_required';
  END IF;
  -- As in set_profile_privacy, since this write sets is_minor either way. The profiles row lock also
  -- comes before the profile_privacy row that this upsert and the placement in get_board hold.
  PERFORM private.lock_minor_change(uid);
  -- Every minority write holds that lock, so the stored value read here holds until this commits.
  IF private.is_minor(uid) IS DISTINCT FROM p_expected_minor THEN
    RAISE EXCEPTION 'privacy_changed';
  END IF;
  INSERT INTO public.profile_privacy (user_id, board_joined, board_nickname, is_minor, board_week_start,
    board_level_band, board_pace_band, board_utc_offset_minutes, board_enrolled_week, updated_at)
  VALUES (uid, true, clean_nickname, minor, p_week_start, p_level_band, p_pace_band, p_utc_offset_minutes,
    private.board_week(today, p_week_start), now())
  ON CONFLICT (user_id) DO UPDATE SET
    board_joined = true,
    board_nickname = EXCLUDED.board_nickname,
    is_minor = EXCLUDED.is_minor,
    board_week_start = EXCLUDED.board_week_start,
    board_level_band = EXCLUDED.board_level_band,
    board_pace_band = EXCLUDED.board_pace_band,
    board_utc_offset_minutes = EXCLUDED.board_utc_offset_minutes,
    board_enrolled_week = GREATEST(public.profile_privacy.board_enrolled_week, EXCLUDED.board_enrolled_week),
    board_waiting = false,
    updated_at = EXCLUDED.updated_at;
  RETURN public.get_board(p_level_band, p_pace_band, p_utc_offset_minutes, p_today, p_week_start);
END;
$$;

-- ─── 2. The policy on achievement_unlocks that reads Halaqa membership ──────
DROP POLICY IF EXISTS "Halaqa members can read shared juz completions" ON public.achievement_unlocks;

-- ─── 3. Halaqa RPCs ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_my_halaqas();
DROP FUNCTION IF EXISTS public.create_invite_halaqa(TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.join_halaqa_by_code(TEXT);
DROP FUNCTION IF EXISTS public.leave_halaqa(UUID);
DROP FUNCTION IF EXISTS public.join_matched_halaqa(TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.set_halaqa_sharing(UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.set_halaqa_member_role(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_halaqa_goal(UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_halaqa_detail(UUID, TEXT);
DROP FUNCTION IF EXISTS public.send_halaqa_encouragement(UUID, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_received_encouragements(TIMESTAMPTZ, UUID);
DROP FUNCTION IF EXISTS public.get_received_encouragements();
DROP FUNCTION IF EXISTS public.get_halaqa_teacher_view(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.set_halaqa_sabaq_assignment(UUID, UUID, INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.clear_halaqa_sabaq_assignment(UUID, UUID);
DROP FUNCTION IF EXISTS public.get_my_sabaq_assignment();
DROP FUNCTION IF EXISTS public.halaqa_shares_with_me(UUID, TEXT);

-- ─── 4. Halaqa helpers ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS private.halaqa_active_count(UUID);
DROP FUNCTION IF EXISTS private.require_halaqa_member(UUID, UUID);
DROP FUNCTION IF EXISTS private.check_halaqa_limit(UUID);
DROP FUNCTION IF EXISTS private.lock_halaqa_user(UUID);
DROP FUNCTION IF EXISTS private.halaqa_leave(UUID, UUID);
DROP FUNCTION IF EXISTS private.encouraged_today(UUID, UUID, DATE, UUID);
DROP FUNCTION IF EXISTS private.halaqa_summary(UUID, UUID);
DROP FUNCTION IF EXISTS private.new_invite_code();
DROP FUNCTION IF EXISTS private.halaqa_goal(UUID, DATE);
DROP FUNCTION IF EXISTS private.live_sabaq_assignments(UUID);
-- Its argument is the table's row type, which a second run no longer has.
DO $$
BEGIN
  IF to_regtype('public.halaqa_sabaq_assignments') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS private.sabaq_assignment_json(public.halaqa_sabaq_assignments);
  END IF;
END $$;

-- ─── 5. Tables, with their indexes, constraints and policies ────────────────
-- Children before halaqa_groups, which the other three reference.
DROP TABLE IF EXISTS public.halaqa_sabaq_assignments;
DROP TABLE IF EXISTS public.halaqa_encouragements;
DROP TABLE IF EXISTS public.halaqa_members;
DROP TABLE IF EXISTS public.halaqa_groups;
DROP TABLE IF EXISTS public.review_partners;

-- ─── 6. Nothing of Halaqa is left ───────────────────────────────────────────
DO $$
DECLARE
  leftovers TEXT;
BEGIN
  SELECT string_agg(item, ', ' ORDER BY item) INTO leftovers FROM (
    SELECT format('table %I.%I', n.nspname, c.relname) AS item
    FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'private', 'rls')
      AND (c.relname ILIKE '%halaqa%' OR c.relname ILIKE '%review_partner%')
    UNION ALL
    SELECT format('function %I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private', 'rls')
      AND (p.proname ILIKE '%halaqa%' OR p.prosrc ILIKE '%halaqa%' OR p.prosrc ILIKE '%review_partner%'
        OR p.proname IN ('get_received_encouragements', 'get_my_sabaq_assignment'))
    UNION ALL
    SELECT format('policy %I on %I.%I', policyname, schemaname, tablename)
    FROM pg_policies
    WHERE policyname ILIKE '%halaqa%' OR qual ILIKE '%halaqa%' OR with_check ILIKE '%halaqa%'
  ) AS found;
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'Halaqa objects remain: %', leftovers;
  END IF;
END $$;
