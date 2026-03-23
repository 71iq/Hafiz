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
  total_score INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  cards_reviewed INTEGER DEFAULT 0,
  last_review_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Daily Scores ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_scores (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  score INTEGER DEFAULT 0,
  reviews_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
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
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
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
  PRIMARY KEY (user_id, id)
);

-- ─── Bookmarks (synced from local SQLite) ────────────────────
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, surah, ayah)
);

-- ─── Highlights (synced from local SQLite) ───────────────────
CREATE TABLE IF NOT EXISTS highlights (
  id BIGSERIAL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  word_start INTEGER,
  word_end INTEGER,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- ============================================================
-- Row Level Security (RLS) Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;

-- ─── Profiles: publicly readable (for leaderboard), writable only by owner
CREATE POLICY "Profiles are publicly readable"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ─── Daily Scores: publicly readable (for leaderboard), writable only by owner
CREATE POLICY "Daily scores are publicly readable"
  ON daily_scores FOR SELECT
  USING (true);

CREATE POLICY "Users can manage own daily scores"
  ON daily_scores FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

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

-- ─── Reflections (Community Feature) ────────────────────────
CREATE TABLE IF NOT EXISTS reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah_start INTEGER NOT NULL,
  ayah_end INTEGER NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 10 AND 5000),
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
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
  created_at TIMESTAMPTZ DEFAULT now()
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
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

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

-- ─── Reflection Likes: publicly readable, auth required to write
CREATE POLICY "Likes are publicly readable"
  ON reflection_likes FOR SELECT
  USING (true);

CREATE POLICY "Users can manage own likes"
  ON reflection_likes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Reflection Comments: publicly readable, auth required to write
CREATE POLICY "Comments are publicly readable"
  ON reflection_comments FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own comments"
  ON reflection_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own comments"
  ON reflection_comments FOR DELETE
  USING (auth.uid() = user_id);

-- ─── Reports: only author can see own, insert requires auth
CREATE POLICY "Users can see own reports"
  ON reports FOR SELECT
  USING (auth.uid() = reporter_id);

CREATE POLICY "Users can insert reports"
  ON reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

-- ─── Trigger: auto-update likes_count on reflections ────────
CREATE OR REPLACE FUNCTION update_reflection_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE reflections SET likes_count = likes_count + 1 WHERE id = NEW.reflection_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE reflections SET likes_count = likes_count - 1 WHERE id = OLD.reflection_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reflection_likes_count ON reflection_likes;
CREATE TRIGGER trg_reflection_likes_count
  AFTER INSERT OR DELETE ON reflection_likes
  FOR EACH ROW EXECUTE FUNCTION update_reflection_likes_count();

-- ─── Trigger: auto-update comments_count on reflections ─────
CREATE OR REPLACE FUNCTION update_reflection_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE reflections SET comments_count = comments_count + 1 WHERE id = NEW.reflection_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE reflections SET comments_count = comments_count - 1 WHERE id = OLD.reflection_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reflection_comments_count ON reflection_comments;
CREATE TRIGGER trg_reflection_comments_count
  AFTER INSERT OR DELETE ON reflection_comments
  FOR EACH ROW EXECUTE FUNCTION update_reflection_comments_count();

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_study_cards_user_due ON study_cards(user_id, due);
CREATE INDEX IF NOT EXISTS idx_study_log_user_reviewed ON study_log(user_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_daily_scores_user_date ON daily_scores(user_id, date);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user ON highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_reflections_ayah ON reflections(surah, ayah_start, ayah_end);
CREATE INDEX IF NOT EXISTS idx_reflections_user ON reflections(user_id);
CREATE INDEX IF NOT EXISTS idx_reflection_likes_reflection ON reflection_likes(reflection_id);
CREATE INDEX IF NOT EXISTS idx_reflection_comments_reflection ON reflection_comments(reflection_id);
CREATE INDEX IF NOT EXISTS idx_reports_reflection ON reports(reflection_id);
