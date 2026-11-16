
DROP POLICY IF EXISTS "Likes are publicly readable" ON public.reflection_likes;
DROP POLICY IF EXISTS "Likes follow reflection visibility" ON public.reflection_likes;
CREATE POLICY "Likes follow reflection visibility"
  ON public.reflection_likes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id));

DROP POLICY IF EXISTS "Users can manage own likes" ON public.reflection_likes;
DROP POLICY IF EXISTS "Users can insert own likes" ON public.reflection_likes;
CREATE POLICY "Users can insert own likes"
  ON public.reflection_likes FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id)
  );

DROP POLICY IF EXISTS "Comments are publicly readable" ON public.reflection_comments;
DROP POLICY IF EXISTS "Comments follow reflection visibility" ON public.reflection_comments;
CREATE POLICY "Comments follow reflection visibility"
  ON public.reflection_comments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id));

DROP POLICY IF EXISTS "Users can insert own comments" ON public.reflection_comments;
CREATE POLICY "Users can insert own comments"
  ON public.reflection_comments FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id)
  );

DROP POLICY IF EXISTS "Comment likes are publicly readable" ON public.reflection_comment_likes;
DROP POLICY IF EXISTS "Comment likes follow reflection visibility" ON public.reflection_comment_likes;
CREATE POLICY "Comment likes follow reflection visibility"
  ON public.reflection_comment_likes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflection_comments AS c WHERE c.id = comment_id));

DROP POLICY IF EXISTS "Users can insert own comment likes" ON public.reflection_comment_likes;
CREATE POLICY "Users can insert own comment likes"
  ON public.reflection_comment_likes FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.reflection_comments AS c WHERE c.id = comment_id)
  );
