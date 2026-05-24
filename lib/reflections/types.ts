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
  // Joined from profiles
  profiles?: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
  // Whether the current user has liked this reflection
  user_has_liked?: boolean;
};

export type ReflectionComment = {
  id: string;
  reflection_id: string;
  user_id: string;
  content: string;
  likes_count?: number | null;
  created_at: string;
  // Joined from profiles
  profiles?: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
};

export type ReflectionFeedSort = "newest" | "oldest" | "popular" | "less";
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
