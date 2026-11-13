import { addDays, datesBetween, type LocalDate } from "@/lib/habit/dates";
import { findEarnBack } from "@/lib/habit/earn-back";
import { graceBalance } from "@/lib/habit/grace";
import { lastCoveredBefore, toDayMap } from "@/lib/habit/streak";
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
 * 2. Grace days for missed days whose make-up window has closed, while grace is held (STR-14, STR-15).
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

  const lastCovered = lastCoveredBefore(days, today);
  if (lastCovered !== null) {
    let missed = addDays(lastCovered, 1);
    while (missed < today) {
      if (days.has(missed)) {
        missed = addDays(missed, 1);
        continue;
      }
      const windowClosed = now.getTime() >= makeUpCutoffFor(missed).getTime();
      if (!windowClosed) break;
      if (graceBalance(days, missed) <= 0) break;
      record(missed, "grace");
      missed = addDays(missed, 1);
    }
  }

  const earnBack = findEarnBack(days, today, { makeUpOpen: isMakeUpOpen(input) });
  if (earnBack?.succeeded) {
    for (const date of earnBack.restoreDays) record(date, "earned_back");
  }

  return writes;
}
