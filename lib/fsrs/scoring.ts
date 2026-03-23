import type { SQLiteDatabase } from "expo-sqlite";
import { Rating } from "ts-fsrs";

/**
 * Scoring algorithm per §3.7.1
 *
 * points = base_points × streak_multiplier × difficulty_bonus × retention_bonus
 *
 * Anti-gaming:
 * - "Again" ratings give 0 points
 * - Max 200 reviews/day count toward leaderboard
 */

const BASE_POINTS = 10;
const MAX_DAILY_REVIEWS = 200;

export function computeReviewPoints(
  rating: number,
  streakDays: number,
  cardDifficulty: number,
  cardStability: number
): number {
  // Again = 0 points (no farming by intentionally failing)
  if (rating === Rating.Again) return 0;

  const streakMultiplier = Math.min(1 + streakDays * 0.05, 2.0);
  const difficultyBonus = 1 + (cardDifficulty / 10) * 0.5;
  const retentionBonus = Math.min(cardStability / 100, 1.0); // Cap at 1.0

  const points = BASE_POINTS * streakMultiplier * difficultyBonus * retentionBonus;
  return Math.round(points);
}

/** Get today's review count for anti-gaming cap */
export async function getTodayReviewCount(db: SQLiteDatabase): Promise<number> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM study_log WHERE DATE(reviewed_at) = ?",
    [today]
  );
  return row?.count ?? 0;
}

/** Get today's total score from user_settings */
export async function getTodayScore(db: SQLiteDatabase): Promise<{ score: number; reviewsCount: number }> {
  const today = new Date().toISOString().split("T")[0];
  const key = `daily_score_${today}`;
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [key]
  );
  if (row?.value) {
    try {
      return JSON.parse(row.value);
    } catch {}
  }
  return { score: 0, reviewsCount: 0 };
}

/** Add points to today's daily score */
export async function addTodayPoints(
  db: SQLiteDatabase,
  points: number
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const key = `daily_score_${today}`;
  const current = await getTodayScore(db);

  // Anti-gaming: cap at MAX_DAILY_REVIEWS
  if (current.reviewsCount >= MAX_DAILY_REVIEWS) return;

  const updated = {
    score: current.score + points,
    reviewsCount: current.reviewsCount + 1,
  };
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
    [key, JSON.stringify(updated)]
  );
}

/** Get the total accumulated score across all days */
export async function getTotalScore(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key LIKE 'daily_score_%'"
  );
  let total = 0;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value);
      total += parsed.score ?? 0;
    } catch {}
  }
  return total;
}
