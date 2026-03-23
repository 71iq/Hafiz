import type { SQLiteDatabase } from "expo-sqlite";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import { getTodayScore, getTotalScore } from "./scoring";
import { getStudyStreak, getLastReviewDate } from "./queries";

/** Sync today's daily score to Supabase */
export async function syncDailyScore(db: SQLiteDatabase): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const user = useAuthStore.getState().user;
  if (!user) return;

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

  const [totalScore, currentStreak, lastReviewDate, totalCards] = await Promise.all([
    getTotalScore(db),
    getStudyStreak(db),
    getLastReviewDate(db),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_cards").then((r) => r?.count ?? 0),
  ]);

  // Fetch current profile to compute longest streak
  const { data: profile } = await supabase
    .from("profiles")
    .select("longest_streak")
    .eq("id", user.id)
    .single();

  const longestStreak = Math.max(currentStreak, profile?.longest_streak ?? 0);
  const lastReviewDay = lastReviewDate ? lastReviewDate.split("T")[0] : null;

  const { error } = await supabase
    .from("profiles")
    .update({
      total_score: totalScore,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      cards_reviewed: totalCards,
      last_review_date: lastReviewDay,
    })
    .eq("id", user.id);

  if (error) console.warn("[Leaderboard] Failed to update profile stats:", error.message);
}
