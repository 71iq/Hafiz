-- RF166: keep reflection reaction counters correct when one user reacts to another author's post.
-- The counter triggers ran with the reacting user's permissions, and RLS stops that user from
-- updating another author's reflection or comment, so counts drifted. The trigger functions now
-- run as their owner with an empty search path and only act for the reaction table they belong to.
-- Existing counts are recalculated once from the reaction rows.

CREATE OR REPLACE FUNCTION public.update_reflection_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_likes' THEN
    RAISE EXCEPTION 'update_reflection_likes_count only maintains public.reflection_likes';
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reflections SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = NEW.reflection_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reflections SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0) WHERE id = OLD.reflection_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reflection_comments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_comments' THEN
    RAISE EXCEPTION 'update_reflection_comments_count only maintains public.reflection_comments';
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reflections SET comments_count = COALESCE(comments_count, 0) + 1 WHERE id = NEW.reflection_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reflections SET comments_count = GREATEST(COALESCE(comments_count, 0) - 1, 0) WHERE id = OLD.reflection_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reflection_comment_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'reflection_comment_likes' THEN
    RAISE EXCEPTION 'update_reflection_comment_likes_count only maintains public.reflection_comment_likes';
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reflection_comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reflection_comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$;

-- Likes are only added or removed; the app never updates one. With owner-rights counters, moving a
-- like to another reflection by UPDATE would change counts without firing the triggers, so likes
-- get separate insert and delete policies and no UPDATE privilege.
DROP POLICY IF EXISTS "Users can manage own likes" ON public.reflection_likes;
DROP POLICY IF EXISTS "Users can insert own likes" ON public.reflection_likes;
CREATE POLICY "Users can insert own likes"
  ON public.reflection_likes FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can delete own likes" ON public.reflection_likes;
CREATE POLICY "Users can delete own likes"
  ON public.reflection_likes FOR DELETE
  USING ((SELECT auth.uid()) = user_id);
REVOKE UPDATE ON public.reflection_likes FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.reflection_comment_likes FROM PUBLIC, anon, authenticated;

-- Trigger functions are never called directly; nobody needs EXECUTE on them.
REVOKE ALL ON FUNCTION public.update_reflection_likes_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_reflection_comments_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_reflection_comment_likes_count() FROM PUBLIC, anon, authenticated;

-- Recalculate counts that drifted while the triggers ran with caller permissions. The share locks
-- hold back new reactions until both recounts finish, so none is lost between count and update.
DO $$
BEGIN
  LOCK TABLE public.reflection_likes, public.reflection_comments, public.reflection_comment_likes IN SHARE MODE;

  UPDATE public.reflections AS reflection
  SET
    likes_count = (SELECT COUNT(*)::INTEGER FROM public.reflection_likes AS l WHERE l.reflection_id = reflection.id),
    comments_count = (SELECT COUNT(*)::INTEGER FROM public.reflection_comments AS c WHERE c.reflection_id = reflection.id);

  UPDATE public.reflection_comments AS comment
  SET likes_count = (
    SELECT COUNT(*)::INTEGER FROM public.reflection_comment_likes AS l WHERE l.comment_id = comment.id
  );
END;
$$;
