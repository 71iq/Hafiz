-- Keep public profile review activity in sync with private study_log.
-- Public profile surfaces must not depend on stale client-only daily_scores.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.public_review_activity (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  reviews_count INTEGER NOT NULL DEFAULT 0 CHECK (reviews_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS public.public_review_stats (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_reviews INTEGER NOT NULL DEFAULT 0 CHECK (total_reviews >= 0),
  active_days INTEGER NOT NULL DEFAULT 0 CHECK (active_days >= 0),
  current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_review_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.public_review_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_review_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public review activity is publicly readable" ON public.public_review_activity;
CREATE POLICY "Public review activity is publicly readable"
  ON public.public_review_activity FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert own public review activity" ON public.public_review_activity;
CREATE POLICY "Users can insert own public review activity"
  ON public.public_review_activity FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own public review activity" ON public.public_review_activity;
CREATE POLICY "Users can update own public review activity"
  ON public.public_review_activity FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own public review activity" ON public.public_review_activity;
CREATE POLICY "Users can delete own public review activity"
  ON public.public_review_activity FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public review stats are publicly readable" ON public.public_review_stats;
CREATE POLICY "Public review stats are publicly readable"
  ON public.public_review_stats FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert own public review stats" ON public.public_review_stats;
CREATE POLICY "Users can insert own public review stats"
  ON public.public_review_stats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own public review stats" ON public.public_review_stats;
CREATE POLICY "Users can update own public review stats"
  ON public.public_review_stats FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own public review stats" ON public.public_review_stats;
CREATE POLICY "Users can delete own public review stats"
  ON public.public_review_stats FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT ON public.public_review_activity TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.public_review_activity TO authenticated;
GRANT SELECT ON public.public_review_stats TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.public_review_stats TO authenticated;

CREATE INDEX IF NOT EXISTS idx_public_review_activity_user_date
  ON public.public_review_activity(user_id, date);

CREATE INDEX IF NOT EXISTS idx_public_review_stats_updated
  ON public.public_review_stats(updated_at DESC);

CREATE OR REPLACE FUNCTION private.refresh_public_review_stats_for_user(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_utc DATE := (now() AT TIME ZONE 'UTC')::DATE;
  aggregate_total_reviews INTEGER := 0;
  aggregate_active_days INTEGER := 0;
  aggregate_current_streak INTEGER := 0;
  aggregate_longest_streak INTEGER := 0;
  aggregate_last_review_date DATE := NULL;
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.public_review_activity
  WHERE user_id = target_user_id;

  INSERT INTO public.public_review_activity (
    user_id,
    date,
    reviews_count,
    updated_at
  )
  SELECT
    user_id,
    (reviewed_at AT TIME ZONE 'UTC')::DATE AS date,
    COUNT(*)::INTEGER AS reviews_count,
    now() AS updated_at
  FROM public.study_log
  WHERE user_id = target_user_id
  GROUP BY user_id, (reviewed_at AT TIME ZONE 'UTC')::DATE;

  SELECT
    COALESCE(SUM(reviews_count), 0)::INTEGER,
    COALESCE(COUNT(*), 0)::INTEGER,
    MAX(date)
  INTO aggregate_total_reviews, aggregate_active_days, aggregate_last_review_date
  FROM public.public_review_activity
  WHERE user_id = target_user_id
    AND reviews_count > 0;

  SELECT COALESCE(MAX(run_length), 0)::INTEGER
  INTO aggregate_longest_streak
  FROM (
    SELECT COUNT(*) AS run_length
    FROM (
      SELECT
        date,
        date - (ROW_NUMBER() OVER (ORDER BY date))::INTEGER AS streak_group
      FROM public.public_review_activity
      WHERE user_id = target_user_id
        AND reviews_count > 0
    ) grouped_days
    GROUP BY streak_group
  ) streaks;

  WITH RECURSIVE current_run(date_key, length) AS (
    SELECT today_utc, 1
    WHERE EXISTS (
      SELECT 1
      FROM public.public_review_activity
      WHERE user_id = target_user_id
        AND date = today_utc
        AND reviews_count > 0
    )
    UNION ALL
    SELECT date_key - 1, length + 1
    FROM current_run
    WHERE EXISTS (
      SELECT 1
      FROM public.public_review_activity
      WHERE user_id = target_user_id
        AND date = current_run.date_key - 1
        AND reviews_count > 0
    )
  )
  SELECT COALESCE(MAX(length), 0)::INTEGER
  INTO aggregate_current_streak
  FROM current_run;

  INSERT INTO public.public_review_stats (
    user_id,
    total_reviews,
    active_days,
    current_streak,
    longest_streak,
    last_review_date,
    updated_at
  )
  VALUES (
    target_user_id,
    aggregate_total_reviews,
    aggregate_active_days,
    aggregate_current_streak,
    aggregate_longest_streak,
    aggregate_last_review_date,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_reviews = excluded.total_reviews,
    active_days = excluded.active_days,
    current_streak = excluded.current_streak,
    longest_streak = excluded.longest_streak,
    last_review_date = excluded.last_review_date,
    updated_at = excluded.updated_at;

  UPDATE public.profiles
  SET
    cards_reviewed = GREATEST(COALESCE(cards_reviewed, 0), aggregate_total_reviews),
    current_streak = aggregate_current_streak,
    longest_streak = GREATEST(COALESCE(longest_streak, 0), aggregate_longest_streak),
    last_review_date = GREATEST(last_review_date, aggregate_last_review_date)
  WHERE id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.refresh_public_review_stats_after_study_log_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
BEGIN
  FOR target_user_id IN
    SELECT DISTINCT user_id FROM new_rows WHERE user_id IS NOT NULL
  LOOP
    PERFORM private.refresh_public_review_stats_for_user(target_user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.refresh_public_review_stats_after_study_log_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
BEGIN
  FOR target_user_id IN
    SELECT DISTINCT user_id
    FROM (
      SELECT user_id FROM new_rows
      UNION
      SELECT user_id FROM old_rows
    ) touched
    WHERE user_id IS NOT NULL
  LOOP
    PERFORM private.refresh_public_review_stats_for_user(target_user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.refresh_public_review_stats_after_study_log_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
BEGIN
  FOR target_user_id IN
    SELECT DISTINCT user_id FROM old_rows WHERE user_id IS NOT NULL
  LOOP
    PERFORM private.refresh_public_review_stats_for_user(target_user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_public_review_stats_for_user(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_public_review_stats_after_study_log_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_public_review_stats_after_study_log_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_public_review_stats_after_study_log_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS study_log_public_review_stats_insert ON public.study_log;
CREATE TRIGGER study_log_public_review_stats_insert
  AFTER INSERT ON public.study_log
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.refresh_public_review_stats_after_study_log_insert();

DROP TRIGGER IF EXISTS study_log_public_review_stats_update ON public.study_log;
CREATE TRIGGER study_log_public_review_stats_update
  AFTER UPDATE ON public.study_log
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.refresh_public_review_stats_after_study_log_update();

DROP TRIGGER IF EXISTS study_log_public_review_stats_delete ON public.study_log;
CREATE TRIGGER study_log_public_review_stats_delete
  AFTER DELETE ON public.study_log
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.refresh_public_review_stats_after_study_log_delete();

DO $$
DECLARE
  target_user_id UUID;
BEGIN
  FOR target_user_id IN
    SELECT DISTINCT user_id FROM public.study_log WHERE user_id IS NOT NULL
  LOOP
    PERFORM private.refresh_public_review_stats_for_user(target_user_id);
  END LOOP;
END $$;
