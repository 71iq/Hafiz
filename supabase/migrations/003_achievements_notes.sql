CREATE TABLE IF NOT EXISTS public.private_notes (
  id TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah_start INTEGER NOT NULL,
  ayah_end INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS public.achievement_unlocks (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL,
  public_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, achievement_id)
);

ALTER TABLE public.private_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own private notes" ON public.private_notes;
CREATE POLICY "Users can read own private notes"
  ON public.private_notes FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own private notes" ON public.private_notes;
CREATE POLICY "Users can insert own private notes"
  ON public.private_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own private notes" ON public.private_notes;
CREATE POLICY "Users can update own private notes"
  ON public.private_notes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own private notes" ON public.private_notes;
CREATE POLICY "Users can delete own private notes"
  ON public.private_notes FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Achievement unlocks are publicly readable" ON public.achievement_unlocks;
CREATE POLICY "Achievement unlocks are publicly readable"
  ON public.achievement_unlocks FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert own achievement unlocks" ON public.achievement_unlocks;
CREATE POLICY "Users can insert own achievement unlocks"
  ON public.achievement_unlocks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own achievement unlocks" ON public.achievement_unlocks;
CREATE POLICY "Users can update own achievement unlocks"
  ON public.achievement_unlocks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own achievement unlocks" ON public.achievement_unlocks;
CREATE POLICY "Users can delete own achievement unlocks"
  ON public.achievement_unlocks FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_private_notes_user_updated ON public.private_notes(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_private_notes_ayah ON public.private_notes(user_id, surah, ayah_start, ayah_end);
CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_user_unlocked ON public.achievement_unlocks(user_id, unlocked_at);
CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_public_unlocked ON public.achievement_unlocks(unlocked_at);
