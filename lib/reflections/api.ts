import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type {
  Reflection,
  ReflectionComment,
  ReflectionCommentSort,
  ReflectionFeedFilter,
  ReflectionFeedSort,
  ReflectionJuzRange,
} from "./types";
import { parseCommentRow, parseCommentRows, parseReflectionRow, parseReflectionRows, parseSavedRow } from "./rows";

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

type CompatibilityError = { code?: string; message?: string; details?: string; hint?: string } | null;
function hasNamedMissingColumn(error: CompatibilityError, column: string): boolean {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = `["']?${escapedColumn}["']?`;
  const postgrest = new RegExp(`could not find (?:the )?${quoted} column(?: of| in|$)`).test(text);
  const postgres = new RegExp(
    `column\\s+(?:"?[a-z0-9_]+"?\\.){0,2}${quoted}(?:\\s+of\\s+relation\\s+["'a-z0-9_.]+)?\\s+does not exist`,
  ).test(text);
  if (error.code === "PGRST204") return postgrest;
  if (error.code === "42703") return postgres;
  return !error.code && (postgrest || postgres);
}
function isMissingJuzColumnsError(error: CompatibilityError): boolean {
  return hasNamedMissingColumn(error, "juz_start") || hasNamedMissingColumn(error, "juz_end");
}
function isMissingColumnError(error: CompatibilityError, column: string): boolean {
  return hasNamedMissingColumn(error, column);
}
function isMissingCommentLikesTableError(error: CompatibilityError): boolean {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  const table = `["']?(?:"?public"?\\.)?"?reflection_comment_likes"?["']?(?=\\s|$)`;
  const postgrest = new RegExp(`could not find (?:the )?table ${table}`).test(text);
  const postgres = new RegExp(`relation\\s+${table}\\s+does not exist`).test(text);
  if (error.code === "PGRST205") return postgrest;
  if (error.code === "42P01") return postgres;
  return !error.code && (postgrest || postgres);
}

function normalizeSearchTerm(value?: string): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_SEARCH_LENGTH);
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

async function attachUserLikes(reflections: Reflection[], userId?: string): Promise<Reflection[]> {
  if (!userId || reflections.length === 0) return reflections;

  const { data: likes, error } = await supabase
    .from("reflection_likes")
    .select("reflection_id")
    .eq("user_id", userId)
    .in(
      "reflection_id",
      reflections.map((r) => r.id),
    );

  if (error) throw error;

  const likedSet = new Set((likes ?? []).map((l) => l.reflection_id));
  return reflections.map((reflection) => ({
    ...reflection,
    user_has_liked: likedSet.has(reflection.id),
  }));
}

async function attachUserCommentLikes(comments: ReflectionComment[], userId?: string): Promise<ReflectionComment[]> {
  if (!userId || comments.length === 0) return comments;

  const { data: likes, error } = await supabase
    .from("reflection_comment_likes")
    .select("comment_id")
    .eq("user_id", userId)
    .in(
      "comment_id",
      comments.map((comment) => comment.id),
    );

  if (error) {
    if (isMissingCommentLikesTableError(error)) return comments;
    throw error;
  }

  const likedSet = new Set((likes ?? []).map((like) => like.comment_id));
  return comments.map((comment) => ({
    ...comment,
    user_has_liked: likedSet.has(comment.id),
  }));
}

/** Fetch reflections for a specific ayah (or range that includes it) */
export async function fetchReflections(
  surah: number,
  ayah: number,
  page: number,
  userId?: string,
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

  const resultPage = pageResult(parseReflectionRows(data), PAGE_SIZE);
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

  const pageResultData = pageResult(parseReflectionRows(data), FEED_PAGE_SIZE);
  const trimmed = await attachUserLikes(pageResultData.data, userId);

  return { data: trimmed, hasMore: pageResultData.hasMore };
}

/** Get reflection count for an ayah */
export async function fetchReflectionCount(surah: number, ayah: number): Promise<number> {
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
  content: string,
  canContinue: () => boolean = () => true,
): Promise<Reflection> {
  if (!canContinue()) throw new Error("Reflection creation superseded");
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

  if (isMissingJuzColumnsError(error) && canContinue()) {
    const fallback = await supabase
      .from("reflections")
      .insert({ user_id: userId, surah, ayah_start: ayahStart, ayah_end: ayahEnd, content })
      .select("*, profiles:profiles!reflections_user_id_fkey(username, display_name, avatar_url)")
      .single();

    if (fallback.error) throw fallback.error;
    return { ...parseSavedRow("reflection", parseReflectionRow, fallback.data), juz_start: juzStart, juz_end: juzEnd };
  }

  if (error) throw error;
  return parseSavedRow("reflection", parseReflectionRow, data);
}

/** Toggle like on a reflection */
export async function toggleLike(userId: string, reflectionId: string, currentlyLiked: boolean): Promise<boolean> {
  if (currentlyLiked) {
    const { error } = await supabase
      .from("reflection_likes")
      .delete()
      .eq("user_id", userId)
      .eq("reflection_id", reflectionId);
    if (error) throw error;
    return false;
  } else {
    const { error } = await supabase.from("reflection_likes").insert({ user_id: userId, reflection_id: reflectionId });
    if (error) throw error;
    return true;
  }
}

/** Fetch comments for a reflection */
export async function fetchComments(
  reflectionId: string,
  page: number,
  sort: ReflectionCommentSort = "oldest",
  userId?: string,
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
    const result = pageResult(parseCommentRows(fallback.data), COMMENT_PAGE_SIZE);
    return { ...result, data: await attachUserCommentLikes(result.data, userId) };
  }

  if (error) throw error;
  const result = pageResult(parseCommentRows(data), COMMENT_PAGE_SIZE);
  return { ...result, data: await attachUserCommentLikes(result.data, userId) };
}

/** Add a comment to a reflection */
export async function addComment(userId: string, reflectionId: string, content: string): Promise<ReflectionComment> {
  const { data, error } = await supabase
    .from("reflection_comments")
    .insert({ user_id: userId, reflection_id: reflectionId, content })
    .select("*, profiles:profiles!reflection_comments_user_id_fkey(username, display_name, avatar_url)")
    .single();

  if (error) throw error;
  return { ...parseSavedRow("comment", parseCommentRow, data), user_has_liked: false };
}

/** Toggle like on a comment */
export async function toggleCommentLike(userId: string, commentId: string, currentlyLiked: boolean): Promise<boolean> {
  if (currentlyLiked) {
    const { error } = await supabase
      .from("reflection_comment_likes")
      .delete()
      .eq("user_id", userId)
      .eq("comment_id", commentId);
    if (error) throw error;
    return false;
  }

  const { error } = await supabase.from("reflection_comment_likes").insert({ user_id: userId, comment_id: commentId });
  if (error) throw error;
  return true;
}

/** Report a reflection */
export async function reportReflection(reporterId: string, reflectionId: string, reason?: string): Promise<void> {
  const { error } = await supabase
    .from("reports")
    .insert({ reporter_id: reporterId, reflection_id: reflectionId, reason });

  if (error) throw error;
}
