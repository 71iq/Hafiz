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
