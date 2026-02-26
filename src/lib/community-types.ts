export interface Post {
  id: string;
  user_id: string;
  surah: number;
  ayah: number;
  ayah_text: string;
  content: string;
  created_at: string;
  author_name: string;
  like_count: number;
  comment_count: number;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author_name: string;
}

export interface LeaderboardEntry {
  id: string;
  display_name: string | null;
  username: string | null;
  score: number;
  current_streak: number;
  longest_streak: number;
}
