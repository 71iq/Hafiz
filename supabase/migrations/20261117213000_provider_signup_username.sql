-- A provider sign-in (Google, Quran Foundation) sends no username, and profiles.username is
-- required, so the old trigger failed the whole sign-up with "Database error saving new user".
-- Such accounts now get the neutral handle the app already uses for a missing profile
-- (lib/auth/store.ts buildInsertUsername): user_ plus the first eight hex digits of the account id.
-- It never contains the email address or the provider's real name. If another account already
-- owns that handle, the longer user_ plus fifteen hex digits is used instead.
-- A valid requested username is kept as before, so a taken name still fails the email sign-up.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requested_username text := btrim(NEW.raw_user_meta_data->>'username');
  account_hex text := replace(NEW.id::text, '-', '');
BEGIN
  IF requested_username ~ '^[A-Za-z0-9_]{3,20}$' THEN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (NEW.id, requested_username, NEW.raw_user_meta_data->>'display_name');
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (NEW.id, 'user_' || left(account_hex, 8), NEW.raw_user_meta_data->>'display_name');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (NEW.id, 'user_' || left(account_hex, 15), NEW.raw_user_meta_data->>'display_name');
  END;
  RETURN NEW;
END;
$$;
