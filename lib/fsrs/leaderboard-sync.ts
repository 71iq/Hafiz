import type { SQLiteDatabase } from "expo-sqlite";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import { getTodayScore, getTotalScore } from "./scoring";
import { getWirdStatus } from "./queries";
import { getLocalSurahProgress } from "@/lib/profile/progress";
import { hasCompletedAccountRestore } from "@/lib/database/sync";

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

function summarizeDailyScores(rows: DailyScoreRow[]): DailyScoreSummary {
  const activeDates = rows
    .filter((row) => (row.reviews_count ?? 0) > 0)
    .map((row) => row.date.slice(0, 10));
  const uniqueDates = Array.from(new Set(activeDates)).sort();
  const today = new Date().toISOString().slice(0, 10);
  const toDayIndex = (ymd: string) => {
    const [year, month, day] = ymd.split("-").map(Number);
    return Math.floor(Date.UTC(year, (month || 1) - 1, day || 1) / 86400000);
  };
  const indices = uniqueDates.map(toDayIndex).sort((a, b) => b - a);
  const todayIndex = toDayIndex(today);
  let currentStreak = 0;
  if (indices[0] === todayIndex) {
    let expected = todayIndex;
    for (const index of indices) {
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
  for (const index of [...indices].sort((a, b) => a - b)) {
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

async function fetchDailyScoreSummary(userId: string): Promise<DailyScoreSummary> {
  const { data, error } = await supabase
    .from("daily_scores")
    .select("date, score, reviews_count")
    .eq("user_id", userId);

  if (error) throw error;
  return summarizeDailyScores((data ?? []) as DailyScoreRow[]);
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

  const [totalScore, wirdStatus, cardsReviewedRow, remoteDailySummary] = await Promise.all([
    getTotalScore(db),
    getWirdStatus(db),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log"),
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
    current_streak: Math.max(wirdStatus.currentDays, remoteDailySummary.currentStreak, profileCurrentStreak),
    longest_streak: Math.max(wirdStatus.longestDays, remoteDailySummary.longestStreak, profile?.longest_streak ?? 0),
    cards_reviewed: Math.max(localReviewedCount, remoteDailySummary.cardsReviewed, profile?.cards_reviewed ?? 0),
    last_review_date: maxDate(lastReviewDay, remoteDailySummary.lastReviewDate, profile?.last_review_date?.slice(0, 10)),
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
