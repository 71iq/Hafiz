import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type LeaderboardEntry = {
  user_id: string;
  username: string;
  display_name: string | null;
  score: number;
  rank: number;
};

export type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  total_score: number;
  current_streak: number;
  longest_streak: number;
  cards_reviewed: number;
  last_review_date: string | null;
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
    .from("daily_scores")
    .select("user_id, score, profiles:profiles!daily_scores_user_id_fkey(username, display_name)")
    .order("score", { ascending: false });

  if (error) throw error;

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

/** Streak leaderboard: by current_streak from profiles */
export async function fetchStreakLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from("daily_scores")
    .select("user_id, date, profiles:profiles!daily_scores_user_id_fkey(username, display_name)")
    .order("date", { ascending: false });

  if (error) throw error;

  const toDayIndex = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Math.floor(new Date(y, (m || 1) - 1, d || 1).getTime() / 86400000);
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIdx = Math.floor(today.getTime() / 86400000);
  const yesterdayIdx = todayIdx - 1;

  const byUser = new Map<string, { username: string; display_name: string | null; dates: Set<string> }>();
  for (const row of data ?? []) {
    const existing = byUser.get(row.user_id);
    if (existing) {
      existing.dates.add(row.date);
    } else {
      byUser.set(row.user_id, {
        username: (row as any).profiles?.username ?? "unknown",
        display_name: (row as any).profiles?.display_name ?? null,
        dates: new Set([row.date]),
      });
    }
  }

  const ranked = Array.from(byUser.entries()).map(([user_id, info]) => {
    const indices = Array.from(info.dates).map(toDayIndex).sort((a, b) => b - a);
    if (indices.length === 0) {
      return { user_id, username: info.username, display_name: info.display_name, score: 0 };
    }
    if (indices[0] < yesterdayIdx) {
      return { user_id, username: info.username, display_name: info.display_name, score: 0 };
    }
    let streak = 0;
    let expected = indices[0];
    for (const idx of indices) {
      if (idx === expected) {
        streak++;
        expected--;
      } else if (idx < expected) {
        break;
      }
    }
    return { user_id, username: info.username, display_name: info.display_name, score: streak };
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((row, i) => ({
      user_id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      score: row.score,
      rank: i + 1,
    }));
}

/** Public profile for leaderboard users */
export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, total_score, current_streak, longest_streak, cards_reviewed, last_review_date")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as PublicProfile | null) ?? null;
}
