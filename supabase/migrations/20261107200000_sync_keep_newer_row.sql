-- RF169: keep the newer synced row when an older device write arrives after a newer one.
--
-- Clients check the remote timestamp before uploading, but another device can write between that
-- read and the upsert. This BEFORE UPDATE trigger repeats the same comparison under the row lock
-- that INSERT ... ON CONFLICT DO UPDATE holds, and skips the update when the stored row is strictly
-- newer. Equal times still update, matching the client rule. Inserts, deletes and server updates
-- that leave the timestamps unchanged are not affected. A skipped update returns success, so the
-- client acknowledges its queue entry and later pulls the newer row.
--
-- Trigger arguments name the timestamp columns in client precedence order; the first non-null one
-- is the row's time.
--
-- An upload that omits updated_at keeps the stored value, so the guard sees equal times and only the
-- client pre-check protects it. An administrative repair that lowers or clears a row time is skipped
-- silently; disable the trigger for that repair.

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
