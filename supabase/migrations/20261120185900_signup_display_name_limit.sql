-- The sign-up trigger keeps the first 60 characters of a requested display name. Released apps do not
-- cap the name at sign-up, and 20261120190000_profile_field_limits.sql limits display_name to 60, so a
-- longer name would otherwise fail the whole account creation. Apply this file before that one.
-- Otherwise the same as 20261117213000_provider_signup_username.sql. Running it again changes nothing.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requested_username text := btrim(NEW.raw_user_meta_data->>'username');
  requested_display_name text := left(NEW.raw_user_meta_data->>'display_name', 60);
  account_hex text := replace(NEW.id::text, '-', '');
BEGIN
  IF requested_username ~ '^[A-Za-z0-9_]{3,20}$' THEN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (NEW.id, requested_username, requested_display_name);
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (NEW.id, 'user_' || left(account_hex, 8), requested_display_name);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (NEW.id, 'user_' || left(account_hex, 15), requested_display_name);
  END;
  RETURN NEW;
END;
$$;
