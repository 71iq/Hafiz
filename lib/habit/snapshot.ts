import { addDays, diffDays, type LocalDate } from "@/lib/habit/dates";
import { findEarnBack, type EarnBack } from "@/lib/habit/earn-back";
import { graceBalance } from "@/lib/habit/grace";
import { nextStreakMilestone, streakTier } from "@/lib/habit/milestones";
import { computeStreak, longestStreak, toDayMap, type StreakView } from "@/lib/habit/streak";
import { COUNTS_TOWARD_LENGTH, type HabitDay, type HabitPause, type StreakGoal } from "@/lib/habit/types";

/** What Home and the session end say about the streak today. One state per day. */
export type HabitHeadline =
  | { kind: "empty" }
  | { kind: "done_today"; length: number }
  | { kind: "excused_today"; length: number }
  | { kind: "paused"; length: number; until: LocalDate }
  | { kind: "at_risk"; length: number }
  | { kind: "make_up_open"; length: number; cutoff: Date }
  | { kind: "earn_back"; earnBack: EarnBack }
  | { kind: "fresh_start"; longest: number };

export type GoalProgress = Readonly<{ target: number; done: number; reached: boolean }>;

export type HabitSnapshot = Readonly<{
  today: LocalDate;
  streak: StreakView;
  headline: HabitHeadline;
  longest: number;
  /** Grace days held now, usable for the next missed day. */
  graceHeld: number;
  /** A grace day used yesterday or the day before, for the note without guilt (STR-16). */
  recentGraceDay: LocalDate | null;
  goal: GoalProgress | null;
  nextMilestone: number;
  tier: number;
}>;

export type SnapshotInput = Readonly<{
  days: readonly HabitDay[];
  today: LocalDate;
  now: Date;
  makeUpCutoff: Date;
  pause: HabitPause | null;
  goal: StreakGoal | null;
}>;

function goalProgress(days: ReadonlyMap<LocalDate, HabitDay>, streak: StreakView, goal: StreakGoal | null): GoalProgress | null {
  if (!goal || !streak.startDay || !streak.lastCoveredDay) {
    return goal ? { target: goal.target, done: 0, reached: false } : null;
  }
  const from = streak.startDay > goal.start ? streak.startDay : goal.start;
  let done = 0;
  for (let date = from; date <= streak.lastCoveredDay; date = addDays(date, 1)) {
    const day = days.get(date);
    if (day && COUNTS_TOWARD_LENGTH[day.status]) done += 1;
  }
  return { target: goal.target, done: Math.min(done, goal.target), reached: done >= goal.target };
}

export function buildHabitSnapshot(input: SnapshotInput): HabitSnapshot {
  const { today, now, makeUpCutoff, pause } = input;
  const days = toDayMap(input.days);
  const makeUpOpen = now.getTime() < makeUpCutoff.getTime();
  const streak = computeStreak(days, today, { makeUpOpen });
  const longest = longestStreak(days, today);
  const earnBack = findEarnBack(days, today, { makeUpOpen });

  // An open earn-back leads: it spans several days, and today's wird is one step of it.
  let headline: HabitHeadline;
  const todayStatus = streak.todayStatus;
  if (earnBack && !earnBack.succeeded) headline = { kind: "earn_back", earnBack };
  // Yesterday's open make-up comes before today's state: an excuse or pause covers today only, and
  // today's wird can be done on a device whose cutoff came earlier while this one can still make up
  // yesterday's grace day. Reviews graded now go to yesterday, so Home shows that progress (STR-07).
  else if (streak.makeUpPending) headline = { kind: "make_up_open", length: streak.length, cutoff: makeUpCutoff };
  else if (todayStatus === "done") headline = { kind: "done_today", length: streak.length };
  else if (todayStatus === "excused") headline = { kind: "excused_today", length: streak.length };
  else if (todayStatus === "paused" || (pause && pause.start <= today && today <= pause.end)) {
    headline = { kind: "paused", length: streak.length, until: pause?.end ?? today };
  } else if (streak.length > 0) headline = { kind: "at_risk", length: streak.length };
  else if (longest > 0) headline = { kind: "fresh_start", longest };
  else headline = { kind: "empty" };

  let recentGraceDay: LocalDate | null = null;
  for (const offset of [1, 2]) {
    const date = addDays(today, -offset);
    if (days.get(date)?.status === "grace") {
      recentGraceDay = date;
      break;
    }
  }

  return {
    today,
    streak,
    headline,
    longest,
    graceHeld: graceBalance(days, addDays(today, 1)),
    recentGraceDay: recentGraceDay && diffDays(recentGraceDay, today) <= 2 ? recentGraceDay : null,
    goal: goalProgress(days, streak, input.goal),
    nextMilestone: nextStreakMilestone(streak.length),
    tier: streakTier(streak.length),
  };
}
