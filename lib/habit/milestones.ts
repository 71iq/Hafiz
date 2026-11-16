const FIXED_MILESTONES = [3, 7, 14, 30, 40, 50, 100, 200, 365] as const;

export function isStreakMilestone(length: number): boolean {
  if ((FIXED_MILESTONES as readonly number[]).includes(length)) return true;
  return length > 365 && length % 100 === 0;
}

export function nextStreakMilestone(length: number): number {
  const fixed = FIXED_MILESTONES.find((milestone) => milestone > length);
  if (fixed !== undefined) return fixed;
  return (Math.floor(length / 100) + 1) * 100;
}

const STREAK_TIER_THRESHOLDS = [7, 14, 30, 50, 100, 365] as const;

export function streakTier(length: number): number {
  return STREAK_TIER_THRESHOLDS.filter((threshold) => length >= threshold).length;
}

export function isEveOfStreakTier(length: number): boolean {
  return (STREAK_TIER_THRESHOLDS as readonly number[]).includes(length + 1);
}

export const STREAK_GOAL_OPTIONS = [7, 14, 30, 50] as const;

