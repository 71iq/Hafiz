ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country TEXT;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_country_length_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_country_length_check
  CHECK (country IS NULL OR char_length(country) <= 80);
