import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Reflection, ReflectionComment, ReflectionFeedFilter, ReflectionFeedSort } from "./types";

const PAGE_SIZE = 5;
const FEED_PAGE_SIZE = 10;

async function attachUserLikes(reflections: Reflection[], userId?: string): Promise<Reflection[]> {
  if (!userId || reflections.length === 0) return reflections;

  const { data: likes } = await supabase
    .from("reflection_likes")
    .select("reflection_id")
    .eq("user_id", userId)
    .in(
      "reflection_id",
      reflections.map((r) => r.id)
    );

  const likedSet = new Set((likes ?? []).map((l) => l.reflection_id));
  return reflections.map((reflection) => ({
    ...reflection,
    user_has_liked: likedSet.has(reflection.id),
  }));
}

/** Fetch reflections for a specific ayah (or range that includes it) */
export async function fetchReflections(
  surah: number,
  ayah: number,
  page: number,
  userId?: string
): Promise<{ data: Reflection[]; hasMore: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], hasMore: false };

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE;

  const { data, error } = await supabase
    .from("reflections")
    .select("*, profiles:profiles!reflections_user_id_fkey(username, display_name)")
    .eq("surah", surah)
    .lte("ayah_start", ayah)
    .gte("ayah_end", ayah)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;

  const reflections = (data ?? []) as Reflection[];
  const hasMore = reflections.length > PAGE_SIZE;
  const trimmed = await attachUserLikes(hasMore ? reflections.slice(0, PAGE_SIZE) : reflections, userId);
  return { data: trimmed, hasMore };
}

/** Fetch the global reflection feed with optional Quran filters */
export async function fetchReflectionFeed({
  filter,
  sort,
  page,
  userId,
}: {
  filter: ReflectionFeedFilter;
  sort: ReflectionFeedSort;
  page: number;
  userId?: string;
}): Promise<{ data: Reflection[]; hasMore: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], hasMore: false };

  const from = page * FEED_PAGE_SIZE;
  const to = from + FEED_PAGE_SIZE;

  let query = supabase
    .from("reflections")
    .select("*, profiles:profiles!reflections_user_id_fkey(username, display_name)")
    .eq("status", "active");

  if (filter.type === "surah") {
    query = query.eq("surah", filter.surah);
  } else if (filter.type === "juz") {
    query = query.lte("juz_start", filter.juz).gte("juz_end", filter.juz);
  }

  switch (sort) {
    case "oldest":
      query = query
        .order("created_at", { ascending: true })
        .order("likes_count", { ascending: false })
        .order("comments_count", { ascending: false });
      break;
    case "popular":
      query = query
        .order("likes_count", { ascending: false })
        .order("comments_count", { ascending: false })
        .order("created_at", { ascending: false });
      break;
    case "less":
      query = query
        .order("likes_count", { ascending: true })
        .order("comments_count", { ascending: true })
        .order("created_at", { ascending: false });
      break;
    case "newest":
    default:
      query = query
        .order("created_at", { ascending: false })
        .order("likes_count", { ascending: false })
        .order("comments_count", { ascending: false });
      break;
  }

  const { data, error } = await query.range(from, to);
  if (error) throw error;

  const reflections = (data ?? []) as Reflection[];
  const hasMore = reflections.length > FEED_PAGE_SIZE;
  const trimmed = await attachUserLikes(hasMore ? reflections.slice(0, FEED_PAGE_SIZE) : reflections, userId);

  return { data: trimmed, hasMore };
}

/** Get reflection count for an ayah */
export async function fetchReflectionCount(
  surah: number,
  ayah: number
): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  const { count, error } = await supabase
    .from("reflections")
    .select("*", { count: "exact", head: true })
    .eq("surah", surah)
    .lte("ayah_start", ayah)
    .gte("ayah_end", ayah)
    .eq("status", "active");

  if (error) throw error;
  return count ?? 0;
}

/** Create a new reflection */
export async function createReflection(
  userId: string,
  surah: number,
  ayahStart: number,
  ayahEnd: number,
  juzStart: number,
  juzEnd: number,
  content: string
): Promise<Reflection> {
  const { data, error } = await supabase
    .from("reflections")
    .insert({
      user_id: userId,
      surah,
      ayah_start: ayahStart,
      ayah_end: ayahEnd,
      juz_start: juzStart,
      juz_end: juzEnd,
      content,
    })
    .select("*, profiles:profiles!reflections_user_id_fkey(username, display_name)")
    .single();

  if (error) throw error;
  return data as Reflection;
}

/** Toggle like on a reflection */
export async function toggleLike(
  userId: string,
  reflectionId: string,
  currentlyLiked: boolean
): Promise<boolean> {
  if (currentlyLiked) {
    const { error } = await supabase
      .from("reflection_likes")
      .delete()
      .eq("user_id", userId)
      .eq("reflection_id", reflectionId);
    if (error) throw error;
    return false;
  } else {
    const { error } = await supabase
      .from("reflection_likes")
      .insert({ user_id: userId, reflection_id: reflectionId });
    if (error) throw error;
    return true;
  }
}

/** Fetch comments for a reflection */
export async function fetchComments(
  reflectionId: string
): Promise<ReflectionComment[]> {
  const { data, error } = await supabase
    .from("reflection_comments")
    .select("*, profiles:profiles!reflection_comments_user_id_fkey(username, display_name)")
    .eq("reflection_id", reflectionId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ReflectionComment[];
}

/** Add a comment to a reflection */
export async function addComment(
  userId: string,
  reflectionId: string,
  content: string
): Promise<ReflectionComment> {
  const { data, error } = await supabase
    .from("reflection_comments")
    .insert({ user_id: userId, reflection_id: reflectionId, content })
    .select("*, profiles:profiles!reflection_comments_user_id_fkey(username, display_name)")
    .single();

  if (error) throw error;
  return data as ReflectionComment;
}

/** Report a reflection */
export async function reportReflection(
  reporterId: string,
  reflectionId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase
    .from("reports")
    .insert({ reporter_id: reporterId, reflection_id: reflectionId, reason });

  if (error) throw error;
}
