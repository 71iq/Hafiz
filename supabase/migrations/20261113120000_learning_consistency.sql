-- Learning and consistency: wird-day sync, private-by-default social data, halaqa groups and the
-- weekly board (spec 5.6, 5.7, 7.1, 7.5). Hafiz has no users yet, so the schema is reshaped directly:
-- no backfills, compatibility views or notices.
--
-- Privacy model (SOC-01, ETH-07):
-- - profiles keeps only identity (username, display name, avatar, bio, country), which the public
--   reflection feed needs. Totals and client-written streaks are dropped. A profile whose owner
--   stated they are a minor is readable only by its owner; halaqa co-members see the name through
--   the halaqa RPCs and the board shows only the nickname (BRD-07). A minor has no photo and no
--   matched halaqa: stating it clears the avatar and leaves matched halaqas, whose members are
--   strangers, and the public avatars bucket refuses their uploads. Invite halaqas stay.
-- - Helpers that RLS policies call live in the rls schema, which PostgREST does not expose, so a
--   client cannot call them as RPCs.
-- - Board and visibility choices live in profile_privacy, readable only by the owner, because
--   is_minor or a nickname next to a username must never be public.
-- - Activity and progress data are readable by their owner, or by halaqa members the owner shared
--   that field with. Board fields are returned only by the board RPC to members of the same cohort.
-- - Halaqa and board tables have RLS with no client policies. Every read and write goes through the
--   SECURITY DEFINER RPCs below, which check auth.uid() themselves.
-- - Board points come only from synced habit_days (PTS-02, PTS-05, SB-04). Excused and grace days
--   never add points and their reason never leaves the owner's rows (SB-03).
--
-- Board weeks start on each user's own week start (BRD-01, STR-28), which the client sends and the
-- server stores with the board choice. Cohorts are keyed by their week's first date, so users with
-- different week starts never share one. There is no cron on the self-hosted stack: a board read
-- places its caller and, in the same pass, a bounded batch of other joined users with the same week
-- start who have not been placed for that week yet, from the bands they last reported. The app
-- reports changed bands (refresh_board_bands), and a user skipped for inactivity returns to the
-- queue with their next synced wird day.
--
-- Concurrency: each user's board placement, joining and leaving serialize on that user's
-- profile_privacy row; cohort choice and capacity serialize on one advisory lock per board week.
-- Halaqa joins serialize on one advisory lock per user. Joining, leaving and sending encouragement
-- lock the group row first and then a membership row. Recording minority locks the user's profiles
-- row, then their halaqa lock, then their profile_privacy row, and then leaves matched halaqas group
-- row first (private.lock_minor_change).

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- Helpers that RLS policies call. anon and authenticated need USAGE to evaluate those policies, but
-- PostgREST exposes only public, so no client can call these as RPCs.
CREATE SCHEMA IF NOT EXISTS rls;
REVOKE ALL ON SCHEMA rls FROM PUBLIC;
GRANT USAGE ON SCHEMA rls TO anon, authenticated;

-- ─── 1. Review detail on existing sync tables (7.1) ──────────────────────────
ALTER TABLE public.study_log
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER CHECK (duration_ms >= 0),
  ADD COLUMN IF NOT EXISTS support_level SMALLINT CHECK (support_level BETWEEN 0 AND 4),
  ADD COLUMN IF NOT EXISTS proposed_rating SMALLINT CHECK (proposed_rating BETWEEN 0 AND 4),
  ADD COLUMN IF NOT EXISTS grader TEXT CHECK (grader IN ('self', 'teacher', 'salah', 'asr')),
  -- Nullable: older clients omit it.
  ADD COLUMN IF NOT EXISTS local_date TEXT CHECK (local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  ADD COLUMN IF NOT EXISTS tz TEXT,
  ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  -- STR-08: the missed day a review was graded toward while it could still be made up. The
  -- attribution travels with the review, so every device credits it to the same day.
  ADD COLUMN IF NOT EXISTS makeup_for TEXT CHECK (makeup_for ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

ALTER TABLE public.study_cards
  ADD COLUMN IF NOT EXISTS tier TEXT
    CHECK (tier IN ('sabaq', 'sabqi', 'manzil', 'manzil.needs_work', 'manzil.unverified')),
  ADD COLUMN IF NOT EXISTS tier_changed_at TIMESTAMPTZ;

-- ─── 2. Wird days (DB-02) ────────────────────────────────────────────────────
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

-- ─── 3. Review sessions and recitation errors (DB-03, last write wins) ───────
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

-- ─── 4. Wird-day merge, identical to lib/habit/merge.ts mergeHabitDays ──────
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

-- ─── 5. Points rework and privacy (5.6, SB-01..04, SOC-01, ETH-07) ───────────
-- Client-written scores and totals are gone. Board points are computed from habit_days.
DROP TABLE IF EXISTS public.daily_scores;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS total_score,
  DROP COLUMN IF EXISTS cards_reviewed,
  DROP COLUMN IF EXISTS current_streak,
  DROP COLUMN IF EXISTS longest_streak,
  DROP COLUMN IF EXISTS last_review_date;

-- Review-count aggregates revealed quantity and used UTC days (DAY-02). The owner has the same data
-- on the device and habit_days now carries consistency, so they are retired with their triggers.
DROP TRIGGER IF EXISTS study_log_public_review_stats_insert ON public.study_log;
DROP TRIGGER IF EXISTS study_log_public_review_stats_update ON public.study_log;
DROP TRIGGER IF EXISTS study_log_public_review_stats_delete ON public.study_log;
DROP FUNCTION IF EXISTS private.refresh_public_review_stats_after_study_log_insert();
DROP FUNCTION IF EXISTS private.refresh_public_review_stats_after_study_log_update();
DROP FUNCTION IF EXISTS private.refresh_public_review_stats_after_study_log_delete();
DROP FUNCTION IF EXISTS private.refresh_public_review_stats_for_user(UUID);
DROP TABLE IF EXISTS public.public_review_activity;
DROP TABLE IF EXISTS public.public_review_stats;

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
  -- A pass found no recent wird day and left this user unplaced for board_enrolled_week. Their next
  -- synced wird day returns them to the queue (private.requeue_board_after_wird_day).
  board_waiting BOOLEAN NOT NULL DEFAULT false,
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
-- It answers for any user id, so it stays out of public, where anon could call it as an RPC and
-- learn who is a minor.
CREATE OR REPLACE FUNCTION rls.profile_identity_visible(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT target = (SELECT auth.uid())
    OR NOT EXISTS (SELECT 1 FROM public.profile_privacy AS pp WHERE pp.user_id = target AND pp.is_minor);
$$;
REVOKE ALL ON FUNCTION rls.profile_identity_visible(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rls.profile_identity_visible(UUID) TO anon, authenticated;

DROP POLICY IF EXISTS "Profiles are publicly readable" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are readable unless the owner is a minor" ON public.profiles;
CREATE POLICY "Profiles are readable unless the owner is a minor"
  ON public.profiles FOR SELECT
  USING (rls.profile_identity_visible(id));
DROP FUNCTION IF EXISTS public.profile_identity_visible(UUID);

-- ETH-07: a minor's photo never goes public. The avatars bucket is public, so a stated minor may not
-- upload or replace an avatar there (deleting stays allowed). Stating it clears the profile's photo
-- in the same transaction. The app deletes the stored files before it records minority, once more
-- after, and once per app session while the account is a minor (lib/profile/privacy.ts).
CREATE OR REPLACE FUNCTION rls.caller_is_minor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profile_privacy AS pp WHERE pp.user_id = (SELECT auth.uid()) AND pp.is_minor);
$$;
REVOKE ALL ON FUNCTION rls.caller_is_minor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rls.caller_is_minor() TO authenticated;

DROP POLICY IF EXISTS "Users can upload own avatar images" ON storage.objects;
CREATE POLICY "Users can upload own avatar images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT rls.caller_is_minor()
  );

DROP POLICY IF EXISTS "Users can update own avatar images" ON storage.objects;
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
    AND NOT rls.caller_is_minor()
  );

-- Whether a person stated they are a minor, for definer functions that return someone else's details.
CREATE OR REPLACE FUNCTION private.is_minor(member UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profile_privacy AS pp WHERE pp.user_id = member AND pp.is_minor);
$$;

-- Every write that records minority (set_profile_privacy, join_board) calls this before it writes
-- and holds both locks until it commits:
-- - The profiles row. A photo update in progress holds it, so the minority write waits for that
--   update to commit and then clears its photo. A photo update that comes later waits on the row,
--   and profiles_minor_photo then reads the committed minority. FOR NO KEY UPDATE conflicts with that
--   update but not with the key-share locks that foreign keys take, so an encouragement, membership
--   or sync insert that references this profile does not wait on it.
-- - The user's halaqa lock, which join_matched_halaqa takes before it checks minority. A matched join
--   either commits first, and private.apply_minor_privacy then leaves that halaqa, or reads the
--   committed minority and is refused.
-- Nothing takes these locks in the other order: halaqa joins take the halaqa lock and only key-share
-- the profile, and board reads and writes take the profile_privacy row, which this write takes last.
CREATE OR REPLACE FUNCTION private.lock_minor_change(member UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = member FOR NO KEY UPDATE;
  PERFORM private.lock_halaqa_user(member);
END;
$$;

-- Runs for every write that sets is_minor, whichever path made it. The photo is cleared without
-- checking it first, so the update waits on a photo update still in progress and clears the photo it
-- commits. Matched halaqas are left as leave_halaqa leaves them (ETH-07): their members are
-- strangers. Invite halaqas hold people the minor chose, and stay.
CREATE OR REPLACE FUNCTION private.apply_minor_privacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  matched UUID;
BEGIN
  UPDATE public.profiles SET avatar_url = NULL WHERE id = NEW.user_id;
  FOR matched IN
    SELECT m.group_id FROM public.halaqa_members AS m
    WHERE m.user_id = NEW.user_id AND m.kind = 'matched' AND m.left_at IS NULL
  LOOP
    PERFORM private.halaqa_leave(matched, NEW.user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

-- Earlier drafts of this migration used these names.
DROP TRIGGER IF EXISTS profile_privacy_minor_avatar ON public.profile_privacy;
DROP FUNCTION IF EXISTS private.clear_minor_avatar();
DROP TRIGGER IF EXISTS profile_privacy_minor ON public.profile_privacy;
CREATE TRIGGER profile_privacy_minor AFTER INSERT OR UPDATE OF is_minor ON public.profile_privacy
  FOR EACH ROW WHEN (NEW.is_minor) EXECUTE FUNCTION private.apply_minor_privacy();

-- A minor's profile never keeps a photo, whatever URL a client writes (ETH-07): the avatars bucket
-- refuses their uploads, and this covers an outside image URL set directly on the profile. A BEFORE
-- trigger runs once the row is locked, so an update that waited on a minority write reads it.
CREATE OR REPLACE FUNCTION private.profiles_minor_photo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.avatar_url IS NOT NULL AND private.is_minor(NEW.id) THEN
    NEW.avatar_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_minor_photo ON public.profiles;
CREATE TRIGGER profiles_minor_photo BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.profiles_minor_photo();

-- ─── 6. Halaqa (5.7.1) ───────────────────────────────────────────────────────
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
  -- The sender's local date as their device sent it, for display only.
  local_date TEXT NOT NULL CHECK (local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  -- SOC-06: the sender's calendar day by the server's clock in their stored zone
  -- (private.member_today), which the caller cannot choose. One send per group, sender and day.
  sent_on DATE NOT NULL,
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
-- Serves get_received_encouragements' (created_at, id) cursor.
CREATE INDEX IF NOT EXISTS idx_halaqa_encouragements_to_user ON public.halaqa_encouragements(to_user, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_halaqa_encouragements_sender_day
  ON public.halaqa_encouragements(group_id, from_user, sent_on);
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

-- ─── 7. Board (5.7.2) ────────────────────────────────────────────────────────
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

-- ─── 8. Activity and progress readers ────────────────────────────────────────
-- Juz completions are the only progress a halaqa member can share (SOC-02). Per-surah counts stay
-- with the owner.
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

DROP POLICY IF EXISTS "Achievement unlocks are publicly readable" ON public.achievement_unlocks;
DROP POLICY IF EXISTS "Users can read own achievement unlocks" ON public.achievement_unlocks;
CREATE POLICY "Users can read own achievement unlocks"
  ON public.achievement_unlocks FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Halaqa members can read shared juz completions" ON public.achievement_unlocks;
CREATE POLICY "Halaqa members can read shared juz completions"
  ON public.achievement_unlocks FOR SELECT TO authenticated
  USING (achievement_id ~ '^juz_[0-9]{2}_completed$' AND public.halaqa_shares_with_me(user_id, 'juz'));
REVOKE ALL ON public.achievement_unlocks FROM anon;

DROP POLICY IF EXISTS "Public surah progress is publicly readable" ON public.public_surah_progress;
DROP POLICY IF EXISTS "Users can read own surah progress" ON public.public_surah_progress;
CREATE POLICY "Users can read own surah progress"
  ON public.public_surah_progress FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.public_surah_progress FROM anon;

-- ─── 9. Shared helpers ───────────────────────────────────────────────────────
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

-- ─── 10. Profile visibility RPCs ─────────────────────────────────────────────
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
  -- Recording minority clears the photo and leaves matched halaqas (private.apply_minor_privacy).
  IF p_is_minor THEN
    PERFORM private.lock_minor_change(uid);
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

-- ─── 11. Halaqa RPCs ─────────────────────────────────────────────────────────
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

-- SOC-06: one encouragement per sender per calendar day in each group. `today` is the sender's day
-- by the server (private.member_today). A send on a later day also counts: that day can only come
-- from the sender's stored zone moving west, which must not open a second send.
CREATE OR REPLACE FUNCTION private.encouraged_today(target_group UUID, sender UUID, today DATE, recipient UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.halaqa_encouragements AS e
    WHERE e.group_id = target_group AND e.from_user = sender AND e.sent_on >= today
      AND (recipient IS NULL OR e.to_user = recipient)
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
-- empty group, so a join that is still committing is counted. False when the member was not in the
-- group. leave_halaqa and recording minority (private.apply_minor_privacy) both leave through this.
CREATE OR REPLACE FUNCTION private.halaqa_leave(target_group UUID, member UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.halaqa_groups WHERE id = target_group AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.halaqa_members SET left_at = now()
  WHERE group_id = target_group AND user_id = member AND left_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF private.halaqa_active_count(target_group) = 0 THEN
    UPDATE public.halaqa_groups SET deleted_at = now() WHERE id = target_group;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_halaqa(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  IF NOT private.halaqa_leave(p_group_id, uid) THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- SOC-04: a standing matched halaqa of about 20. Minors join only invite halaqas (ETH-07), and a
-- re-match never returns the user to a halaqa they left. The per-user lock makes concurrent requests
-- by one user find each other's membership; idx_halaqa_members_one_matched backs it. Minority is
-- checked under that lock, which recording minority also takes (private.lock_minor_change), so a join
-- either commits before a minority write, which then leaves the halaqa, or is refused.
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
  PERFORM private.lock_halaqa_user(uid);
  IF private.is_minor(uid) THEN
    RAISE EXCEPTION 'minor_not_allowed';
  END IF;
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
  sender_day DATE := private.member_today(uid);
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
          -- A minor has no photo (ETH-07), even if one were ever stored.
          'avatar_url', CASE WHEN NOT private.is_minor(p.id) THEN p.avatar_url END,
          'role', m.role,
          'is_me', m.user_id = uid,
          'week', CASE WHEN m.share_consistency OR m.user_id = uid THEN private.week_wird_days(m.user_id, week_start) END,
          'streak', CASE WHEN m.share_consistency OR m.user_id = uid
            THEN private.habit_streak(m.user_id, private.member_today(m.user_id)) END,
          'juz_completions', CASE WHEN m.share_juz OR m.user_id = uid THEN private.juz_completions(m.user_id) END,
          'encouraged_today', private.encouraged_today(p_group_id, uid, sender_day, m.user_id),
          'teacher_view', mine.role = 'teacher' AND m.user_id <> uid
            AND (m.share_plan_with_teachers OR m.share_grades_with_teachers)
        ) AS member
        FROM public.halaqa_members AS m
        JOIN public.profiles AS p ON p.id = m.user_id
        WHERE m.group_id = p_group_id AND m.left_at IS NULL
      ) AS members
    ),
    'encouraged_today', private.encouraged_today(p_group_id, uid, sender_day),
    'received', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id,
        -- A minor who has left this matched halaqa is not named to the strangers in it (ETH-07).
        'from_name', CASE WHEN mine.kind = 'matched' AND private.is_minor(e.from_user) THEN NULL
          ELSE private.member_name(e.from_user) END,
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
  sender_day DATE;
  clean_body TEXT := NULLIF(btrim(COALESCE(p_body, '')), '');
  new_id UUID;
BEGIN
  -- The group row, then the sender's membership row: the order leave_halaqa and the joins use, so a
  -- send and a leave cannot deadlock. Membership is checked under both locks, so a sender who is
  -- leaving cannot send, and concurrent sends by one sender see each other.
  SELECT kind INTO group_kind FROM public.halaqa_groups WHERE id = p_group_id AND deleted_at IS NULL FOR SHARE;
  PERFORM 1 FROM public.halaqa_members
  WHERE group_id = p_group_id AND user_id = uid AND left_at IS NULL
  FOR UPDATE;
  IF group_kind IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = '42501';
  END IF;
  IF p_to_user IS NULL OR p_to_user = uid THEN
    RAISE EXCEPTION 'invalid_recipient';
  END IF;
  BEGIN
    PERFORM private.require_halaqa_member(p_group_id, p_to_user);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'invalid_recipient';
  END;
  IF clean_body IS NOT NULL AND group_kind <> 'invite' THEN
    RAISE EXCEPTION 'free_text_invite_only';
  END IF;
  IF p_template_id IS NULL AND clean_body IS NULL THEN
    RAISE EXCEPTION 'invalid_template';
  END IF;
  sender_day := private.member_today(uid);
  IF private.encouraged_today(p_group_id, uid, sender_day) THEN
    RAISE EXCEPTION 'already_encouraged_today';
  END IF;
  BEGIN
    INSERT INTO public.halaqa_encouragements (group_id, from_user, to_user, template_id, body, local_date, sent_on)
    VALUES (p_group_id, uid, p_to_user, p_template_id, clean_body, to_char(today, 'YYYY-MM-DD'), sender_day)
    RETURNING id INTO new_id;
  EXCEPTION
    WHEN check_violation THEN RAISE EXCEPTION 'invalid_template';
    WHEN unique_violation THEN RAISE EXCEPTION 'already_encouraged_today';
  END;
  RETURN jsonb_build_object('id', new_id);
END;
$$;

-- 5.8.2 group_encouragement: what the caller received in the last 7 days in the halaqas they are
-- still in, oldest first by (created_at, id), one page of at most 100 after the cursor the previous
-- page ended on; `more` says whether another page follows. The app reads every page at each check
-- (lib/halaqa/api.ts), so a burst larger than a page is listed in full, and so is a send that commits
-- after a later one. The device acknowledges ids instead of keeping a time watermark. checked_at is
-- the server's time, for pruning acknowledged ids by age.
-- It replaces a version without parameters, which would make a call without arguments ambiguous.
DROP FUNCTION IF EXISTS public.get_received_encouragements();
CREATE OR REPLACE FUNCTION public.get_received_encouragements(
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  page_size CONSTANT INTEGER := 100;
  page JSONB;
BEGIN
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_cursor';
  END IF;
  -- One row past the page tells whether another page follows; it is not returned.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', listed.id, 'created_at', listed.created_at)
    ORDER BY listed.created_at, listed.id), '[]'::JSONB)
  INTO page
  FROM (
    SELECT e.id, e.created_at FROM public.halaqa_encouragements AS e
    WHERE e.to_user = uid AND e.created_at > now() - INTERVAL '7 days'
      AND (p_after_created_at IS NULL OR (e.created_at, e.id) > (p_after_created_at, p_after_id))
      AND EXISTS (
        SELECT 1 FROM public.halaqa_members AS m
        JOIN public.halaqa_groups AS g ON g.id = m.group_id AND g.deleted_at IS NULL
        WHERE m.group_id = e.group_id AND m.user_id = uid AND m.left_at IS NULL
      )
    ORDER BY e.created_at, e.id
    LIMIT page_size + 1
  ) AS listed;
  RETURN jsonb_build_object(
    'items', page - page_size,
    'more', jsonb_array_length(page) > page_size,
    'checked_at', now()
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

-- ─── 12. Board RPCs ──────────────────────────────────────────────────────────
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
-- before are marked as waiting, so people who stopped using the app do not fill cohorts; their next
-- synced wird day returns them to the queue (private.requeue_board_after_wird_day), and their own
-- board read places them anyway. Rows another transaction holds (that user reading, joining or
-- leaving the board, or syncing a wird day) are skipped and left for a later pass.
-- idx_profile_privacy_board_pending serves the scan in this order, so a pass reads at most 100
-- candidates.
CREATE OR REPLACE FUNCTION private.board_enroll_pending(board_week DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  candidate public.profile_privacy;
  active BOOLEAN;
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
    active := EXISTS (
      SELECT 1 FROM public.habit_days AS h
      WHERE h.user_id = candidate.user_id
        AND h.status IS NOT NULL
        AND h.local_date >= to_char(board_week - 14, 'YYYY-MM-DD')
    );
    IF active THEN
      PERFORM private.board_place(candidate.user_id, board_week, candidate.board_level_band,
        candidate.board_pace_band, candidate.board_utc_offset_minutes);
      placed := placed + 1;
    END IF;
    UPDATE public.profile_privacy SET board_enrolled_week = board_week, board_waiting = NOT active
    WHERE user_id = candidate.user_id;
  END LOOP;
  RETURN placed;
END;
$$;

-- A waiting board user who records a wird day returns to the queue: their considered week moves back
-- a week, so the next pass of the current week places them from their latest bands. The trigger is
-- deferred to commit and first locks the user's privacy row, so a pass considering them at the same
-- time either finishes first (and is undone here) or skips the locked row and sees this day later.
-- Runs as owner because the client writes habit_days and has no access to profile_privacy.
CREATE OR REPLACE FUNCTION private.requeue_board_after_wird_day()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.profile_privacy WHERE user_id = NEW.user_id AND board_joined FOR NO KEY UPDATE;
  IF FOUND THEN
    UPDATE public.profile_privacy SET board_waiting = false, board_enrolled_week = board_enrolled_week - 7
    WHERE user_id = NEW.user_id AND board_waiting;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS habit_days_board_requeue ON public.habit_days;
CREATE CONSTRAINT TRIGGER habit_days_board_requeue AFTER INSERT OR UPDATE ON public.habit_days
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status IS NOT NULL) EXECUTE FUNCTION private.requeue_board_after_wird_day();

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
    board_enrolled_week = GREATEST(board_enrolled_week, board_week),
    board_waiting = false
  WHERE user_id = uid
    AND (board_week_start, board_level_band, board_pace_band, board_utc_offset_minutes, board_enrolled_week, board_waiting)
      IS DISTINCT FROM (p_week_start, p_level_band, p_pace_band, p_utc_offset_minutes, GREATEST(board_enrolled_week, board_week), false);
  cohort := private.board_place(uid, board_week, p_level_band, p_pace_band, p_utc_offset_minutes);
  PERFORM private.board_enroll_pending(board_week);
  RETURN private.board_view(uid, board_week, cohort);
END;
$$;

-- 8.13: the app reports its bands when they change and at most once a day otherwise
-- (lib/board/refresh.ts), so a weekly pass places a joined user who has not opened the Board tab
-- from their current bands. A new week start is a new board week, so the user returns to the queue
-- for it. Users who are not on the board are left alone.
CREATE OR REPLACE FUNCTION public.refresh_board_bands(
  p_level_band TEXT,
  p_pace_band TEXT,
  p_utc_offset_minutes INTEGER,
  p_today TEXT,
  p_week_start INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  today DATE := private.checked_local_date(p_today);
BEGIN
  PERFORM private.check_bands(p_level_band, p_pace_band, p_utc_offset_minutes);
  PERFORM private.check_week_start(p_week_start);
  UPDATE public.profile_privacy SET
    board_level_band = p_level_band,
    board_pace_band = p_pace_band,
    board_utc_offset_minutes = p_utc_offset_minutes,
    board_week_start = p_week_start,
    board_enrolled_week = CASE WHEN board_week_start = p_week_start THEN board_enrolled_week
      ELSE LEAST(board_enrolled_week, private.board_week(today, p_week_start) - 7) END,
    board_waiting = board_waiting AND board_week_start = p_week_start
  WHERE user_id = uid AND board_joined
    AND (board_level_band, board_pace_band, board_utc_offset_minutes, board_week_start)
      IS DISTINCT FROM (p_level_band, p_pace_band, p_utc_offset_minutes, p_week_start::SMALLINT);
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
  -- As in set_profile_privacy, recording minority clears the photo and leaves matched halaqas.
  IF minor THEN
    PERFORM private.lock_minor_change(uid);
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
    board_waiting = false,
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

-- ─── 13. Function privileges ─────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  private.habit_status_rank(TEXT),
  private.effective_habit_status(TEXT, TEXT),
  private.merge_habit_day(public.habit_days, public.habit_days),
  private.habit_days_before_write(),
  private.is_minor(UUID),
  private.lock_minor_change(UUID),
  private.apply_minor_privacy(),
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
  private.halaqa_leave(UUID, UUID),
  private.encouraged_today(UUID, UUID, DATE, UUID),
  private.halaqa_summary(UUID, UUID),
  private.new_invite_code(),
  private.halaqa_goal(UUID, DATE),
  private.board_cohort_size(UUID),
  private.board_choose_cohort(DATE, TEXT, TEXT, INTEGER, UUID),
  private.board_place(UUID, DATE, TEXT, TEXT, INTEGER),
  private.board_enroll_pending(DATE),
  private.requeue_board_after_wird_day(),
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
  public.get_received_encouragements(TIMESTAMPTZ, UUID),
  public.get_halaqa_teacher_view(UUID, UUID, TEXT),
  public.get_board(TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.refresh_board_bands(TEXT, TEXT, INTEGER, TEXT, INTEGER),
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
  public.get_received_encouragements(TIMESTAMPTZ, UUID),
  public.get_halaqa_teacher_view(UUID, UUID, TEXT),
  public.get_board(TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.refresh_board_bands(TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.join_board(TEXT, BOOLEAN, TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.leave_board()
TO authenticated;

-- A profile's opted-in streak and juz completions are public (SOC-01), so signed-out viewers may ask.
GRANT EXECUTE ON FUNCTION public.get_profile_summary(UUID) TO anon;
