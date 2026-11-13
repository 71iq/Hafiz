import { addDays, datesBetween, type LocalDate } from "@/lib/habit/dates";
import { computeStreak, isRecited, runLengthEndingOn, type DayMap } from "@/lib/habit/streak";

const EARN_BACK_MIN_STREAK = 7;
const EARN_BACK_WINDOW_DAYS = 3;
const EARN_BACK_DAYS_NEEDED = 3;
const EARN_BACK_FULL_DAYS_NEEDED = 2;

export type EarnBack = Readonly<{
  /** Length of the streak that broke. */
  brokenLength: number;
  /** Last covered day of the broken streak. */
  lastDay: LocalDate;
  windowStart: LocalDate;
  windowEnd: LocalDate;
  /** Recited days inside the window so far. */
  daysDone: number;
  /** Days inside the window with the full wird. */
  fullDone: number;
  succeeded: boolean;
  /** Missed days to mark earned_back on success. */
  restoreDays: readonly LocalDate[];
}>;

/**
 * STR-17: a streak of 7 or more days that broke can be earned back. The window opens the day after
 * the missed day's make-up cutoff, the last covered day + 2, and lasts 3 days. Reciting the minimum
 * wird on all 3 days, or the full wird on 2 of them, restores it, and the missed days become
 * earned_back so the old and new runs join (Duolingo repair: new length = previous + current).
 *
 * Returns null when there is nothing to earn back: no break, a short streak, a closed window, or a
 * window that can no longer succeed.
 */
export function findEarnBack(days: DayMap, today: LocalDate, options: { makeUpOpen: boolean }): EarnBack | null {
  if (computeStreak(days, today, options).makeUpPending) return null;
  // The break is found from the window, not from the latest run: a missed day inside the window
  // ends a short run but must not hide the original break. Look back over every last covered day
  // whose window could include today (or has just succeeded), latest first.
  for (let offset = 2; offset <= 2 * EARN_BACK_WINDOW_DAYS + 1; offset += 1) {
    const lastDay = addDays(today, -offset);
    if (!days.has(lastDay) || days.has(addDays(lastDay, 1))) continue;
    const earnBack = earnBackFrom(days, today, lastDay);
    if (earnBack) return earnBack;
  }
  return null;
}

function earnBackFrom(days: DayMap, today: LocalDate, lastDay: LocalDate): EarnBack | null {
  const windowStart = addDays(lastDay, 2);
  const windowEnd = addDays(lastDay, 1 + EARN_BACK_WINDOW_DAYS);
  if (today < windowStart) return null;
  const brokenLength = runLengthEndingOn(days, lastDay);
  if (brokenLength < EARN_BACK_MIN_STREAK) return null;

  const throughToday = today < windowEnd ? today : windowEnd;
  const windowSoFar = datesBetween(windowStart, throughToday);
  const recited = windowSoFar.filter((date) => isRecited(days.get(date)));
  const daysDone = recited.length;
  const fullDone = recited.filter((date) => days.get(date)!.fullMet).length;
  const succeeded = daysDone >= EARN_BACK_DAYS_NEEDED || fullDone >= EARN_BACK_FULL_DAYS_NEEDED;

  if (!succeeded) {
    if (today > windowEnd) return null;
    const ahead = datesBetween(today, windowEnd);
    const canStillRecite = ahead.filter((date) => !isRecited(days.get(date))).length;
    const canStillComplete = ahead.filter((date) => !days.get(date)?.fullMet).length;
    const possible =
      daysDone + canStillRecite >= EARN_BACK_DAYS_NEEDED || fullDone + canStillComplete >= EARN_BACK_FULL_DAYS_NEEDED;
    if (!possible) return null;
  }

  const lastRecited = recited.length > 0 ? recited[recited.length - 1] : addDays(lastDay, 1);
  const restoreDays = datesBetween(addDays(lastDay, 1), lastRecited).filter((date) => !days.has(date));
  return { brokenLength, lastDay, windowStart, windowEnd, daysDone, fullDone, succeeded, restoreDays };
}
