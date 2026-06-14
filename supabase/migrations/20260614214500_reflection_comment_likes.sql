ALTER TABLE public.reflection_comments
  ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.reflection_comment_likes (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.reflection_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);

ALTER TABLE public.reflection_comment_likes ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.reflection_comment_likes TO anon, authenticated;
GRANT INSERT, DELETE ON public.reflection_comment_likes TO authenticated;

DROP POLICY IF EXISTS "Comment likes are publicly readable" ON public.reflection_comment_likes;
CREATE POLICY "Comment likes are publicly readable"
  ON public.reflection_comment_likes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert own comment likes" ON public.reflection_comment_likes;
CREATE POLICY "Users can insert own comment likes"
  ON public.reflection_comment_likes FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own comment likes" ON public.reflection_comment_likes;
CREATE POLICY "Users can delete own comment likes"
  ON public.reflection_comment_likes FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.update_reflection_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reflection_comments
    SET likes_count = likes_count + 1
    WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reflection_comments
    SET likes_count = GREATEST(likes_count - 1, 0)
    WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reflection_comment_likes_count ON public.reflection_comment_likes;
CREATE TRIGGER trg_reflection_comment_likes_count
  AFTER INSERT OR DELETE ON public.reflection_comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.update_reflection_comment_likes_count();

UPDATE public.reflection_comments AS comment
SET likes_count = counts.likes_count
FROM (
  SELECT comment_id, COUNT(*)::INTEGER AS likes_count
  FROM public.reflection_comment_likes
  GROUP BY comment_id
) AS counts
WHERE comment.id = counts.comment_id;

CREATE INDEX IF NOT EXISTS idx_reflection_comment_likes_comment
  ON public.reflection_comment_likes(comment_id);

CREATE INDEX IF NOT EXISTS idx_reflection_comments_popular
  ON public.reflection_comments(reflection_id, likes_count DESC, created_at DESC);
