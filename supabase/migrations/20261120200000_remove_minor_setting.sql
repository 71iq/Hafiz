-- Removes the under-18 setting (ETH-07, BRD-07). On 2026-11-20 the owner decided that people under 18
-- use Hafiz as everyone else does, so they can learn from more experienced people: their reflections,
-- comments and likes are public, they may have a profile photo, others can open their profile, and
-- the Board treats them like any member. The setting is gone with its stored value, so nobody is
-- marked as under 18 any more.
--
-- What changes:
-- - profile_privacy.is_minor and its Board nickname rule are dropped, with every trigger and helper
--   that read them. Profiles, avatars, summaries and Board rows follow the rules every adult had.
-- - The is_private flag on reflections, comments and their likes is dropped. Only a person who said
--   they were under 18 ever wrote a private row, and the app had promised them those rows stay
--   private. Production held none on 2026-11-20, and this migration refuses to run if any exist, so
--   nothing promised private is published.
-- -- - The app showed the two profile sharing switches off for someone under 18, but kept what they had
--   stored before. Those stored choices are turned off, so dropping the setting publishes no streak or
--   juz completions that the person could not see.
-- - Like and comment counts count every row again. Counts that differ are recounted at the end.
-- - The rls schema held only the minor and private-row helpers, so it is dropped once empty.
--
-- Released apps (1.0.8 and earlier) still call the old signatures of create_reflection,
-- add_reflection_comment, set_profile_privacy and join_board, and require is_minor in
-- get_profile_privacy. The old signatures stay as wrappers, and get_profile_privacy reports
-- is_minor = false:
-- - A reflection or comment that the old app promised was private (p_private = true) is refused with
--   privacy_changed. The old app then reloads the privacy, which no longer says under 18, keeps the
--   draft, and the person can publish it knowingly.
-- - The under-18 values that set_profile_privacy and join_board receive are ignored. The response
--   shows is_minor = false, so the old app's switch turns off.
-- The current app calls the new signatures, which take no under-18 or private value.
--
-- Nothing is dropped with CASCADE, so an object this file does not know about stops the migration
-- instead of disappearing with it. The check at the end refuses to commit while anything still reads
-- the setting. Run it in one transaction (psql --single-transaction), so a failure leaves the database
-- as it was. Running it again changes nothing.

-- ─── 1. Hold the affected tables and refuse to publish private rows ───────────
-- Every reflection write, privacy write and Board join waits until this commits, so the check and the
-- recount below see every row.
LOCK TABLE public.profile_privacy, public.reflections, public.reflection_likes, public.reflection_comments,
  public.reflection_comment_likes IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  private_rows BIGINT := 0;
  rows_in_table BIGINT;
  activity_table TEXT;
BEGIN
  FOREACH activity_table IN ARRAY ARRAY['reflections', 'reflection_likes', 'reflection_comments', 'reflection_comment_likes']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = activity_table AND column_name = 'is_private'
    ) THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE is_private', activity_table) INTO rows_in_table;
      private_rows := private_rows + rows_in_table;
    END IF;
  END LOOP;
  IF private_rows > 0 THEN
    RAISE EXCEPTION '% reflections, comments or likes were written privately by someone under 18; dropping is_private would publish them', private_rows;
  END IF;
END $$;

-- ─── 2. Sharing choices an under-18 person could not see ─────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profile_privacy' AND column_name = 'is_minor'
  ) THEN
    EXECUTE 'UPDATE public.profile_privacy SET show_streak = false, show_juz_completions = false, updated_at = now()
      WHERE is_minor AND (show_streak OR show_juz_completions)';
  END IF;
END $$;

-- ─── 3. Triggers that read the setting ──────────────────────────────────────
DROP TRIGGER IF EXISTS profile_privacy_minor ON public.profile_privacy;
DROP TRIGGER IF EXISTS profile_privacy_activity_counts ON public.profile_privacy;
DROP TRIGGER IF EXISTS profiles_minor_photo ON public.profiles;

-- ─── 4. Read policies as they were before the setting ───────────────────────
DROP POLICY IF EXISTS "Profiles are readable unless the owner is a minor" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are publicly readable" ON public.profiles;
CREATE POLICY "Profiles are publicly readable"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Active reflections are readable unless private" ON public.reflections;
DROP POLICY IF EXISTS "Active reflections are publicly readable" ON public.reflections;
CREATE POLICY "Active reflections are publicly readable"
  ON public.reflections FOR SELECT
  USING (status = 'active');

-- A like or comment follows its parent under the parent's own policy, so one on a hidden reflection
-- or comment is hidden with it.
DROP POLICY IF EXISTS "Likes follow their reflection unless private" ON public.reflection_likes;
DROP POLICY IF EXISTS "Likes follow reflection visibility" ON public.reflection_likes;
CREATE POLICY "Likes follow reflection visibility"
  ON public.reflection_likes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id));

DROP POLICY IF EXISTS "Comments follow their reflection unless private" ON public.reflection_comments;
DROP POLICY IF EXISTS "Comments follow reflection visibility" ON public.reflection_comments;
CREATE POLICY "Comments follow reflection visibility"
  ON public.reflection_comments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id));

DROP POLICY IF EXISTS "Comment likes follow their comment unless private" ON public.reflection_comment_likes;
DROP POLICY IF EXISTS "Comment likes follow reflection visibility" ON public.reflection_comment_likes;
CREATE POLICY "Comment likes follow reflection visibility"
  ON public.reflection_comment_likes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflection_comments AS c WHERE c.id = comment_id));

DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;
CREATE POLICY "Avatar images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload own avatar images" ON storage.objects;
CREATE POLICY "Users can upload own avatar images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own avatar images" ON storage.objects;
CREATE POLICY "Users can update own avatar images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── 5. Counts of every like and comment ────────────────────────────────────
-- A single like or comment moves its parent's count by one. A statement that changes several rows,
-- such as a cascade from a deleted account or reflection, recounts each parent once instead, in id
-- order. A parent that is being deleted takes its likes and comments with it, so it is skipped.
CREATE OR REPLACE FUNCTION public.update_reflection_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent UUID;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_likes' OR TG_LEVEL <> 'STATEMENT' THEN
    RAISE EXCEPTION 'update_reflection_likes_count only maintains public.reflection_likes';
  END IF;
  IF (SELECT count(*) FROM changed) = 1 THEN
    SELECT c.reflection_id INTO parent FROM changed AS c;
    UPDATE public.reflections SET likes_count = likes_count + CASE TG_OP WHEN 'INSERT' THEN 1 ELSE -1 END
    WHERE id = parent;
    RETURN NULL;
  END IF;
  FOR parent IN
    SELECT DISTINCT c.reflection_id FROM changed AS c
    WHERE EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = c.reflection_id)
    ORDER BY 1
  LOOP
    PERFORM private.recount_reflection(parent);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reflection_comments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent UUID;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_comments' OR TG_LEVEL <> 'STATEMENT' THEN
    RAISE EXCEPTION 'update_reflection_comments_count only maintains public.reflection_comments';
  END IF;
  IF (SELECT count(*) FROM changed) = 1 THEN
    SELECT c.reflection_id INTO parent FROM changed AS c;
    UPDATE public.reflections SET comments_count = comments_count + CASE TG_OP WHEN 'INSERT' THEN 1 ELSE -1 END
    WHERE id = parent;
    RETURN NULL;
  END IF;
  FOR parent IN
    SELECT DISTINCT c.reflection_id FROM changed AS c
    WHERE EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = c.reflection_id)
    ORDER BY 1
  LOOP
    PERFORM private.recount_reflection(parent);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reflection_comment_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent UUID;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_comment_likes' OR TG_LEVEL <> 'STATEMENT' THEN
    RAISE EXCEPTION 'update_reflection_comment_likes_count only maintains public.reflection_comment_likes';
  END IF;
  IF (SELECT count(*) FROM changed) = 1 THEN
    SELECT c.comment_id INTO parent FROM changed AS c;
    UPDATE public.reflection_comments SET likes_count = likes_count + CASE TG_OP WHEN 'INSERT' THEN 1 ELSE -1 END
    WHERE id = parent;
    RETURN NULL;
  END IF;
  FOR parent IN
    SELECT DISTINCT c.comment_id FROM changed AS c
    WHERE EXISTS (SELECT 1 FROM public.reflection_comments AS rc WHERE rc.id = c.comment_id)
    ORDER BY 1
  LOOP
    PERFORM private.recount_comment(parent);
  END LOOP;
  RETURN NULL;
END;
$$;

-- A recount locks its row first, in its own statement, so it reads every like and comment committed
-- before it, and a later change waits for this one.
CREATE OR REPLACE FUNCTION private.recount_reflection(target UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.reflections WHERE id = target FOR NO KEY UPDATE;
  UPDATE public.reflections SET
    likes_count = (SELECT count(*) FROM public.reflection_likes AS l WHERE l.reflection_id = target),
    comments_count = (SELECT count(*) FROM public.reflection_comments AS c WHERE c.reflection_id = target)
  WHERE id = target;
END;
$$;

CREATE OR REPLACE FUNCTION private.recount_comment(target UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.reflection_comments WHERE id = target FOR NO KEY UPDATE;
  UPDATE public.reflection_comments SET likes_count = (
    SELECT count(*) FROM public.reflection_comment_likes AS cl WHERE cl.comment_id = target
  )
  WHERE id = target;
END;
$$;

-- ─── 6. Reflection writes ───────────────────────────────────────────────────
-- Locks a reflection the caller may react to, which is one the read policy shows: an active one.
CREATE OR REPLACE FUNCTION private.lock_readable_reflection(target UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.reflections AS r WHERE r.id = target AND r.status = 'active' FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reflection_not_found';
  END IF;
END;
$$;

-- Locks a comment the caller may like, which is one on an active reflection. A comment like changes
-- only the comment's count, so the reflection is read without a lock.
CREATE OR REPLACE FUNCTION private.lock_readable_comment(target UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  parent UUID;
BEGIN
  SELECT c.reflection_id INTO parent FROM public.reflection_comments AS c WHERE c.id = target FOR NO KEY UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = parent AND r.status = 'active') THEN
    RAISE EXCEPTION 'comment_not_found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_reflection(
  p_user_id UUID,
  p_surah INTEGER,
  p_ayah_start INTEGER,
  p_ayah_end INTEGER,
  p_juz_start INTEGER,
  p_juz_end INTEGER,
  p_content TEXT
)
RETURNS public.reflections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
  created public.reflections;
BEGIN
  INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content)
  VALUES (uid, p_surah, p_ayah_start, p_ayah_end, p_juz_start, p_juz_end, p_content)
  RETURNING * INTO created;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_reflection_comment(
  p_user_id UUID,
  p_reflection_id UUID,
  p_content TEXT
)
RETURNS public.reflection_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
  created public.reflection_comments;
BEGIN
  PERFORM private.lock_readable_reflection(p_reflection_id);
  INSERT INTO public.reflection_comments (reflection_id, user_id, content)
  VALUES (p_reflection_id, uid, p_content)
  RETURNING * INTO created;
  RETURN created;
END;
$$;

-- Likes and unlikes are idempotent: the result is the state the caller asked for.
CREATE OR REPLACE FUNCTION public.set_reflection_like(p_user_id UUID, p_reflection_id UUID, p_liked BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
BEGIN
  IF p_liked IS NULL THEN
    RAISE EXCEPTION 'invalid_like';
  END IF;
  IF p_liked THEN
    PERFORM private.lock_readable_reflection(p_reflection_id);
    INSERT INTO public.reflection_likes (user_id, reflection_id)
    VALUES (uid, p_reflection_id) ON CONFLICT DO NOTHING;
  ELSE
    PERFORM 1 FROM public.reflections WHERE id = p_reflection_id FOR NO KEY UPDATE;
    DELETE FROM public.reflection_likes WHERE user_id = uid AND reflection_id = p_reflection_id;
  END IF;
  RETURN p_liked;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_reflection_comment_like(p_user_id UUID, p_comment_id UUID, p_liked BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
BEGIN
  IF p_liked IS NULL THEN
    RAISE EXCEPTION 'invalid_like';
  END IF;
  IF p_liked THEN
    PERFORM private.lock_readable_comment(p_comment_id);
    INSERT INTO public.reflection_comment_likes (user_id, comment_id)
    VALUES (uid, p_comment_id) ON CONFLICT DO NOTHING;
  ELSE
    PERFORM 1 FROM public.reflection_comments WHERE id = p_comment_id FOR NO KEY UPDATE;
    DELETE FROM public.reflection_comment_likes WHERE user_id = uid AND comment_id = p_comment_id;
  END IF;
  RETURN p_liked;
END;
$$;

-- ─── 7. Profile privacy and the Board ───────────────────────────────────────
-- is_minor stays in the result, always false, because released apps (1.0.8 and earlier) refuse a
-- privacy without it.
CREATE OR REPLACE FUNCTION public.get_profile_privacy()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  row_data public.profile_privacy;
BEGIN
  SELECT * INTO row_data FROM public.profile_privacy WHERE user_id = uid;
  RETURN jsonb_build_object(
    'board_joined', COALESCE(row_data.board_joined, false),
    'board_nickname', row_data.board_nickname,
    'show_streak', COALESCE(row_data.show_streak, false),
    'show_juz_completions', COALESCE(row_data.show_juz_completions, false),
    'is_minor', false
  );
END;
$$;

-- The profiles row is key-shared first, as in get_board and leave_board, so an account deletion in
-- progress finishes before this reaches the privacy row it cascades to.
CREATE OR REPLACE FUNCTION public.set_profile_privacy(
  p_show_streak BOOLEAN,
  p_show_juz_completions BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  IF p_show_streak IS NULL OR p_show_juz_completions IS NULL THEN
    RAISE EXCEPTION 'invalid_privacy';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = uid FOR KEY SHARE;
  INSERT INTO public.profile_privacy (user_id, show_streak, show_juz_completions, updated_at)
  VALUES (uid, p_show_streak, p_show_juz_completions, now())
  ON CONFLICT (user_id) DO UPDATE SET
    show_streak = EXCLUDED.show_streak,
    show_juz_completions = EXCLUDED.show_juz_completions,
    updated_at = EXCLUDED.updated_at;
  RETURN public.get_profile_privacy();
END;
$$;

-- What a viewer may see of another person's consistency: the owner always, and anyone when the
-- person turned it on for their profile. Null fields are hidden.
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
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO privacy FROM public.profile_privacy WHERE user_id = p_user_id;
  RETURN jsonb_build_object(
    'streak', CASE WHEN is_owner OR COALESCE(privacy.show_streak, false)
      THEN private.habit_streak(p_user_id, private.member_today(p_user_id)) END,
    'juz_completed', CASE WHEN is_owner OR COALESCE(privacy.show_juz_completions, false) THEN (
      SELECT COALESCE(jsonb_agg(substring(a.achievement_id FROM 5 FOR 2)::INTEGER ORDER BY a.achievement_id), '[]'::JSONB)
      FROM public.achievement_unlocks AS a
      WHERE a.user_id = p_user_id AND a.achievement_id ~ '^juz_[0-9]{2}_completed$'
    ) END
  );
END;
$$;

-- BRD-05, BRD-08: standings show only when the cohort has at least 5 people. Each row has a nickname
-- or display name, weekly points and current streak. The avatar is never shown under a nickname,
-- since a photo would identify the person behind it. No user ids are returned. Only members still on
-- the board are listed.
CREATE OR REPLACE FUNCTION private.board_view(member UUID, board_week DATE, cohort UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  size INTEGER := private.board_cohort_size(cohort);
BEGIN
  IF size < 5 THEN
    RETURN jsonb_build_object(
      'status', 'gathering',
      'week_start', to_char(board_week, 'YYYY-MM-DD'),
      'member_count', size,
      'min_members', 5
    );
  END IF;
  RETURN jsonb_build_object(
    'status', 'ready',
    'week_start', to_char(board_week, 'YYYY-MM-DD'),
    'member_count', size,
    'min_members', 5,
    'standings', (
      SELECT jsonb_agg(jsonb_build_object(
        'rank', rank,
        'name', name,
        'uses_nickname', uses_nickname,
        'avatar_url', avatar_url,
        'points', points,
        'streak', streak,
        'is_me', is_me
      ) ORDER BY rank, name)
      FROM (
        SELECT
          rank() OVER (ORDER BY s.points DESC) AS rank,
          s.*
        FROM (
          SELECT
            COALESCE(pp.board_nickname, private.member_name(p.id)) AS name,
            pp.board_nickname IS NOT NULL AS uses_nickname,
            CASE WHEN pp.board_nickname IS NULL THEN p.avatar_url END AS avatar_url,
            private.board_points(p.id, board_week) AS points,
            private.habit_streak(p.id, private.member_today(p.id)) AS streak,
            p.id = member AS is_me
          FROM public.board_members AS bm
          JOIN public.profiles AS p ON p.id = bm.user_id
          JOIN public.profile_privacy AS pp ON pp.user_id = bm.user_id AND pp.board_joined
          WHERE bm.cohort_id = cohort AND bm.left_at IS NULL
        ) AS s
      ) AS ranked
    )
  );
END;
$$;

-- BRD-04: opt-in from the Board tab, optionally under a nickname. The profiles row is key-shared
-- before the profile_privacy row that this upsert and the placement in get_board hold, as in
-- get_board.
CREATE OR REPLACE FUNCTION public.join_board(
  p_nickname TEXT,
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
BEGIN
  PERFORM private.check_bands(p_level_band, p_pace_band, p_utc_offset_minutes);
  PERFORM private.check_week_start(p_week_start);
  IF clean_nickname IS NOT NULL AND (char_length(clean_nickname) NOT BETWEEN 3 AND 20 OR clean_nickname ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'invalid_nickname';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = uid FOR KEY SHARE;
  INSERT INTO public.profile_privacy (user_id, board_joined, board_nickname, board_week_start,
    board_level_band, board_pace_band, board_utc_offset_minutes, board_enrolled_week, updated_at)
  VALUES (uid, true, clean_nickname, p_week_start, p_level_band, p_pace_band, p_utc_offset_minutes,
    private.board_week(today, p_week_start), now())
  ON CONFLICT (user_id) DO UPDATE SET
    board_joined = true,
    board_nickname = EXCLUDED.board_nickname,
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

-- ─── 8. Old signatures for released apps ────────────────────────────────────
-- Apps released up to 1.0.8 send an under-18 or private value with these calls. Drop these wrappers
-- once no supported app sends them.

-- p_private is whether the old app showed the post as visible only to its author. That promise can
-- no longer be kept, so such a post is refused and the old app reloads the privacy.
CREATE OR REPLACE FUNCTION public.create_reflection(
  p_user_id UUID,
  p_surah INTEGER,
  p_ayah_start INTEGER,
  p_ayah_end INTEGER,
  p_juz_start INTEGER,
  p_juz_end INTEGER,
  p_content TEXT,
  p_private BOOLEAN
)
RETURNS public.reflections
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_private IS NULL THEN
    RAISE EXCEPTION 'invalid_visibility';
  END IF;
  IF p_private THEN
    RAISE EXCEPTION 'privacy_changed';
  END IF;
  RETURN public.create_reflection(p_user_id, p_surah, p_ayah_start, p_ayah_end, p_juz_start, p_juz_end, p_content);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_reflection_comment(
  p_user_id UUID,
  p_reflection_id UUID,
  p_content TEXT,
  p_private BOOLEAN
)
RETURNS public.reflection_comments
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_private IS NULL THEN
    RAISE EXCEPTION 'invalid_visibility';
  END IF;
  IF p_private THEN
    RAISE EXCEPTION 'privacy_changed';
  END IF;
  RETURN public.add_reflection_comment(p_user_id, p_reflection_id, p_content);
END;
$$;

-- The under-18 values are ignored. left_board is always false, since saving never leaves the Board.
CREATE OR REPLACE FUNCTION public.set_profile_privacy(
  p_show_streak BOOLEAN,
  p_show_juz_completions BOOLEAN,
  p_is_minor BOOLEAN,
  p_expected_minor BOOLEAN
)
RETURNS JSONB
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT public.set_profile_privacy(p_show_streak, p_show_juz_completions) || jsonb_build_object('left_board', false);
$$;

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
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT public.join_board(p_nickname, p_level_band, p_pace_band, p_utc_offset_minutes, p_today, p_week_start);
$$;

-- ─── 9. Helpers, the stored setting and the private flag ────────────────────
DROP FUNCTION IF EXISTS private.check_promised_visibility(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS private.recount_minor_activity();
DROP FUNCTION IF EXISTS private.profiles_minor_photo();
DROP FUNCTION IF EXISTS private.apply_minor_privacy();
DROP FUNCTION IF EXISTS private.lock_minor_change(UUID);
DROP FUNCTION IF EXISTS private.visible_step(UUID, INTEGER);
DROP FUNCTION IF EXISTS private.lock_activity_authors(UUID[]);
DROP FUNCTION IF EXISTS private.activity_public(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS private.is_minor(UUID);
DROP FUNCTION IF EXISTS rls.avatar_object_visible(TEXT);
DROP FUNCTION IF EXISTS rls.caller_is_minor();
DROP FUNCTION IF EXISTS rls.activity_visible(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS rls.profile_identity_visible(UUID);
DROP SCHEMA IF EXISTS rls;

ALTER TABLE public.profile_privacy DROP CONSTRAINT IF EXISTS profile_privacy_minor_nickname;
ALTER TABLE public.profile_privacy DROP COLUMN IF EXISTS is_minor;
ALTER TABLE public.reflections DROP COLUMN IF EXISTS is_private;
ALTER TABLE public.reflection_likes DROP COLUMN IF EXISTS is_private;
ALTER TABLE public.reflection_comments DROP COLUMN IF EXISTS is_private;
ALTER TABLE public.reflection_comment_likes DROP COLUMN IF EXISTS is_private;

-- ─── 10. Counts that left out an under-18 person's activity ──────────────────
UPDATE public.reflections AS r SET likes_count = counted.likes, comments_count = counted.comments
FROM (
  SELECT
    item.id,
    (SELECT count(*) FROM public.reflection_likes AS l WHERE l.reflection_id = item.id)::INTEGER AS likes,
    (SELECT count(*) FROM public.reflection_comments AS c WHERE c.reflection_id = item.id)::INTEGER AS comments
  FROM public.reflections AS item
) AS counted
WHERE r.id = counted.id AND (r.likes_count, r.comments_count) IS DISTINCT FROM (counted.likes, counted.comments);

UPDATE public.reflection_comments AS rc SET likes_count = counted.likes
FROM (
  SELECT
    item.id,
    (SELECT count(*) FROM public.reflection_comment_likes AS cl WHERE cl.comment_id = item.id)::INTEGER AS likes
  FROM public.reflection_comments AS item
) AS counted
WHERE rc.id = counted.id AND rc.likes_count IS DISTINCT FROM counted.likes;

-- ─── 11. Privileges of the new signatures ───────────────────────────────────
REVOKE ALL ON FUNCTION
  public.create_reflection(UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT),
  public.add_reflection_comment(UUID, UUID, TEXT),
  public.set_profile_privacy(BOOLEAN, BOOLEAN),
  public.join_board(TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.create_reflection(UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT),
  public.add_reflection_comment(UUID, UUID, TEXT),
  public.set_profile_privacy(BOOLEAN, BOOLEAN),
  public.join_board(TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER)
TO authenticated;

-- ─── 12. Nothing reads the setting ──────────────────────────────────────────
DO $$
DECLARE
  leftovers TEXT;
BEGIN
  SELECT string_agg(item, ', ' ORDER BY item) INTO leftovers FROM (
    SELECT format('column %I.%I.%I', table_schema, table_name, column_name) AS item
    FROM information_schema.columns
    WHERE table_schema IN ('public', 'private') AND column_name IN ('is_minor', 'is_private')
    UNION ALL
    SELECT format('function %I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND (p.proname ILIKE '%minor%' OR p.prosrc ~* '\.is_minor|is_private|minor_|\mrls\.')
    UNION ALL
    SELECT format('trigger %I on %s', t.tgname, t.tgrelid::regclass)
    FROM pg_trigger AS t WHERE NOT t.tgisinternal AND t.tgname ILIKE '%minor%'
    UNION ALL
    SELECT format('policy %I on %I.%I', policyname, schemaname, tablename)
    FROM pg_policies
    WHERE policyname ILIKE '%minor%' OR policyname ILIKE '%unless private%'
      OR qual ~* '\mrls\.|is_private|minor' OR with_check ~* '\mrls\.|is_private|minor'
    UNION ALL
    SELECT 'schema rls' FROM pg_namespace WHERE nspname = 'rls'
  ) AS found;
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'The under-18 setting is still read by: %', leftovers;
  END IF;
END $$;
