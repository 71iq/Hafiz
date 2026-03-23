export type Reflection = {
  id: string;
  user_id: string;
  surah: number;
  ayah_start: number;
  ayah_end: number;
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
  };
  // Whether the current user has liked this reflection
  user_has_liked?: boolean;
};

export type ReflectionComment = {
  id: string;
  reflection_id: string;
  user_id: string;
  content: string;
  created_at: string;
  // Joined from profiles
  profiles?: {
    username: string;
    display_name: string | null;
  };
};
