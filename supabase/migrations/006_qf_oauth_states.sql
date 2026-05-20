CREATE TABLE IF NOT EXISTS public.qf_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_verifier_ciphertext TEXT NOT NULL,
  nonce TEXT,
  redirect_uri TEXT NOT NULL,
  return_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

ALTER TABLE public.qf_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_qf_oauth_states_user
  ON public.qf_oauth_states(user_id, expires_at);
