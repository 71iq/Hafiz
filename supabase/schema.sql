-- ============================================================
-- Hafiz — Supabase Schema (Phase 6: Authentication & Sync)
-- Run this SQL in your Supabase project's SQL Editor
-- ============================================================

-- ─── Profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL CHECK (length(username) BETWEEN 3 AND 20),
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT CHECK (bio IS NULL OR char_length(bio) <= 280),
  country TEXT CHECK (country IS NULL OR char_length(country) <= 80),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Study Cards (synced from local SQLite) ──────────────────
CREATE TABLE IF NOT EXISTS study_cards (
  id TEXT NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL,
  due TIMESTAMPTZ NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  last_review TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  buried_until TIMESTAMPTZ,
  marked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cached hifz tier (TIER-01), recomputable from history.
  tier TEXT CHECK (tier IN ('sabaq', 'sabqi', 'manzil', 'manzil.needs_work', 'manzil.unverified')),
  tier_changed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

-- ─── Study Log (synced from local SQLite) ────────────────────
CREATE TABLE IF NOT EXISTS study_log (
  id BIGSERIAL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  state INTEGER NOT NULL,
  due TIMESTAMPTZ NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id TEXT,
  duration_ms INTEGER CHECK (duration_ms >= 0),
  support_level SMALLINT CHECK (support_level BETWEEN 0 AND 4),
  proposed_rating SMALLINT CHECK (proposed_rating BETWEEN 0 AND 4),
  grader TEXT CHECK (grader IN ('self', 'teacher', 'salah', 'asr')),
  -- Nullable: older clients omit it.
  local_date TEXT CHECK (local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  tz TEXT,
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  PRIMARY KEY (user_id, id)
);

-- ─── Bookmarks (synced from local SQLite) ────────────────────
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  qf_bookmark_id TEXT,
  qf_synced_at TIMESTAMPTZ,
  qf_sync_error TEXT,
  qf_is_in_default_collection BOOLEAN NOT NULL DEFAULT false,
  qf_collections_count INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, surah, ayah)
);

-- ─── Highlights (synced from local SQLite) ───────────────────
CREATE TABLE IF NOT EXISTS highlights (
  id BIGSERIAL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  sync_id TEXT,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  word_start INTEGER,
  word_end INTEGER,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

-- ─── User Settings (synced account-level settings) ──────────
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ─── User Word Meanings (custom vocabulary meaning overrides) ─
CREATE TABLE IF NOT EXISTS user_word_meanings (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
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

-- ============================================================
-- Row Level Security (RLS) Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_word_meanings ENABLE ROW LEVEL SECURITY;

-- ─── Profiles: identity is readable (reflection feed authors) unless the owner stated they are a
-- minor, and writable only by the owner. The read policy needs profile_privacy, so it is created
-- with that table below. Board and visibility choices live in the owner-only profile_privacy table.
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ─── Study Cards: owner only
CREATE POLICY "Users can read own study cards"
  ON study_cards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own study cards"
  ON study_cards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Study Log: owner only
CREATE POLICY "Users can read own study log"
  ON study_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own study log"
  ON study_log FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Bookmarks: owner only
CREATE POLICY "Users can read own bookmarks"
  ON bookmarks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own bookmarks"
  ON bookmarks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Highlights: owner only
CREATE POLICY "Users can read own highlights"
  ON highlights FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own highlights"
  ON highlights FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── User Settings: owner only
CREATE POLICY "Users can read own user settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own user settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own user settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own user settings"
  ON user_settings FOR DELETE
  USING (auth.uid() = user_id);

-- ─── User Word Meanings: owner only
CREATE POLICY "Users can read own user word meanings"
  ON user_word_meanings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own user word meanings"
  ON user_word_meanings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own user word meanings"
  ON user_word_meanings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own user word meanings"
  ON user_word_meanings FOR DELETE
  USING (auth.uid() = user_id);

-- ─── Reflections (Community Feature) ────────────────────────
CREATE TABLE IF NOT EXISTS reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah_start INTEGER NOT NULL,
  ayah_end INTEGER NOT NULL,
  juz_start INTEGER NOT NULL,
  juz_end INTEGER NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 10 AND 5000),
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT reflections_juz_range_check CHECK (
    juz_start BETWEEN 1 AND 30
    AND juz_end BETWEEN 1 AND 30
    AND juz_start <= juz_end
  )
);

-- ─── Reflection Likes ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS reflection_likes (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  reflection_id UUID REFERENCES reflections(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, reflection_id)
);

-- ─── Reflection Comments ───────────────────────────────────
CREATE TABLE IF NOT EXISTS reflection_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reflection_id UUID REFERENCES reflections(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  likes_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Reflection Comment Likes ──────────────────────────────
CREATE TABLE IF NOT EXISTS reflection_comment_likes (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES reflection_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);

-- ─── Reports (moderation queue) ────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  reflection_id UUID REFERENCES reflections(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on reflection tables
ALTER TABLE reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE reflection_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reflection_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reflection_comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON reflection_comment_likes TO anon, authenticated;
GRANT INSERT, DELETE ON reflection_comment_likes TO authenticated;

-- ─── Reflections: publicly readable (active only), writable by author
CREATE POLICY "Active reflections are publicly readable"
  ON reflections FOR SELECT
  USING (status = 'active');

CREATE POLICY "Users can insert own reflections"
  ON reflections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reflections"
  ON reflections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reflections"
  ON reflections FOR DELETE
  USING (auth.uid() = user_id);

-- ─── Reflection Likes: visible with their reflection, auth required to write
-- Child policies look up the parent under its own RLS, so discussion follows reflection visibility.
CREATE POLICY "Likes follow reflection visibility"
  ON reflection_likes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id));

-- Likes are only added or removed, never updated: owner-rights counters fire on insert and delete.
CREATE POLICY "Users can insert own likes"
  ON reflection_likes FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id)
  );

CREATE POLICY "Users can delete own likes"
  ON reflection_likes FOR DELETE
  USING (auth.uid() = user_id);

-- ─── Reflection Comments: visible with their reflection, auth required to write
CREATE POLICY "Comments follow reflection visibility"
  ON reflection_comments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id));

CREATE POLICY "Users can insert own comments"
  ON reflection_comments FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id)
  );

CREATE POLICY "Users can delete own comments"
  ON reflection_comments FOR DELETE
  USING (auth.uid() = user_id);

-- ─── Reflection Comment Likes: visible with their comment, auth required to write
CREATE POLICY "Comment likes follow reflection visibility"
  ON reflection_comment_likes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflection_comments AS c WHERE c.id = comment_id));

CREATE POLICY "Users can insert own comment likes"
  ON reflection_comment_likes FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.reflection_comments AS c WHERE c.id = comment_id)
  );

CREATE POLICY "Users can delete own comment likes"
  ON reflection_comment_likes FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- ─── Reports: only author can see own, insert requires auth
CREATE POLICY "Users can see own reports"
  ON reports FOR SELECT
  USING (auth.uid() = reporter_id);

CREATE POLICY "Users can insert reports"
  ON reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

-- ─── Private Notes (synced from local SQLite) ───────────────
CREATE TABLE IF NOT EXISTS private_notes (
  id TEXT NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah_start INTEGER NOT NULL,
  ayah_end INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  qf_note_id TEXT,
  qf_synced_at TIMESTAMPTZ,
  qf_sync_error TEXT,
  qf_ranges_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS qf_user_connections (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  qf_subject TEXT,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT[] NOT NULL DEFAULT '{}',
  env TEXT NOT NULL CHECK (env IN ('prelive', 'production')),
  status TEXT NOT NULL CHECK (status IN ('connected', 'needs_reauth', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qf_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code_verifier_ciphertext TEXT NOT NULL,
  nonce TEXT,
  redirect_uri TEXT NOT NULL,
  return_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

-- ─── Reflection Journey Entries (synced from local SQLite) ──
CREATE TABLE IF NOT EXISTS reflection_journey_entries (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  level_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'completed')),
  response_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, level_id)
);

-- ─── Achievement Unlocks (public badges) ────────────────────
CREATE TABLE IF NOT EXISTS achievement_unlocks (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL,
  public_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS public_surah_progress (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL CHECK (surah BETWEEN 1 AND 114),
  total_cards INTEGER NOT NULL DEFAULT 0 CHECK (total_cards >= 0),
  memorized_cards INTEGER NOT NULL DEFAULT 0 CHECK (memorized_cards >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, surah),
  CHECK (memorized_cards <= total_cards)
);

ALTER TABLE private_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE qf_user_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qf_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE reflection_journey_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_surah_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own private notes"
  ON private_notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own private notes"
  ON private_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own private notes"
  ON private_notes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own private notes"
  ON private_notes FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read own reflection journey entries"
  ON reflection_journey_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reflection journey entries"
  ON reflection_journey_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reflection journey entries"
  ON reflection_journey_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reflection journey entries"
  ON reflection_journey_entries FOR DELETE
  USING (auth.uid() = user_id);

-- Achievement read policies are defined with the halaqa tables below.

CREATE POLICY "Users can insert own achievement unlocks"
  ON achievement_unlocks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own achievement unlocks"
  ON achievement_unlocks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own achievement unlocks"
  ON achievement_unlocks FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read own surah progress"
  ON public.public_surah_progress FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own public surah progress"
  ON public_surah_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own public surah progress"
  ON public_surah_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own public surah progress"
  ON public_surah_progress FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT ON public_surah_progress TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public_surah_progress TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_word_meanings TO authenticated;

-- ─── Storage: profile avatars ────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  3145728,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Avatar images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload own avatar images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

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

CREATE POLICY "Users can delete own avatar images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── Trigger: auto-update likes_count on reflections ────────
CREATE OR REPLACE FUNCTION public.update_reflection_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_likes' THEN
    RAISE EXCEPTION 'update_reflection_likes_count only maintains public.reflection_likes';
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reflections SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = NEW.reflection_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reflections SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0) WHERE id = OLD.reflection_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reflection_likes_count ON reflection_likes;
CREATE TRIGGER trg_reflection_likes_count
  AFTER INSERT OR DELETE ON reflection_likes
  FOR EACH ROW EXECUTE FUNCTION update_reflection_likes_count();

-- ─── Trigger: auto-update comments_count on reflections ─────
CREATE OR REPLACE FUNCTION public.update_reflection_comments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_comments' THEN
    RAISE EXCEPTION 'update_reflection_comments_count only maintains public.reflection_comments';
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reflections SET comments_count = COALESCE(comments_count, 0) + 1 WHERE id = NEW.reflection_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reflections SET comments_count = GREATEST(COALESCE(comments_count, 0) - 1, 0) WHERE id = OLD.reflection_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reflection_comments_count ON reflection_comments;
CREATE TRIGGER trg_reflection_comments_count
  AFTER INSERT OR DELETE ON reflection_comments
  FOR EACH ROW EXECUTE FUNCTION update_reflection_comments_count();

-- ─── Trigger: auto-update likes_count on reflection comments
CREATE OR REPLACE FUNCTION public.update_reflection_comment_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_comment_likes' THEN
    RAISE EXCEPTION 'update_reflection_comment_likes_count only maintains public.reflection_comment_likes';
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reflection_comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reflection_comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reflection_comment_likes_count ON reflection_comment_likes;
CREATE TRIGGER trg_reflection_comment_likes_count
  AFTER INSERT OR DELETE ON reflection_comment_likes
  FOR EACH ROW EXECUTE FUNCTION update_reflection_comment_likes_count();

-- Counter triggers run as their owner so a reaction to another author's post still updates its
-- count under RLS. They are never called directly.
REVOKE UPDATE ON public.reflection_likes FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.reflection_comment_likes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_reflection_likes_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_reflection_comments_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_reflection_comment_likes_count() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_study_cards_user_due ON study_cards(user_id, due);
CREATE INDEX IF NOT EXISTS idx_study_cards_user_buried ON study_cards(user_id, buried_until);
CREATE INDEX IF NOT EXISTS idx_study_cards_user_marked ON study_cards(user_id, marked_at);
CREATE INDEX IF NOT EXISTS idx_study_cards_user_synced ON study_cards(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_study_log_user_reviewed ON study_log(user_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_study_log_user_synced ON study_log(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_updated ON bookmarks(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_qf_id ON bookmarks(user_id, qf_bookmark_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_synced ON bookmarks(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_highlights_user ON highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_synced ON highlights(user_id, synced_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_highlights_user_sync_id ON highlights(user_id, sync_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_synced ON user_settings(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_user_word_meanings_user_synced ON user_word_meanings(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_reflections_ayah ON reflections(surah, ayah_start, ayah_end);
CREATE INDEX IF NOT EXISTS idx_reflections_user ON reflections(user_id);
CREATE INDEX IF NOT EXISTS idx_reflections_feed_created ON reflections(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reflections_feed_likes ON reflections(status, likes_count DESC, comments_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reflections_surah_feed ON reflections(status, surah, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reflections_juz_feed ON reflections(status, juz_start, juz_end, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reflection_likes_reflection ON reflection_likes(reflection_id);
CREATE INDEX IF NOT EXISTS idx_reflection_comments_reflection ON reflection_comments(reflection_id);
CREATE INDEX IF NOT EXISTS idx_reflection_comment_likes_comment ON reflection_comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_reflection_comments_popular ON reflection_comments(reflection_id, likes_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reflection ON reports(reflection_id);
CREATE INDEX IF NOT EXISTS idx_private_notes_user_updated ON private_notes(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_private_notes_ayah ON private_notes(user_id, surah, ayah_start, ayah_end);
CREATE INDEX IF NOT EXISTS idx_private_notes_qf_id ON private_notes(user_id, qf_note_id);
CREATE INDEX IF NOT EXISTS idx_private_notes_user_synced ON private_notes(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_qf_user_connections_status ON qf_user_connections(status, env);
CREATE INDEX IF NOT EXISTS idx_qf_oauth_states_user ON qf_oauth_states(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_reflection_journey_entries_user_updated ON reflection_journey_entries(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_reflection_journey_entries_user_synced ON reflection_journey_entries(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_user_unlocked ON achievement_unlocks(user_id, unlocked_at);
CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_public_unlocked ON achievement_unlocks(unlocked_at);
CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_user_synced ON achievement_unlocks(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_public_surah_progress_user_updated ON public_surah_progress(user_id, updated_at DESC);

-- ─── Public Surah Progress aggregate maintenance ─────────────
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

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

-- Serialized per account across concurrent clients (migration 20261014104500).
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

-- ─── Sync conflict guard (RF169) ─────────────────────────────
-- Skip an update whose row time is strictly older than the stored row (see migration 20261107200000).

CREATE OR REPLACE FUNCTION public.sync_keep_newer_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  old_row JSONB := to_jsonb(OLD);
  new_row JSONB := to_jsonb(NEW);
  old_at TIMESTAMPTZ;
  new_at TIMESTAMPTZ;
  col TEXT;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    old_at := COALESCE(old_at, (old_row ->> col)::TIMESTAMPTZ);
    new_at := COALESCE(new_at, (new_row ->> col)::TIMESTAMPTZ);
  END LOOP;
  IF old_at IS NOT NULL AND new_at IS NOT NULL AND old_at > new_at THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_keep_newer_row() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.study_cards;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.study_cards
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('updated_at', 'created_at', 'synced_at');

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.bookmarks;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.bookmarks
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('updated_at', 'created_at', 'synced_at');

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.highlights;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.highlights
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('updated_at', 'created_at', 'synced_at');

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.user_settings;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('updated_at', 'created_at', 'synced_at');

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.user_word_meanings;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.user_word_meanings
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('updated_at', 'created_at', 'synced_at');

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.private_notes;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.private_notes
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('updated_at', 'created_at', 'synced_at');

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.reflection_journey_entries;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.reflection_journey_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('updated_at', 'created_at', 'synced_at');

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.achievement_unlocks;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.achievement_unlocks
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('unlocked_at', 'synced_at');

-- ============================================================
-- Learning and consistency (migration 20261113120000)
-- ============================================================
-- Wird-day sync with a server-side merge, private-by-default social data, halaqa groups and the
-- weekly board. Halaqa and board tables have no client policies: every read and write goes through
-- the SECURITY DEFINER RPCs below. Board points come only from synced habit_days.

CREATE SCHEMA IF NOT EXISTS private;

-- ─── Wird days (DB-02) ────────────────────────────────────────────────────
-- One row per user-local day. The earned status only rises in precedence; the excuse is a separate
-- last-write-wins register so a withdrawn excuse never comes back. There is no deleted_at.
CREATE TABLE IF NOT EXISTS public.habit_days (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- A real calendar date, so server date arithmetic on these rows can never fail.
  local_date TEXT NOT NULL CHECK (
    CASE WHEN local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN to_char(local_date::DATE, 'YYYY-MM-DD') = local_date
      ELSE false
    END
  ),
  status TEXT CHECK (status IN ('done', 'made_up', 'earned_back', 'excused', 'paused', 'grace')),
  earned_status TEXT CHECK (earned_status IN ('done', 'made_up', 'earned_back', 'paused', 'grace')),
  reason TEXT CHECK (reason IN ('illness', 'travel', 'menstruation', 'other')),
  excuse_updated_at TIMESTAMPTZ,
  minimum_met BOOLEAN NOT NULL DEFAULT false,
  full_met BOOLEAN NOT NULL DEFAULT false,
  manzil_cycle_completed BOOLEAN NOT NULL DEFAULT false,
  source_session_id TEXT,
  credited_through TIMESTAMPTZ,
  tz TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date)
);

-- ─── Review sessions and recitation errors (DB-03, last write wins) ───────
CREATE TABLE IF NOT EXISTS public.review_sessions (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'cards', 'wird', 'sabaq', 'mistakes', 'juz_check', 'portion_check', 'welcome_back', 'seams',
    'mutashabihat', 'listening', 'full_juz', 'salah'
  )),
  deck_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  local_date TEXT NOT NULL CHECK (local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  tz TEXT NOT NULL,
  cards_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (cards_reviewed >= 0),
  pages_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (pages_reviewed >= 0),
  new_lines INTEGER NOT NULL DEFAULT 0 CHECK (new_lines >= 0),
  clean_pages INTEGER NOT NULL DEFAULT 0 CHECK (clean_pages >= 0),
  errors INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
  minimum_met BOOLEAN NOT NULL DEFAULT false,
  full_met BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'salah', 'listener')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS public.recitation_errors (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  session_id TEXT,
  surah INTEGER NOT NULL CHECK (surah > 0),
  ayah INTEGER CHECK (ayah > 0),
  word INTEGER CHECK (word > 0),
  type TEXT NOT NULL CHECK (type IN (
    'skip_word', 'wrong_word', 'added_word', 'harakah', 'skip_ayah', 'seam', 'mutashabih_drift',
    'hesitation', 'tajweed', 'waqf_ibtida'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('jali', 'khafi')),
  corrected TEXT NOT NULL CHECK (corrected IN ('self', 'tanbih', 'fath', 'none')),
  sibling_ref TEXT,
  local_date TEXT NOT NULL CHECK (local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  clean_count INTEGER NOT NULL DEFAULT 0 CHECK (clean_count >= 0),
  last_clean_date TEXT CHECK (last_clean_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.habit_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recitation_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own habit days" ON public.habit_days;
CREATE POLICY "Users can manage own habit days"
  ON public.habit_days FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage own review sessions" ON public.review_sessions;
CREATE POLICY "Users can manage own review sessions"
  ON public.review_sessions FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage own recitation errors" ON public.recitation_errors;
CREATE POLICY "Users can manage own recitation errors"
  ON public.recitation_errors FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.habit_days, public.review_sessions, public.recitation_errors FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_days, public.review_sessions, public.recitation_errors
  TO authenticated;

CREATE INDEX IF NOT EXISTS idx_habit_days_user_synced ON public.habit_days(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_review_sessions_user_synced ON public.review_sessions(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_recitation_errors_user_synced ON public.recitation_errors(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_recitation_errors_user_open
  ON public.recitation_errors(user_id, local_date) WHERE resolved_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_study_log_user_local_date ON public.study_log(user_id, local_date);

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.review_sessions;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.review_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('updated_at', 'created_at', 'synced_at');

DROP TRIGGER IF EXISTS sync_keep_newer_row ON public.recitation_errors;
CREATE TRIGGER sync_keep_newer_row BEFORE UPDATE ON public.recitation_errors
  FOR EACH ROW EXECUTE FUNCTION public.sync_keep_newer_row('updated_at', 'created_at', 'synced_at');

-- ─── Wird-day merge, identical to lib/habit/merge.ts mergeHabitDays ──────
-- DB-02 precedence: done > made_up > earned_back > excused > paused > grace.
CREATE OR REPLACE FUNCTION private.habit_status_rank(status TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE status
    WHEN 'done' THEN 6
    WHEN 'made_up' THEN 5
    WHEN 'earned_back' THEN 4
    WHEN 'excused' THEN 3
    WHEN 'paused' THEN 2
    WHEN 'grace' THEN 1
    ELSE 0
  END;
$$;

-- effectiveStatus in lib/habit/types.ts: an excuse ranks between earned_back and paused.
CREATE OR REPLACE FUNCTION private.effective_habit_status(earned TEXT, reason TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN reason IS NULL THEN earned
    WHEN earned IS NULL THEN 'excused'
    WHEN private.habit_status_rank(earned) > private.habit_status_rank('excused') THEN earned
    ELSE 'excused'
  END;
$$;

-- Every part is a maximum over a total order or an OR, so the merge is commutative, associative and
-- idempotent. Ties keep `a`, as the TypeScript merge does. String ties compare bytes (C collation),
-- which matches JavaScript's code-unit order for the ASCII session ids and IANA zone names stored here.
CREATE OR REPLACE FUNCTION private.merge_habit_day(a public.habit_days, b public.habit_days)
RETURNS public.habit_days
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  earned_cmp INTEGER;
  excuse_cmp INTEGER;
  earned public.habit_days;
  excuse public.habit_days;
  merged public.habit_days;
  left_text TEXT;
  right_text TEXT;
BEGIN
  IF a.user_id IS DISTINCT FROM b.user_id OR a.local_date IS DISTINCT FROM b.local_date THEN
    RAISE EXCEPTION 'Cannot merge different habit days';
  END IF;

  -- Earned part: precedence, then session id, then zone.
  earned_cmp := sign(private.habit_status_rank(a.earned_status) - private.habit_status_rank(b.earned_status));
  IF earned_cmp = 0 THEN
    left_text := COALESCE(a.source_session_id, '');
    right_text := COALESCE(b.source_session_id, '');
    IF left_text COLLATE "C" < right_text COLLATE "C" THEN
      earned_cmp := -1;
    ELSIF left_text COLLATE "C" > right_text COLLATE "C" THEN
      earned_cmp := 1;
    ELSE
      left_text := COALESCE(a.tz, '');
      right_text := COALESCE(b.tz, '');
      earned_cmp := CASE
        WHEN left_text COLLATE "C" < right_text COLLATE "C" THEN -1
        WHEN left_text COLLATE "C" > right_text COLLATE "C" THEN 1
        ELSE 0
      END;
    END IF;
  END IF;

  -- Excuse register: a written excuse beats none, then the later write, then the reason spelling.
  IF a.excuse_updated_at IS NULL OR b.excuse_updated_at IS NULL THEN
    excuse_cmp := (CASE WHEN a.excuse_updated_at IS NULL THEN 0 ELSE 1 END)
      - (CASE WHEN b.excuse_updated_at IS NULL THEN 0 ELSE 1 END);
  ELSIF a.excuse_updated_at < b.excuse_updated_at THEN
    excuse_cmp := -1;
  ELSIF a.excuse_updated_at > b.excuse_updated_at THEN
    excuse_cmp := 1;
  ELSE
    left_text := COALESCE(a.reason, '');
    right_text := COALESCE(b.reason, '');
    excuse_cmp := CASE
      WHEN left_text COLLATE "C" < right_text COLLATE "C" THEN -1
      WHEN left_text COLLATE "C" > right_text COLLATE "C" THEN 1
      ELSE 0
    END;
  END IF;

  earned := CASE WHEN earned_cmp >= 0 THEN a ELSE b END;
  excuse := CASE WHEN excuse_cmp >= 0 THEN a ELSE b END;

  merged := a;
  merged.earned_status := earned.earned_status;
  merged.source_session_id := earned.source_session_id;
  merged.tz := earned.tz;
  merged.reason := excuse.reason;
  merged.excuse_updated_at := excuse.excuse_updated_at;
  merged.status := private.effective_habit_status(earned.earned_status, excuse.reason);
  merged.minimum_met := COALESCE(a.minimum_met, false) OR COALESCE(b.minimum_met, false);
  merged.full_met := COALESCE(a.full_met, false) OR COALESCE(b.full_met, false);
  merged.manzil_cycle_completed := COALESCE(a.manzil_cycle_completed, false) OR COALESCE(b.manzil_cycle_completed, false);
  -- GREATEST and LEAST skip nulls, which is laterOptional for credited_through.
  merged.credited_through := GREATEST(a.credited_through, b.credited_through);
  merged.created_at := LEAST(a.created_at, b.created_at);
  merged.updated_at := GREATEST(a.updated_at, b.updated_at);
  merged.synced_at := GREATEST(a.synced_at, b.synced_at);
  RETURN merged;
END;
$$;

-- Inserts store the effective status of their own parts. An upload that meets an existing row (the
-- client's INSERT ... ON CONFLICT DO UPDATE) merges with it instead of replacing it, so an older or
-- concurrent upload still contributes. Runs as owner only to reach the private helpers.
CREATE OR REPLACE FUNCTION private.habit_days_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.minimum_met := COALESCE(NEW.minimum_met, false);
  NEW.full_met := COALESCE(NEW.full_met, false);
  NEW.manzil_cycle_completed := COALESCE(NEW.manzil_cycle_completed, false);
  IF TG_OP = 'UPDATE' THEN
    NEW := private.merge_habit_day(OLD, NEW);
  ELSE
    NEW.status := private.effective_habit_status(NEW.earned_status, NEW.reason);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS habit_days_merge ON public.habit_days;
CREATE TRIGGER habit_days_merge BEFORE INSERT OR UPDATE ON public.habit_days
  FOR EACH ROW EXECUTE FUNCTION private.habit_days_before_write();

-- ─── Profile privacy (SOC-01, ETH-07) ───────────────────────
-- is_minor and the board nickname live here, owner-only, never next to the profile's identity.
CREATE TABLE IF NOT EXISTS public.profile_privacy (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  board_joined BOOLEAN NOT NULL DEFAULT false,
  board_nickname TEXT CHECK (
    board_nickname IS NULL OR (
      char_length(board_nickname) BETWEEN 3 AND 20
      AND board_nickname = btrim(board_nickname)
      AND board_nickname !~ '[[:cntrl:]]'
    )
  ),
  show_streak BOOLEAN NOT NULL DEFAULT false,
  show_juz_completions BOOLEAN NOT NULL DEFAULT false,
  is_minor BOOLEAN NOT NULL DEFAULT false,
  -- The board's matching inputs as the user last reported them (8.13, STR-28), so a weekly pass can
  -- place users who keep studying without opening the Board tab. 0 is Sunday, as in JavaScript.
  board_week_start SMALLINT CHECK (board_week_start BETWEEN 0 AND 6),
  board_level_band TEXT CHECK (board_level_band IN ('starting', 'juz_amma', 'juz_4_15', 'juz_16_29', 'hafiz')),
  board_pace_band TEXT CHECK (board_pace_band IN ('maintenance', 'light', 'half_page', 'page_plus')),
  board_utc_offset_minutes INTEGER CHECK (board_utc_offset_minutes BETWEEN -720 AND 840),
  -- The latest board week this user was considered for, by their own read or another user's pass.
  board_enrolled_week DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- BRD-07: a minor appears on the board only under a nickname.
  CONSTRAINT profile_privacy_minor_nickname CHECK (NOT (is_minor AND board_joined AND board_nickname IS NULL)),
  CONSTRAINT profile_privacy_board_inputs CHECK (
    NOT board_joined OR (
      board_week_start IS NOT NULL AND board_level_band IS NOT NULL AND board_pace_band IS NOT NULL
      AND board_utc_offset_minutes IS NOT NULL AND board_enrolled_week IS NOT NULL
    )
  )
);

-- Users a board pass still has to place, by week start and the last week they were considered for.
CREATE INDEX IF NOT EXISTS idx_profile_privacy_board_pending
  ON public.profile_privacy(board_week_start, board_enrolled_week) WHERE board_joined;

ALTER TABLE public.profile_privacy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile privacy" ON public.profile_privacy;
CREATE POLICY "Users can read own profile privacy"
  ON public.profile_privacy FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.profile_privacy FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profile_privacy TO authenticated;

-- ETH-07: minors cannot go public. Identity stays readable for the reflection feed, except a profile
-- whose owner stated they are a minor, which only its owner reads. profile_privacy is owner-only, so
-- the policy asks this definer helper. It must not read profiles itself, or the policy would recurse.
CREATE OR REPLACE FUNCTION public.profile_identity_visible(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT target = (SELECT auth.uid())
    OR NOT EXISTS (SELECT 1 FROM public.profile_privacy AS pp WHERE pp.user_id = target AND pp.is_minor);
$$;
REVOKE ALL ON FUNCTION public.profile_identity_visible(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_identity_visible(UUID) TO anon, authenticated;

DROP POLICY IF EXISTS "Profiles are publicly readable" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are readable unless the owner is a minor" ON public.profiles;
CREATE POLICY "Profiles are readable unless the owner is a minor"
  ON public.profiles FOR SELECT
  USING (public.profile_identity_visible(id));

-- ─── Halaqa (5.7.1) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.halaqa_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'matched')),
  name TEXT CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 60),
  invite_code TEXT UNIQUE CHECK (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  level_band TEXT CHECK (level_band IN ('starting', 'juz_amma', 'juz_4_15', 'juz_16_29', 'hafiz')),
  pace_band TEXT CHECK (pace_band IN ('maintenance', 'light', 'half_page', 'page_plus')),
  utc_offset_band INTEGER CHECK (utc_offset_band BETWEEN -6 AND 7),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  -- Lets halaqa_members carry the kind, so one active matched membership per user is a constraint.
  CONSTRAINT halaqa_groups_id_kind_key UNIQUE (id, kind),
  CONSTRAINT halaqa_groups_kind_fields CHECK (
    (kind = 'invite' AND name IS NOT NULL AND invite_code IS NOT NULL
      AND level_band IS NULL AND pace_band IS NULL AND utc_offset_band IS NULL)
    OR (kind = 'matched' AND invite_code IS NULL
      AND level_band IS NOT NULL AND pace_band IS NOT NULL AND utc_offset_band IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.halaqa_members (
  group_id UUID NOT NULL,
  -- The group's kind, kept equal to it by the foreign key below.
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'matched')),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'teacher')),
  share_consistency BOOLEAN NOT NULL DEFAULT true,
  share_juz BOOLEAN NOT NULL DEFAULT true,
  share_plan_with_teachers BOOLEAN NOT NULL DEFAULT false,
  share_grades_with_teachers BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT halaqa_members_group_kind_fkey FOREIGN KEY (group_id, kind)
    REFERENCES public.halaqa_groups(id, kind) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.halaqa_encouragements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.halaqa_groups(id) ON DELETE CASCADE,
  from_user UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Fixed set, rendered in each reader's own language (MAT-01). Keep in sync with lib/halaqa/api.ts.
  template_id TEXT CHECK (template_id IN (
    'ease', 'missed_you', 'keep_going', 'small_steady', 'dua', 'together', 'welcome_back', 'well_done',
    'firm_heart'
  )),
  -- Free text only in invite halaqas (SOC-06), checked by send_halaqa_encouragement.
  body TEXT CHECK (body IS NULL OR (char_length(btrim(body)) BETWEEN 1 AND 200 AND body !~ '[[:cntrl:]]')),
  -- The sender's local date, for display only. SOC-06's one-a-day limit uses created_at, which the
  -- caller cannot choose (send_halaqa_encouragement).
  local_date TEXT NOT NULL CHECK (local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (template_id IS NOT NULL OR body IS NOT NULL),
  CHECK (from_user <> to_user)
);

-- SOC-05 review partners. The table and its read rule ship now; pairing RPCs come with the partner UI.
CREATE TABLE IF NOT EXISTS public.review_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  weekly_goal_pages INTEGER NOT NULL DEFAULT 5 CHECK (weekly_goal_pages BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CHECK (user_a < user_b)
);

CREATE INDEX IF NOT EXISTS idx_halaqa_members_user_active ON public.halaqa_members(user_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_halaqa_members_group_active ON public.halaqa_members(group_id) WHERE left_at IS NULL;
-- SOC-04: one standing matched halaqa per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_halaqa_members_one_matched
  ON public.halaqa_members(user_id) WHERE kind = 'matched' AND left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_halaqa_groups_matched
  ON public.halaqa_groups(level_band, pace_band, utc_offset_band) WHERE kind = 'matched' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_halaqa_encouragements_to_user ON public.halaqa_encouragements(to_user, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_halaqa_encouragements_sender
  ON public.halaqa_encouragements(group_id, from_user, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_partners_active_pair
  ON public.review_partners(user_a, user_b) WHERE ended_at IS NULL;

ALTER TABLE public.halaqa_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.halaqa_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.halaqa_encouragements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners can read their pairing" ON public.review_partners;
CREATE POLICY "Partners can read their pairing"
  ON public.review_partners FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (user_a, user_b));

REVOKE ALL ON public.halaqa_groups, public.halaqa_members, public.halaqa_encouragements, public.review_partners
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.review_partners TO authenticated;

-- ─── Board (5.7.2) ────────────────────────────────────────────────────────
-- week_start is the first date of the members' week (BRD-01, STR-28); its weekday is their week start.
CREATE TABLE IF NOT EXISTS public.board_cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  level_band TEXT NOT NULL CHECK (level_band IN ('starting', 'juz_amma', 'juz_4_15', 'juz_16_29', 'hafiz')),
  pace_band TEXT NOT NULL CHECK (pace_band IN ('maintenance', 'light', 'half_page', 'page_plus')),
  utc_offset_band INTEGER NOT NULL CHECK (utc_offset_band BETWEEN -6 AND 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.board_members (
  cohort_id UUID NOT NULL REFERENCES public.board_cohorts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (cohort_id, user_id),
  -- One cohort per user per week (SB-04): rejoining returns to the same cohort while it has room,
  -- and otherwise moves this row to another cohort of the week.
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_board_cohorts_week ON public.board_cohorts(week_start, level_band);
CREATE INDEX IF NOT EXISTS idx_board_members_cohort_active ON public.board_members(cohort_id) WHERE left_at IS NULL;

ALTER TABLE public.board_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.board_cohorts, public.board_members FROM PUBLIC, anon, authenticated;

-- ─── Activity and progress readers ────────────────────────────────────────
-- Juz completions are the only progress a halaqa member can share (SOC-02). Per-surah counts stay
-- with the owner (policy above).
CREATE OR REPLACE FUNCTION public.halaqa_shares_with_me(target UUID, field TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.halaqa_members AS mine
    JOIN public.halaqa_members AS theirs ON theirs.group_id = mine.group_id
    JOIN public.halaqa_groups AS g ON g.id = mine.group_id AND g.deleted_at IS NULL
    WHERE mine.user_id = (SELECT auth.uid())
      AND mine.left_at IS NULL
      AND theirs.user_id = target
      AND theirs.left_at IS NULL
      AND CASE field
        WHEN 'consistency' THEN theirs.share_consistency
        WHEN 'juz' THEN theirs.share_juz
        ELSE false
      END
  );
$$;
REVOKE ALL ON FUNCTION public.halaqa_shares_with_me(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.halaqa_shares_with_me(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Users can read own achievement unlocks" ON public.achievement_unlocks;
CREATE POLICY "Users can read own achievement unlocks"
  ON public.achievement_unlocks FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Halaqa members can read shared juz completions" ON public.achievement_unlocks;
CREATE POLICY "Halaqa members can read shared juz completions"
  ON public.achievement_unlocks FOR SELECT TO authenticated
  USING (achievement_id ~ '^juz_[0-9]{2}_completed$' AND public.halaqa_shares_with_me(user_id, 'juz'));
REVOKE ALL ON public.achievement_unlocks FROM anon;
REVOKE ALL ON public.public_surah_progress FROM anon;


-- ─── Shared helpers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.require_user()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN uid;
END;
$$;

-- The caller's local date. Every zone is within a day of UTC, so anything further is rejected.
CREATE OR REPLACE FUNCTION private.checked_local_date(value TEXT)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  parsed DATE;
  utc_today DATE := (now() AT TIME ZONE 'UTC')::DATE;
BEGIN
  IF value IS NULL OR value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'invalid_local_date';
  END IF;
  BEGIN
    parsed := value::DATE;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_local_date';
  END;
  IF parsed < utc_today - 1 OR parsed > utc_today + 1 OR to_char(parsed, 'YYYY-MM-DD') <> value THEN
    RAISE EXCEPTION 'invalid_local_date';
  END IF;
  RETURN parsed;
END;
$$;

-- Today in a stored IANA zone, or in UTC when the zone is missing or unknown.
CREATE OR REPLACE FUNCTION private.local_today(zone TEXT)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF zone IS NULL OR zone = '' THEN
    RETURN (now() AT TIME ZONE 'UTC')::DATE;
  END IF;
  RETURN (now() AT TIME ZONE zone)::DATE;
EXCEPTION WHEN OTHERS THEN
  RETURN (now() AT TIME ZONE 'UTC')::DATE;
END;
$$;

-- A member's own today, from the zone of their latest recorded wird day.
CREATE OR REPLACE FUNCTION private.member_today(member UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT private.local_today((
    SELECT h.tz FROM public.habit_days AS h
    WHERE h.user_id = member AND h.tz IS NOT NULL
    ORDER BY h.local_date DESC
    LIMIT 1
  ));
$$;

-- Current streak: consecutive covered dates (any status) ending today or yesterday. Paused days keep
-- the run without adding to it (8.2). Days after today are ignored.
CREATE OR REPLACE FUNCTION private.habit_streak(member UUID, today DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH covered AS (
    SELECT h.local_date::DATE AS covered_on, h.status
    FROM public.habit_days AS h
    WHERE h.user_id = member AND h.status IS NOT NULL AND h.local_date <= to_char(today, 'YYYY-MM-DD')
  ),
  anchor AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM covered WHERE covered_on = today) THEN today
      WHEN EXISTS (SELECT 1 FROM covered WHERE covered_on = today - 1) THEN today - 1
    END AS anchor_on
  ),
  islands AS (
    SELECT covered_on, status, covered_on - (row_number() OVER (ORDER BY covered_on))::INTEGER AS run_id
    FROM covered
  )
  SELECT COALESCE(count(*) FILTER (WHERE i.status <> 'paused'), 0)::INTEGER
  FROM islands AS i, anchor AS a
  WHERE a.anchor_on IS NOT NULL
    AND i.covered_on <= a.anchor_on
    AND i.run_id = (SELECT run_id FROM islands AS x WHERE x.covered_on = a.anchor_on);
$$;

-- PTS-02: per wird day, 1 for the minimum, +1 for the full wird, +1 for a completed manzil cycle, at
-- most 3. Only recited days count; excused, paused and grace days add nothing (SB-03). Dates more
-- than a day ahead of UTC cannot have been recited yet, so they never count.
CREATE OR REPLACE FUNCTION private.board_points(member UUID, week_start DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(sum(LEAST(3, h.minimum_met::INTEGER + h.full_met::INTEGER + h.manzil_cycle_completed::INTEGER)), 0)::INTEGER
  FROM public.habit_days AS h
  WHERE h.user_id = member
    AND h.status IN ('done', 'made_up', 'earned_back')
    AND h.local_date >= to_char(week_start, 'YYYY-MM-DD')
    AND h.local_date < to_char(week_start + 7, 'YYYY-MM-DD')
    AND h.local_date <= to_char((now() AT TIME ZONE 'UTC')::DATE + 1, 'YYYY-MM-DD');
$$;

-- Wird days in a week, Monday first, as seven booleans. Excused, paused and grace days are false
-- like any other day without a wird, so no reason or excuse is ever visible (SB-03).
CREATE OR REPLACE FUNCTION private.week_wird_days(member UUID, week_start DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_agg(
    EXISTS (
      SELECT 1 FROM public.habit_days AS h
      WHERE h.user_id = member
        AND h.local_date = to_char(week_start + offs, 'YYYY-MM-DD')
        AND h.status IN ('done', 'made_up', 'earned_back')
    )
    ORDER BY offs
  )
  FROM generate_series(0, 6) AS offs;
$$;

CREATE OR REPLACE FUNCTION private.juz_completions(member UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT count(*)::INTEGER FROM public.achievement_unlocks AS a
  WHERE a.user_id = member AND a.achievement_id ~ '^juz_[0-9]{2}_completed$';
$$;

-- 8.13 matching bands.
CREATE OR REPLACE FUNCTION private.level_band_rank(band TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE band
    WHEN 'starting' THEN 0
    WHEN 'juz_amma' THEN 1
    WHEN 'juz_4_15' THEN 2
    WHEN 'juz_16_29' THEN 3
    WHEN 'hafiz' THEN 4
  END;
$$;

-- offsetBand in lib/social/bands.ts: Math.round(minutes / 120), where halves round up.
CREATE OR REPLACE FUNCTION private.offset_band(utc_offset_minutes INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT floor(utc_offset_minutes / 120.0 + 0.5)::INTEGER;
$$;

CREATE OR REPLACE FUNCTION private.check_bands(level_band TEXT, pace_band TEXT, utc_offset_minutes INTEGER)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF private.level_band_rank(level_band) IS NULL
    OR pace_band IS NULL OR pace_band NOT IN ('maintenance', 'light', 'half_page', 'page_plus')
    OR utc_offset_minutes IS NULL OR utc_offset_minutes NOT BETWEEN -720 AND 840 THEN
    RAISE EXCEPTION 'invalid_bands';
  END IF;
END;
$$;

-- STR-28: the user's week start, 0 (Sunday) to 6 (Saturday), as lib/habit/settings.ts effectiveWeekStart.
CREATE OR REPLACE FUNCTION private.check_week_start(week_start_day INTEGER)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF week_start_day IS NULL OR week_start_day NOT BETWEEN 0 AND 6 THEN
    RAISE EXCEPTION 'invalid_week_start';
  END IF;
END;
$$;

-- The first date of the week holding `day` for a week that starts on week_start_day (BRD-01).
CREATE OR REPLACE FUNCTION private.board_week(day DATE, week_start_day INTEGER)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT day - ((extract(dow FROM day)::INTEGER - week_start_day + 7) % 7);
$$;

-- MAT-03: a pure, replayable match rule shared by board cohorts and matched halaqas. Returns the
-- preference tier of a group for a user, or NULL when the user may not join it:
--   1. same level, pace and 2-hour offset band, while the group has room;
--   2. same level and pace, offset within 3 hours;
--   3. same level, any pace, offset within 3 hours;
--   4. one level band either way, offset within 3 hours.
-- Tiers 2 to 4 widen the match (BRD-08) and only fill groups still under 10 people, so a group that
-- already has enough close matches is not diluted.
CREATE OR REPLACE FUNCTION private.match_tier(
  group_level TEXT,
  group_pace TEXT,
  group_offset_band INTEGER,
  group_size INTEGER,
  capacity INTEGER,
  user_level TEXT,
  user_pace TEXT,
  user_offset_minutes INTEGER
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN group_size >= capacity THEN NULL
    WHEN group_level = user_level AND group_pace = user_pace
      AND group_offset_band = private.offset_band(user_offset_minutes) THEN 1
    WHEN group_size >= 10 THEN NULL
    WHEN abs(group_offset_band * 120 - user_offset_minutes) > 180 THEN NULL
    WHEN group_level = user_level AND group_pace = user_pace THEN 2
    WHEN group_level = user_level THEN 3
    WHEN abs(private.level_band_rank(group_level) - private.level_band_rank(user_level)) = 1 THEN 4
  END;
$$;

CREATE OR REPLACE FUNCTION private.member_name(member UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), p.username) FROM public.profiles AS p WHERE p.id = member;
$$;

-- ─── Profile visibility RPCs ─────────────────────────────────────────────
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
    'is_minor', COALESCE(row_data.is_minor, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_profile_privacy(
  p_show_streak BOOLEAN,
  p_show_juz_completions BOOLEAN,
  p_is_minor BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  current_row public.profile_privacy;
BEGIN
  IF p_show_streak IS NULL OR p_show_juz_completions IS NULL OR p_is_minor IS NULL THEN
    RAISE EXCEPTION 'invalid_privacy';
  END IF;
  SELECT * INTO current_row FROM public.profile_privacy WHERE user_id = uid;
  IF p_is_minor AND COALESCE(current_row.board_joined, false) AND current_row.board_nickname IS NULL THEN
    RAISE EXCEPTION 'nickname_required';
  END IF;
  INSERT INTO public.profile_privacy (user_id, show_streak, show_juz_completions, is_minor, updated_at)
  VALUES (uid, p_show_streak, p_show_juz_completions, p_is_minor, now())
  ON CONFLICT (user_id) DO UPDATE SET
    show_streak = EXCLUDED.show_streak,
    show_juz_completions = EXCLUDED.show_juz_completions,
    is_minor = EXCLUDED.is_minor,
    updated_at = EXCLUDED.updated_at;
  RETURN public.get_profile_privacy();
END;
$$;

-- What a viewer may see of another person's consistency: the owner always; a halaqa member when the
-- person shared that field with the group; anyone when the person turned it on for their profile,
-- unless they stated they are a minor (ETH-07). Null fields are hidden. A minor's profile is hidden
-- as a whole from anyone but the owner and their halaqa co-members, as the profiles policy hides it.
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
  see_streak BOOLEAN;
  see_juz BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO privacy FROM public.profile_privacy WHERE user_id = p_user_id;
  IF COALESCE(privacy.is_minor, false) AND NOT is_owner AND NOT (viewer IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.halaqa_members AS mine
    JOIN public.halaqa_members AS theirs ON theirs.group_id = mine.group_id
    JOIN public.halaqa_groups AS g ON g.id = mine.group_id AND g.deleted_at IS NULL
    WHERE mine.user_id = viewer AND mine.left_at IS NULL AND theirs.user_id = p_user_id AND theirs.left_at IS NULL
  )) THEN
    RETURN NULL;
  END IF;
  see_streak := is_owner
    OR (viewer IS NOT NULL AND public.halaqa_shares_with_me(p_user_id, 'consistency'))
    OR (COALESCE(privacy.show_streak, false) AND NOT COALESCE(privacy.is_minor, false));
  see_juz := is_owner
    OR (viewer IS NOT NULL AND public.halaqa_shares_with_me(p_user_id, 'juz'))
    OR (COALESCE(privacy.show_juz_completions, false) AND NOT COALESCE(privacy.is_minor, false));
  RETURN jsonb_build_object(
    'streak', CASE WHEN see_streak THEN private.habit_streak(p_user_id, private.member_today(p_user_id)) END,
    'juz_completed', CASE WHEN see_juz THEN (
      SELECT COALESCE(jsonb_agg(substring(a.achievement_id FROM 5 FOR 2)::INTEGER ORDER BY a.achievement_id), '[]'::JSONB)
      FROM public.achievement_unlocks AS a
      WHERE a.user_id = p_user_id AND a.achievement_id ~ '^juz_[0-9]{2}_completed$'
    ) END
  );
END;
$$;

-- ─── Halaqa RPCs ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.halaqa_active_count(target_group UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT count(*)::INTEGER FROM public.halaqa_members WHERE group_id = target_group AND left_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION private.require_halaqa_member(target_group UUID, member UUID)
RETURNS public.halaqa_members
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  membership public.halaqa_members;
BEGIN
  SELECT m.* INTO membership
  FROM public.halaqa_members AS m
  JOIN public.halaqa_groups AS g ON g.id = m.group_id AND g.deleted_at IS NULL
  WHERE m.group_id = target_group AND m.user_id = member AND m.left_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = '42501';
  END IF;
  RETURN membership;
END;
$$;

CREATE OR REPLACE FUNCTION private.check_halaqa_limit(member UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF (
    SELECT count(*) FROM public.halaqa_members AS m
    JOIN public.halaqa_groups AS g ON g.id = m.group_id AND g.deleted_at IS NULL
    WHERE m.user_id = member AND m.left_at IS NULL
  ) >= 10 THEN
    RAISE EXCEPTION 'halaqa_limit';
  END IF;
END;
$$;

-- Serializes one user's halaqa joins, so the 10-group limit and the single matched halaqa are checked
-- against committed state. Taken before any group row lock.
CREATE OR REPLACE FUNCTION private.lock_halaqa_user(member UUID)
RETURNS VOID
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('hafiz:halaqa-user:' || member::TEXT, 0));
$$;

-- SOC-06: one encouragement per sender per day in each group, measured on the server's clock so the
-- caller's date cannot widen it. 20 hours lets a daily habit drift a little earlier each day.
CREATE OR REPLACE FUNCTION private.encouraged_recently(target_group UUID, sender UUID, recipient UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.halaqa_encouragements AS e
    WHERE e.group_id = target_group AND e.from_user = sender
      AND (recipient IS NULL OR e.to_user = recipient)
      AND e.created_at > now() - INTERVAL '20 hours'
  );
$$;

CREATE OR REPLACE FUNCTION private.halaqa_summary(target_group UUID, member UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', g.id,
    'kind', g.kind,
    'name', g.name,
    'invite_code', g.invite_code,
    'member_count', private.halaqa_active_count(g.id),
    'role', m.role,
    'is_creator', g.created_by = member,
    'share_consistency', m.share_consistency,
    'share_juz', m.share_juz,
    'share_plan_with_teachers', m.share_plan_with_teachers,
    'share_grades_with_teachers', m.share_grades_with_teachers
  )
  FROM public.halaqa_groups AS g
  JOIN public.halaqa_members AS m ON m.group_id = g.id AND m.user_id = member
  WHERE g.id = target_group;
$$;

CREATE OR REPLACE FUNCTION private.new_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes BYTEA := uuid_send(gen_random_uuid());
  code TEXT := '';
  i INTEGER;
BEGIN
  -- Bytes 6 and 8 carry the UUID version and variant, so use the other fully random bytes.
  FOREACH i IN ARRAY ARRAY[0, 1, 2, 3, 4, 5, 9, 10] LOOP
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  END LOOP;
  RETURN code;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_halaqas()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(private.halaqa_summary(g.id, uid) ORDER BY g.kind, m.joined_at)
    FROM public.halaqa_members AS m
    JOIN public.halaqa_groups AS g ON g.id = m.group_id AND g.deleted_at IS NULL
    WHERE m.user_id = uid AND m.left_at IS NULL
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_invite_halaqa(p_name TEXT, p_as_teacher BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  clean_name TEXT := btrim(COALESCE(p_name, ''));
  new_id UUID;
  attempt INTEGER := 0;
BEGIN
  IF char_length(clean_name) NOT BETWEEN 1 AND 60 OR clean_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  PERFORM private.lock_halaqa_user(uid);
  PERFORM private.check_halaqa_limit(uid);
  LOOP
    attempt := attempt + 1;
    BEGIN
      INSERT INTO public.halaqa_groups (kind, name, invite_code, created_by)
      VALUES ('invite', clean_name, private.new_invite_code(), uid)
      RETURNING id INTO new_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
  INSERT INTO public.halaqa_members (group_id, kind, user_id, role)
  VALUES (new_id, 'invite', uid, CASE WHEN COALESCE(p_as_teacher, false) THEN 'teacher' ELSE 'member' END);
  RETURN private.halaqa_summary(new_id, uid);
END;
$$;

-- SOC-02: invite halaqas hold up to 50 people. The group row lock orders this join with leave_halaqa,
-- so a group is never deleted as empty while someone is joining it.
CREATE OR REPLACE FUNCTION public.join_halaqa_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  target public.halaqa_groups;
  existing public.halaqa_members;
BEGIN
  PERFORM private.lock_halaqa_user(uid);
  SELECT * INTO target FROM public.halaqa_groups
  WHERE kind = 'invite' AND deleted_at IS NULL AND invite_code = upper(btrim(COALESCE(p_code, '')))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;
  SELECT * INTO existing FROM public.halaqa_members WHERE group_id = target.id AND user_id = uid;
  IF FOUND AND existing.left_at IS NULL THEN
    RETURN private.halaqa_summary(target.id, uid);
  END IF;
  PERFORM private.check_halaqa_limit(uid);
  IF private.halaqa_active_count(target.id) >= 50 THEN
    RAISE EXCEPTION 'halaqa_full';
  END IF;
  -- Rejoining keeps the earlier sharing choices but never a teacher role.
  INSERT INTO public.halaqa_members (group_id, kind, user_id, role)
  VALUES (target.id, 'invite', uid, 'member')
  ON CONFLICT (group_id, user_id) DO UPDATE SET left_at = NULL, role = 'member', joined_at = now();
  RETURN private.halaqa_summary(target.id, uid);
END;
$$;

-- Leaving takes the group row lock that joining takes before it changes membership or checks for an
-- empty group, so a join that is still committing is counted.
CREATE OR REPLACE FUNCTION public.leave_halaqa(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  PERFORM 1 FROM public.halaqa_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  PERFORM private.require_halaqa_member(p_group_id, uid);
  UPDATE public.halaqa_members SET left_at = now() WHERE group_id = p_group_id AND user_id = uid;
  IF private.halaqa_active_count(p_group_id) = 0 THEN
    UPDATE public.halaqa_groups SET deleted_at = now() WHERE id = p_group_id;
  END IF;
END;
$$;

-- SOC-04: a standing matched halaqa of about 20. Minors join only invite halaqas (ETH-07), and a
-- re-match never returns the user to a halaqa they left. The per-user lock makes concurrent requests
-- by one user find each other's membership; idx_halaqa_members_one_matched backs it.
CREATE OR REPLACE FUNCTION public.join_matched_halaqa(
  p_level_band TEXT,
  p_pace_band TEXT,
  p_utc_offset_minutes INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  chosen UUID;
BEGIN
  PERFORM private.check_bands(p_level_band, p_pace_band, p_utc_offset_minutes);
  IF COALESCE((SELECT is_minor FROM public.profile_privacy WHERE user_id = uid), false) THEN
    RAISE EXCEPTION 'minor_not_allowed';
  END IF;
  PERFORM private.lock_halaqa_user(uid);
  SELECT g.id INTO chosen
  FROM public.halaqa_members AS m
  JOIN public.halaqa_groups AS g ON g.id = m.group_id AND g.deleted_at IS NULL
  WHERE m.user_id = uid AND m.left_at IS NULL AND m.kind = 'matched'
  LIMIT 1;
  IF FOUND THEN
    RETURN private.halaqa_summary(chosen, uid);
  END IF;
  PERFORM private.check_halaqa_limit(uid);
  PERFORM pg_advisory_xact_lock(hashtextextended('hafiz:matched-halaqa', 0));

  SELECT c.id INTO chosen
  FROM (
    SELECT g.id, g.created_at, private.halaqa_active_count(g.id) AS size,
      private.match_tier(g.level_band, g.pace_band, g.utc_offset_band, private.halaqa_active_count(g.id), 20,
        p_level_band, p_pace_band, p_utc_offset_minutes) AS tier
    FROM public.halaqa_groups AS g
    WHERE g.kind = 'matched' AND g.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.halaqa_members AS left_m WHERE left_m.group_id = g.id AND left_m.user_id = uid)
  ) AS c
  WHERE c.tier IS NOT NULL
  ORDER BY c.tier, c.size DESC, c.created_at, c.id
  LIMIT 1;

  -- A last member may be leaving the chosen group right now; its row lock settles that first.
  IF chosen IS NOT NULL THEN
    SELECT id INTO chosen FROM public.halaqa_groups WHERE id = chosen AND deleted_at IS NULL FOR UPDATE;
  END IF;
  IF chosen IS NULL THEN
    INSERT INTO public.halaqa_groups (kind, level_band, pace_band, utc_offset_band, created_by)
    VALUES ('matched', p_level_band, p_pace_band, private.offset_band(p_utc_offset_minutes), uid)
    RETURNING id INTO chosen;
  END IF;
  INSERT INTO public.halaqa_members (group_id, kind, user_id, role) VALUES (chosen, 'matched', uid, 'member');
  RETURN private.halaqa_summary(chosen, uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_halaqa_sharing(
  p_group_id UUID,
  p_share_consistency BOOLEAN,
  p_share_juz BOOLEAN,
  p_share_plan_with_teachers BOOLEAN,
  p_share_grades_with_teachers BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  PERFORM private.require_halaqa_member(p_group_id, uid);
  IF p_share_consistency IS NULL OR p_share_juz IS NULL
    OR p_share_plan_with_teachers IS NULL OR p_share_grades_with_teachers IS NULL THEN
    RAISE EXCEPTION 'invalid_sharing';
  END IF;
  UPDATE public.halaqa_members SET
    share_consistency = p_share_consistency,
    share_juz = p_share_juz,
    share_plan_with_teachers = p_share_plan_with_teachers,
    share_grades_with_teachers = p_share_grades_with_teachers
  WHERE group_id = p_group_id AND user_id = uid;
  RETURN private.halaqa_summary(p_group_id, uid);
END;
$$;

-- Only the creator of an invite halaqa assigns teachers (SOC-03). Matched halaqas have none.
CREATE OR REPLACE FUNCTION public.set_halaqa_member_role(p_group_id UUID, p_member_id UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  PERFORM private.require_halaqa_member(p_group_id, uid);
  IF NOT EXISTS (
    SELECT 1 FROM public.halaqa_groups WHERE id = p_group_id AND kind = 'invite' AND created_by = uid
  ) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('member', 'teacher') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  PERFORM private.require_halaqa_member(p_group_id, p_member_id);
  UPDATE public.halaqa_members SET role = p_role WHERE group_id = p_group_id AND user_id = p_member_id;
END;
$$;

-- SOC-07: the week's shared goal is a total, with no individual ranking. Only members who share
-- their consistency contribute, so a total can never expose a member who chose not to share.
-- The target is five wird days per contributing member.
CREATE OR REPLACE FUNCTION private.halaqa_goal(target_group UUID, week_start DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH contributors AS (
    SELECT m.user_id FROM public.halaqa_members AS m
    WHERE m.group_id = target_group AND m.left_at IS NULL AND m.share_consistency
  )
  SELECT jsonb_build_object(
    'week_start', to_char(week_start, 'YYYY-MM-DD'),
    'contributors', (SELECT count(*) FROM contributors),
    'target', 5 * (SELECT count(*) FROM contributors),
    'wird_days', (
      SELECT count(*) FROM public.habit_days AS h
      JOIN contributors AS c ON c.user_id = h.user_id
      WHERE h.status IN ('done', 'made_up', 'earned_back')
        AND h.local_date >= to_char(week_start, 'YYYY-MM-DD')
        AND h.local_date < to_char(week_start + 7, 'YYYY-MM-DD')
        AND h.local_date <= to_char((now() AT TIME ZONE 'UTC')::DATE + 1, 'YYYY-MM-DD')
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_halaqa_goal(p_group_id UUID, p_today TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  today DATE := private.checked_local_date(p_today);
BEGIN
  PERFORM private.require_halaqa_member(p_group_id, uid);
  RETURN private.halaqa_goal(p_group_id, date_trunc('week', today)::DATE);
END;
$$;

-- The group view. Members see each other's wird days this week, current streak and juz completions
-- only where each member shared them (SOC-02). Never mistakes, grades or recordings.
CREATE OR REPLACE FUNCTION public.get_halaqa_detail(p_group_id UUID, p_today TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  today DATE := private.checked_local_date(p_today);
  week_start DATE := date_trunc('week', today)::DATE;
  mine public.halaqa_members;
BEGIN
  mine := private.require_halaqa_member(p_group_id, uid);
  RETURN jsonb_build_object(
    'group', private.halaqa_summary(p_group_id, uid),
    'goal', private.halaqa_goal(p_group_id, week_start),
    'members', (
      SELECT COALESCE(jsonb_agg(member ORDER BY (member->>'role') = 'teacher' DESC, member->>'name'), '[]'::JSONB)
      FROM (
        SELECT jsonb_build_object(
          'user_id', p.id,
          'name', private.member_name(p.id),
          'username', p.username,
          'avatar_url', p.avatar_url,
          'role', m.role,
          'is_me', m.user_id = uid,
          'week', CASE WHEN m.share_consistency OR m.user_id = uid THEN private.week_wird_days(m.user_id, week_start) END,
          'streak', CASE WHEN m.share_consistency OR m.user_id = uid
            THEN private.habit_streak(m.user_id, private.member_today(m.user_id)) END,
          'juz_completions', CASE WHEN m.share_juz OR m.user_id = uid THEN private.juz_completions(m.user_id) END,
          'encouraged_today', private.encouraged_recently(p_group_id, uid, m.user_id),
          'teacher_view', mine.role = 'teacher' AND m.user_id <> uid
            AND (m.share_plan_with_teachers OR m.share_grades_with_teachers)
        ) AS member
        FROM public.halaqa_members AS m
        JOIN public.profiles AS p ON p.id = m.user_id
        WHERE m.group_id = p_group_id AND m.left_at IS NULL
      ) AS members
    ),
    'encouraged_today', private.encouraged_recently(p_group_id, uid),
    'received', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id,
        'from_name', private.member_name(e.from_user),
        'template_id', e.template_id,
        'body', e.body,
        'created_at', e.created_at
      ) ORDER BY e.created_at DESC), '[]'::JSONB)
      FROM (
        SELECT * FROM public.halaqa_encouragements AS recent
        WHERE recent.group_id = p_group_id AND recent.to_user = uid AND recent.created_at > now() - INTERVAL '7 days'
        ORDER BY recent.created_at DESC
        LIMIT 20
      ) AS e
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.send_halaqa_encouragement(
  p_group_id UUID,
  p_to_user UUID,
  p_template_id TEXT,
  p_body TEXT,
  p_today TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  today DATE := private.checked_local_date(p_today);
  group_kind TEXT;
  clean_body TEXT := NULLIF(btrim(COALESCE(p_body, '')), '');
  new_id UUID;
BEGIN
  PERFORM private.require_halaqa_member(p_group_id, uid);
  IF p_to_user IS NULL OR p_to_user = uid THEN
    RAISE EXCEPTION 'invalid_recipient';
  END IF;
  BEGIN
    PERFORM private.require_halaqa_member(p_group_id, p_to_user);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'invalid_recipient';
  END;
  SELECT kind INTO group_kind FROM public.halaqa_groups WHERE id = p_group_id;
  IF clean_body IS NOT NULL AND group_kind <> 'invite' THEN
    RAISE EXCEPTION 'free_text_invite_only';
  END IF;
  IF p_template_id IS NULL AND clean_body IS NULL THEN
    RAISE EXCEPTION 'invalid_template';
  END IF;
  -- The sender's membership row lock orders concurrent sends, so the second one sees the first.
  PERFORM 1 FROM public.halaqa_members
  WHERE group_id = p_group_id AND user_id = uid AND left_at IS NULL
  FOR UPDATE;
  IF private.encouraged_recently(p_group_id, uid) THEN
    RAISE EXCEPTION 'already_encouraged_today';
  END IF;
  BEGIN
    INSERT INTO public.halaqa_encouragements (group_id, from_user, to_user, template_id, body, local_date)
    VALUES (p_group_id, uid, p_to_user, p_template_id, clean_body, to_char(today, 'YYYY-MM-DD'))
    RETURNING id INTO new_id;
  EXCEPTION
    WHEN check_violation THEN RAISE EXCEPTION 'invalid_template';
  END;
  RETURN jsonb_build_object('id', new_id);
END;
$$;

-- 5.8.2 group_encouragement: how many encouragements the caller received after p_since in the
-- halaqas they are still in, and the newest created_at seen, which the device keeps as its next
-- p_since. At most the 50 newest rows are read, through idx_halaqa_encouragements_to_user, so a
-- device that was away for long gets a capped count. With no p_since the count starts the
-- watermark; checked_at is the server's time for an inbox with nothing in it yet.
CREATE OR REPLACE FUNCTION public.get_received_encouragements_since(p_since TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'count', count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.halaqa_members AS m
        JOIN public.halaqa_groups AS g ON g.id = m.group_id AND g.deleted_at IS NULL
        WHERE m.group_id = recent.group_id AND m.user_id = uid AND m.left_at IS NULL
      )),
      'latest_created_at', max(recent.created_at),
      'checked_at', now()
    )
    FROM (
      SELECT e.group_id, e.created_at FROM public.halaqa_encouragements AS e
      WHERE e.to_user = uid AND e.created_at > COALESCE(p_since, '-infinity'::TIMESTAMPTZ)
      ORDER BY e.created_at DESC
      LIMIT 50
    ) AS recent
  );
END;
$$;

-- SOC-03: a teacher sees a member's plan and tiers, and recent grades and mistake-inbox count, each
-- only with that member's consent in this halaqa. Null sections were not shared.
CREATE OR REPLACE FUNCTION public.get_halaqa_teacher_view(p_group_id UUID, p_member_id UUID, p_today TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  today DATE := private.checked_local_date(p_today);
  mine public.halaqa_members;
  theirs public.halaqa_members;
BEGIN
  mine := private.require_halaqa_member(p_group_id, uid);
  IF mine.role <> 'teacher' OR p_member_id = uid THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  theirs := private.require_halaqa_member(p_group_id, p_member_id);
  RETURN jsonb_build_object(
    'name', private.member_name(p_member_id),
    'plan', CASE WHEN theirs.share_plan_with_teachers THEN jsonb_build_object(
      'hifz_plan', (
        SELECT s.value FROM public.user_settings AS s
        WHERE s.user_id = p_member_id AND s.key = 'hifz_plan' AND s.deleted_at IS NULL
      ),
      'tiers', (
        SELECT COALESCE(jsonb_object_agg(t.tier, t.cards), '{}'::JSONB)
        FROM (
          SELECT c.tier, count(*) AS cards FROM public.study_cards AS c
          WHERE c.user_id = p_member_id AND c.deleted_at IS NULL AND c.tier IS NOT NULL
          GROUP BY c.tier
        ) AS t
      )
    ) END,
    'grades', CASE WHEN theirs.share_grades_with_teachers THEN jsonb_build_object(
      'recent', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'card_id', l.card_id,
          'rating', l.rating,
          'grader', l.grader,
          'support_level', l.support_level,
          'local_date', l.local_date,
          'reviewed_at', l.reviewed_at
        ) ORDER BY l.reviewed_at DESC), '[]'::JSONB)
        FROM (
          SELECT * FROM public.study_log AS recent
          WHERE recent.user_id = p_member_id
          ORDER BY recent.reviewed_at DESC
          LIMIT 20
        ) AS l
      ),
      -- The inbox keeps open mistakes for 28 days (4.6).
      'mistake_inbox_count', (
        SELECT count(*) FROM public.recitation_errors AS e
        WHERE e.user_id = p_member_id AND e.resolved_at IS NULL AND e.deleted_at IS NULL
          AND e.local_date >= to_char(today - 28, 'YYYY-MM-DD')
      )
    ) END
  );
END;
$$;

-- ─── Board RPCs ──────────────────────────────────────────────────────────
-- Active members of a cohort who are still on the board. Leaving the board also closes the
-- membership, so the join only matters while a leave is still committing.
CREATE OR REPLACE FUNCTION private.board_cohort_size(cohort UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT count(*)::INTEGER
  FROM public.board_members AS bm
  JOIN public.profile_privacy AS pp ON pp.user_id = bm.user_id AND pp.board_joined
  WHERE bm.cohort_id = cohort AND bm.left_at IS NULL;
$$;

-- MAT-03, BRD-08: the best cohort of a board week for these bands, or NULL when none has room.
CREATE OR REPLACE FUNCTION private.board_choose_cohort(
  board_week DATE,
  user_level TEXT,
  user_pace TEXT,
  user_offset_minutes INTEGER,
  excluded UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.id
  FROM (
    SELECT bc.id, bc.created_at, sizes.size,
      private.match_tier(bc.level_band, bc.pace_band, bc.utc_offset_band, sizes.size, 30,
        user_level, user_pace, user_offset_minutes) AS tier
    FROM public.board_cohorts AS bc
    CROSS JOIN LATERAL (SELECT private.board_cohort_size(bc.id) AS size) AS sizes
    WHERE bc.week_start = board_week
      AND bc.id IS DISTINCT FROM excluded
      AND abs(private.level_band_rank(bc.level_band) - private.level_band_rank(user_level)) <= 1
  ) AS c
  WHERE c.tier IS NOT NULL
  ORDER BY c.tier, c.size DESC, c.created_at, c.id
  LIMIT 1;
$$;

-- Places a user in a board week's cohort, idempotently. Every change runs under the week's advisory
-- lock, so cohort choice and the capacity of 30 see committed sizes. A returning member goes back to
-- their cohort while it has room (SB-04). Otherwise their row moves to another cohort of the week by
-- the normal rules, so a user never holds two. An active membership in an overlapping week, left
-- from before the user changed their week start, is closed. Callers hold the member's
-- profile_privacy row lock and have checked board_joined under it.
CREATE OR REPLACE FUNCTION private.board_place(
  member UUID,
  board_week DATE,
  user_level TEXT,
  user_pace TEXT,
  user_offset_minutes INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  existing public.board_members;
  returning_member BOOLEAN;
  chosen UUID;
BEGIN
  SELECT cohort_id INTO chosen FROM public.board_members
  WHERE user_id = member AND week_start = board_week AND left_at IS NULL;
  IF FOUND THEN
    RETURN chosen;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hafiz:board:' || board_week::TEXT, 0));
  SELECT * INTO existing FROM public.board_members WHERE user_id = member AND week_start = board_week;
  returning_member := FOUND;
  IF returning_member AND existing.left_at IS NULL THEN
    RETURN existing.cohort_id;
  END IF;

  IF returning_member AND private.board_cohort_size(existing.cohort_id) < 30 THEN
    chosen := existing.cohort_id;
  ELSE
    chosen := private.board_choose_cohort(board_week, user_level, user_pace, user_offset_minutes, existing.cohort_id);
  END IF;
  IF chosen IS NULL THEN
    INSERT INTO public.board_cohorts (week_start, level_band, pace_band, utc_offset_band)
    VALUES (board_week, user_level, user_pace, private.offset_band(user_offset_minutes))
    RETURNING id INTO chosen;
  END IF;

  IF returning_member THEN
    UPDATE public.board_members
    SET cohort_id = chosen, left_at = NULL, joined_at = CASE WHEN cohort_id = chosen THEN joined_at ELSE now() END
    WHERE user_id = member AND week_start = board_week;
  ELSE
    INSERT INTO public.board_members (cohort_id, user_id, week_start) VALUES (chosen, member, board_week);
  END IF;
  UPDATE public.board_members SET left_at = now()
  WHERE user_id = member AND left_at IS NULL AND week_start <> board_week
    AND week_start > board_week - 7 AND week_start < board_week + 7;
  RETURN chosen;
END;
$$;

-- The weekly placement (BRD-01, MAT-03) without cron. Each board read continues it for the reader's
-- week: up to 100 joined users who share that week start and were not yet considered for the week
-- are placed from the bands they last reported. Users with no synced wird day in the two weeks
-- before are only marked as considered, so people who stopped using the app do not fill cohorts;
-- their own next board read places them. Rows another transaction holds (that user reading, joining
-- or leaving the board) are skipped and left to it. idx_profile_privacy_board_pending serves the
-- scan in this order, so a pass reads at most 100 candidates.
CREATE OR REPLACE FUNCTION private.board_enroll_pending(board_week DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  candidate public.profile_privacy;
  placed INTEGER := 0;
BEGIN
  FOR candidate IN
    SELECT * FROM public.profile_privacy AS pp
    WHERE pp.board_joined
      AND pp.board_week_start = extract(dow FROM board_week)::INTEGER
      AND pp.board_enrolled_week < board_week
    ORDER BY pp.board_enrolled_week, pp.user_id
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.habit_days AS h
      WHERE h.user_id = candidate.user_id
        AND h.status IS NOT NULL
        AND h.local_date >= to_char(board_week - 14, 'YYYY-MM-DD')
    ) THEN
      PERFORM private.board_place(candidate.user_id, board_week, candidate.board_level_band,
        candidate.board_pace_band, candidate.board_utc_offset_minutes);
      placed := placed + 1;
    END IF;
    UPDATE public.profile_privacy SET board_enrolled_week = board_week WHERE user_id = candidate.user_id;
  END LOOP;
  RETURN placed;
END;
$$;

-- BRD-05, BRD-07, BRD-08: standings show only when the cohort has at least 5 people. Each row has a
-- nickname or display name, weekly points and current streak. The avatar is never shown for a minor
-- or under a nickname, since a photo would identify the person behind it. No user ids are returned.
-- Only members still on the board are listed.
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
            CASE WHEN pp.board_nickname IS NULL AND NOT pp.is_minor THEN p.avatar_url END AS avatar_url,
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

-- Called when the Board tab opens. The client sends its bands and offset (8.13), its local date and
-- its week start (STR-28); the server picks the cohort and computes every score. The caller's
-- profile_privacy row lock is the one leave_board and join_board take, so the consent read here
-- holds until this placement commits.
CREATE OR REPLACE FUNCTION public.get_board(
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
  board_week DATE;
  privacy public.profile_privacy;
  cohort UUID;
BEGIN
  PERFORM private.check_bands(p_level_band, p_pace_band, p_utc_offset_minutes);
  PERFORM private.check_week_start(p_week_start);
  board_week := private.board_week(today, p_week_start);
  SELECT * INTO privacy FROM public.profile_privacy WHERE user_id = uid FOR UPDATE;
  IF NOT COALESCE(privacy.board_joined, false) THEN
    RETURN jsonb_build_object('status', 'not_joined', 'week_start', to_char(board_week, 'YYYY-MM-DD'));
  END IF;
  UPDATE public.profile_privacy SET
    board_week_start = p_week_start,
    board_level_band = p_level_band,
    board_pace_band = p_pace_band,
    board_utc_offset_minutes = p_utc_offset_minutes,
    board_enrolled_week = GREATEST(board_enrolled_week, board_week)
  WHERE user_id = uid
    AND (board_week_start, board_level_band, board_pace_band, board_utc_offset_minutes, board_enrolled_week)
      IS DISTINCT FROM (p_week_start, p_level_band, p_pace_band, p_utc_offset_minutes, GREATEST(board_enrolled_week, board_week));
  cohort := private.board_place(uid, board_week, p_level_band, p_pace_band, p_utc_offset_minutes);
  PERFORM private.board_enroll_pending(board_week);
  RETURN private.board_view(uid, board_week, cohort);
END;
$$;

-- BRD-04: opt-in from the Board tab, optionally under a nickname. A minor must use one (BRD-07).
CREATE OR REPLACE FUNCTION public.join_board(
  p_nickname TEXT,
  p_is_minor BOOLEAN,
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
  minor BOOLEAN := COALESCE(p_is_minor, false);
BEGIN
  PERFORM private.check_bands(p_level_band, p_pace_band, p_utc_offset_minutes);
  PERFORM private.check_week_start(p_week_start);
  IF clean_nickname IS NOT NULL AND (char_length(clean_nickname) NOT BETWEEN 3 AND 20 OR clean_nickname ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'invalid_nickname';
  END IF;
  IF minor AND clean_nickname IS NULL THEN
    RAISE EXCEPTION 'nickname_required';
  END IF;
  INSERT INTO public.profile_privacy (user_id, board_joined, board_nickname, is_minor, board_week_start,
    board_level_band, board_pace_band, board_utc_offset_minutes, board_enrolled_week, updated_at)
  VALUES (uid, true, clean_nickname, minor, p_week_start, p_level_band, p_pace_band, p_utc_offset_minutes,
    private.board_week(today, p_week_start), now())
  ON CONFLICT (user_id) DO UPDATE SET
    board_joined = true,
    board_nickname = EXCLUDED.board_nickname,
    is_minor = EXCLUDED.is_minor,
    board_week_start = EXCLUDED.board_week_start,
    board_level_band = EXCLUDED.board_level_band,
    board_pace_band = EXCLUDED.board_pace_band,
    board_utc_offset_minutes = EXCLUDED.board_utc_offset_minutes,
    board_enrolled_week = GREATEST(public.profile_privacy.board_enrolled_week, EXCLUDED.board_enrolled_week),
    updated_at = EXCLUDED.updated_at;
  RETURN public.get_board(p_level_band, p_pace_band, p_utc_offset_minutes, p_today, p_week_start);
END;
$$;

-- One tap: off the board and out of every cohort. The first update takes the caller's
-- profile_privacy row lock, which a board read holds while it places, so a read in flight either
-- commits its placement first, which the second update then closes, or reads board_joined = false.
CREATE OR REPLACE FUNCTION public.leave_board()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  UPDATE public.profile_privacy SET board_joined = false, updated_at = now() WHERE user_id = uid;
  UPDATE public.board_members SET left_at = now() WHERE user_id = uid AND left_at IS NULL;
END;
$$;

-- ─── Function privileges ─────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  private.habit_status_rank(TEXT),
  private.effective_habit_status(TEXT, TEXT),
  private.merge_habit_day(public.habit_days, public.habit_days),
  private.habit_days_before_write(),
  private.require_user(),
  private.checked_local_date(TEXT),
  private.local_today(TEXT),
  private.member_today(UUID),
  private.habit_streak(UUID, DATE),
  private.board_points(UUID, DATE),
  private.week_wird_days(UUID, DATE),
  private.juz_completions(UUID),
  private.level_band_rank(TEXT),
  private.offset_band(INTEGER),
  private.check_bands(TEXT, TEXT, INTEGER),
  private.check_week_start(INTEGER),
  private.board_week(DATE, INTEGER),
  private.match_tier(TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER),
  private.member_name(UUID),
  private.halaqa_active_count(UUID),
  private.require_halaqa_member(UUID, UUID),
  private.check_halaqa_limit(UUID),
  private.lock_halaqa_user(UUID),
  private.encouraged_recently(UUID, UUID, UUID),
  private.halaqa_summary(UUID, UUID),
  private.new_invite_code(),
  private.halaqa_goal(UUID, DATE),
  private.board_cohort_size(UUID),
  private.board_choose_cohort(DATE, TEXT, TEXT, INTEGER, UUID),
  private.board_place(UUID, DATE, TEXT, TEXT, INTEGER),
  private.board_enroll_pending(DATE),
  private.board_view(UUID, DATE, UUID)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.get_profile_privacy(),
  public.set_profile_privacy(BOOLEAN, BOOLEAN, BOOLEAN),
  public.get_profile_summary(UUID),
  public.get_my_halaqas(),
  public.create_invite_halaqa(TEXT, BOOLEAN),
  public.join_halaqa_by_code(TEXT),
  public.leave_halaqa(UUID),
  public.join_matched_halaqa(TEXT, TEXT, INTEGER),
  public.set_halaqa_sharing(UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN),
  public.set_halaqa_member_role(UUID, UUID, TEXT),
  public.get_halaqa_goal(UUID, TEXT),
  public.get_halaqa_detail(UUID, TEXT),
  public.send_halaqa_encouragement(UUID, UUID, TEXT, TEXT, TEXT),
  public.get_received_encouragements_since(TIMESTAMPTZ),
  public.get_halaqa_teacher_view(UUID, UUID, TEXT),
  public.get_board(TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.join_board(TEXT, BOOLEAN, TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.leave_board()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.get_profile_privacy(),
  public.set_profile_privacy(BOOLEAN, BOOLEAN, BOOLEAN),
  public.get_profile_summary(UUID),
  public.get_my_halaqas(),
  public.create_invite_halaqa(TEXT, BOOLEAN),
  public.join_halaqa_by_code(TEXT),
  public.leave_halaqa(UUID),
  public.join_matched_halaqa(TEXT, TEXT, INTEGER),
  public.set_halaqa_sharing(UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN),
  public.set_halaqa_member_role(UUID, UUID, TEXT),
  public.get_halaqa_goal(UUID, TEXT),
  public.get_halaqa_detail(UUID, TEXT),
  public.send_halaqa_encouragement(UUID, UUID, TEXT, TEXT, TEXT),
  public.get_received_encouragements_since(TIMESTAMPTZ),
  public.get_halaqa_teacher_view(UUID, UUID, TEXT),
  public.get_board(TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.join_board(TEXT, BOOLEAN, TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.leave_board()
TO authenticated;

-- A profile's opted-in streak and juz completions are public (SOC-01), so signed-out viewers may ask.
GRANT EXECUTE ON FUNCTION public.get_profile_summary(UUID) TO anon;
