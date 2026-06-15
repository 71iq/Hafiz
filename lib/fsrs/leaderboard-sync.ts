import type { SQLiteDatabase } from "expo-sqlite";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import { getTodayScore, getTotalScore } from "./scoring";
import { getWirdStatus } from "./queries";
import { getLocalSurahProgress } from "@/lib/profile/progress";
import { hasCompletedAccountRestore } from "@/lib/database/sync";
import { dayIndexFromUtcDateKey as toDayIndex, formatLocalDateKey } from "@/lib/date";

type ProfileStatsPatch = {
  total_score: number;
  current_streak: number;
  longest_streak: number;
  cards_reviewed: number;
  last_review_date: string | null;
};

type DailyScoreRow = {
  date: string;
  score: number | null;
  reviews_count: number | null;
};

type DailyScoreSummary = {
  totalScore: number;
  cardsReviewed: number;
  currentStreak: number;
  longestStreak: number;
  lastReviewDate: string | null;
};

type ReviewActivityDay = {
  date: string;
  count: number;
};

type PublicReviewSummary = {
  activity: ReviewActivityDay[];
  totalReviews: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  lastReviewDate: string | null;
};

async function ensureProfileRow() {
  const { user, ensureProfile } = useAuthStore.getState();
  if (!user) return null;
  return ensureProfile();
}

async function canWriteAccountDerivedStats(db: SQLiteDatabase, userId: string): Promise<boolean> {
  const restored = await hasCompletedAccountRestore(db, userId);
  if (!restored) console.warn("[Leaderboard] Skipping profile stats until account data restore completes.");
  return restored;
}

function maxDate(...dates: Array<string | null | undefined>): string | null {
  return dates.filter((date): date is string => Boolean(date)).sort().at(-1) ?? null;
}

function calculateCurrentStreak(dateKeysDesc: string[], todayIndex: number): number {
  if (dateKeysDesc.length === 0) return 0;
  if (toDayIndex(dateKeysDesc[0]) !== todayIndex) return 0;

  let streak = 0;
  let expected = todayIndex;
  for (const dateKey of dateKeysDesc) {
    const index = toDayIndex(dateKey);
    if (index === expected) {
      streak += 1;
      expected -= 1;
    } else if (index < expected) {
      break;
    }
  }
  return streak;
}

function calculateLongestStreak(dateKeysAsc: string[]): number {
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const dateKey of dateKeysAsc) {
    const index = toDayIndex(dateKey);
    run = previous === null || index === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = index;
  }
  return longest;
}

function summarizeReviewCounts(counts: Map<string, number>): PublicReviewSummary {
  const dateKeysAsc = Array.from(counts.keys()).filter((dateKey) => (counts.get(dateKey) ?? 0) > 0).sort();
  const dateKeysDesc = [...dateKeysAsc].reverse();
  const todayIndex = toDayIndex(formatLocalDateKey(new Date()));

  return {
    activity: dateKeysAsc.map((date) => ({ date, count: counts.get(date) ?? 0 })),
    totalReviews: [...counts.values()].reduce((sum, count) => sum + count, 0),
    activeDays: dateKeysAsc.length,
    currentStreak: calculateCurrentStreak(dateKeysDesc, todayIndex),
    longestStreak: calculateLongestStreak(dateKeysAsc),
    lastReviewDate: dateKeysAsc.at(-1) ?? null,
  };
}

function summarizeDailyScores(rows: DailyScoreRow[]): DailyScoreSummary {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const date = row.date.slice(0, 10);
    if ((row.reviews_count ?? 0) > 0) counts.set(date, (counts.get(date) ?? 0) + (row.reviews_count ?? 0));
  }
  const reviewSummary = summarizeReviewCounts(counts);

  return {
    totalScore: rows.reduce((sum, row) => sum + (row.score ?? 0), 0),
    cardsReviewed: rows.reduce((sum, row) => sum + (row.reviews_count ?? 0), 0),
    currentStreak: reviewSummary.currentStreak,
    longestStreak: reviewSummary.longestStreak,
    lastReviewDate: reviewSummary.lastReviewDate,
  };
}

async function fetchDailyScoreSummary(userId: string): Promise<DailyScoreSummary> {
  const { data, error } = await supabase
    .from("daily_scores")
    .select("date, score, reviews_count")
    .eq("user_id", userId);

  if (error) throw error;
  return summarizeDailyScores((data ?? []) as DailyScoreRow[]);
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

async function getLocalReviewSummary(db: SQLiteDatabase): Promise<PublicReviewSummary> {
  const rows = await db.getAllAsync<{ reviewed_at: string }>("SELECT reviewed_at FROM study_log ORDER BY reviewed_at ASC");
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reviewedAt = new Date(row.reviewed_at);
    if (Number.isNaN(reviewedAt.getTime())) continue;
    const date = formatLocalDateKey(reviewedAt);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return summarizeReviewCounts(counts);
}

async function fetchPublicReviewSummary(userId: string): Promise<PublicReviewSummary | null> {
  const [statsResult, activityResult] = await Promise.all([
    supabase
      .from("public_review_stats")
      .select("total_reviews, active_days, current_streak, longest_streak, last_review_date")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("public_review_activity")
      .select("date, reviews_count")
      .eq("user_id", userId),
  ]);

  if (statsResult.error) {
    if (isMissingPublicReviewAggregateError(statsResult.error)) return null;
    throw statsResult.error;
  }
  if (activityResult.error) {
    if (isMissingPublicReviewAggregateError(activityResult.error)) return null;
    throw activityResult.error;
  }

  const counts = new Map<string, number>();
  for (const row of activityResult.data ?? []) {
    counts.set((row as any).date, (row as any).reviews_count ?? 0);
  }
  const summary = summarizeReviewCounts(counts);
  const stats = statsResult.data as any | null;
  if (!stats) return summary.totalReviews > 0 ? summary : null;
  const statsLastReviewDate = stats.last_review_date?.slice(0, 10) ?? null;
  const today = formatLocalDateKey(new Date());

  return {
    activity: summary.activity,
    totalReviews: Math.max(summary.totalReviews, stats.total_reviews ?? 0),
    activeDays: Math.max(summary.activeDays, stats.active_days ?? 0),
    currentStreak: Math.max(summary.currentStreak, statsLastReviewDate === today ? stats.current_streak ?? 0 : 0),
    longestStreak: Math.max(summary.longestStreak, stats.longest_streak ?? 0),
    lastReviewDate: maxDate(summary.lastReviewDate, statsLastReviewDate),
  };
}

async function upsertPublicReviewSummary(userId: string, localSummary: PublicReviewSummary, remoteSummary: PublicReviewSummary | null): Promise<void> {
  const sourceSummary =
    remoteSummary && remoteSummary.totalReviews > localSummary.totalReviews
      ? remoteSummary
      : localSummary;
  const mergedActivity = sourceSummary.activity
    .map((row) => ({ date: row.date, count: row.count }))
    .filter((row) => row.count > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const mergedCounts = new Map(mergedActivity.map((row) => [row.date, row.count]));
  const derived = summarizeReviewCounts(mergedCounts);
  const today = formatLocalDateKey(new Date());
  const remoteCurrentStreak = remoteSummary?.lastReviewDate === today ? remoteSummary.currentStreak : 0;
  const mergedStats = {
    totalReviews: Math.max(localSummary.totalReviews, remoteSummary?.totalReviews ?? 0, derived.totalReviews),
    activeDays: Math.max(sourceSummary.activeDays, derived.activeDays),
    currentStreak: Math.max(sourceSummary.currentStreak, sourceSummary === remoteSummary ? remoteCurrentStreak : 0, derived.currentStreak),
    longestStreak: Math.max(localSummary.longestStreak, remoteSummary?.longestStreak ?? 0, derived.longestStreak),
    lastReviewDate: maxDate(localSummary.lastReviewDate, remoteSummary?.lastReviewDate, derived.lastReviewDate),
  };

  const statsResult = await supabase
    .from("public_review_stats")
    .upsert({
      user_id: userId,
      total_reviews: mergedStats.totalReviews,
      active_days: mergedStats.activeDays,
      current_streak: mergedStats.currentStreak,
      longest_streak: mergedStats.longestStreak,
      last_review_date: mergedStats.lastReviewDate,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (statsResult.error) throw statsResult.error;
  if (mergedActivity.length === 0) return;

  const activityResult = await supabase
    .from("public_review_activity")
    .upsert(
      mergedActivity.map((row) => ({
        user_id: userId,
        date: row.date,
        reviews_count: row.count,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,date" }
    );
  if (activityResult.error) throw activityResult.error;
}

function patchCurrentProfile(stats: ProfileStatsPatch): void {
  useAuthStore.setState((state) => ({
    profile: state.profile ? { ...state.profile, ...stats } : state.profile,
  }));
}

/** Sync today's daily score to Supabase */
export async function syncDailyScore(db: SQLiteDatabase): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const user = useAuthStore.getState().user;
  if (!user) return;
  if (!(await canWriteAccountDerivedStats(db, user.id))) return;
  await ensureProfileRow();

  const today = new Date().toISOString().split("T")[0];
  const { score, reviewsCount } = await getTodayScore(db);
  if (reviewsCount === 0) return;

  const { data: existing, error: existingError } = await supabase
    .from("daily_scores")
    .select("score, reviews_count")
    .eq("user_id", user.id)
    .eq("date", today)
    .maybeSingle();

  if (existingError) {
    console.warn("[Leaderboard] Failed to read existing daily score:", existingError.message);
    return;
  }

  const { error } = await supabase
    .from("daily_scores")
    .upsert(
      {
        user_id: user.id,
        date: today,
        score: Math.max(score, existing?.score ?? 0),
        reviews_count: Math.max(reviewsCount, existing?.reviews_count ?? 0),
      },
      { onConflict: "user_id,date" }
    );

  if (error) console.warn("[Leaderboard] Failed to sync daily score:", error.message);
}

/** Update profile stats on Supabase (total_score, streak, cards_reviewed, last_review_date) */
export async function updateProfileStats(db: SQLiteDatabase): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const user = useAuthStore.getState().user;
  if (!user) return;
  if (!(await canWriteAccountDerivedStats(db, user.id))) return;
  await ensureProfileRow();

  const [totalScore, wirdStatus, cardsReviewedRow, localReviewSummary, remoteDailySummary, remotePublicReviewSummary] = await Promise.all([
    getTotalScore(db),
    getWirdStatus(db),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log"),
    getLocalReviewSummary(db),
    fetchDailyScoreSummary(user.id).catch((error) => {
      console.warn("[Leaderboard] Failed to read remote daily scores:", error.message);
      return {
        totalScore: 0,
        cardsReviewed: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastReviewDate: null,
      };
    }),
    fetchPublicReviewSummary(user.id).catch((error) => {
      console.warn("[Leaderboard] Failed to read public review summary:", error.message);
      return null;
    }),
  ]);

  const { data: profile } = await supabase
    .from("profiles")
    .select("total_score, current_streak, longest_streak, cards_reviewed, last_review_date")
    .eq("id", user.id)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const localReviewedCount = cardsReviewedRow?.count ?? 0;
  const lastReviewDay = wirdStatus.lastReviewDate ? wirdStatus.lastReviewDate.split("T")[0] : null;
  const profileCurrentStreak = profile?.last_review_date?.slice(0, 10) === today ? profile?.current_streak ?? 0 : 0;
  const stats: ProfileStatsPatch = {
    total_score: Math.max(totalScore, remoteDailySummary.totalScore, profile?.total_score ?? 0),
    current_streak: Math.max(wirdStatus.currentDays, localReviewSummary.currentStreak, remoteDailySummary.currentStreak, remotePublicReviewSummary?.currentStreak ?? 0, profileCurrentStreak),
    longest_streak: Math.max(wirdStatus.longestDays, localReviewSummary.longestStreak, remoteDailySummary.longestStreak, remotePublicReviewSummary?.longestStreak ?? 0, profile?.longest_streak ?? 0),
    cards_reviewed: Math.max(localReviewedCount, localReviewSummary.totalReviews, remoteDailySummary.cardsReviewed, remotePublicReviewSummary?.totalReviews ?? 0, profile?.cards_reviewed ?? 0),
    last_review_date: maxDate(lastReviewDay, localReviewSummary.lastReviewDate, remoteDailySummary.lastReviewDate, remotePublicReviewSummary?.lastReviewDate, profile?.last_review_date?.slice(0, 10)),
  };

  patchCurrentProfile(stats);

  const { data, error } = await supabase
    .from("profiles")
    .upsert({
      id: user.id,
      ...stats,
    })
    .select("*")
    .single();

  if (error) console.warn("[Leaderboard] Failed to update profile stats:", error.message);
  else if (data) useAuthStore.setState({ profile: data });

  try {
    await upsertPublicReviewSummary(user.id, localReviewSummary, remotePublicReviewSummary);
  } catch (reviewAggregateError: any) {
    if (!isMissingPublicReviewAggregateError(reviewAggregateError)) {
      console.warn("[Leaderboard] Failed to update public review summary:", reviewAggregateError.message);
    }
  }

  try {
    const [surahProgress, remoteSurahProgress] = await Promise.all([
      getLocalSurahProgress(db),
      supabase
        .from("public_surah_progress")
        .select("surah, total_cards, memorized_cards")
        .eq("user_id", user.id),
    ]);
    if (remoteSurahProgress.error) throw remoteSurahProgress.error;

    const bySurah = new Map<number, { surah: number; total_cards: number; memorized_cards: number }>();
    for (const row of remoteSurahProgress.data ?? []) {
      bySurah.set(row.surah, {
        surah: row.surah,
        total_cards: row.total_cards ?? 0,
        memorized_cards: row.memorized_cards ?? 0,
      });
    }
    for (const row of surahProgress) {
      const existing = bySurah.get(row.surah);
      bySurah.set(row.surah, {
        surah: row.surah,
        total_cards: Math.max(row.totalCards, existing?.total_cards ?? 0),
        memorized_cards: Math.max(row.memorized, existing?.memorized_cards ?? 0),
      });
    }

    const mergedSurahProgress = Array.from(bySurah.values());
    if (mergedSurahProgress.length > 0) {
      const now = new Date().toISOString();
      const { error: progressError } = await supabase
        .from("public_surah_progress")
        .upsert(
          mergedSurahProgress.map((row) => ({
            user_id: user.id,
            surah: row.surah,
            total_cards: row.total_cards,
            memorized_cards: row.memorized_cards,
            updated_at: now,
          })),
          { onConflict: "user_id,surah" }
        );
      if (progressError) throw progressError;
    } else {
      const { error: deleteError } = await supabase
        .from("public_surah_progress")
        .delete()
        .eq("user_id", user.id);
      if (deleteError) throw deleteError;
    }
  } catch (progressError: any) {
    console.warn("[Leaderboard] Failed to update public surah progress:", progressError.message);
  }
}
