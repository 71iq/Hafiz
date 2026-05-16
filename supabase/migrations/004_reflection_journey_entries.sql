CREATE TABLE IF NOT EXISTS reflection_journey_entries (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  level_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'completed')),
  response_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, level_id)
);

ALTER TABLE reflection_journey_entries ENABLE ROW LEVEL SECURITY;

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

CREATE INDEX IF NOT EXISTS idx_reflection_journey_entries_user_updated
  ON reflection_journey_entries(user_id, updated_at);
