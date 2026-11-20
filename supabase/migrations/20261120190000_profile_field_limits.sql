-- Server-side limits for the profile fields other people see, matching what the app already enforces.
-- The API lets an account write its own profiles row directly, so until now only the length of a
-- username was checked:
-- - username: 3 to 20 English letters, digits or underscores (app/auth/signup.tsx), not only 3 to 20
--   characters of anything.
-- - display_name: at most 60 characters, the profile editor's limit.
-- - avatar_url: a file in the owner's own folder of an avatars bucket, named as uploadProfileAvatar
--   names it (lib/profile/avatar.ts): <bucket URL>/<owner id>/<digits>.<jpg|png|webp|gif>.
--
-- A CHECK constraint cannot read configuration, so it cannot name this deployment's API host. The
-- host is pinned by private.avatar_public_prefix instead: one row holding the avatars bucket's public
-- URL, which a trigger compares with every photo address written. Without a row the CHECK still
-- applies on any host, so local and test databases work unchanged. Production needs the row:
--   INSERT INTO private.avatar_public_prefix (prefix)
--   VALUES ('https://api.hafizquran.app/storage/v1/object/public/avatars/')
--   ON CONFLICT (only_row) DO UPDATE SET prefix = EXCLUDED.prefix;
-- The table is in pg_dump backups and restores with the data, which a database setting would not.
--
-- Apply 20261120185900_signup_display_name_limit.sql first: it keeps a long sign-up display name
-- from failing account creation once display_name is limited.
--
-- Adding a constraint checks every existing row and stops the migration if one fails. On 2026-11-20
-- all 12 production profiles met these limits (read-only count). Run in one transaction
-- (psql --single-transaction); running it again changes nothing.

-- ─── 1. Field limits ─────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format,
  DROP CONSTRAINT IF EXISTS profiles_display_name_length,
  DROP CONSTRAINT IF EXISTS profiles_avatar_url_own_file;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  ADD CONSTRAINT profiles_display_name_length CHECK (display_name IS NULL OR char_length(display_name) <= 60),
  ADD CONSTRAINT profiles_avatar_url_own_file CHECK (
    avatar_url IS NULL
    OR avatar_url ~ ('^https?://[^/?#@]+/storage/v1/object/public/avatars/' || id::text || '/[0-9]{1,20}\.(jpg|png|webp|gif)$')
  );

-- ─── 2. The deployment's avatars bucket ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS private.avatar_public_prefix (
  only_row BOOLEAN PRIMARY KEY DEFAULT true CHECK (only_row),
  prefix TEXT NOT NULL CHECK (prefix ~ '^https://[^/?#@]+/storage/v1/object/public/avatars/$')
);
REVOKE ALL ON private.avatar_public_prefix FROM PUBLIC, anon, authenticated;

-- Runs after profiles_minor_photo (triggers fire in name order), so a minor's photo is already cleared.
CREATE OR REPLACE FUNCTION private.profiles_photo_host()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  expected TEXT;
BEGIN
  IF NEW.avatar_url IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT prefix INTO expected FROM private.avatar_public_prefix;
  IF expected IS NOT NULL AND left(NEW.avatar_url, char_length(expected)) <> expected THEN
    RAISE EXCEPTION 'A profile photo must be in this project''s avatars bucket'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.profiles_photo_host() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_photo_host ON public.profiles;
CREATE TRIGGER profiles_photo_host BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.profiles_photo_host();
