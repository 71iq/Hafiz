-- RF170: comments, likes and comment likes follow their reflection's visibility.
-- They were readable by anyone even when the reflection was hidden or soft-deleted. A child row is now
-- visible only when its parent is visible to the viewer. The parent lookups below run under the
-- parent tables' own RLS, and reflections are readable only while active, so discussion on active
-- reflections stays public and disappears with a hidden or soft-deleted reflection. New reactions
-- also require a visible parent. Hard deletes still cascade.

DROP POLICY IF EXISTS "Likes are publicly readable" ON public.reflection_likes;
DROP POLICY IF EXISTS "Likes follow reflection visibility" ON public.reflection_likes;
CREATE POLICY "Likes follow reflection visibility"
  ON public.reflection_likes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reflections AS r WHERE r.id = reflection_id));

-- The original FOR ALL likes policy would bypass both checks; RF166 drops it too.
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
