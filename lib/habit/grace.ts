import type { LocalDate } from "@/lib/habit/dates";
import type { DayMap } from "@/lib/habit/streak";
import type { DayStatus } from "@/lib/habit/types";

export const GRACE_FIRST_AWARD_AFTER = 3;
export const GRACE_AWARD_EVERY = 7;
export const GRACE_MAX_HELD = 2;

const EARNS_GRACE: ReadonlySet<DayStatus> = new Set<DayStatus>(["done", "made_up", "earned_back"]);

/**
 * STR-14: grace days are earned free, one after the 3rd wird day and then one every 7 wird days,
 * holding at most 2. The balance is derived from the history before `before`, never stored (DB-06).
 */
export function graceBalance(days: DayMap, before: LocalDate): number {
  const dates = [...days.keys()].filter((date) => date < before).sort();
  let balance = 0;
  let earnedRun = 0;
  let firstAwarded = false;
  for (const date of dates) {
    const status = days.get(date)!.status;
    if (status === "grace") {
      balance = Math.max(0, balance - 1);
      continue;
    }
    if (!EARNS_GRACE.has(status)) continue;
    earnedRun += 1;
    const threshold = firstAwarded ? GRACE_AWARD_EVERY : GRACE_FIRST_AWARD_AFTER;
    if (earnedRun >= threshold) {
      balance = Math.min(GRACE_MAX_HELD, balance + 1);
      firstAwarded = true;
      earnedRun = 0;
    }
  }
  return balance;
}
