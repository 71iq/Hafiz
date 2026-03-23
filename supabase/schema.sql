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

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_study_cards_user_due ON study_cards(user_id, due);
CREATE INDEX IF NOT EXISTS idx_study_log_user_reviewed ON study_log(user_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_daily_scores_user_date ON daily_scores(user_id, date);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user ON highlights(user_id);
