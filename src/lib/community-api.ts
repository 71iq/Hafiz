import { supabase } from "./supabase";
import type { Post, Comment, LeaderboardEntry } from "./community-types";

const PAGE_SIZE = 20;

export async function fetchPosts(
  cursor?: string
): Promise<{ posts: Post[]; nextCursor: string | null }> {
  let query = supabase
    .from("posts_with_counts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const posts = (data ?? []) as Post[];
  const nextCursor =
    posts.length === PAGE_SIZE
      ? posts[posts.length - 1].created_at
      : null;

  return { posts, nextCursor };
}

export async function createPost(
  userId: string,
  surah: number,
  ayah: number,
  ayahText: string,
  content: string
): Promise<void> {
  const { error } = await supabase.from("posts").insert({
    user_id: userId,
    surah,
    ayah,
    ayah_text: ayahText,
    content,
  });
  if (error) throw new Error(error.message);
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) throw new Error(error.message);
}

export async function fetchComments(postId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select(
      "id, post_id, user_id, content, created_at, profiles:user_id (display_name, username)"
    )
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    post_id: row.post_id,
    user_id: row.user_id,
    content: row.content,
    created_at: row.created_at,
    author_name:
      row.profiles?.display_name ?? row.profiles?.username ?? "Anonymous",
  }));
}

export async function createComment(
  postId: string,
  userId: string,
  content: string
): Promise<void> {
  const { error } = await supabase.from("comments").insert({
    post_id: postId,
    user_id: userId,
    content,
  });
  if (error) throw new Error(error.message);
}

export async function toggleLike(
  postId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("likes")
    .select("user_id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();

  if (data) {
    const { error } = await supabase
      .from("likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return false; // unliked
  } else {
    const { error } = await supabase
      .from("likes")
      .insert({ post_id: postId, user_id: userId });
    if (error) throw new Error(error.message);
    return true; // liked
  }
}

export async function checkUserLikes(
  postIds: string[],
  userId: string
): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from("likes")
    .select("post_id")
    .eq("user_id", userId)
    .in("post_id", postIds);

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: any) => r.post_id));
}

export async function fetchLeaderboard(
  sortBy: "score" | "current_streak",
  limit = 50
): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, username, score, current_streak, longest_streak")
    .order(sortBy, { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as LeaderboardEntry[];
}
