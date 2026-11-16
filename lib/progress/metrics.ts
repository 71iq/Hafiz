import type { AppDatabase } from "@/lib/database/types";
import { getMemorizedAyahCardCount, getReviewStats, getTotalAyahCardCount, type ReviewStats } from "@/lib/fsrs/queries";
import { countSteadyWeeks, toDayMap } from "@/lib/habit/streak";
import type { HabitOverview } from "@/lib/habit/queries";


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

export function consistencyFromHabit(habit: HabitOverview | null, weekStart: number): ConsistencyMetrics | null {
  if (!habit) return null;
  return {
    current: habit.streak.length,
    longest: habit.longest,
    steadyWeeks: countSteadyWeeks(toDayMap(habit.days), habit.today, weekStart),
  };
}

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
