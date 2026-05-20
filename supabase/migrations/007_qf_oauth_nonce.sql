ALTER TABLE public.qf_oauth_states
  ADD COLUMN IF NOT EXISTS nonce TEXT;
