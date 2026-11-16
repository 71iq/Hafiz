import { addDays, datesBetween, type LocalDate } from "@/lib/habit/dates";
import { computeStreak, isRecited, runLengthEndingOn, type DayMap } from "@/lib/habit/streak";

const EARN_BACK_MIN_STREAK = 7;
const EARN_BACK_WINDOW_DAYS = 3;
const EARN_BACK_DAYS_NEEDED = 3;
const EARN_BACK_FULL_DAYS_NEEDED = 2;

export type EarnBack = Readonly<{
  brokenLength: number;
  lastDay: LocalDate;
  windowStart: LocalDate;
  windowEnd: LocalDate;
  daysDone: number;
  fullDone: number;
  succeeded: boolean;
  restoreDays: readonly LocalDate[];
}>;

export function findEarnBack(days: DayMap, today: LocalDate, options: { makeUpOpen: boolean }): EarnBack | null {
  if (computeStreak(days, today, options).makeUpPending) return null;
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
