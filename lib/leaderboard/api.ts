import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type LeaderboardEntry = {
  user_id: string;
  username: string;
  display_name: string | null;
  score: number;
  rank: number;
};

/** Daily leaderboard: top scorers today */
export async function fetchDailyLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured()) return [];

  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("daily_scores")
    .select("user_id, score, profiles:profiles!daily_scores_user_id_fkey(username, display_name)")
    .eq("date", today)
    .order("score", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map((row: any, i: number) => ({
    user_id: row.user_id,
    username: row.profiles?.username ?? "unknown",
    display_name: row.profiles?.display_name ?? null,
    score: row.score,
    rank: i + 1,
  }));
}

/** Weekly leaderboard: aggregate last 7 days */
export async function fetchWeeklyLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured()) return [];

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().split("T")[0];

  // Fetch all daily_scores from last 7 days, aggregate in JS
  const { data, error } = await supabase
    .from("daily_scores")
    .select("user_id, score, profiles:profiles!daily_scores_user_id_fkey(username, display_name)")
    .gte("date", weekAgoStr)
    .order("score", { ascending: false });

  if (error) throw error;

  // Aggregate by user
  const userMap = new Map<string, { username: string; display_name: string | null; score: number }>();
  for (const row of data ?? []) {
    const existing = userMap.get(row.user_id);
    if (existing) {
      existing.score += row.score;
    } else {
      userMap.set(row.user_id, {
        username: (row as any).profiles?.username ?? "unknown",
        display_name: (row as any).profiles?.display_name ?? null,
        score: row.score,
      });
    }
  }

  return Array.from(userMap.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 50)
    .map(([user_id, info], i) => ({
      user_id,
      username: info.username,
      display_name: info.display_name,
      score: info.score,
      rank: i + 1,
    }));
}

/** All-time leaderboard: by total_score from profiles */
export async function fetchAllTimeLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, total_score")
    .order("total_score", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map((row: any, i: number) => ({
    user_id: row.id,
    username: row.username,
    display_name: row.display_name,
    score: row.total_score,
    rank: i + 1,
  }));
}

/** Streak leaderboard: by current_streak from profiles */
export async function fetchStreakLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, current_streak")
    .order("current_streak", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map((row: any, i: number) => ({
    user_id: row.id,
    username: row.username,
    display_name: row.display_name,
    score: row.current_streak,
    rank: i + 1,
  }));
}
