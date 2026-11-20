-- Checks 20261120200000_remove_minor_setting.sql against a database that still holds the under-18
-- setting, as production does. run-learning-consistency.sh runs this with -v phase=before after the
-- Halaqa drop, shows that the migration refuses a row written privately, applies it twice, and runs
-- this again with -v phase=after. Synthetic users only, deleted at the end with the Board cohort and
-- avatar files they made, so learning_consistency.test.sql starts from the same state as before. Any
-- failed assertion stops psql.
--
-- 1 is an adult author. 2 wrote, liked and commented as an adult and then stated they are under 18,
-- which hid those rows and left them out of the counts; they never wrote privately. 3 is an adult
-- with a photo. 4 joined the Board as a minor under a nickname, which cleared their photo. 5 to 7
-- fill the Board cohort after the migration.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset pager off

SELECT :'phase' = 'before' AS before_removal \gset

\if :before_removal
CREATE SCHEMA hz_minor;
GRANT USAGE ON SCHEMA hz_minor TO anon, authenticated;

CREATE FUNCTION hz_minor.login(uid UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN '' ELSE jsonb_build_object('sub', uid, 'role', 'authenticated')::TEXT END, false);
$$;
CREATE FUNCTION hz_minor.eq(label TEXT, actual ANYELEMENT, expected ANYELEMENT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'remove_minor_setting %: expected %, got %', label, expected, actual;
  END IF;
END;
$$;
-- Runs a statement that must fail with a message containing `fragment`.
CREATE FUNCTION hz_minor.expect_error(stmt TEXT, fragment TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF position(fragment IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'remove_minor_setting: expected error containing "%" from [%], got "%"', fragment, stmt, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'remove_minor_setting: expected error containing "%" from [%], but it succeeded', fragment, stmt;
END;
$$;
CREATE FUNCTION hz_minor.uid(n INTEGER) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8095-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION hz_minor.today_text() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT to_char((now() AT TIME ZONE 'UTC')::DATE, 'YYYY-MM-DD')
$$;
-- The stored counts on 1's reflection and on 1's comment there, as the caller reads them.
CREATE FUNCTION hz_minor.counts() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT r.likes_count || ' likes, ' || r.comments_count || ' comments, comment liked ' || COALESCE((
    SELECT c.likes_count FROM public.reflection_comments AS c WHERE c.content = 'The author''s own comment'
  )::TEXT, '-')
  FROM public.reflections AS r WHERE r.content = 'A reflection the former minor answered'
$$;
-- The likes and comments on 1's reflection and the likes on 1's comment that the caller can read.
CREATE FUNCTION hz_minor.readable() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM public.reflection_likes AS l JOIN public.reflections AS r ON r.id = l.reflection_id
      WHERE r.content = 'A reflection the former minor answered') || ' likes, '
    || (SELECT count(*) FROM public.reflection_comments AS c JOIN public.reflections AS r ON r.id = c.reflection_id
      WHERE r.content = 'A reflection the former minor answered') || ' comments, comment liked '
    || (SELECT count(*) FROM public.reflection_comment_likes AS cl JOIN public.reflection_comments AS c ON c.id = cl.comment_id
      WHERE c.content = 'The author''s own comment')
$$;
-- The reflections, comments, likes and comment likes by `author` that the caller can read.
CREATE FUNCTION hz_minor.rows_by(author UUID) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM public.reflections WHERE user_id = author) || '/'
    || (SELECT count(*) FROM public.reflection_comments WHERE user_id = author) || '/'
    || (SELECT count(*) FROM public.reflection_likes WHERE user_id = author) || '/'
    || (SELECT count(*) FROM public.reflection_comment_likes WHERE user_id = author)
$$;
-- Stored counts that differ from a count of every row, as text, or 'none'. Called after the
-- migration only, since before it the counts leave out minors.
CREATE FUNCTION hz_minor.count_drift() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(drift, '; ' ORDER BY drift), 'none') FROM (
    SELECT format('reflection %s: %s likes stored, %s counted; %s comments stored, %s counted',
      r.content, r.likes_count, (SELECT count(*) FROM public.reflection_likes AS l WHERE l.reflection_id = r.id),
      r.comments_count, (SELECT count(*) FROM public.reflection_comments AS c WHERE c.reflection_id = r.id)) AS drift
    FROM public.reflections AS r
    WHERE (r.likes_count, r.comments_count) IS DISTINCT FROM (
      (SELECT count(*) FROM public.reflection_likes AS l WHERE l.reflection_id = r.id)::INTEGER,
      (SELECT count(*) FROM public.reflection_comments AS c WHERE c.reflection_id = r.id)::INTEGER)
    UNION ALL
    SELECT format('comment %s: %s likes stored, %s counted', c.content, c.likes_count,
      (SELECT count(*) FROM public.reflection_comment_likes AS cl WHERE cl.comment_id = c.id))
    FROM public.reflection_comments AS c
    WHERE c.likes_count IS DISTINCT FROM (SELECT count(*) FROM public.reflection_comment_likes AS cl WHERE cl.comment_id = c.id)::INTEGER
  ) AS d
$$;
CREATE TABLE hz_minor.state (key TEXT PRIMARY KEY, value TEXT);
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hz_minor TO anon, authenticated;
GRANT SELECT, INSERT ON hz_minor.state TO authenticated;

INSERT INTO auth.users (id, email) SELECT hz_minor.uid(i), 'remove' || i || '@example.invalid' FROM generate_series(1, 7) AS i;
INSERT INTO public.profiles (id, username, display_name, avatar_url)
SELECT hz_minor.uid(i), 'remove_user_' || i, 'Remove ' || i,
  CASE WHEN i IN (3, 4) THEN 'https://example.invalid/remove' || i || '.png' END
FROM generate_series(1, 7) AS i;

-- Everything is written through the RPCs the released apps call, with their under-18 values.
SET ROLE authenticated;
DO $$
DECLARE
  target UUID;
  target_comment UUID;
BEGIN
  PERFORM hz_minor.login(hz_minor.uid(1));
  target := (public.create_reflection(auth.uid(), 4, 1, 1, 4, 4, 'A reflection the former minor answered', false)).id;
  target_comment := (public.add_reflection_comment(auth.uid(), target, 'The author''s own comment', false)).id;
  INSERT INTO hz_minor.state VALUES ('target', target::TEXT), ('target_comment', target_comment::TEXT);

  PERFORM hz_minor.login(hz_minor.uid(3));
  PERFORM public.set_reflection_like(auth.uid(), target, true);

  PERFORM hz_minor.login(hz_minor.uid(2));
  PERFORM public.create_reflection(auth.uid(), 4, 2, 2, 4, 4, 'Written by the former minor as an adult', false);
  PERFORM public.set_reflection_like(auth.uid(), target, true);
  PERFORM public.add_reflection_comment(auth.uid(), target, 'Said by the former minor as an adult', false);
  PERFORM public.set_reflection_comment_like(auth.uid(), target_comment, true);
  PERFORM hz_minor.eq('before: an adult''s activity is counted', hz_minor.counts(), '2 likes, 2 comments, comment liked 1');
  -- Shared as an adult, then stated minority. The old app showed both switches off from then on, but
  -- the stored choices stayed on.
  PERFORM public.set_profile_privacy(true, true, false, false);
  PERFORM public.set_profile_privacy(true, true, true, false);
  PERFORM hz_minor.eq('before: stating minority leaves it out of the counts', hz_minor.counts(),
    '1 likes, 1 comments, comment liked 0');

  PERFORM hz_minor.login(hz_minor.uid(4));
  PERFORM public.join_board('Young Reader', true, false, 'juz_amma', 'light', 180, hz_minor.today_text(), 2);
  PERFORM hz_minor.expect_error(format($q$INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('avatars', %L, %L)$q$, auth.uid() || '/before.png', auth.uid()), 'row-level security');
END $$;
RESET ROLE;

DO $$
BEGIN
  PERFORM hz_minor.eq('before: 2 and 4 are recorded as minors', (
    SELECT string_agg(user_id::TEXT, ', ' ORDER BY user_id) FROM public.profile_privacy WHERE is_minor
      AND user_id::TEXT LIKE '00000000-0000-4000-8095-%'
  ), hz_minor.uid(2) || ', ' || hz_minor.uid(4));
  -- The migration refuses to run over private rows, so the state it is tested on has none.
  PERFORM hz_minor.eq('before: nothing was written privately', (
    SELECT count(*) FROM public.reflections WHERE is_private
  ) + (SELECT count(*) FROM public.reflection_comments WHERE is_private)
    + (SELECT count(*) FROM public.reflection_likes WHERE is_private)
    + (SELECT count(*) FROM public.reflection_comment_likes WHERE is_private), 0::BIGINT);
  PERFORM hz_minor.eq('before: the Board minor is on the Board under a nickname', (
    SELECT board_joined AND board_nickname = 'Young Reader' FROM public.profile_privacy WHERE user_id = hz_minor.uid(4)
  ), true);
  PERFORM hz_minor.eq('before: joining as a minor cleared the photo', (
    SELECT avatar_url FROM public.profiles WHERE id = hz_minor.uid(4)
  ), NULL::TEXT);
  PERFORM hz_minor.eq('before: the adult has a photo', (
    SELECT avatar_url FROM public.profiles WHERE id = hz_minor.uid(3)
  ), 'https://example.invalid/remove3.png');
  INSERT INTO hz_minor.state
    SELECT 'cohort', cohort_id::TEXT FROM public.board_members WHERE user_id = hz_minor.uid(4) AND left_at IS NULL;
END $$;

-- Before the migration a minor's profile and every row they wrote are hidden from everyone else.
SELECT hz_minor.login(NULL);
SET ROLE anon;
DO $$
BEGIN
  PERFORM hz_minor.eq('before: anon cannot read the former minor''s profile', (
    SELECT count(*) FROM public.profiles WHERE id IN (hz_minor.uid(2), hz_minor.uid(4))
  ), 0::BIGINT);
  PERFORM hz_minor.eq('before: anon reads none of their rows', hz_minor.rows_by(hz_minor.uid(2)), '0/0/0/0');
  PERFORM hz_minor.eq('before: anon gets no summary for them', public.get_profile_summary(hz_minor.uid(2)), NULL::JSONB);
END $$;
RESET ROLE;

\else

-- ─── 1. The setting is gone ─────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hz_minor.eq('no is_minor or is_private column', (
    SELECT string_agg(table_name || '.' || column_name, ', ') FROM information_schema.columns
    WHERE column_name IN ('is_minor', 'is_private')
  ), NULL::TEXT);
  PERFORM hz_minor.eq('no rls schema', to_regnamespace('rls'), NULL::regnamespace);
  PERFORM hz_minor.eq('no removed helper', (
    SELECT string_agg(p.proname, ', ') FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname IN ('is_minor', 'activity_public', 'lock_minor_change',
      'apply_minor_privacy', 'profiles_minor_photo', 'recount_minor_activity', 'visible_step',
      'lock_activity_authors', 'check_promised_visibility')
  ), NULL::TEXT);
  PERFORM hz_minor.eq('no minority trigger', (
    SELECT string_agg(tgname, ', ') FROM pg_trigger WHERE NOT tgisinternal AND tgname ILIKE '%minor%'
  ), NULL::TEXT);
  PERFORM hz_minor.eq('no Board nickname rule for minors', (
    SELECT count(*) FROM pg_constraint WHERE conname = 'profile_privacy_minor_nickname'
  ), 0::BIGINT);
  PERFORM hz_minor.eq('profiles are publicly readable', (
    SELECT policyname || ': ' || qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT'
  ), 'Profiles are publicly readable: true');
  -- The current app's signatures and the released apps' wrappers are for signed-in users only.
  PERFORM hz_minor.eq('signed-in users, not anon, call both signatures', (
    SELECT string_agg(f, ', ') FROM unnest(ARRAY[
      'public.create_reflection(uuid, integer, integer, integer, integer, integer, text)',
      'public.create_reflection(uuid, integer, integer, integer, integer, integer, text, boolean)',
      'public.add_reflection_comment(uuid, uuid, text)',
      'public.add_reflection_comment(uuid, uuid, text, boolean)',
      'public.set_profile_privacy(boolean, boolean)',
      'public.set_profile_privacy(boolean, boolean, boolean, boolean)',
      'public.join_board(text, text, text, integer, text, integer)',
      'public.join_board(text, boolean, boolean, text, text, integer, text, integer)'
    ]) AS f
    WHERE NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
  ), NULL::TEXT);
END $$;

-- ─── 2. What the former minor wrote as an adult is public and counted ──────────
-- Nothing has written since the migration, so these counts are the ones it recounted.
DO $$
BEGIN
  PERFORM hz_minor.eq('the former minor''s rows are counted', hz_minor.counts(), '2 likes, 2 comments, comment liked 1');
  PERFORM hz_minor.eq('every count matches a count of every row', hz_minor.count_drift(), 'none');
  PERFORM hz_minor.eq('the adult kept their photo', (
    SELECT avatar_url FROM public.profiles WHERE id = hz_minor.uid(3)
  ), 'https://example.invalid/remove3.png');
END $$;

SELECT hz_minor.login(NULL);
SET ROLE anon;
DO $$
BEGIN
  PERFORM hz_minor.eq('anon reads both former minors'' profiles', (
    SELECT string_agg(username, ', ' ORDER BY username) FROM public.profiles WHERE id IN (hz_minor.uid(2), hz_minor.uid(4))
  ), 'remove_user_2, remove_user_4');
  PERFORM hz_minor.eq('anon reads every row the former minor wrote', hz_minor.rows_by(hz_minor.uid(2)), '1/1/1/1');
  PERFORM hz_minor.eq('anon reads their reflection', (
    SELECT content FROM public.reflections WHERE user_id = hz_minor.uid(2)
  ), 'Written by the former minor as an adult');
  PERFORM hz_minor.eq('anon reads as many rows as the counts say', hz_minor.readable(), '2 likes, 2 comments, comment liked 1');
  PERFORM hz_minor.eq('anon gets their summary, with nothing they did not share', public.get_profile_summary(hz_minor.uid(2)),
    '{"streak": null, "juz_completed": null}'::JSONB);
END $$;
RESET ROLE;

-- ─── 3. Released apps' signatures, and the current app's ─────────────────────
SET ROLE authenticated;
DO $$
DECLARE
  target UUID := (SELECT value FROM hz_minor.state WHERE key = 'target')::UUID;
  privacy JSONB;
BEGIN
  PERFORM hz_minor.login(hz_minor.uid(1));
  -- The sharing choices the former minor could not see were turned off, so nothing is shared.
  PERFORM hz_minor.eq('a signed-in user gets the former minor''s summary', public.get_profile_summary(hz_minor.uid(2)),
    '{"streak": null, "juz_completed": null}'::JSONB);

  PERFORM hz_minor.login(hz_minor.uid(2));
  PERFORM hz_minor.eq('the former minor''s hidden sharing choices were turned off',
    (public.get_profile_privacy()->>'show_streak') || '/' || (public.get_profile_privacy()->>'show_juz_completions'),
    'false/false');
  PERFORM hz_minor.eq('get_profile_privacy still reports is_minor, as false', public.get_profile_privacy()->'is_minor',
    'false'::JSONB);
  -- A released app whose screen still promised privacy is refused, so nothing it promised is published.
  PERFORM hz_minor.expect_error(format($q$SELECT public.create_reflection(%L, 4, 3, 3, 4, 4,
    'Promised private by an old app', true)$q$, auth.uid()), 'privacy_changed');
  PERFORM hz_minor.expect_error(format($q$SELECT public.add_reflection_comment(%L, %L,
    'Promised private by an old app', true)$q$, auth.uid(), target), 'privacy_changed');
  PERFORM hz_minor.expect_error(format($q$SELECT public.create_reflection(%L, 4, 3, 3, 4, 4,
    'No promise from an old app', NULL)$q$, auth.uid()), 'invalid_visibility');
  PERFORM hz_minor.expect_error(format($q$SELECT public.add_reflection_comment(%L, %L,
    'No promise from an old app', NULL)$q$, auth.uid(), target), 'invalid_visibility');
  PERFORM hz_minor.eq('a refused write stores nothing', (
    SELECT count(*) FROM public.reflections WHERE content IN ('Promised private by an old app', 'No promise from an old app')
  ) + (
    SELECT count(*) FROM public.reflection_comments WHERE content IN ('Promised private by an old app', 'No promise from an old app')
  ), 0::BIGINT);
  -- Shown as public, a released app's write goes through.
  PERFORM hz_minor.eq('an old app posts a public reflection',
    (public.create_reflection(auth.uid(), 4, 3, 3, 4, 4, 'Posted publicly by an old app', false)).content,
    'Posted publicly by an old app');
  PERFORM public.add_reflection_comment(auth.uid(), target, 'Commented publicly by an old app', false);
  PERFORM hz_minor.eq('an old app''s comment counts one', hz_minor.counts(), '2 likes, 3 comments, comment liked 1');
  PERFORM hz_minor.eq('the current app posts a reflection',
    (public.create_reflection(auth.uid(), 4, 4, 4, 4, 4, 'Posted by the current app')).content, 'Posted by the current app');
  PERFORM public.add_reflection_comment(auth.uid(), target, 'Commented by the current app');
  PERFORM hz_minor.eq('the current app''s comment counts one', hz_minor.counts(), '2 likes, 4 comments, comment liked 1');
  PERFORM public.set_reflection_like(auth.uid(), target, false);
  PERFORM hz_minor.eq('an unlike counts down by one', hz_minor.counts(), '1 likes, 4 comments, comment liked 1');
  PERFORM public.set_reflection_like(auth.uid(), target, true);
  PERFORM hz_minor.eq('a like counts up by one', hz_minor.counts(), '2 likes, 4 comments, comment liked 1');

  -- A released app's privacy save: the under-18 values are ignored, even null or stale ones.
  privacy := public.set_profile_privacy(true, false, true, false);
  PERFORM hz_minor.eq('an old app saves the sharing choices', privacy->'show_streak', 'true'::JSONB);
  PERFORM hz_minor.eq('and is told it is not under 18', privacy->'is_minor', 'false'::JSONB);
  PERFORM hz_minor.eq('and that it did not leave the Board', privacy->'left_board', 'false'::JSONB);
  PERFORM hz_minor.eq('null under-18 values are ignored too',
    public.set_profile_privacy(false, false, NULL, NULL)->'show_streak', 'false'::JSONB);
  PERFORM hz_minor.eq('the current app''s save', public.set_profile_privacy(false, true),
    '{"board_joined": false, "board_nickname": null, "show_streak": false, "show_juz_completions": true, "is_minor": false}'::JSONB);
  PERFORM hz_minor.expect_error('SELECT public.set_profile_privacy(NULL, true)', 'invalid_privacy');
END $$;
RESET ROLE;

-- ─── 4. Photos and the Board ────────────────────────────────────────────────
-- 4 may have a photo again. 3, 4 and 5 to 7 make a Board cohort of five, joined through both
-- signatures. 4 kept the nickname they joined with as a minor, so the Board hides their photo until
-- they join again without one, which the nickname rule used to refuse.
SET ROLE authenticated;
DO $$
DECLARE
  board JSONB;
  privacy JSONB;
  me JSONB;
BEGIN
  PERFORM hz_minor.login(hz_minor.uid(4));
  PERFORM hz_minor.eq('a former minor reads is_minor as false', public.get_profile_privacy()->'is_minor', 'false'::JSONB);
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', auth.uid() || '/after.png', auth.uid());
  UPDATE public.profiles SET avatar_url = 'https://example.invalid/remove4-after.png' WHERE id = auth.uid();
  PERFORM hz_minor.eq('a former minor keeps the photo they set', (
    SELECT avatar_url FROM public.profiles WHERE id = auth.uid()
  ), 'https://example.invalid/remove4-after.png');

  PERFORM hz_minor.login(hz_minor.uid(3));
  PERFORM public.join_board(NULL, 'juz_amma', 'light', 180, hz_minor.today_text(), 2);
  -- A released app saving privacy with minority stated used to take a Board member without a
  -- nickname off the Board.
  privacy := public.set_profile_privacy(false, false, true, false);
  PERFORM hz_minor.eq('an old app''s save keeps a member without a nickname on the Board',
    (privacy->>'board_joined') || '/' || (privacy->>'left_board'), 'true/false');

  -- Under 18 without a nickname used to be refused with nickname_required.
  PERFORM hz_minor.login(hz_minor.uid(5));
  PERFORM public.join_board(NULL, true, false, 'juz_amma', 'light', 180, hz_minor.today_text(), 2);
  PERFORM hz_minor.eq('an old app joins with its under-18 values ignored',
    (public.get_profile_privacy()->>'board_joined') || '/' || (public.get_profile_privacy()->>'is_minor'), 'true/false');
  PERFORM hz_minor.login(hz_minor.uid(6));
  PERFORM public.join_board(NULL, NULL, NULL, 'juz_amma', 'light', 180, hz_minor.today_text(), 2);
  PERFORM hz_minor.login(hz_minor.uid(7));
  board := public.join_board(NULL, 'juz_amma', 'light', 180, hz_minor.today_text(), 2);
  PERFORM hz_minor.eq('five members share the former minor''s cohort', (board->>'status') || '/' || (board->>'member_count'),
    'ready/5');
  SELECT s INTO me FROM jsonb_array_elements(board->'standings') AS s WHERE s->>'name' = 'Young Reader';
  PERFORM hz_minor.eq('a nickname hides the photo', me->'avatar_url', 'null'::JSONB);
  PERFORM hz_minor.eq('and shows as a nickname', me->'uses_nickname', 'true'::JSONB);
  SELECT s INTO me FROM jsonb_array_elements(board->'standings') AS s WHERE s->>'name' = 'Remove 3';
  PERFORM hz_minor.eq('a display name shows the photo', me->>'avatar_url', 'https://example.invalid/remove3.png');

  PERFORM hz_minor.login(hz_minor.uid(4));
  board := public.join_board(NULL, 'juz_amma', 'light', 180, hz_minor.today_text(), 2);
  SELECT s INTO me FROM jsonb_array_elements(board->'standings') AS s WHERE (s->>'is_me')::BOOLEAN;
  PERFORM hz_minor.eq('without a nickname the former minor shows by name with their photo',
    (me->>'name') || ' ' || (me->>'avatar_url'), 'Remove 4 https://example.invalid/remove4-after.png');
  PERFORM hz_minor.eq('in the same cohort', board->>'member_count', '5');

  PERFORM hz_minor.login(hz_minor.uid(1));
  PERFORM hz_minor.eq('others list the former minor''s photo', (
    SELECT count(*) FROM storage.objects WHERE name = hz_minor.uid(4) || '/after.png'
  ), 1::BIGINT);
END $$;
RESET ROLE;

DO $$
BEGIN
  PERFORM hz_minor.eq('every count still matches a count of every row', hz_minor.count_drift(), 'none');
END $$;

-- Board cohorts outlive their members, so the one made here goes too.
DELETE FROM auth.users WHERE id::TEXT LIKE '00000000-0000-4000-8095-%';
DELETE FROM public.board_cohorts WHERE id = (SELECT value FROM hz_minor.state WHERE key = 'cohort')::UUID;
DELETE FROM storage.objects WHERE name LIKE '00000000-0000-4000-8095-%';
SET client_min_messages = warning;
DROP SCHEMA hz_minor CASCADE;
RESET client_min_messages;
\endif
