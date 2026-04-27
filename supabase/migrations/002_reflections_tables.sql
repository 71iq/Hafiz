CREATE TABLE IF NOT EXISTS public.reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah_start INTEGER NOT NULL,
  ayah_end INTEGER NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 10 AND 5000),
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reflection_likes (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  reflection_id UUID REFERENCES public.reflections(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, reflection_id)
);

CREATE TABLE IF NOT EXISTS public.reflection_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reflection_id UUID REFERENCES public.reflections(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  reflection_id UUID REFERENCES public.reflections(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reflection_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reflection_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active reflections are publicly readable" ON public.reflections;
CREATE POLICY "Active reflections are publicly readable"
  ON public.reflections FOR SELECT
  USING (status = 'active');

DROP POLICY IF EXISTS "Users can insert own reflections" ON public.reflections;
CREATE POLICY "Users can insert own reflections"
  ON public.reflections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own reflections" ON public.reflections;
CREATE POLICY "Users can update own reflections"
  ON public.reflections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own reflections" ON public.reflections;
CREATE POLICY "Users can delete own reflections"
  ON public.reflections FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Likes are publicly readable" ON public.reflection_likes;
CREATE POLICY "Likes are publicly readable"
  ON public.reflection_likes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can manage own likes" ON public.reflection_likes;
CREATE POLICY "Users can manage own likes"
  ON public.reflection_likes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Comments are publicly readable" ON public.reflection_comments;
CREATE POLICY "Comments are publicly readable"
  ON public.reflection_comments FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert own comments" ON public.reflection_comments;
CREATE POLICY "Users can insert own comments"
  ON public.reflection_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own comments" ON public.reflection_comments;
CREATE POLICY "Users can delete own comments"
  ON public.reflection_comments FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can see own reports" ON public.reports;
CREATE POLICY "Users can see own reports"
  ON public.reports FOR SELECT
  USING (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Users can insert reports" ON public.reports;
CREATE POLICY "Users can insert reports"
  ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

CREATE OR REPLACE FUNCTION public.update_reflection_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reflections SET likes_count = likes_count + 1 WHERE id = NEW.reflection_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reflections SET likes_count = likes_count - 1 WHERE id = OLD.reflection_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reflection_likes_count ON public.reflection_likes;
CREATE TRIGGER trg_reflection_likes_count
  AFTER INSERT OR DELETE ON public.reflection_likes
  FOR EACH ROW EXECUTE FUNCTION public.update_reflection_likes_count();

CREATE OR REPLACE FUNCTION public.update_reflection_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reflections SET comments_count = comments_count + 1 WHERE id = NEW.reflection_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reflections SET comments_count = comments_count - 1 WHERE id = OLD.reflection_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reflection_comments_count ON public.reflection_comments;
CREATE TRIGGER trg_reflection_comments_count
  AFTER INSERT OR DELETE ON public.reflection_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_reflection_comments_count();

CREATE INDEX IF NOT EXISTS idx_reflections_ayah ON public.reflections(surah, ayah_start, ayah_end);
CREATE INDEX IF NOT EXISTS idx_reflections_user ON public.reflections(user_id);
CREATE INDEX IF NOT EXISTS idx_reflection_likes_reflection ON public.reflection_likes(reflection_id);
CREATE INDEX IF NOT EXISTS idx_reflection_comments_reflection ON public.reflection_comments(reflection_id);
CREATE INDEX IF NOT EXISTS idx_reports_reflection ON public.reports(reflection_id);
