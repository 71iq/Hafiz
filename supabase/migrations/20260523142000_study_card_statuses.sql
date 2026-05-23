ALTER TABLE study_cards
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS buried_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_study_cards_user_buried
  ON study_cards(user_id, buried_until);

CREATE INDEX IF NOT EXISTS idx_study_cards_user_marked
  ON study_cards(user_id, marked_at);
