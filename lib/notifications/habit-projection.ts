import { addDays, diffDays, type LocalDate } from "@/lib/habit/dates";
import { findEarnBack, type EarnBack } from "@/lib/habit/earn-back";
import { GraceCounter } from "@/lib/habit/grace";
import { nextStreakMilestone, streakTier } from "@/lib/habit/milestones";
import { planSettlement } from "@/lib/habit/settle";
import { buildHabitSnapshot, type HabitHeadline, type HabitSnapshot } from "@/lib/habit/snapshot";
import { toDayMap } from "@/lib/habit/streak";
import { COUNTS_TOWARD_LENGTH, type DayStatus, type HabitDay, type HabitPause } from "@/lib/habit/types";
import type { DayClock } from "@/lib/notifications/clock";
import { makeUpCutoff } from "@/lib/notifications/day-times";
import type { DayPrayerTimes } from "@/lib/prayer/times";

export type HabitProjectionInput = Readonly<{
  habit: Readonly<{ days: readonly HabitDay[]; pause: HabitPause | null }>;
  clock: DayClock;
  prayers: (date: LocalDate) => DayPrayerTimes | null;
}>;

export type HabitProjection = Readonly<{
  snapshot: HabitSnapshot;
  /**
   * Covered days through the projected date after settlement, for lifecycle state (6.1). A full
   * replay returns every day. A projection from a summary returns the first day, the latest day
   * before the last 30 and every day since, which is everything lifecycle state reads.
   */
  days: readonly HabitDay[];
}>;

export type HabitProjector = (date: LocalDate, at: Date) => HabitProjection;

/**
 * Days before `from` minus this many are settled once and summarized. 8 days covers the earn-back
 * look-back (a broken run ends at most 7 days back) and the make-up window (yesterday).
 */
const RECENT_DAYS = 8;
/** Lifecycle state reads the last 30 days (6.1); the summary keeps those days. */
const LIFECYCLE_DAYS = 30;
/**
 * The earlier part of a run reaching into the recent window is stood in for by at most this many
 * excused days. It must be at least every run length lib/habit decides on (earn-back needs 7), so
 * the capped stand-in decides the same way; the exact lengths are restored afterwards.
 */
const STAND_IN_CAP = 14;
const DAY_MS = 86_400_000;

function settledDay(localDate: LocalDate, status: DayStatus): HabitDay {
  return { localDate, status, fullMet: false };
}

/**
 * The habit as it will stand at `at` on `date` if the user does nothing more: the settle pass (grace,
 * pause and earn-back days) runs with lib/habit's rules over the whole history, then the snapshot is
 * built. This replays every day, so it is the reference the summarized projection must match.
 */
export function replayHabit(input: HabitProjectionInput, date: LocalDate, at: Date): HabitProjection {
  const cutoffFor = (missed: LocalDate) => makeUpCutoff(input, missed);
  const writes = planSettlement({ days: input.habit.days, today: date, now: at, makeUpCutoffFor: cutoffFor, pause: input.habit.pause });
  let days = input.habit.days;
  if (writes.length > 0) {
    const byDate = new Map(days.map((day) => [day.localDate, day]));
    for (const write of writes) byDate.set(write.localDate, settledDay(write.localDate, write.status));
    days = [...byDate.values()].sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
  }
  const snapshot = buildHabitSnapshot({
    days,
    today: date,
    now: at,
    makeUpCutoff: cutoffFor(addDays(date, -1)),
    pause: input.habit.pause,
    goal: null,
  });
  return { snapshot, days };
}

/** What the projection needs from the settled days before the cut. */
type EarlierSummary = Readonly<{
  /** Settled statuses in date order, replayed into each grace counter. */
  statuses: readonly DayStatus[];
  /** The day before the cut is covered, so a run can continue across the cut. */
  covered: boolean;
  /** The run ending the day before the cut: its counted length and first day. */
  runLength: number;
  runStart: LocalDate | null;
  longest: number;
  /** For lifecycle state: the first settled day, the latest one and those of the last 30 days. */
  lifecycleDays: readonly HabitDay[];
}>;

/**
 * Projects the habit for many dates and instants from one summary. The history before the recent
 * window is settled once; each projection settles only the window, runs lib/habit on the window with
 * a short stand-in for the earlier run, and restores the lengths that reach back past the cut.
 *
 * Queries for `from` or later, at instants after every earlier make-up window has closed, use the
 * summary. Anything else falls back to the full replay, so the result is always the replay's.
 */
export function createHabitProjector(input: HabitProjectionInput, from: LocalDate): HabitProjector {
  const cutoffs = new Map<LocalDate, Date>();
  const cutoffFor = (missed: LocalDate): Date => {
    let cutoff = cutoffs.get(missed);
    if (!cutoff) {
      cutoff = makeUpCutoff(input, missed);
      cutoffs.set(missed, cutoff);
    }
    return cutoff;
  };
  const { pause } = input.habit;
  const cut = addDays(from, -RECENT_DAYS);
  const beforeCut = addDays(cut, -1);
  // From this instant every make-up window for a day before the cut has closed.
  const settledFrom = Math.max(input.clock.at(addDays(cut, 1), 0).getTime(), cutoffFor(beforeCut).getTime());

  const stored = toDayMap(input.habit.days);
  const recent = new Map<LocalDate, HabitDay>();
  const earlierDays: HabitDay[] = [];
  for (const day of stored.values()) {
    if (day.localDate < cut) earlierDays.push(day);
    else recent.set(day.localDate, day);
  }
  const earlier = summarizeEarlier(earlierDays, {
    pause,
    cut,
    settledFrom: new Date(settledFrom),
    cutoffFor,
    lifecycleFrom: addDays(from, -LIFECYCLE_DAYS),
  });
  const standInLength = Math.min(earlier.runLength, STAND_IN_CAP);
  const standIn: HabitDay[] = !earlier.covered
    ? []
    : standInLength === 0
      ? [settledDay(beforeCut, "paused")]
      : Array.from({ length: standInLength }, (_, index) => settledDay(addDays(cut, index - standInLength), "excused"));
  const missingLength = earlier.runLength - standInLength;

  const counterAfterEarlier = () => {
    const counter = new GraceCounter();
    for (const status of earlier.statuses) counter.add(status);
    return counter;
  };

  const project = (date: LocalDate, at: Date): HabitProjection => {
    const days = new Map(recent);
    // STR-13: pause days inside the window.
    if (pause && pause.start <= date && pause.start <= pause.end) {
      const through = pause.end < date ? pause.end : date;
      for (let day = pause.start < cut ? cut : pause.start; day <= through; day = addDays(day, 1)) {
        if (!days.has(day)) days.set(day, settledDay(day, "paused"));
      }
    }
    // STR-14, STR-15: the grace walk continues from the earlier balance.
    const walk = counterAfterEarlier();
    for (let day = cut; day < date; day = addDays(day, 1)) {
      const existing = days.get(day);
      if (existing) {
        walk.add(existing.status);
        continue;
      }
      const afterCovered = day === cut ? earlier.covered : days.has(addDays(day, -1));
      if (afterCovered && walk.balance > 0 && at.getTime() >= cutoffFor(day).getTime()) {
        days.set(day, settledDay(day, "grace"));
        walk.add("grace");
      }
    }
    // STR-17: an earn-back that succeeded restores its missed days.
    const withStandIn = new Map<LocalDate, HabitDay>([...standIn.map((day) => [day.localDate, day] as const), ...days]);
    const makeUpCutoffToday = cutoffFor(addDays(date, -1));
    const settledEarnBack = findEarnBack(withStandIn, date, { makeUpOpen: at.getTime() < makeUpCutoffToday.getTime() });
    if (settledEarnBack?.succeeded) {
      for (const day of settledEarnBack.restoreDays) {
        const restored = settledDay(day, "earned_back");
        days.set(day, restored);
        withStandIn.set(day, restored);
      }
    }

    const base = buildHabitSnapshot({
      days: [...withStandIn.values()],
      today: date,
      now: at,
      makeUpCutoff: makeUpCutoffToday,
      pause,
      goal: null,
    });
    const throughDate = [...days.keys()].filter((day) => day <= date).sort();
    const reachesEarlier = (lastDay: LocalDate) => {
      if (!earlier.covered) return false;
      for (let day = lastDay; day >= cut; day = addDays(day, -1)) if (!days.has(day)) return false;
      return true;
    };

    const streak =
      base.streak.startDay !== null && base.streak.startDay < cut
        ? { ...base.streak, length: base.streak.length + missingLength, startDay: earlier.runStart }
        : base.streak;

    let longest = earlier.longest;
    let run = earlier.covered ? earlier.runLength : 0;
    let previous: LocalDate | null = earlier.covered ? beforeCut : null;
    const held = counterAfterEarlier();
    for (const day of throughDate) {
      const status = days.get(day)!.status;
      if (previous === null || diffDays(previous, day) !== 1) run = 0;
      if (COUNTS_TOWARD_LENGTH[status]) run += 1;
      longest = Math.max(longest, run);
      previous = day;
      held.add(status);
    }

    const restoreEarnBack = (earnBack: EarnBack): EarnBack =>
      reachesEarlier(earnBack.lastDay) ? { ...earnBack, brokenLength: earnBack.brokenLength + missingLength } : earnBack;
    const snapshot: HabitSnapshot = {
      ...base,
      streak,
      headline: restoreHeadline(base.headline, streak.length, longest, restoreEarnBack),
      longest,
      graceHeld: held.balance,
      nextMilestone: nextStreakMilestone(streak.length),
      tier: streakTier(streak.length),
    };
    return { snapshot, days: [...earlier.lifecycleDays, ...throughDate.map((day) => days.get(day)!)] };
  };

  const memo = new Map<string, HabitProjection>();
  return (date, at) => {
    if (date < from || at.getTime() < settledFrom) return replayHabit(input, date, at);
    const key = `${date}|${at.getTime()}`;
    let projection = memo.get(key);
    if (!projection) {
      projection = project(date, at);
      memo.set(key, projection);
    }
    return projection;
  };
}

/** Settles the days before the cut once, the way the full replay settles them for any later date. */
function summarizeEarlier(
  stored: readonly HabitDay[],
  options: Readonly<{
    pause: HabitPause | null;
    cut: LocalDate;
    settledFrom: Date;
    cutoffFor: (missed: LocalDate) => Date;
    lifecycleFrom: LocalDate;
  }>,
): EarlierSummary {
  const { pause, cut } = options;
  const beforeCut = addDays(cut, -1);
  // The replay pauses through the projected date; before the cut that is through the day before it.
  const earlierPause =
    pause && pause.start <= beforeCut && pause.start <= pause.end
      ? { start: pause.start, end: pause.end < beforeCut ? pause.end : beforeCut }
      : null;
  // Earn-back days restored here belong to a window the replay no longer looks at, so they are dropped.
  const writes = planSettlement({
    days: stored,
    today: cut,
    now: options.settledFrom,
    makeUpCutoffFor: options.cutoffFor,
    pause: earlierPause,
  })
    .filter((write) => write.status !== "earned_back")
    .map((write) => settledDay(write.localDate, write.status));
  const settled = toDayMap([...stored, ...writes]);
  const dates = [...settled.keys()].sort();

  // Runs the way lib/habit counts them (longestStreak, computeStreak), in one pass on day numbers
  // rather than date strings, since this walks the whole history.
  let longest = 0;
  let run = 0;
  let runStart: LocalDate | null = null;
  let previous = Number.NaN;
  for (const date of dates) {
    const dayNumber = Date.parse(`${date}T00:00:00Z`) / DAY_MS;
    if (dayNumber - previous !== 1) {
      run = 0;
      runStart = date;
    }
    if (COUNTS_TOWARD_LENGTH[settled.get(date)!.status]) run += 1;
    longest = Math.max(longest, run);
    previous = dayNumber;
  }
  const covered = dates.length > 0 && dates[dates.length - 1] === beforeCut;
  const lifecycleDates = dates.filter(
    (date, index) => index === 0 || index === dates.length - 1 || date >= options.lifecycleFrom,
  );
  return {
    statuses: dates.map((date) => settled.get(date)!.status),
    covered,
    runLength: covered ? run : 0,
    runStart: covered ? runStart : null,
    longest,
    lifecycleDays: lifecycleDates.map((date) => settled.get(date)!),
  };
}

/** The headline lib/habit chose, with lengths that reach back past the cut restored. */
function restoreHeadline(
  headline: HabitHeadline,
  length: number,
  longest: number,
  restoreEarnBack: (earnBack: EarnBack) => EarnBack,
): HabitHeadline {
  switch (headline.kind) {
    case "done_today":
    case "excused_today":
    case "paused":
    case "at_risk":
    case "make_up_open":
      return { ...headline, length };
    case "earn_back":
      return { kind: "earn_back", earnBack: restoreEarnBack(headline.earnBack) };
    case "fresh_start":
    case "empty":
      return longest > 0 ? { kind: "fresh_start", longest } : { kind: "empty" };
    default: {
      const unknown: never = headline;
      return unknown;
    }
  }
}

/** One projection. Plans with many projections share a projector instead. */
export function projectHabit(input: HabitProjectionInput, date: LocalDate, at: Date): HabitProjection {
  return createHabitProjector(input, date)(date, at);
}
