import type { SQLiteDatabase } from "expo-sqlite";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import { getTodayScore, getTotalScore } from "./scoring";
import { getWirdStatus } from "./queries";

type ProfileStatsPatch = {
  total_score: number;
  current_streak: number;
  longest_streak: number;
  cards_reviewed: number;
  last_review_date: string | null;
};

async function ensureProfileRow() {
  const { user, ensureProfile } = useAuthStore.getState();
  if (!user) return null;
  return ensureProfile();
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
  await ensureProfileRow();

  const today = new Date().toISOString().split("T")[0];
  const { score, reviewsCount } = await getTodayScore(db);
  if (reviewsCount === 0) return;

  const { error } = await supabase
    .from("daily_scores")
    .upsert(
      {
        user_id: user.id,
        date: today,
        score,
        reviews_count: reviewsCount,
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
  await ensureProfileRow();

  const [totalScore, wirdStatus, cardsReviewedRow] = await Promise.all([
    getTotalScore(db),
    getWirdStatus(db),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log"),
  ]);

  // Fetch current profile to compute longest streak
  const { data: profile } = await supabase
    .from("profiles")
    .select("longest_streak")
    .eq("id", user.id)
    .single();

  const longestStreak = Math.max(wirdStatus.longestDays, profile?.longest_streak ?? 0);
  const lastReviewDay = wirdStatus.lastReviewDate ? wirdStatus.lastReviewDate.split("T")[0] : null;
  const stats: ProfileStatsPatch = {
    total_score: totalScore,
    current_streak: wirdStatus.currentDays,
    longest_streak: longestStreak,
    cards_reviewed: cardsReviewedRow?.count ?? 0,
    last_review_date: lastReviewDay,
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
}
