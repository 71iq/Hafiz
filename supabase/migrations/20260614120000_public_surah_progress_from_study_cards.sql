-- Keep public Surah Progress in sync with private study_cards.
-- Existing rows are backfilled once; future study_card writes refresh the
-- affected user's public aggregate on the server.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.public_surah_progress (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL CHECK (surah BETWEEN 1 AND 114),
  total_cards INTEGER NOT NULL DEFAULT 0 CHECK (total_cards >= 0),
  memorized_cards INTEGER NOT NULL DEFAULT 0 CHECK (memorized_cards >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, surah),
  CHECK (memorized_cards <= total_cards)
);

ALTER TABLE public.public_surah_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public surah progress is publicly readable" ON public.public_surah_progress;
CREATE POLICY "Public surah progress is publicly readable"
  ON public.public_surah_progress FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert own public surah progress" ON public.public_surah_progress;
CREATE POLICY "Users can insert own public surah progress"
  ON public.public_surah_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own public surah progress" ON public.public_surah_progress;
CREATE POLICY "Users can update own public surah progress"
  ON public.public_surah_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own public surah progress" ON public.public_surah_progress;
CREATE POLICY "Users can delete own public surah progress"
  ON public.public_surah_progress FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT ON public.public_surah_progress TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.public_surah_progress TO authenticated;

CREATE INDEX IF NOT EXISTS idx_public_surah_progress_user_updated
  ON public.public_surah_progress(user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION private.hafiz_public_surah_from_card(card_id TEXT, deck_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  ayah_key TEXT;
  surah_text TEXT;
  surah_num INTEGER;
BEGIN
  IF card_id IS NULL OR deck_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF card_id LIKE 'word:%' THEN
    RETURN NULL;
  END IF;

  IF deck_id IN (
    'default-mutashabihat',
    'default-similar-tails',
    'default-qiraat',
    'default-reasons-of-revelation'
  ) THEN
    RETURN NULL;
  END IF;

  ayah_key := CASE
    WHEN deck_id = 'mutashabihat' AND card_id LIKE 'mutashabihat:%'
      THEN substring(card_id FROM length('mutashabihat') + 2)
    ELSE card_id
  END;

  IF position(':' IN ayah_key) <= 1 THEN
    RETURN NULL;
  END IF;

  surah_text := split_part(ayah_key, ':', 1);
  IF surah_text !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;

  surah_num := surah_text::INTEGER;
  IF surah_num < 1 OR surah_num > 114 THEN
    RETURN NULL;
  END IF;

  RETURN surah_num;
END;
$$;

CREATE OR REPLACE FUNCTION private.refresh_public_surah_progress_for_user(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

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
  GROUP BY user_id, surah;
END;
$$;

CREATE OR REPLACE FUNCTION private.refresh_public_surah_progress_after_study_card_insert()
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
    PERFORM private.refresh_public_surah_progress_for_user(target_user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.refresh_public_surah_progress_after_study_card_update()
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
    PERFORM private.refresh_public_surah_progress_for_user(target_user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.refresh_public_surah_progress_after_study_card_delete()
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
    PERFORM private.refresh_public_surah_progress_for_user(target_user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.hafiz_public_surah_from_card(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_public_surah_progress_for_user(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_public_surah_progress_after_study_card_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_public_surah_progress_after_study_card_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_public_surah_progress_after_study_card_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS study_cards_public_surah_progress_insert ON public.study_cards;
CREATE TRIGGER study_cards_public_surah_progress_insert
  AFTER INSERT ON public.study_cards
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.refresh_public_surah_progress_after_study_card_insert();

DROP TRIGGER IF EXISTS study_cards_public_surah_progress_update ON public.study_cards;
CREATE TRIGGER study_cards_public_surah_progress_update
  AFTER UPDATE ON public.study_cards
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.refresh_public_surah_progress_after_study_card_update();

DROP TRIGGER IF EXISTS study_cards_public_surah_progress_delete ON public.study_cards;
CREATE TRIGGER study_cards_public_surah_progress_delete
  AFTER DELETE ON public.study_cards
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.refresh_public_surah_progress_after_study_card_delete();

DO $$
DECLARE
  target_user_id UUID;
BEGIN
  FOR target_user_id IN
    SELECT DISTINCT user_id FROM public.study_cards WHERE user_id IS NOT NULL
  LOOP
    PERFORM private.refresh_public_surah_progress_for_user(target_user_id);
  END LOOP;
END $$;
