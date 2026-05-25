CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.study_cards
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.study_log
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.highlights
  ADD COLUMN IF NOT EXISTS sync_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.private_notes
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.reflection_journey_entries
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.achievement_unlocks
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.highlights
  SET updated_at = COALESCE(updated_at, created_at, synced_at, now())
  WHERE updated_at IS NULL;

UPDATE public.highlights
  SET sync_id = 'highlight:' || surah || ':' || ayah || ':' ||
    COALESCE(word_start::TEXT, 'ayah') || ':' ||
    COALESCE(word_end::TEXT, 'ayah') || ':' || color
  WHERE sync_id IS NULL OR sync_id = '';

WITH ranked AS (
  SELECT id, user_id, sync_id, row_number() OVER (PARTITION BY user_id, sync_id ORDER BY id) AS rn
  FROM public.highlights
  WHERE sync_id IS NOT NULL
)
UPDATE public.highlights h
SET sync_id = h.sync_id || ':' || h.id
FROM ranked r
WHERE h.id = r.id
  AND h.user_id = r.user_id
  AND r.rn > 1;

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own user settings" ON public.user_settings;
CREATE POLICY "Users can read own user settings"
  ON public.user_settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own user settings" ON public.user_settings;
CREATE POLICY "Users can insert own user settings"
  ON public.user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own user settings" ON public.user_settings;
CREATE POLICY "Users can update own user settings"
  ON public.user_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own user settings" ON public.user_settings;
CREATE POLICY "Users can delete own user settings"
  ON public.user_settings FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_synced
  ON public.user_settings(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_study_cards_user_synced
  ON public.study_cards(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_study_log_user_synced
  ON public.study_log(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_synced
  ON public.bookmarks(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_highlights_user_synced
  ON public.highlights(user_id, synced_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_highlights_user_sync_id
  ON public.highlights(user_id, sync_id);
CREATE INDEX IF NOT EXISTS idx_private_notes_user_synced
  ON public.private_notes(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_reflection_journey_entries_user_synced
  ON public.reflection_journey_entries(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_user_synced
  ON public.achievement_unlocks(user_id, synced_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
