CREATE TABLE IF NOT EXISTS public.user_word_meanings (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  word_pos INTEGER NOT NULL,
  word TEXT,
  meaning TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, surah, ayah, word_pos)
);

ALTER TABLE public.user_word_meanings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own user word meanings" ON public.user_word_meanings;
CREATE POLICY "Users can read own user word meanings"
  ON public.user_word_meanings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own user word meanings" ON public.user_word_meanings;
CREATE POLICY "Users can insert own user word meanings"
  ON public.user_word_meanings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own user word meanings" ON public.user_word_meanings;
CREATE POLICY "Users can update own user word meanings"
  ON public.user_word_meanings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own user word meanings" ON public.user_word_meanings;
CREATE POLICY "Users can delete own user word meanings"
  ON public.user_word_meanings FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_word_meanings_user_synced
  ON public.user_word_meanings(user_id, synced_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_word_meanings TO authenticated;
