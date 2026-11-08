import { dayIndexFromLocalDateKey as dayIndexFromDateKey, formatLocalDateKey } from "@/lib/date";

export function buildLocalReviewCounts(rows: { reviewed_at: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reviewedAt = new Date(row.reviewed_at);
    if (Number.isNaN(reviewedAt.getTime())) continue;
    const key = formatLocalDateKey(reviewedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function calculateLongestStreak(dateKeys: string[]): number {
  let maxStreak = 0;
  let runStreak = 0;
  let prevIndex: number | null = null;

  for (const dateKey of dateKeys) {
    const dayIndex = dayIndexFromDateKey(dateKey);
    runStreak = prevIndex !== null && dayIndex - prevIndex === 1 ? runStreak + 1 : 1;
    maxStreak = Math.max(maxStreak, runStreak);
    prevIndex = dayIndex;
  }

  return maxStreak;
}
