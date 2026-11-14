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
-- - A minor's reflections, comments and likes carry their id, so they are readable only by that minor,
--   and the public like and comment counts leave them out. Clients write them only through RPCs, and
--   a write the app showed as private is refused once the writer is no longer a minor. Each row stores
--   whether it was written privately, from the writer's minority at that moment, so what a minor wrote
--   stays readable only by them after minority is withdrawn.
-- - Every write that sets is_minor carries the value its form loaded and is refused with
--   privacy_changed when the stored value differs, so a form left open on another device cannot
--   clear minority.
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
-- lock the group row first and then a membership row. Recording or withdrawing minority locks the
-- user's profiles row, then their halaqa lock, then their profile_privacy row, and then leaves
-- matched halaqas group row first (private.lock_minor_change). Account deletion locks the profiles
-- row and then cascades to its children, so board placement, joining and leaving the board, and
-- sending encouragement take the profiles rows they depend on before any child row. The wird-day
-- requeue is the exception, explained at private.requeue_board_after_wird_day. Reflection activity
-- follows one order: the writer's profiles row, then reflections in id order, then comments in id
-- order, then the like or comment row (section 5, reflection writes).

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

-- A card merges in two groups, as upsertStudyCard in lib/database/sync.ts does on each device. The
-- schedule (due through last_review) comes from the version reviewed later; every other column and
-- updated_at come from the version written later, as sync_keep_newer_row decides. Whole-row last
-- write wins let a status change (suspend, bury, mark, due date, unit switch) made on a device holding
-- an older schedule replace a review made since on another device.
--
-- Postgres runs BEFORE triggers in name order, so this one runs before sync_keep_newer_row:
-- - An upload reviewed earlier keeps the stored schedule. If it is written later, it brings the rest.
-- - An upload reviewed later but written earlier brings only its schedule. The stored row keeps its
--   other columns and updated_at, so sync_keep_newer_row sees equal times and lets it through, and the
--   new synced_at sends the merged row to other devices.
-- - Equal review times, both null included, leave the whole row to sync_keep_newer_row, so a due-date
--   change without a review still follows updated_at. No review counts as the earliest.
-- A deletion is one of the other columns: a card deleted on a device behind on reviews stays deleted
-- with the later schedule, which is what comes back if the card is restored. A repair that moves
-- last_review earlier without a later updated_at keeps the stored schedule; disable the trigger for it.
CREATE OR REPLACE FUNCTION private.study_cards_merge_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.last_review IS NOT DISTINCT FROM OLD.last_review THEN
    RETURN NEW;
  END IF;
  IF NEW.last_review IS NOT NULL AND (OLD.last_review IS NULL OR NEW.last_review > OLD.last_review) THEN
    IF NEW.updated_at < OLD.updated_at THEN
      NEW.deck_id := OLD.deck_id;
      NEW.suspended_at := OLD.suspended_at;
      NEW.buried_until := OLD.buried_until;
      NEW.marked_at := OLD.marked_at;
      NEW.tier := OLD.tier;
      NEW.tier_changed_at := OLD.tier_changed_at;
      NEW.created_at := OLD.created_at;
      NEW.deleted_at := OLD.deleted_at;
      NEW.updated_at := OLD.updated_at;
    END IF;
  ELSE
    NEW.due := OLD.due;
    NEW.stability := OLD.stability;
    NEW.difficulty := OLD.difficulty;
    NEW.elapsed_days := OLD.elapsed_days;
    NEW.scheduled_days := OLD.scheduled_days;
    NEW.learning_steps := OLD.learning_steps;
    NEW.reps := OLD.reps;
    NEW.lapses := OLD.lapses;
    NEW.state := OLD.state;
    NEW.last_review := OLD.last_review;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS study_cards_merge_schedule ON public.study_cards;
CREATE TRIGGER study_cards_merge_schedule BEFORE UPDATE ON public.study_cards
  FOR EACH ROW EXECUTE FUNCTION private.study_cards_merge_schedule();

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

-- Users a board pass still has to place, by week start and the last week they were considered for,
-- then user id: the pass reads them in that order, so with user_id in the index it stops after its
-- batch of 100 instead of sorting every pending row (earlier drafts lacked user_id).
DROP INDEX IF EXISTS public.idx_profile_privacy_board_pending;
CREATE INDEX idx_profile_privacy_board_pending
  ON public.profile_privacy(board_week_start, board_enrolled_week, user_id) WHERE board_joined;

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

-- ETH-07: the same rule for public activity. A reflection, comment or like carries its author's id,
-- so a hidden profiles row alone would still show a minor's id and words here. A minor may still
-- write them: their rows are readable only by them, so the app keeps working for the minor and
-- strangers never see the rows, and the public counts leave them out (private.recount_reflection).
-- A row also stores whether it was written privately (section 5, reflection writes): a row a minor
-- wrote stays readable only by them for good, even after they withdraw minority, while rows they wrote
-- as an adult are hidden only while they are a minor. Nothing publishes a private row later. A
-- comment or like also follows its parent, so one on a hidden reflection or comment is hidden with
-- it, and a stranger cannot react to what they cannot read.
ALTER TABLE public.reflections ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.reflection_comments ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.reflection_likes ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.reflection_comment_likes ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

-- Whether the caller may read a reflection, comment or like: always their own, and anyone else's only
-- when it was not written privately and its author is not a minor now. The public counts apply the
-- same rule to every reader (private.activity_public).
CREATE OR REPLACE FUNCTION rls.activity_visible(author UUID, written_private BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT author = (SELECT auth.uid()) OR (NOT written_private AND rls.profile_identity_visible(author));
$$;
REVOKE ALL ON FUNCTION rls.activity_visible(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rls.activity_visible(UUID, BOOLEAN) TO anon, authenticated;

DROP POLICY IF EXISTS "Active reflections are publicly readable" ON public.reflections;
DROP POLICY IF EXISTS "Active reflections are readable unless the author is a minor" ON public.reflections;
DROP POLICY IF EXISTS "Active reflections are readable unless private" ON public.reflections;
CREATE POLICY "Active reflections are readable unless private"
  ON public.reflections FOR SELECT
  USING (status = 'active' AND rls.activity_visible(user_id, is_private));

DROP POLICY IF EXISTS "Likes follow reflection visibility" ON public.reflection_likes;
DROP POLICY IF EXISTS "Likes follow their reflection unless the liker is a minor" ON public.reflection_likes;
DROP POLICY IF EXISTS "Likes follow their reflection unless private" ON public.reflection_likes;
CREATE POLICY "Likes follow their reflection unless private"
  ON public.reflection_likes FOR SELECT
  USING (
    rls.activity_visible(user_id, is_private)
    AND EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id)
  );

DROP POLICY IF EXISTS "Comments follow reflection visibility" ON public.reflection_comments;
DROP POLICY IF EXISTS "Comments follow their reflection unless the author is a minor" ON public.reflection_comments;
DROP POLICY IF EXISTS "Comments follow their reflection unless private" ON public.reflection_comments;
CREATE POLICY "Comments follow their reflection unless private"
  ON public.reflection_comments FOR SELECT
  USING (
    rls.activity_visible(user_id, is_private)
    AND EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id)
  );

DROP POLICY IF EXISTS "Comment likes follow reflection visibility" ON public.reflection_comment_likes;
DROP POLICY IF EXISTS "Comment likes follow their comment unless the liker is a minor" ON public.reflection_comment_likes;
DROP POLICY IF EXISTS "Comment likes follow their comment unless private" ON public.reflection_comment_likes;
CREATE POLICY "Comment likes follow their comment unless private"
  ON public.reflection_comment_likes FOR SELECT
  USING (
    rls.activity_visible(user_id, is_private)
    AND EXISTS (SELECT 1 FROM public.reflection_comments AS c WHERE c.id = comment_id)
  );

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

-- Each photo sits in a folder named after its owner's id (lib/profile/avatar.ts), and PostgREST and
-- the storage list endpoint read storage.objects under this policy. A minor's files that the app has
-- not deleted yet are therefore listed only to the minor, who still needs to list them to delete
-- them. Names outside an id folder stay listed as before.
CREATE OR REPLACE FUNCTION rls.avatar_object_visible(object_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN rls.profile_identity_visible(split_part(object_name, '/', 1)::UUID)
    ELSE true
  END;
$$;
REVOKE ALL ON FUNCTION rls.avatar_object_visible(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rls.avatar_object_visible(TEXT) TO anon, authenticated;

DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;
CREATE POLICY "Avatar images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars' AND rls.avatar_object_visible(name));

-- Whether a person stated they are a minor, for definer functions that return someone else's details.
CREATE OR REPLACE FUNCTION private.is_minor(member UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profile_privacy AS pp WHERE pp.user_id = member AND pp.is_minor);
$$;

-- Whether a reflection, comment or like is public, so the public counts include it: it was not
-- written privately and its author is not a minor now. rls.activity_visible applies the same rule
-- to readers other than the author.
CREATE OR REPLACE FUNCTION private.activity_public(author UUID, written_private BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NOT written_private AND NOT private.is_minor(author);
$$;

-- Every write that can change is_minor (set_profile_privacy, join_board) calls this before it writes,
-- whichever way it changes, and holds both locks until it commits:
-- - The profiles row. A photo update in progress holds it, so the minority write waits for that
--   update to commit and then clears its photo. A photo update that comes later waits on the row,
--   and profiles_minor_photo then reads the committed minority. FOR NO KEY UPDATE conflicts with that
--   update but not with the key-share locks that foreign keys take, so an encouragement, membership
--   or sync insert that references this profile does not wait on it. A reflection write by this user
--   takes the row FOR SHARE (private.lock_activity_writer, private.visible_step), so it either commits
--   first and is recounted here (private.recount_minor_activity), or waits and reads the committed
--   minority.
--   Account deletion locks the row too, so a board join waits for it rather than deadlocking with it.
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

-- ETH-07: like and comment counts are public, so they count only likes and comments that others can
-- read: never one written privately, and never a current minor's (private.activity_public). A single
-- new or deleted like or comment adds or subtracts one when it was not written privately and its
-- author is not a minor (private.visible_step); a private one never moves a count. A statement that
-- changes several rows, a cascade from a deleted account, and recording or withdrawing minority
-- recount each count they affect once instead. A recount locks its row first, in its own statement,
-- so the count reads every like and comment committed before it, and a later change waits for this one.
CREATE OR REPLACE FUNCTION private.recount_reflection(target UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.reflections WHERE id = target FOR NO KEY UPDATE;
  UPDATE public.reflections SET
    likes_count = (
      SELECT count(*) FROM public.reflection_likes AS l
      WHERE l.reflection_id = target AND private.activity_public(l.user_id, l.is_private)
    ),
    comments_count = (
      SELECT count(*) FROM public.reflection_comments AS c
      WHERE c.reflection_id = target AND private.activity_public(c.user_id, c.is_private)
    )
  WHERE id = target;
END;
$$;

CREATE OR REPLACE FUNCTION private.recount_comment(target UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.reflection_comments WHERE id = target FOR NO KEY UPDATE;
  UPDATE public.reflection_comments SET likes_count = (
    SELECT count(*) FROM public.reflection_comment_likes AS cl
    WHERE cl.comment_id = target AND private.activity_public(cl.user_id, cl.is_private)
  )
  WHERE id = target;
END;
$$;

-- How one like or comment by `author` moves a public count: by `step` when others can read it, not
-- at all when the author is a minor. The counter triggers call this only for a row not written
-- privately, since a private row never counts whatever its author's minority. The author's profiles
-- row stays locked FOR SHARE until commit, and recording or withdrawing minority holds it FOR NO KEY
-- UPDATE (private.lock_minor_change), so the minority read here holds until the count commits, and a
-- minority write after it recounts.
-- NULL means the author's profile was deleted in this transaction: their privacy row may already be
-- gone, so the caller recounts instead.
CREATE OR REPLACE FUNCTION private.visible_step(author UUID, step INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = author FOR SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN CASE WHEN private.is_minor(author) THEN 0 ELSE step END;
END;
$$;

-- A recount reads the minority of the authors of new rows, and a minority write in flight cannot see
-- those rows until they commit, so it would not recount them. Their profiles rows are therefore
-- locked FOR SHARE first, in id order, as in private.visible_step. Rows being deleted stay visible to
-- a minority write until the deletion commits, so a recount after a deletion needs no author lock.
-- Privately written rows never count, so their authors are not locked and their parents are not
-- recounted for them.
CREATE OR REPLACE FUNCTION private.lock_activity_authors(authors UUID[])
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = ANY (authors) ORDER BY id FOR SHARE;
END;
$$;

-- The counter triggers run once per statement, with the changed rows in `changed`, and as their
-- owner, so a reaction to another author's post still updates its count under RLS. A parent that is
-- being deleted takes its likes and comments with it, so they are skipped before any lock is taken.
CREATE OR REPLACE FUNCTION public.update_reflection_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent UUID;
  author UUID;
  written_private BOOLEAN;
  step INTEGER;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_likes' OR TG_LEVEL <> 'STATEMENT' THEN
    RAISE EXCEPTION 'update_reflection_likes_count only maintains public.reflection_likes';
  END IF;
  IF (SELECT count(*) FROM changed) = 1 THEN
    SELECT c.reflection_id, c.user_id, c.is_private INTO parent, author, written_private FROM changed AS c;
    IF written_private OR NOT EXISTS (SELECT 1 FROM public.reflections WHERE id = parent) THEN
      RETURN NULL;
    END IF;
    step := private.visible_step(author, CASE TG_OP WHEN 'INSERT' THEN 1 ELSE -1 END);
    IF step IS NULL THEN
      PERFORM private.recount_reflection(parent);
    ELSIF step <> 0 THEN
      UPDATE public.reflections SET likes_count = likes_count + step WHERE id = parent;
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.lock_activity_authors(ARRAY(SELECT c.user_id FROM changed AS c WHERE NOT c.is_private));
  END IF;
  FOR parent IN
    SELECT DISTINCT c.reflection_id FROM changed AS c
    WHERE NOT c.is_private AND EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = c.reflection_id)
    ORDER BY 1
  LOOP
    PERFORM private.recount_reflection(parent);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reflection_comments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent UUID;
  author UUID;
  written_private BOOLEAN;
  step INTEGER;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_comments' OR TG_LEVEL <> 'STATEMENT' THEN
    RAISE EXCEPTION 'update_reflection_comments_count only maintains public.reflection_comments';
  END IF;
  IF (SELECT count(*) FROM changed) = 1 THEN
    SELECT c.reflection_id, c.user_id, c.is_private INTO parent, author, written_private FROM changed AS c;
    IF written_private OR NOT EXISTS (SELECT 1 FROM public.reflections WHERE id = parent) THEN
      RETURN NULL;
    END IF;
    step := private.visible_step(author, CASE TG_OP WHEN 'INSERT' THEN 1 ELSE -1 END);
    IF step IS NULL THEN
      PERFORM private.recount_reflection(parent);
    ELSIF step <> 0 THEN
      UPDATE public.reflections SET comments_count = comments_count + step WHERE id = parent;
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.lock_activity_authors(ARRAY(SELECT c.user_id FROM changed AS c WHERE NOT c.is_private));
  END IF;
  FOR parent IN
    SELECT DISTINCT c.reflection_id FROM changed AS c
    WHERE NOT c.is_private AND EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = c.reflection_id)
    ORDER BY 1
  LOOP
    PERFORM private.recount_reflection(parent);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reflection_comment_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent UUID;
  author UUID;
  written_private BOOLEAN;
  step INTEGER;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_comment_likes' OR TG_LEVEL <> 'STATEMENT' THEN
    RAISE EXCEPTION 'update_reflection_comment_likes_count only maintains public.reflection_comment_likes';
  END IF;
  IF (SELECT count(*) FROM changed) = 1 THEN
    SELECT c.comment_id, c.user_id, c.is_private INTO parent, author, written_private FROM changed AS c;
    IF written_private OR NOT EXISTS (SELECT 1 FROM public.reflection_comments WHERE id = parent) THEN
      RETURN NULL;
    END IF;
    step := private.visible_step(author, CASE TG_OP WHEN 'INSERT' THEN 1 ELSE -1 END);
    IF step IS NULL THEN
      PERFORM private.recount_comment(parent);
    ELSIF step <> 0 THEN
      UPDATE public.reflection_comments SET likes_count = likes_count + step WHERE id = parent;
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.lock_activity_authors(ARRAY(SELECT c.user_id FROM changed AS c WHERE NOT c.is_private));
  END IF;
  FOR parent IN
    SELECT DISTINCT c.comment_id FROM changed AS c
    WHERE NOT c.is_private AND EXISTS (SELECT 1 FROM public.reflection_comments AS rc WHERE rc.id = c.comment_id)
    ORDER BY 1
  LOOP
    PERFORM private.recount_comment(parent);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reflection_likes_count ON public.reflection_likes;
DROP TRIGGER IF EXISTS trg_reflection_likes_count_insert ON public.reflection_likes;
DROP TRIGGER IF EXISTS trg_reflection_likes_count_delete ON public.reflection_likes;
CREATE TRIGGER trg_reflection_likes_count_insert AFTER INSERT ON public.reflection_likes
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION public.update_reflection_likes_count();
CREATE TRIGGER trg_reflection_likes_count_delete AFTER DELETE ON public.reflection_likes
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION public.update_reflection_likes_count();

DROP TRIGGER IF EXISTS trg_reflection_comments_count ON public.reflection_comments;
DROP TRIGGER IF EXISTS trg_reflection_comments_count_insert ON public.reflection_comments;
DROP TRIGGER IF EXISTS trg_reflection_comments_count_delete ON public.reflection_comments;
CREATE TRIGGER trg_reflection_comments_count_insert AFTER INSERT ON public.reflection_comments
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION public.update_reflection_comments_count();
CREATE TRIGGER trg_reflection_comments_count_delete AFTER DELETE ON public.reflection_comments
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION public.update_reflection_comments_count();

DROP TRIGGER IF EXISTS trg_reflection_comment_likes_count ON public.reflection_comment_likes;
DROP TRIGGER IF EXISTS trg_reflection_comment_likes_count_insert ON public.reflection_comment_likes;
DROP TRIGGER IF EXISTS trg_reflection_comment_likes_count_delete ON public.reflection_comment_likes;
CREATE TRIGGER trg_reflection_comment_likes_count_insert AFTER INSERT ON public.reflection_comment_likes
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION public.update_reflection_comment_likes_count();
CREATE TRIGGER trg_reflection_comment_likes_count_delete AFTER DELETE ON public.reflection_comment_likes
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION public.update_reflection_comment_likes_count();

-- Recording minority, or withdrawing it, changes which of the person's likes and comments the
-- public counts include, so every count they touched is recounted once: reflections in id order,
-- then comments in id order. The callers hold private.lock_minor_change, so none of the person's
-- own likes or comments is in flight. What they wrote privately counts neither way, so withdrawing
-- minority adds only what they wrote as an adult, and their private rows need no recount.
CREATE OR REPLACE FUNCTION private.recount_minor_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  target UUID;
BEGIN
  IF NEW.is_minor = COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.is_minor END, false) THEN
    RETURN NULL;
  END IF;
  FOR target IN
    SELECT l.reflection_id FROM public.reflection_likes AS l WHERE l.user_id = NEW.user_id AND NOT l.is_private
    UNION
    SELECT c.reflection_id FROM public.reflection_comments AS c WHERE c.user_id = NEW.user_id AND NOT c.is_private
    ORDER BY 1
  LOOP
    PERFORM private.recount_reflection(target);
  END LOOP;
  FOR target IN
    SELECT cl.comment_id FROM public.reflection_comment_likes AS cl
    WHERE cl.user_id = NEW.user_id AND NOT cl.is_private
    ORDER BY 1
  LOOP
    PERFORM private.recount_comment(target);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS profile_privacy_activity_counts ON public.profile_privacy;
CREATE TRIGGER profile_privacy_activity_counts AFTER INSERT OR UPDATE OF is_minor ON public.profile_privacy
  FOR EACH ROW EXECUTE FUNCTION private.recount_minor_activity();

-- Deleting an account deletes the person's reflections, likes and comments with it, and the counter
-- triggers recount what they touched (private.visible_step returns NULL once the profile is gone).
-- The profiles row is locked before this trigger runs, so it takes the rest in the order every other
-- path uses: each reflection the cascade deletes or recounts, in id order, then each such comment, in
-- id order. Reached one table at a time, the cascade could lock a comment before its reflection, or
-- reflections out of order, and deadlock with a minority write or a reflection write.
CREATE OR REPLACE FUNCTION private.lock_account_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Each branch reads only this account's rows through an index, so the cost follows the account's
  -- own activity, not the size of the community.
  PERFORM 1 FROM public.reflections AS r
  WHERE r.id IN (
    SELECT own.id FROM public.reflections AS own WHERE own.user_id = OLD.id
    UNION SELECT l.reflection_id FROM public.reflection_likes AS l WHERE l.user_id = OLD.id
    UNION SELECT c.reflection_id FROM public.reflection_comments AS c WHERE c.user_id = OLD.id
  )
  ORDER BY r.id
  FOR NO KEY UPDATE;
  PERFORM 1 FROM public.reflection_comments AS c
  WHERE c.id IN (
    SELECT own.id FROM public.reflection_comments AS own WHERE own.user_id = OLD.id
    UNION SELECT cl.comment_id FROM public.reflection_comment_likes AS cl WHERE cl.user_id = OLD.id
    UNION SELECT under.id FROM public.reflection_comments AS under
      JOIN public.reflections AS parent ON parent.id = under.reflection_id
      WHERE parent.user_id = OLD.id
  )
  ORDER BY c.id
  FOR NO KEY UPDATE;
  RETURN OLD;
END;
$$;

-- Account deletion finds the comments an account wrote (private.lock_account_activity).
CREATE INDEX IF NOT EXISTS idx_reflection_comments_user ON public.reflection_comments(user_id);

DROP TRIGGER IF EXISTS profiles_lock_activity ON public.profiles;
CREATE TRIGGER profiles_lock_activity BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.lock_account_activity();

-- Reflection writes. Clients add and remove reflections, comments and likes only through the RPCs
-- below, which lock in the order recording minority and account deletion use: the writer's profiles
-- row FOR SHARE, then the reflection, then the comment, then the row itself. A direct delete locks
-- its row first and its counter trigger the profile after it, which deadlocks with a minority write
-- that holds the profile and then recounts that row, or with an account deletion that holds the
-- profile and then deletes the row. A direct insert key-shares its parent before the profile.
REVOKE INSERT, DELETE ON public.reflections, public.reflection_likes, public.reflection_comments,
  public.reflection_comment_likes FROM PUBLIC, anon, authenticated;
-- The app never edits a stored reflection. An owner who could update the row could also set its like
-- and comment counts, which now leave minors out, or show a post that moderation hid.
REVOKE UPDATE ON public.reflections, public.reflection_likes, public.reflection_comments,
  public.reflection_comment_likes FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Users can update own reflections" ON public.reflections;
DROP POLICY IF EXISTS "Users can insert own reflections" ON public.reflections;
DROP POLICY IF EXISTS "Users can delete own reflections" ON public.reflections;
DROP POLICY IF EXISTS "Users can insert own likes" ON public.reflection_likes;
DROP POLICY IF EXISTS "Users can delete own likes" ON public.reflection_likes;
DROP POLICY IF EXISTS "Users can insert own comments" ON public.reflection_comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON public.reflection_comments;
DROP POLICY IF EXISTS "Users can insert own comment likes" ON public.reflection_comment_likes;
DROP POLICY IF EXISTS "Users can delete own comment likes" ON public.reflection_comment_likes;
-- Earlier drafts of this migration locked the author in each counter trigger with this.
DROP FUNCTION IF EXISTS private.lock_activity_author(UUID);

-- The signed-in writer. Their profiles row stays locked FOR SHARE until commit, so a minority write
-- either commits first and the write reads it, or waits and then recounts the write. The client names
-- the account it writes for, so a request that arrives after an account switch is refused instead of
-- being written for the other account.
CREATE OR REPLACE FUNCTION private.lock_activity_writer(expected UUID)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  IF expected IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'account_mismatch';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = uid FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN uid;
END;
$$;

-- ETH-07: the composer and the comment input tell a stated minor that what they write is visible only
-- to them, from a cached copy of their privacy that another device may have changed. Each write
-- carries what the screen promised, and its caller holds the writer's profiles row
-- (private.lock_activity_writer), so this reads the committed minority. A write promised to stay
-- private is refused once the writer is no longer a minor, and the app reloads their privacy so they
-- can decide again. Writing as an adult when the server has a minor only makes the text more private.
-- Each write then stores the minority it read under the same lock as the row's is_private, so the
-- promise holds after the writer withdraws minority too. The flag never comes from the client.
CREATE OR REPLACE FUNCTION private.check_promised_visibility(author UUID, promised_private BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF promised_private IS NULL THEN
    RAISE EXCEPTION 'invalid_visibility';
  END IF;
  IF promised_private AND NOT private.is_minor(author) THEN
    RAISE EXCEPTION 'privacy_changed';
  END IF;
END;
$$;

-- Locks a reflection the caller may react to, which is one the read policy shows them: active, and
-- neither written privately nor a current minor's, unless it is the caller's own.
CREATE OR REPLACE FUNCTION private.lock_readable_reflection(target UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  author UUID;
  state TEXT;
  written_private BOOLEAN;
BEGIN
  SELECT r.user_id, r.status, r.is_private INTO author, state, written_private
  FROM public.reflections AS r WHERE r.id = target FOR NO KEY UPDATE;
  IF NOT FOUND OR state IS DISTINCT FROM 'active' OR NOT rls.activity_visible(author, written_private) THEN
    RAISE EXCEPTION 'reflection_not_found';
  END IF;
END;
$$;

-- Locks a comment the caller may like, which is one the read policies show them. A comment like
-- changes only the comment's count, so the reflection is read without a lock.
CREATE OR REPLACE FUNCTION private.lock_readable_comment(target UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  author UUID;
  parent UUID;
  written_private BOOLEAN;
BEGIN
  SELECT c.user_id, c.reflection_id, c.is_private INTO author, parent, written_private
  FROM public.reflection_comments AS c WHERE c.id = target FOR NO KEY UPDATE;
  IF NOT FOUND OR NOT rls.activity_visible(author, written_private) OR NOT EXISTS (
    SELECT 1 FROM public.reflections AS r
    WHERE r.id = parent AND r.status = 'active' AND rls.activity_visible(r.user_id, r.is_private)
  ) THEN
    RAISE EXCEPTION 'comment_not_found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_reflection(
  p_user_id UUID,
  p_surah INTEGER,
  p_ayah_start INTEGER,
  p_ayah_end INTEGER,
  p_juz_start INTEGER,
  p_juz_end INTEGER,
  p_content TEXT,
  p_private BOOLEAN
)
RETURNS public.reflections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
  created public.reflections;
BEGIN
  PERFORM private.check_promised_visibility(uid, p_private);
  INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content, is_private)
  VALUES (uid, p_surah, p_ayah_start, p_ayah_end, p_juz_start, p_juz_end, p_content, private.is_minor(uid))
  RETURNING * INTO created;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_reflection_comment(
  p_user_id UUID,
  p_reflection_id UUID,
  p_content TEXT,
  p_private BOOLEAN
)
RETURNS public.reflection_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
  created public.reflection_comments;
BEGIN
  PERFORM private.check_promised_visibility(uid, p_private);
  PERFORM private.lock_readable_reflection(p_reflection_id);
  INSERT INTO public.reflection_comments (reflection_id, user_id, content, is_private)
  VALUES (p_reflection_id, uid, p_content, private.is_minor(uid))
  RETURNING * INTO created;
  RETURN created;
END;
$$;

-- Likes and unlikes are idempotent: the result is the state the caller asked for. A like stores the
-- writer's minority as it is now, and liking again keeps the stored like as it was written.
CREATE OR REPLACE FUNCTION public.set_reflection_like(p_user_id UUID, p_reflection_id UUID, p_liked BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
BEGIN
  IF p_liked IS NULL THEN
    RAISE EXCEPTION 'invalid_like';
  END IF;
  IF p_liked THEN
    PERFORM private.lock_readable_reflection(p_reflection_id);
    INSERT INTO public.reflection_likes (user_id, reflection_id, is_private)
    VALUES (uid, p_reflection_id, private.is_minor(uid)) ON CONFLICT DO NOTHING;
  ELSE
    PERFORM 1 FROM public.reflections WHERE id = p_reflection_id FOR NO KEY UPDATE;
    DELETE FROM public.reflection_likes WHERE user_id = uid AND reflection_id = p_reflection_id;
  END IF;
  RETURN p_liked;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_reflection_comment_like(p_user_id UUID, p_comment_id UUID, p_liked BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
BEGIN
  IF p_liked IS NULL THEN
    RAISE EXCEPTION 'invalid_like';
  END IF;
  IF p_liked THEN
    PERFORM private.lock_readable_comment(p_comment_id);
    INSERT INTO public.reflection_comment_likes (user_id, comment_id, is_private)
    VALUES (uid, p_comment_id, private.is_minor(uid)) ON CONFLICT DO NOTHING;
  ELSE
    PERFORM 1 FROM public.reflection_comments WHERE id = p_comment_id FOR NO KEY UPDATE;
    DELETE FROM public.reflection_comment_likes WHERE user_id = uid AND comment_id = p_comment_id;
  END IF;
  RETURN p_liked;
END;
$$;

-- Deletes the caller's own comment, with its likes. False when there is no such comment.
CREATE OR REPLACE FUNCTION public.delete_reflection_comment(p_user_id UUID, p_comment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
  parent UUID;
BEGIN
  SELECT c.reflection_id INTO parent FROM public.reflection_comments AS c WHERE c.id = p_comment_id AND c.user_id = uid;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.reflections WHERE id = parent FOR NO KEY UPDATE;
  DELETE FROM public.reflection_comments WHERE id = p_comment_id AND user_id = uid;
  RETURN FOUND;
END;
$$;

-- Deletes the caller's own reflection with its comments and likes. The comments it deletes are
-- locked first, in id order, as a minority write or an account deletion would lock them.
CREATE OR REPLACE FUNCTION public.delete_reflection(p_user_id UUID, p_reflection_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.lock_activity_writer(p_user_id);
BEGIN
  PERFORM 1 FROM public.reflections WHERE id = p_reflection_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.reflection_comments WHERE reflection_id = p_reflection_id ORDER BY id FOR UPDATE;
  DELETE FROM public.reflections WHERE id = p_reflection_id;
  RETURN true;
END;
$$;

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

-- SOC-03: a teacher's next sabaq for a member of their halaqa, a page and a range of its lines. One per
-- member and halaqa; the member's app memorizes those lines next (lib/hifz/teacher-sabaq.ts). Written
-- and read only through RPCs, and only while the member shares their plan with teachers.
CREATE TABLE IF NOT EXISTS public.halaqa_sabaq_assignments (
  group_id UUID NOT NULL REFERENCES public.halaqa_groups(id) ON DELETE CASCADE,
  learner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  page INTEGER NOT NULL CHECK (page BETWEEN 1 AND 604),
  from_line INTEGER NOT NULL CHECK (from_line BETWEEN 1 AND 15),
  to_line INTEGER NOT NULL CHECK (to_line BETWEEN 1 AND 15),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, learner_id),
  CHECK (from_line <= to_line),
  CHECK (learner_id <> teacher_id)
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
-- Serves get_my_sabaq_assignment, which reads across the learner's halaqas.
CREATE INDEX IF NOT EXISTS idx_halaqa_sabaq_assignments_learner ON public.halaqa_sabaq_assignments(learner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_partners_active_pair
  ON public.review_partners(user_a, user_b) WHERE ended_at IS NULL;

ALTER TABLE public.halaqa_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.halaqa_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.halaqa_encouragements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.halaqa_sabaq_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners can read their pairing" ON public.review_partners;
CREATE POLICY "Partners can read their pairing"
  ON public.review_partners FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (user_a, user_b));

REVOKE ALL ON public.halaqa_groups, public.halaqa_members, public.halaqa_encouragements, public.review_partners
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.halaqa_sabaq_assignments FROM PUBLIC, anon, authenticated;
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
-- STR-07: a missed yesterday can still be made up today before Dhuhr, and the app keeps the streak
-- meanwhile, with today's own run added when today is covered (lib/habit/streak.ts computeStreak).
-- The cutoff comes from prayer times the server never sees (ETH-11), so on the make-up day the run
-- through the day before yesterday stands all day; the next day it is gone unless made up.
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
  islands AS (
    SELECT covered_on, status, covered_on - (row_number() OVER (ORDER BY covered_on))::INTEGER AS run_id
    FROM covered
  ),
  -- The last day of each run the streak counts: today's run when today is covered, yesterday's when
  -- it is not, and the run through the day before yesterday when yesterday is missing.
  ends AS (
    SELECT today AS end_on WHERE EXISTS (SELECT 1 FROM covered WHERE covered_on = today)
    UNION
    SELECT today - 1
    WHERE NOT EXISTS (SELECT 1 FROM covered WHERE covered_on = today)
      AND EXISTS (SELECT 1 FROM covered WHERE covered_on = today - 1)
    UNION
    SELECT today - 2
    WHERE NOT EXISTS (SELECT 1 FROM covered WHERE covered_on = today - 1)
      AND EXISTS (SELECT 1 FROM covered WHERE covered_on = today - 2)
  )
  SELECT COALESCE(count(*) FILTER (WHERE i.status <> 'paused'), 0)::INTEGER
  FROM islands AS i
  WHERE i.run_id IN (SELECT x.run_id FROM islands AS x JOIN ends AS e ON x.covered_on = e.end_on);
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

-- Earlier drafts of this migration had no expected minority.
DROP FUNCTION IF EXISTS public.set_profile_privacy(BOOLEAN, BOOLEAN, BOOLEAN);

-- p_expected_minor is the minority the form loaded. A form loaded before another device recorded
-- minority would otherwise clear it and make the profile public (ETH-07), so a stored value that
-- differs refuses the write with privacy_changed and the app reloads.
CREATE OR REPLACE FUNCTION public.set_profile_privacy(
  p_show_streak BOOLEAN,
  p_show_juz_completions BOOLEAN,
  p_is_minor BOOLEAN,
  p_expected_minor BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  current_row public.profile_privacy;
  -- Whether recording minority took a Board member without a nickname off the Board, for the screen
  -- to say so.
  leaves_board BOOLEAN;
BEGIN
  IF p_show_streak IS NULL OR p_show_juz_completions IS NULL OR p_is_minor IS NULL OR p_expected_minor IS NULL THEN
    RAISE EXCEPTION 'invalid_privacy';
  END IF;
  -- Recording minority clears the photo and leaves matched halaqas (private.apply_minor_privacy), and
  -- recording or withdrawing it recounts the person's likes and comments. Every minority write holds
  -- this lock, so the stored value compared below holds until this write commits.
  PERFORM private.lock_minor_change(uid);
  -- The row lock comes last, as in join_board. It waits for a board placement in progress, so the
  -- Board choice read here is the committed one.
  SELECT * INTO current_row FROM public.profile_privacy WHERE user_id = uid FOR UPDATE;
  IF COALESCE(current_row.is_minor, false) IS DISTINCT FROM p_expected_minor THEN
    RAISE EXCEPTION 'privacy_changed';
  END IF;
  -- Under 18s appear on the Board only under a nickname (BRD-07). Recording minority must not fail on
  -- that rule, so a member without one leaves the Board in this transaction, as leave_board does, and
  -- can join again with a nickname.
  leaves_board := p_is_minor AND COALESCE(current_row.board_joined, false) AND current_row.board_nickname IS NULL;
  INSERT INTO public.profile_privacy (user_id, show_streak, show_juz_completions, is_minor, updated_at)
  VALUES (uid, p_show_streak, p_show_juz_completions, p_is_minor, now())
  ON CONFLICT (user_id) DO UPDATE SET
    show_streak = EXCLUDED.show_streak,
    show_juz_completions = EXCLUDED.show_juz_completions,
    is_minor = EXCLUDED.is_minor,
    board_joined = public.profile_privacy.board_joined AND NOT leaves_board,
    updated_at = EXCLUDED.updated_at;
  IF leaves_board THEN
    UPDATE public.board_members SET left_at = now() WHERE user_id = uid AND left_at IS NULL;
  END IF;
  RETURN public.get_profile_privacy() || jsonb_build_object('left_board', leaves_board);
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
    -- created_by is null once the creator deletes their account; the client needs a boolean.
    'is_creator', COALESCE(g.created_by = member, false),
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
  -- SOC-03: a member who leaves takes their next sabaq with them, and a teacher the ones they set.
  DELETE FROM public.halaqa_sabaq_assignments
  WHERE group_id = target_group AND (learner_id = member OR teacher_id = member);
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
  -- SOC-03: a teacher's next sabaq needs the plan shared; sharing it again does not bring one back.
  IF NOT p_share_plan_with_teachers THEN
    DELETE FROM public.halaqa_sabaq_assignments WHERE group_id = p_group_id AND learner_id = uid;
  END IF;
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
  IF p_role <> 'teacher' THEN
    DELETE FROM public.halaqa_sabaq_assignments WHERE group_id = p_group_id AND teacher_id = p_member_id;
  END IF;
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
  -- The sender's and recipient's profiles rows first, in key-share mode, before any halaqa row:
  -- deleting either account locks its profile and then cascades to the group (as creator) and the
  -- memberships, so a send that held those rows and only key-shared the profiles at its insert
  -- would deadlock with it.
  PERFORM 1 FROM public.profiles WHERE id IN (uid, p_to_user) ORDER BY id FOR KEY SHARE;
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

-- SOC-03: a member's next sabaq from a teacher counts while both are still in the halaqa, the teacher
-- still teaches there and the member still shares their plan with teachers. Leaving, a change of role
-- and withdrawn sharing also delete it; this check keeps a read right while one of those commits.
CREATE OR REPLACE FUNCTION private.live_sabaq_assignments(learner UUID)
RETURNS SETOF public.halaqa_sabaq_assignments
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT a.*
  FROM public.halaqa_sabaq_assignments AS a
  JOIN public.halaqa_groups AS g ON g.id = a.group_id AND g.deleted_at IS NULL
  JOIN public.halaqa_members AS lm ON lm.group_id = a.group_id AND lm.user_id = a.learner_id
    AND lm.left_at IS NULL AND lm.share_plan_with_teachers
  JOIN public.halaqa_members AS tm ON tm.group_id = a.group_id AND tm.user_id = a.teacher_id
    AND tm.left_at IS NULL AND tm.role = 'teacher'
  WHERE a.learner_id = learner;
$$;

CREATE OR REPLACE FUNCTION private.sabaq_assignment_json(assignment public.halaqa_sabaq_assignments)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'group_id', assignment.group_id,
    'group_name', (SELECT g.name FROM public.halaqa_groups AS g WHERE g.id = assignment.group_id),
    'teacher_name', private.member_name(assignment.teacher_id),
    'page', assignment.page,
    'from_line', assignment.from_line,
    'to_line', assignment.to_line,
    'assigned_at', assignment.assigned_at
  );
$$;

-- SOC-03: a teacher sees a member's plan and tiers, and recent grades and mistake-inbox count, each
-- only with that member's consent in this halaqa, with the next sabaq a teacher set. Null sections
-- were not shared.
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
      ),
      'sabaq_assignment', (
        SELECT private.sabaq_assignment_json(a) FROM private.live_sabaq_assignments(p_member_id) AS a
        WHERE a.group_id = p_group_id
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

-- SOC-03: a teacher sets a member's next sabaq, replacing any earlier one in this halaqa, while the member
-- shares their plan with teachers. The group is locked as leaving locks it, then both memberships, so a
-- concurrent leave, change of role or withdrawn sharing either commits first and refuses this, or waits
-- and then deletes what this wrote.
CREATE OR REPLACE FUNCTION public.set_halaqa_sabaq_assignment(
  p_group_id UUID,
  p_member_id UUID,
  p_page INTEGER,
  p_from_line INTEGER,
  p_to_line INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  saved public.halaqa_sabaq_assignments;
BEGIN
  PERFORM 1 FROM public.halaqa_groups WHERE id = p_group_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.halaqa_members
  WHERE group_id = p_group_id AND user_id = uid AND left_at IS NULL AND role = 'teacher'
  FOR SHARE;
  IF NOT FOUND OR p_member_id IS NULL OR p_member_id = uid THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.halaqa_members
  WHERE group_id = p_group_id AND user_id = p_member_id AND left_at IS NULL AND share_plan_with_teachers
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_not_shared' USING ERRCODE = '42501';
  END IF;
  IF p_page IS NULL OR p_from_line IS NULL OR p_to_line IS NULL OR p_page NOT BETWEEN 1 AND 604
    OR p_from_line NOT BETWEEN 1 AND 15 OR p_to_line NOT BETWEEN p_from_line AND 15 THEN
    RAISE EXCEPTION 'invalid_assignment';
  END IF;
  INSERT INTO public.halaqa_sabaq_assignments (group_id, learner_id, teacher_id, page, from_line, to_line)
  VALUES (p_group_id, p_member_id, uid, p_page, p_from_line, p_to_line)
  ON CONFLICT (group_id, learner_id) DO UPDATE SET
    teacher_id = EXCLUDED.teacher_id,
    page = EXCLUDED.page,
    from_line = EXCLUDED.from_line,
    to_line = EXCLUDED.to_line,
    assigned_at = now()
  RETURNING * INTO saved;
  RETURN private.sabaq_assignment_json(saved);
END;
$$;

-- SOC-03: any teacher of the halaqa clears a member's next sabaq, whatever the member shares.
CREATE OR REPLACE FUNCTION public.clear_halaqa_sabaq_assignment(p_group_id UUID, p_member_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
  mine public.halaqa_members;
BEGIN
  mine := private.require_halaqa_member(p_group_id, uid);
  IF mine.role <> 'teacher' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.halaqa_sabaq_assignments WHERE group_id = p_group_id AND learner_id = p_member_id;
END;
$$;

-- SOC-03: the caller's latest next sabaq from a teacher in any of their halaqas, or null.
CREATE OR REPLACE FUNCTION public.get_my_sabaq_assignment()
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
    SELECT private.sabaq_assignment_json(a)
    FROM private.live_sabaq_assignments(uid) AS a
    ORDER BY a.assigned_at DESC, a.group_id
    LIMIT 1
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
-- candidates. Each candidate's profiles row is key-shared before their privacy row, as get_board
-- does, and skipped while an account deletion holds it.
CREATE OR REPLACE FUNCTION private.board_enroll_pending(board_week DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  pending UUID;
  candidate public.profile_privacy;
  active BOOLEAN;
  placed INTEGER := 0;
BEGIN
  FOR pending IN
    SELECT pp.user_id FROM public.profile_privacy AS pp
    WHERE pp.board_joined
      AND pp.board_week_start = extract(dow FROM board_week)::INTEGER
      AND pp.board_enrolled_week < board_week
    ORDER BY pp.board_enrolled_week, pp.user_id
    LIMIT 100
  LOOP
    PERFORM 1 FROM public.profiles WHERE id = pending FOR KEY SHARE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO candidate FROM public.profile_privacy AS pp
    WHERE pp.user_id = pending
      AND pp.board_joined
      AND pp.board_week_start = extract(dow FROM board_week)::INTEGER
      AND pp.board_enrolled_week < board_week
    FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
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
-- It takes no profiles lock first, unlike the board paths: the sync that fires it already holds its
-- habit_days rows, and an account deletion waits on those rows, so waiting here for that deletion's
-- profile lock would deadlock. The deletion's cascade reaches habit_days before profile_privacy, so
-- it waits on the sync's rows before it can hold the privacy row this locks.
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
-- holds until this placement commits. The caller's profiles row is key-shared before it: deleting
-- the account locks that row and then cascades to profile_privacy, so a placement that held the
-- privacy row and only key-shared the profile at its board_members insert would deadlock with it.
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
  PERFORM 1 FROM public.profiles WHERE id = uid FOR KEY SHARE;
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

-- Earlier drafts of this migration had no expected minority.
DROP FUNCTION IF EXISTS public.join_board(TEXT, BOOLEAN, TEXT, TEXT, INTEGER, TEXT, INTEGER);

-- BRD-04: opt-in from the Board tab, optionally under a nickname. A minor must use one (BRD-07).
-- p_expected_minor is the minority the form loaded, compared as in set_profile_privacy.
CREATE OR REPLACE FUNCTION public.join_board(
  p_nickname TEXT,
  p_is_minor BOOLEAN,
  p_expected_minor BOOLEAN,
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
  minor BOOLEAN := p_is_minor;
  -- Whether recording minority here leaves a matched halaqa, for the screen to say so (ETH-07).
  leaves_matched BOOLEAN := false;
BEGIN
  PERFORM private.check_bands(p_level_band, p_pace_band, p_utc_offset_minutes);
  PERFORM private.check_week_start(p_week_start);
  IF p_is_minor IS NULL OR p_expected_minor IS NULL THEN
    RAISE EXCEPTION 'invalid_privacy';
  END IF;
  IF clean_nickname IS NOT NULL AND (char_length(clean_nickname) NOT BETWEEN 3 AND 20 OR clean_nickname ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'invalid_nickname';
  END IF;
  IF minor AND clean_nickname IS NULL THEN
    RAISE EXCEPTION 'nickname_required';
  END IF;
  -- As in set_profile_privacy, since this write sets is_minor either way. The profiles row lock also
  -- comes before the profile_privacy row that this upsert and the placement in get_board hold.
  PERFORM private.lock_minor_change(uid);
  -- Every minority write holds that lock, so the stored value read here holds until this commits.
  IF private.is_minor(uid) IS DISTINCT FROM p_expected_minor THEN
    RAISE EXCEPTION 'privacy_changed';
  END IF;
  -- Read under the halaqa lock lock_minor_change took, so no matched join can slip in after it.
  IF minor THEN
    leaves_matched := EXISTS (
      SELECT 1 FROM public.halaqa_members AS m
      WHERE m.user_id = uid AND m.kind = 'matched' AND m.left_at IS NULL
    );
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
  RETURN public.get_board(p_level_band, p_pace_band, p_utc_offset_minutes, p_today, p_week_start)
    || jsonb_build_object('left_matched', leaves_matched);
END;
$$;

-- One tap: off the board and out of every cohort. The first update takes the caller's
-- profile_privacy row lock, which a board read holds while it places, so a read in flight either
-- commits its placement first, which the second update then closes, or reads board_joined = false.
-- The profiles row is key-shared first, as in get_board, since this holds the privacy row while it
-- closes board_members rows, both of which an account deletion removes after the profile.
CREATE OR REPLACE FUNCTION public.leave_board()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := private.require_user();
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = uid FOR KEY SHARE;
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
  private.study_cards_merge_schedule(),
  private.is_minor(UUID),
  private.activity_public(UUID, BOOLEAN),
  private.lock_minor_change(UUID),
  private.apply_minor_privacy(),
  private.recount_reflection(UUID),
  private.recount_comment(UUID),
  private.visible_step(UUID, INTEGER),
  private.lock_activity_authors(UUID[]),
  private.recount_minor_activity(),
  private.lock_account_activity(),
  private.lock_activity_writer(UUID),
  private.check_promised_visibility(UUID, BOOLEAN),
  private.lock_readable_reflection(UUID),
  private.lock_readable_comment(UUID),
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
  private.live_sabaq_assignments(UUID),
  private.sabaq_assignment_json(public.halaqa_sabaq_assignments),
  private.board_cohort_size(UUID),
  private.board_choose_cohort(DATE, TEXT, TEXT, INTEGER, UUID),
  private.board_place(UUID, DATE, TEXT, TEXT, INTEGER),
  private.board_enroll_pending(DATE),
  private.requeue_board_after_wird_day(),
  private.board_view(UUID, DATE, UUID)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.create_reflection(UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN),
  public.add_reflection_comment(UUID, UUID, TEXT, BOOLEAN),
  public.set_reflection_like(UUID, UUID, BOOLEAN),
  public.set_reflection_comment_like(UUID, UUID, BOOLEAN),
  public.delete_reflection_comment(UUID, UUID),
  public.delete_reflection(UUID, UUID),
  public.get_profile_privacy(),
  public.set_profile_privacy(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN),
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
  public.set_halaqa_sabaq_assignment(UUID, UUID, INTEGER, INTEGER, INTEGER),
  public.clear_halaqa_sabaq_assignment(UUID, UUID),
  public.get_my_sabaq_assignment(),
  public.get_board(TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.refresh_board_bands(TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.join_board(TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.leave_board()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.create_reflection(UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN),
  public.add_reflection_comment(UUID, UUID, TEXT, BOOLEAN),
  public.set_reflection_like(UUID, UUID, BOOLEAN),
  public.set_reflection_comment_like(UUID, UUID, BOOLEAN),
  public.delete_reflection_comment(UUID, UUID),
  public.delete_reflection(UUID, UUID),
  public.get_profile_privacy(),
  public.set_profile_privacy(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN),
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
  public.set_halaqa_sabaq_assignment(UUID, UUID, INTEGER, INTEGER, INTEGER),
  public.clear_halaqa_sabaq_assignment(UUID, UUID),
  public.get_my_sabaq_assignment(),
  public.get_board(TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.refresh_board_bands(TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.join_board(TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, TEXT, INTEGER),
  public.leave_board()
TO authenticated;

-- A profile's opted-in streak and juz completions are public (SOC-01), so signed-out viewers may ask.
GRANT EXECUTE ON FUNCTION public.get_profile_summary(UUID) TO anon;
