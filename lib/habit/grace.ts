import type { LocalDate } from "@/lib/habit/dates";
import type { DayMap } from "@/lib/habit/streak";
import type { DayStatus } from "@/lib/habit/types";

const GRACE_FIRST_AWARD_AFTER = 3;
const GRACE_AWARD_EVERY = 7;
const GRACE_MAX_HELD = 2;

const EARNS_GRACE: ReadonlySet<DayStatus> = new Set<DayStatus>(["done", "made_up", "earned_back"]);

/**
 * STR-14: grace days are earned free, one after the 3rd wird day and then one every 7 wird days,
 * holding at most 2. Feed day statuses in date order; a grace day spends one.
 */
export class GraceCounter {
  private earnedRun = 0;
  private firstAwarded = false;
  balance = 0;

  add(status: DayStatus): void {
    if (status === "grace") {
      this.balance = Math.max(0, this.balance - 1);
      return;
    }
    if (!EARNS_GRACE.has(status)) return;
    this.earnedRun += 1;
    const threshold = this.firstAwarded ? GRACE_AWARD_EVERY : GRACE_FIRST_AWARD_AFTER;
    if (this.earnedRun >= threshold) {
      this.balance = Math.min(GRACE_MAX_HELD, this.balance + 1);
      this.firstAwarded = true;
      this.earnedRun = 0;
    }
  }
}

/** The grace balance held before `before`, derived from history and never stored (DB-06). */
export function graceBalance(days: DayMap, before: LocalDate): number {
  const counter = new GraceCounter();
  for (const date of [...days.keys()].filter((date) => date < before).sort()) counter.add(days.get(date)!.status);
  return counter.balance;
}
