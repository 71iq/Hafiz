-- Remote study_log may contain duplicate rows for the same review event from
-- older sync paths. Public profile stats must count unique review events.

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
    COUNT(DISTINCT (card_id, reviewed_at))::INTEGER AS reviews_count,
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
    cards_reviewed = aggregate_total_reviews,
    current_streak = aggregate_current_streak,
    longest_streak = aggregate_longest_streak,
    last_review_date = aggregate_last_review_date
  WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_public_review_stats_for_user(UUID) FROM PUBLIC, anon, authenticated;

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
