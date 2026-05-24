import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type {
  Reflection,
  ReflectionComment,
  ReflectionCommentSort,
  ReflectionFeedFilter,
  ReflectionFeedSort,
  ReflectionJuzRange,
} from "./types";

const PAGE_SIZE = 5;
const FEED_PAGE_SIZE = 10;
const COMMENT_PAGE_SIZE = 20;
const MAX_SEARCH_LENGTH = 120;

function pageBounds(page: number, pageSize: number) {
  const from = page * pageSize;
  return { from, to: from + pageSize };
}

function pageResult<T>(rows: T[], pageSize: number): { data: T[]; hasMore: boolean } {
  const hasMore = rows.length > pageSize;
  return { data: hasMore ? rows.slice(0, pageSize) : rows, hasMore };
}

function isMissingJuzColumnsError(error: { code?: string; message?: string } | null): boolean {
  return !!(
    error &&
    (error.code === "PGRST204" ||
      error.code === "PGRST205" ||
      error.message?.includes("juz_start") ||
      error.message?.includes("juz_end"))
  );
}

function isMissingColumnError(error: { code?: string; message?: string } | null, column: string): boolean {
  return !!(
    error &&
    (error.code === "PGRST204" ||
      error.code === "PGRST205" ||
      error.message?.includes(column))
  );
}

function normalizeSearchTerm(value?: string): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_SEARCH_LENGTH);
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

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

  const { from, to } = pageBounds(page, PAGE_SIZE);

  const { data, error } = await supabase
    .from("reflections")
    .select("*, profiles:profiles!reflections_user_id_fkey(username, display_name, avatar_url)")
    .eq("surah", surah)
    .lte("ayah_start", ayah)
    .gte("ayah_end", ayah)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;

  const resultPage = pageResult((data ?? []) as Reflection[], PAGE_SIZE);
  const trimmed = await attachUserLikes(resultPage.data, userId);
  return { data: trimmed, hasMore: resultPage.hasMore };
}

/** Fetch the global reflection feed with optional Quran filters */
export async function fetchReflectionFeed({
  filter,
  sort,
  page,
  userId,
  juzRanges,
  searchTerm,
}: {
  filter: ReflectionFeedFilter;
  sort: ReflectionFeedSort;
  page: number;
  userId?: string;
  juzRanges?: ReflectionJuzRange[];
  searchTerm?: string;
}): Promise<{ data: Reflection[]; hasMore: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], hasMore: false };

  const { from, to } = pageBounds(page, FEED_PAGE_SIZE);
  const normalizedSearch = normalizeSearchTerm(searchTerm);

  let query = supabase
    .from("reflections")
    .select("*, profiles:profiles!reflections_user_id_fkey(username, display_name, avatar_url)")
    .eq("status", "active");

  if (filter.type === "surah") {
    query = query.eq("surah", filter.surah);
  } else if (filter.type === "juz") {
    const filters = (juzRanges ?? [])
      .filter((range) => range.juz === filter.juz)
      .map((range) => `and(surah.eq.${range.surah},ayah_start.lte.${range.ayah_end},ayah_end.gte.${range.ayah_start})`);
    if (filters.length === 0) return { data: [], hasMore: false };
    query = query.or(filters.join(","));
  }

  if (normalizedSearch) {
    query = query.ilike("content", `%${escapeIlikePattern(normalizedSearch)}%`);
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

  const pageResultData = pageResult((data ?? []) as Reflection[], FEED_PAGE_SIZE);
  const trimmed = await attachUserLikes(pageResultData.data, userId);

  return { data: trimmed, hasMore: pageResultData.hasMore };
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
  const insertPayload = {
    user_id: userId,
    surah,
    ayah_start: ayahStart,
    ayah_end: ayahEnd,
    juz_start: juzStart,
    juz_end: juzEnd,
    content,
  };
  const { data, error } = await supabase
    .from("reflections")
    .insert(insertPayload)
    .select("*, profiles:profiles!reflections_user_id_fkey(username, display_name, avatar_url)")
    .single();

  if (isMissingJuzColumnsError(error)) {
    const fallback = await supabase
      .from("reflections")
      .insert({ user_id: userId, surah, ayah_start: ayahStart, ayah_end: ayahEnd, content })
      .select("*, profiles:profiles!reflections_user_id_fkey(username, display_name, avatar_url)")
      .single();

    if (fallback.error) throw fallback.error;
    return { ...(fallback.data as Reflection), juz_start: juzStart, juz_end: juzEnd };
  }

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
  reflectionId: string,
  page: number,
  sort: ReflectionCommentSort = "oldest"
): Promise<{ data: ReflectionComment[]; hasMore: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], hasMore: false };

  const { from, to } = pageBounds(page, COMMENT_PAGE_SIZE);
  const buildQuery = () =>
    supabase
      .from("reflection_comments")
      .select("*, profiles:profiles!reflection_comments_user_id_fkey(username, display_name, avatar_url)")
      .eq("reflection_id", reflectionId);

  const applySort = (query: ReturnType<typeof buildQuery>, nextSort: ReflectionCommentSort, usePopularity: boolean) => {
    if (nextSort === "newest") return query.order("created_at", { ascending: false });
    if (nextSort === "popular" && usePopularity) {
      return query.order("likes_count", { ascending: false }).order("created_at", { ascending: false });
    }
    if (nextSort === "popular") return query.order("created_at", { ascending: false });
    return query.order("created_at", { ascending: true });
  };

  const { data, error } = await applySort(buildQuery(), sort, true).range(from, to);

  if (error && sort === "popular" && isMissingColumnError(error, "likes_count")) {
    const fallback = await applySort(buildQuery(), sort, false).range(from, to);
    if (fallback.error) throw fallback.error;
    return pageResult((fallback.data ?? []) as ReflectionComment[], COMMENT_PAGE_SIZE);
  }

  if (error) throw error;
  return pageResult((data ?? []) as ReflectionComment[], COMMENT_PAGE_SIZE);
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
    .select("*, profiles:profiles!reflection_comments_user_id_fkey(username, display_name, avatar_url)")
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
