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
  makeUpCutoffFor: (missedDay: LocalDate) => Date;
  pause: HabitPause | null;
}>;

export function isMakeUpOpen(input: Pick<SettlementInput, "today" | "now" | "makeUpCutoffFor">): boolean {
  return input.now.getTime() < input.makeUpCutoffFor(addDays(input.today, -1)).getTime();
}

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
