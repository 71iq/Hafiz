import { addDays, atLocalTime, type LocalDate } from "@/lib/habit/dates";

/** STR-07: without prayer times the make-up window closes at 12:30 local time. */
export const DEFAULT_MAKE_UP_CUTOFF_MINUTES = 12 * 60 + 30;

/** Dhuhr on a local date, or null when prayer times are not set up on this device. */
export type DhuhrResolver = (date: LocalDate) => Date | null;

export const NO_PRAYER_TIMES: DhuhrResolver = () => null;

/**
 * The make-up window for a missed day ends at Dhuhr the following day (Muslim 747), or at 12:30
 * when prayer times are not set.
 */
export function makeUpCutoffFor(missedDay: LocalDate, dhuhr: DhuhrResolver = NO_PRAYER_TIMES): Date {
  const nextDay = addDays(missedDay, 1);
  return dhuhr(nextDay) ?? atLocalTime(nextDay, DEFAULT_MAKE_UP_CUTOFF_MINUTES);
}
