ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_bio_length_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_bio_length_check
  CHECK (bio IS NULL OR char_length(bio) <= 280);
