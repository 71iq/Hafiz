export type Reflection = {
  id: string;
  user_id: string;
  surah: number;
  ayah_start: number;
  ayah_end: number;
  juz_start?: number | null;
  juz_end?: number | null;
  content: string;
  likes_count: number;
  comments_count: number;
  status: "active" | "hidden" | "deleted";
  created_at: string;
  updated_at: string;
  profiles?: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
  user_has_liked?: boolean;
};

export type ReflectionComment = {
  id: string;
  reflection_id: string;
  user_id: string;
  content: string;
  likes_count: number;
  created_at: string;
  profiles?: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
  user_has_liked?: boolean;
};

export type ReflectionFeedSort = "newest" | "popular";

export function normalizeFeedSort(value: unknown): ReflectionFeedSort {
  return value === "popular" ? "popular" : "newest";
}
export type ReflectionCommentSort = "popular" | "oldest" | "newest";

export type ReflectionFeedFilter =
  | { type: "all" }
  | { type: "surah"; surah: number }
  | { type: "juz"; juz: number };

export type ReflectionJuzRange = {
  juz: number;
  surah: number;
  ayah_start: number;
  ayah_end: number;
};
