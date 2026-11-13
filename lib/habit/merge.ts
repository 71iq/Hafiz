import { compareSyncTimestamps } from "@/lib/database/sync-timestamps";
import { effectiveStatus, STATUS_PRECEDENCE, type EarnedStatus, type HabitDayRow } from "@/lib/habit/types";

/** Orders instants, then their spelling (".000Z" or "Z"), so every comparison is total. */
function compareTimes(a: string, b: string): number {
  const order = compareSyncTimestamps(a, b);
  if (order !== 0) return order;
  return a < b ? -1 : a > b ? 1 : 0;
}

function later(a: string, b: string): string {
  return compareTimes(a, b) >= 0 ? a : b;
}

function earlier(a: string, b: string): string {
  return compareTimes(a, b) <= 0 ? a : b;
}

function laterOptional(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return later(a, b);
}

function earnedRank(status: EarnedStatus | null): number {
  return status === null ? 0 : STATUS_PRECEDENCE[status];
}

/** Total order for the earned part: precedence, then its session and zone. */
function compareEarned(a: HabitDayRow, b: HabitDayRow): number {
  const byRank = earnedRank(a.earned_status) - earnedRank(b.earned_status);
  if (byRank !== 0) return byRank;
  const left = `${a.source_session_id ?? ""}\u0000${a.tz ?? ""}`;
  const right = `${b.source_session_id ?? ""}\u0000${b.tz ?? ""}`;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Total order for the excuse register: last write wins by instant, then the reason, then the
 * timestamp spelling. The server merge (private.merge_habit_day) compares the same instant and
 * reason, so a withdrawal and an excuse written at the same instant but spelled ".000Z" and "Z"
 * resolve the same way on both sides. The spelling only decides which equal string is kept.
 */
function compareExcuse(a: HabitDayRow, b: HabitDayRow): number {
  if (a.excuse_updated_at === null || b.excuse_updated_at === null) {
    return (a.excuse_updated_at === null ? 0 : 1) - (b.excuse_updated_at === null ? 0 : 1);
  }
  const byInstant = compareSyncTimestamps(a.excuse_updated_at, b.excuse_updated_at);
  if (byInstant !== 0) return byInstant;
  const left = a.reason ?? "";
  const right = b.reason ?? "";
  if (left !== right) return left < right ? -1 : 1;
  return compareTimes(a.excuse_updated_at, b.excuse_updated_at);
}

/**
 * Merge two versions of the same local day (DB-02). Every part is a maximum over a total order or an
 * OR, so the merge is commutative, associative and idempotent and devices converge in any order.
 *
 * - The earned status keeps the highest precedence, with that version's session and zone.
 * - The excuse keeps the latest write, so withdrawing an excused day sticks.
 * - The effective status is the higher of the two.
 * - The flags merge with OR, and the made-up credit keeps the later review, so no review counts for
 *   two days.
 */
export function mergeHabitDays(a: HabitDayRow, b: HabitDayRow): HabitDayRow {
  if (a.local_date !== b.local_date) throw new Error("Cannot merge different habit days");
  const earned = compareEarned(a, b) >= 0 ? a : b;
  const excuse = compareExcuse(a, b) >= 0 ? a : b;
  return {
    local_date: a.local_date,
    status: effectiveStatus(earned.earned_status, excuse.reason),
    earned_status: earned.earned_status,
    reason: excuse.reason,
    excuse_updated_at: excuse.excuse_updated_at,
    minimum_met: a.minimum_met === 1 || b.minimum_met === 1 ? 1 : 0,
    full_met: a.full_met === 1 || b.full_met === 1 ? 1 : 0,
    manzil_cycle_completed: a.manzil_cycle_completed === 1 || b.manzil_cycle_completed === 1 ? 1 : 0,
    source_session_id: earned.source_session_id,
    credited_through: laterOptional(a.credited_through, b.credited_through),
    tz: earned.tz,
    created_at: earlier(a.created_at, b.created_at),
    updated_at: later(a.updated_at, b.updated_at),
  };
}
