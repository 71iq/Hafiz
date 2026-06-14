import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { AchievementUnlock } from "@/lib/achievements/types";

export type LeaderboardEntry = {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  score: number;
  rank: number;
};

export type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
  total_score: number;
  current_streak: number;
  longest_streak: number;
  cards_reviewed: number;
  last_review_date: string | null;
};

export type PublicReviewActivityDay = { date: string; count: number };

export type PublicSurahProgressRow = {
  surah: number;
  totalCards: number;
  memorized: number;
};

type PublicReviewStats = {
  totalReviews: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  lastReviewDate: string | null;
};

type PublicScoreSummary = {
  totalScore: number;
  cardsReviewed: number;
  currentStreak: number;
  longestStreak: number;
  lastReviewDate: string | null;
};

type PublicReviewActivityResult = {
  activity: PublicReviewActivityDay[];
  activeDays: number;
  totalReviews: number;
};

function toDayIndex(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(year, (month || 1) - 1, day || 1) / 86400000);
}

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function summarizeDailyScoreRows(rows: Array<{ date: string; score?: number | null; reviews_count?: number | null }>): PublicScoreSummary {
  const activeDates = rows
    .filter((row) => (row.reviews_count ?? 0) > 0)
    .map((row) => row.date.slice(0, 10));
  const uniqueDates = Array.from(new Set(activeDates)).sort();
  const today = formatLocalDateKey(new Date());
  const indicesDesc = uniqueDates.map(toDayIndex).sort((a, b) => b - a);
  const todayIndex = toDayIndex(today);

  let currentStreak = 0;
  if (indicesDesc[0] === todayIndex) {
    let expected = todayIndex;
    for (const index of indicesDesc) {
      if (index === expected) {
        currentStreak += 1;
        expected -= 1;
      } else if (index < expected) {
        break;
      }
    }
  }

  let longestStreak = 0;
  let run = 0;
  let previous: number | null = null;
  for (const index of [...indicesDesc].sort((a, b) => a - b)) {
    run = previous === null || index === previous + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = index;
  }

  return {
    totalScore: rows.reduce((sum, row) => sum + (row.score ?? 0), 0),
    cardsReviewed: rows.reduce((sum, row) => sum + (row.reviews_count ?? 0), 0),
    currentStreak,
    longestStreak,
    lastReviewDate: uniqueDates.at(-1) ?? null,
  };
}

function emptyScoreSummary(): PublicScoreSummary {
  return { totalScore: 0, cardsReviewed: 0, currentStreak: 0, longestStreak: 0, lastReviewDate: null };
}

function isMissingPublicReviewAggregateError(error: { code?: string; message?: string; details?: string } | null): boolean {
  const message = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return (
    message.includes("public_review_activity") ||
    message.includes("public_review_stats")
  ) && (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("pgrst205") ||
    message.includes("42p01")
  );
}

function mergePublicProfileStats(
  profile: PublicProfile,
  reviewStats: PublicReviewStats | null,
  scoreSummary: PublicScoreSummary
): PublicProfile {
  const normalizedProfile = normalizePublicProfileStreak(profile);
  return {
    ...normalizedProfile,
    total_score: Math.max(normalizedProfile.total_score ?? 0, scoreSummary.totalScore),
    current_streak: Math.max(normalizedProfile.current_streak ?? 0, reviewStats?.currentStreak ?? 0, scoreSummary.currentStreak),
    longest_streak: Math.max(normalizedProfile.longest_streak ?? 0, reviewStats?.longestStreak ?? 0, scoreSummary.longestStreak),
    cards_reviewed: Math.max(normalizedProfile.cards_reviewed ?? 0, reviewStats?.totalReviews ?? 0, scoreSummary.cardsReviewed),
    last_review_date: [normalizedProfile.last_review_date?.slice(0, 10), reviewStats?.lastReviewDate, scoreSummary.lastReviewDate]
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1) ?? null,
  };
}

async function fetchPublicScoreSummary(userId: string): Promise<PublicScoreSummary> {
  const { data, error } = await supabase
    .from("daily_scores")
    .select("date, score, reviews_count")
    .eq("user_id", userId);

  if (error) throw error;
  return summarizeDailyScoreRows((data ?? []) as Array<{ date: string; score: number | null; reviews_count: number | null }>);
}

async function fetchPublicReviewStats(userId: string): Promise<PublicReviewStats | null> {
  const { data, error } = await supabase
    .from("public_review_stats")
    .select("total_reviews, active_days, current_streak, longest_streak, last_review_date")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingPublicReviewAggregateError(error)) return null;
    throw error;
  }
  if (!data) return null;
  const lastReviewDate = (data as any).last_review_date?.slice(0, 10) ?? null;
  const today = formatLocalDateKey(new Date());
  return {
    totalReviews: (data as any).total_reviews ?? 0,
    activeDays: (data as any).active_days ?? 0,
    currentStreak: lastReviewDate === today ? (data as any).current_streak ?? 0 : 0,
    longestStreak: (data as any).longest_streak ?? 0,
    lastReviewDate,
  };
}

async function fetchDailyScoreActivity(userId: string, startDate: string): Promise<PublicReviewActivityResult> {
  const { data, error } = await supabase
    .from("daily_scores")
    .select("date, reviews_count")
    .eq("user_id", userId)
    .gte("date", startDate)
    .order("date", { ascending: true });

  if (error) throw error;

  const activity = (data ?? []).map((row: any) => ({
    date: row.date,
    count: row.reviews_count ?? 0,
  }));
  return {
    activity,
    activeDays: activity.filter((day) => day.count > 0).length,
    totalReviews: activity.reduce((sum, day) => sum + day.count, 0),
  };
}

async function fetchPublicReviewAggregateActivity(userId: string, startDate: string): Promise<PublicReviewActivityResult | null> {
  const [stats, rowsResult] = await Promise.all([
    fetchPublicReviewStats(userId),
    supabase
      .from("public_review_activity")
      .select("date, reviews_count")
      .eq("user_id", userId)
      .gte("date", startDate)
      .order("date", { ascending: true }),
  ]);

  if (rowsResult.error) {
    if (isMissingPublicReviewAggregateError(rowsResult.error)) return null;
    throw rowsResult.error;
  }

  const activity = (rowsResult.data ?? []).map((row: any) => ({
    date: row.date,
    count: row.reviews_count ?? 0,
  }));
  return {
    activity,
    activeDays: Math.max(stats?.activeDays ?? 0, activity.filter((day) => day.count > 0).length),
    totalReviews: Math.max(stats?.totalReviews ?? 0, activity.reduce((sum, day) => sum + day.count, 0)),
  };
}

/** Daily leaderboard: top scorers today */
export async function fetchDailyLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured()) return [];

  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("daily_scores")
    .select("user_id, score, profiles:profiles!daily_scores_user_id_fkey(username, display_name, avatar_url)")
    .eq("date", today)
    .order("score", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map((row: any, i: number) => ({
    user_id: row.user_id,
    username: row.profiles?.username ?? "unknown",
    display_name: row.profiles?.display_name ?? null,
    avatar_url: row.profiles?.avatar_url ?? null,
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
    .select("user_id, score, profiles:profiles!daily_scores_user_id_fkey(username, display_name, avatar_url)")
    .gte("date", weekAgoStr)
    .order("score", { ascending: false });

  if (error) throw error;

  // Aggregate by user
  const userMap = new Map<string, { username: string; display_name: string | null; avatar_url: string | null; score: number }>();
  for (const row of data ?? []) {
    const existing = userMap.get(row.user_id);
    if (existing) {
      existing.score += row.score;
    } else {
      userMap.set(row.user_id, {
        username: (row as any).profiles?.username ?? "unknown",
        display_name: (row as any).profiles?.display_name ?? null,
        avatar_url: (row as any).profiles?.avatar_url ?? null,
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
      avatar_url: info.avatar_url,
      score: info.score,
      rank: i + 1,
    }));
}

/** All-time leaderboard: by total_score from profiles */
export async function fetchAllTimeLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from("daily_scores")
    .select("user_id, score, profiles:profiles!daily_scores_user_id_fkey(username, display_name, avatar_url)")
    .order("score", { ascending: false });

  if (error) throw error;

  const userMap = new Map<string, { username: string; display_name: string | null; avatar_url: string | null; score: number }>();
  for (const row of data ?? []) {
    const existing = userMap.get(row.user_id);
    if (existing) {
      existing.score += row.score;
    } else {
      userMap.set(row.user_id, {
        username: (row as any).profiles?.username ?? "unknown",
        display_name: (row as any).profiles?.display_name ?? null,
        avatar_url: (row as any).profiles?.avatar_url ?? null,
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
      avatar_url: info.avatar_url,
      score: info.score,
      rank: i + 1,
    }));
}

/** Streak leaderboard: by current_streak from profiles */
export async function fetchStreakLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from("daily_scores")
    .select("user_id, date, profiles:profiles!daily_scores_user_id_fkey(username, display_name, avatar_url)")
    .order("date", { ascending: false });

  if (error) throw error;

  const toDayIndex = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Math.floor(new Date(y, (m || 1) - 1, d || 1).getTime() / 86400000);
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIdx = Math.floor(today.getTime() / 86400000);

  const byUser = new Map<string, { username: string; display_name: string | null; avatar_url: string | null; dates: Set<string> }>();
  for (const row of data ?? []) {
    const existing = byUser.get(row.user_id);
    if (existing) {
      existing.dates.add(row.date);
    } else {
      byUser.set(row.user_id, {
        username: (row as any).profiles?.username ?? "unknown",
        display_name: (row as any).profiles?.display_name ?? null,
        avatar_url: (row as any).profiles?.avatar_url ?? null,
        dates: new Set([row.date]),
      });
    }
  }

  const ranked = Array.from(byUser.entries()).map(([user_id, info]) => {
    const indices = Array.from(info.dates).map(toDayIndex).sort((a, b) => b - a);
    if (indices.length === 0) {
      return { user_id, username: info.username, display_name: info.display_name, avatar_url: info.avatar_url, score: 0 };
    }
    if (indices[0] !== todayIdx) {
      return { user_id, username: info.username, display_name: info.display_name, avatar_url: info.avatar_url, score: 0 };
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
    return { user_id, username: info.username, display_name: info.display_name, avatar_url: info.avatar_url, score: streak };
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((row, i) => ({
      user_id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      score: row.score,
      rank: i + 1,
    }));
}

/** Public profile for leaderboard users */
export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  if (!isSupabaseConfigured()) return null;

  const [profileResult, reviewStats, scoreSummary] = await Promise.all([
    supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio, country, total_score, current_streak, longest_streak, cards_reviewed, last_review_date")
    .eq("id", userId)
      .maybeSingle(),
    fetchPublicReviewStats(userId),
    fetchPublicScoreSummary(userId).catch(() => emptyScoreSummary()),
  ]);
  const { data, error } = profileResult;

  if (error && isMissingOptionalProfileColumnError(error)) {
    const fallback = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, total_score, current_streak, longest_streak, cards_reviewed, last_review_date")
      .eq("id", userId)
      .maybeSingle();

    if (fallback.error) throw fallback.error;
    return fallback.data
      ? mergePublicProfileStats({ ...fallback.data, bio: null, country: null } as PublicProfile, reviewStats, scoreSummary)
      : null;
  }

  if (error) throw error;
  return data ? mergePublicProfileStats(data as PublicProfile, reviewStats, scoreSummary) : null;
}

export async function fetchPublicAchievementUnlocks(userId: string): Promise<AchievementUnlock[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const { data, error } = await supabase
    .from("achievement_unlocks")
    .select("achievement_id, unlocked_at, public_payload")
    .eq("user_id", userId)
    .order("unlocked_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    achievementId: row.achievement_id,
    unlockedAt: row.unlocked_at,
    seenAt: row.unlocked_at,
    localPayload: {},
    publicPayload: parsePayload(row.public_payload),
  }));
}

export async function fetchPublicReviewActivity(userId: string, days = 90): Promise<{
  activity: PublicReviewActivityDay[];
  activeDays: number;
  totalReviews: number;
}> {
  if (!isSupabaseConfigured() || !userId) return { activity: [], activeDays: 0, totalReviews: 0 };

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.max(days - 1, 0));
  const startDate = start.toISOString().split("T")[0];

  const [aggregate, dailyScores] = await Promise.all([
    fetchPublicReviewAggregateActivity(userId, startDate),
    fetchDailyScoreActivity(userId, startDate),
  ]);
  const aggregateTotal = aggregate?.totalReviews ?? 0;
  const dailyTotal = dailyScores.totalReviews;
  const activity = aggregate && aggregateTotal >= dailyTotal ? aggregate.activity : dailyScores.activity;

  return {
    activity,
    activeDays: Math.max(aggregate?.activeDays ?? 0, dailyScores.activeDays),
    totalReviews: Math.max(aggregateTotal, dailyTotal),
  };
}

export async function fetchPublicSurahProgress(userId: string): Promise<PublicSurahProgressRow[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const { data, error } = await supabase
    .from("public_surah_progress")
    .select("surah, total_cards, memorized_cards")
    .eq("user_id", userId)
    .order("surah", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    surah: row.surah,
    totalCards: row.total_cards ?? 0,
    memorized: row.memorized_cards ?? 0,
  }));
}

function normalizePublicProfileStreak(profile: PublicProfile): PublicProfile {
  const lastReviewDate = profile.last_review_date?.slice(0, 10) ?? null;
  const today = formatLocalDateKey(new Date());
  return {
    ...profile,
    current_streak: lastReviewDate === today ? profile.current_streak ?? 0 : 0,
  };
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isMissingOptionalProfileColumnError(error: { code?: string; message?: string; details?: string } | null): boolean {
  const message = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  const referencesOptionalColumn = message.includes("bio") || message.includes("country");
  return referencesOptionalColumn && (message.includes("column") || message.includes("schema") || message.includes("pgrst204"));
}
