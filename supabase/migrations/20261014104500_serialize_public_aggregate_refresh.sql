-- Serialize each account's public aggregate refreshes across concurrent clients.
-- Preserve existing trigger functions, permissions and historical rows.

CREATE OR REPLACE FUNCTION private.refresh_public_surah_progress_for_user(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hafiz:public-aggregates:' || target_user_id::TEXT, 0)
  );

  DELETE FROM public.public_surah_progress
  WHERE user_id = target_user_id;

  INSERT INTO public.public_surah_progress (
    user_id,
    surah,
    total_cards,
    memorized_cards,
    updated_at
  )
  SELECT
    user_id,
    surah,
    COUNT(*)::INTEGER AS total_cards,
    COALESCE(SUM(CASE WHEN reps > 0 OR last_review IS NOT NULL THEN 1 ELSE 0 END), 0)::INTEGER AS memorized_cards,
    now() AS updated_at
  FROM (
    SELECT
      sc.user_id,
      private.hafiz_public_surah_from_card(sc.id, sc.deck_id) AS surah,
      sc.reps,
      sc.last_review
    FROM public.study_cards sc
    WHERE sc.user_id = target_user_id
      AND sc.deleted_at IS NULL
  ) card_surahs
  WHERE surah IS NOT NULL
  GROUP BY user_id, surah
  ON CONFLICT (user_id, surah) DO UPDATE SET
    total_cards = EXCLUDED.total_cards,
    memorized_cards = EXCLUDED.memorized_cards,
    updated_at = EXCLUDED.updated_at;
END;
$function$;

CREATE OR REPLACE FUNCTION private.refresh_public_review_stats_for_user(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hafiz:public-aggregates:' || target_user_id::TEXT, 0)
  );

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
  GROUP BY user_id, (reviewed_at AT TIME ZONE 'UTC')::DATE
  ON CONFLICT (user_id, date) DO UPDATE SET
    reviews_count = EXCLUDED.reviews_count,
    updated_at = EXCLUDED.updated_at;

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
$function$;
