import type { AppDatabase } from "@/lib/database/types";
import { getMemorizedAyahCardCount, getReviewStats, getTotalAyahCardCount, type ReviewStats } from "@/lib/fsrs/queries";
import { countSteadyWeeks, toDayMap } from "@/lib/habit/streak";
import type { HabitOverview } from "@/lib/habit/queries";

/**
 * The one set of study-metric definitions (W10). Progress, Home and the own profile read their
 * figures from here so the same local owner always sees the same numbers.
 *
 * - Memorized share: memorized ayah cards / all ayah cards, as a whole percent; 0 with no cards.
 *   It is a share of cards, not a recall probability.
 * - Total memorized: ayah cards with at least one review (getMemorizedAyahCardCount).
 * - Total reviews and active days: study_log rows and the local days that have any (getReviewStats).
 * - Average reviews per active day: total reviews / active days, rounded; 0 with no active days.
 * - Current and longest consistency: the wird streak from lib/habit, which applies the minimum,
 *   grace, make-up, pause and covered days. Never count consecutive review days instead.
 */

export function memorizedSharePercent(memorized: number, total: number): number {
  return total > 0 ? Math.round((memorized / total) * 100) : 0;
}

export function averageReviewsPerActiveDay(totalReviews: number, activeDays: number): number {
  return activeDays > 0 ? Math.round(totalReviews / activeDays) : 0;
}

export type StudyMetrics = Readonly<{
  totalAyahCards: number;
  memorizedAyahCards: number;
  memorizedSharePercent: number;
  totalReviews: number;
  activeDays: number;
  averageReviewsPerActiveDay: number;
  activity: ReviewStats["activity"];
}>;

/**
 * Loads the card and review figures together. It rejects when any query fails, so a caller keeps its
 * last valid figures instead of showing zeros for a failure.
 */
export async function loadStudyMetrics(db: AppDatabase): Promise<StudyMetrics> {
  const [totalAyahCards, memorizedAyahCards, reviews] = await Promise.all([
    getTotalAyahCardCount(db),
    getMemorizedAyahCardCount(db),
    getReviewStats(db),
  ]);
  return {
    totalAyahCards,
    memorizedAyahCards,
    memorizedSharePercent: memorizedSharePercent(memorizedAyahCards, totalAyahCards),
    totalReviews: reviews.totalReviews,
    activeDays: reviews.activeDays,
    averageReviewsPerActiveDay: averageReviewsPerActiveDay(reviews.totalReviews, reviews.activeDays),
    activity: reviews.activity,
  };
}

export type ConsistencyMetrics = Readonly<{ current: number; longest: number; steadyWeeks: number }>;

/** Consistency from the habit owner; null while the habit overview has not loaded. */
export function consistencyFromHabit(habit: HabitOverview | null, weekStart: number): ConsistencyMetrics | null {
  if (!habit) return null;
  return {
    current: habit.streak.length,
    longest: habit.longest,
    steadyWeeks: countSteadyWeeks(toDayMap(habit.days), habit.today, weekStart),
  };
}

/** The figures each surface shows, in order. The profile reuses these definitions (W12). */
export const PROGRESS_PRIMARY_METRICS = [
  "memorizedShare",
  "totalMemorized",
  "currentConsistency",
  "totalReviews",
] as const;
export const PROGRESS_MORE_METRICS = [
  "longestConsistency",
  "averageReviewsPerActiveDay",
  "steadyWeeks",
  "activeDays",
] as const;
export const PROFILE_METRICS = ["totalMemorized", "currentConsistency", "activeDays", "totalReviews"] as const;
export type StudyMetricKey = (typeof PROGRESS_PRIMARY_METRICS)[number] | (typeof PROGRESS_MORE_METRICS)[number];
