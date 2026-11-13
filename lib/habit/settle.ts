import { addDays, datesBetween, type LocalDate } from "@/lib/habit/dates";
import { findEarnBack } from "@/lib/habit/earn-back";
import { GraceCounter } from "@/lib/habit/grace";
import { toDayMap } from "@/lib/habit/streak";
import type { DayStatus, HabitDay, HabitPause } from "@/lib/habit/types";

export type SettlementWrite = Readonly<{ localDate: LocalDate; status: Extract<DayStatus, "grace" | "paused" | "earned_back"> }>;

export type SettlementInput = Readonly<{
  days: readonly HabitDay[];
  today: LocalDate;
  now: Date;
  /** End of the make-up window for a missed day: Dhuhr of the following day, or 12:30. */
  makeUpCutoffFor: (missedDay: LocalDate) => Date;
  pause: HabitPause | null;
}>;

/** Whether yesterday can still be made up right now (STR-07). */
export function isMakeUpOpen(input: Pick<SettlementInput, "today" | "now" | "makeUpCutoffFor">): boolean {
  return input.now.getTime() < input.makeUpCutoffFor(addDays(input.today, -1)).getTime();
}

/**
 * The idempotent "settle days" pass, run on app open, on Home focus and after sync, never as a
 * background job. It records what the rules already decided:
 * 1. Paused days inside the user's pause, through today (STR-13).
 * 2. Grace days for missed days whose make-up window has closed, while grace is held (STR-14, STR-15),
 *    replayed over the whole history so an earlier unsettled gap is not skipped.
 * 3. Earned-back days once an earn-back succeeded (STR-17).
 * Days already covered are never touched, so running it twice writes nothing the second time.
 */
export function planSettlement(input: SettlementInput): SettlementWrite[] {
  const { today, now, makeUpCutoffFor, pause } = input;
  const days = toDayMap(input.days);
  const writes: SettlementWrite[] = [];
  const record = (localDate: LocalDate, status: SettlementWrite["status"]) => {
    writes.push({ localDate, status });
    days.set(localDate, { localDate, status, fullMet: false });
  };

  if (pause && pause.start <= today && pause.start <= pause.end) {
    const through = pause.end < today ? pause.end : today;
    for (const date of datesBetween(pause.start, through)) {
      if (!days.has(date)) record(date, "paused");
    }
  }

  // Walk the whole history in date order with a running balance, so a gap that was never settled
  // (the app stayed closed, or the next day's wird came from another device) still gets the grace
  // the rules gave it. Only a day right after a covered day can take grace.
  const dates = [...days.keys()].sort();
  if (dates.length > 0) {
    const counter = new GraceCounter();
    for (let date = dates[0]!; date < today; date = addDays(date, 1)) {
      const day = days.get(date);
      if (day) {
        counter.add(day.status);
        continue;
      }
      const afterCovered = days.has(addDays(date, -1));
      const windowClosed = now.getTime() >= makeUpCutoffFor(date).getTime();
      if (afterCovered && windowClosed && counter.balance > 0) {
        record(date, "grace");
        counter.add("grace");
      }
    }
  }

  const earnBack = findEarnBack(days, today, { makeUpOpen: isMakeUpOpen(input) });
  if (earnBack?.succeeded) {
    for (const date of earnBack.restoreDays) record(date, "earned_back");
  }

  return writes;
}
