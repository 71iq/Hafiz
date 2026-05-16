ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qf_bookmark_id TEXT,
  ADD COLUMN IF NOT EXISTS qf_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qf_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS qf_is_in_default_collection BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qf_collections_count INTEGER NOT NULL DEFAULT 0;

UPDATE public.bookmarks
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE public.bookmarks
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.private_notes
  ADD COLUMN IF NOT EXISTS qf_note_id TEXT,
  ADD COLUMN IF NOT EXISTS qf_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qf_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS qf_ranges_json JSONB;

CREATE TABLE IF NOT EXISTS public.qf_user_connections (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  qf_subject TEXT,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT[] NOT NULL DEFAULT '{}',
  env TEXT NOT NULL CHECK (env IN ('prelive', 'production')),
  status TEXT NOT NULL CHECK (status IN ('connected', 'needs_reauth', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.qf_user_connections ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_updated ON public.bookmarks(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_qf_id ON public.bookmarks(user_id, qf_bookmark_id);
CREATE INDEX IF NOT EXISTS idx_private_notes_qf_id ON public.private_notes(user_id, qf_note_id);
CREATE INDEX IF NOT EXISTS idx_qf_user_connections_status ON public.qf_user_connections(status, env);
