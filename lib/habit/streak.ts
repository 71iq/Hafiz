import { addDays, diffDays, startOfWeek, type LocalDate } from "@/lib/habit/dates";
import { COUNTS_TOWARD_LENGTH, RECITED_STATUSES, type DayStatus, type HabitDay } from "@/lib/habit/types";

export type DayMap = ReadonlyMap<LocalDate, HabitDay>;

export function toDayMap(days: readonly HabitDay[]): Map<LocalDate, HabitDay> {
  return new Map(days.map((day) => [day.localDate, day]));
}

export type StreakView = Readonly<{
  /** Days that count toward the streak, through today or the open day before it. */
  length: number;
  /** First day of the current run, or null when there is no streak. */
  startDay: LocalDate | null;
  /** Latest covered day of the current run. */
  lastCoveredDay: LocalDate | null;
  todayStatus: DayStatus | null;
  /** Today is a wird day earned by recitation (STR-04). */
  doneToday: boolean;
  /** The streak is alive but today has no wird yet (STR-03). */
  atRisk: boolean;
  /** Yesterday is missed but can still be made up before Dhuhr today (STR-07). */
  makeUpPending: boolean;
}>;

/**
 * STR-03: a streak stays alive while the last covered day is today or yesterday, and shows its full
 * length during the at-risk day. When yesterday was missed but its make-up window is still open,
 * the streak is pending instead of broken.
 */
export function computeStreak(days: DayMap, today: LocalDate, options: { makeUpOpen: boolean }): StreakView {
  const todayStatus = days.get(today)?.status ?? null;
  const yesterday = addDays(today, -1);
  // Yesterday's gap stays open until its cutoff, whatever today holds: an excused or paused today
  // must not hide it (STR-07).
  const makeUpPending = !days.has(yesterday) && options.makeUpOpen && days.has(addDays(today, -2));
  let length = 0;
  let startDay: LocalDate | null = null;
  let lastCoveredDay: LocalDate | null = null;
  const countRunFrom = (from: LocalDate) => {
    let cursor = from;
    while (days.has(cursor)) {
      if (COUNTS_TOWARD_LENGTH[days.get(cursor)!.status]) length += 1;
      lastCoveredDay ??= cursor;
      startDay = cursor;
      cursor = addDays(cursor, -1);
    }
  };
  if (todayStatus) countRunFrom(today);
  if (makeUpPending) countRunFrom(addDays(today, -2));
  else if (!todayStatus) countRunFrom(yesterday);
  if (startDay === null) {
    return { length: 0, startDay: null, lastCoveredDay: null, todayStatus, doneToday: false, atRisk: false, makeUpPending: false };
  }
  return {
    length,
    startDay,
    lastCoveredDay,
    todayStatus,
    doneToday: todayStatus === "done",
    atRisk: todayStatus === null,
    makeUpPending,
  };
}

/** Length of the run that ends on `lastDay`, counted the way the streak counts. */
export function runLengthEndingOn(days: DayMap, lastDay: LocalDate): number {
  let length = 0;
  let cursor = lastDay;
  while (days.has(cursor)) {
    if (COUNTS_TOWARD_LENGTH[days.get(cursor)!.status]) length += 1;
    cursor = addDays(cursor, -1);
  }
  return length;
}

/** The longest run in the history, through `today`. Future excused days are ignored. */
export function longestStreak(days: DayMap, today: LocalDate): number {
  const dates = [...days.keys()].filter((date) => date <= today).sort();
  let longest = 0;
  let run = 0;
  let previous: LocalDate | null = null;
  for (const date of dates) {
    if (previous === null || diffDays(previous, date) !== 1) run = 0;
    if (COUNTS_TOWARD_LENGTH[days.get(date)!.status]) run += 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  return longest;
}

/** The latest covered day strictly before `before`, or null. */
export function lastCoveredBefore(days: DayMap, before: LocalDate): LocalDate | null {
  let latest: LocalDate | null = null;
  for (const date of days.keys()) {
    if (date < before && (latest === null || date > latest)) latest = date;
  }
  return latest;
}

/** Recited days (done or made up), used by grace awards and earn-back progress. */
export function isRecited(day: HabitDay | undefined): boolean {
  return day !== undefined && RECITED_STATUSES.has(day.status);
}

const STEADY_STATUSES: ReadonlySet<DayStatus> = new Set<DayStatus>(["done", "made_up", "excused"]);

/**
 * STR-27: a steady week has all 7 days earned by recitation or excused. Grace and paused days do not
 * count. Only weeks that have ended, or end today with today recited, are counted.
 */
export function countSteadyWeeks(days: DayMap, today: LocalDate, weekStart: number): number {
  let earliest: LocalDate | null = null;
  for (const date of days.keys()) if (earliest === null || date < earliest) earliest = date;
  if (earliest === null) return 0;
  let count = 0;
  for (let weekFirst = startOfWeek(earliest, weekStart); weekFirst <= today; weekFirst = addDays(weekFirst, 7)) {
    const weekLast = addDays(weekFirst, 6);
    if (weekLast > today) break;
    let steady = true;
    for (let offset = 0; offset < 7 && steady; offset += 1) {
      const status = days.get(addDays(weekFirst, offset))?.status;
      steady = status !== undefined && STEADY_STATUSES.has(status);
    }
    if (steady) count += 1;
  }
  return count;
}
