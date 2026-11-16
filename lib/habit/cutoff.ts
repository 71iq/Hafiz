import { addDays, atLocalTime, type LocalDate } from "@/lib/habit/dates";

export const DEFAULT_MAKE_UP_CUTOFF_MINUTES = 12 * 60 + 30;

export type DhuhrResolver = (date: LocalDate) => Date | null;

const NO_PRAYER_TIMES: DhuhrResolver = () => null;

export function makeUpCutoffFor(missedDay: LocalDate, dhuhr: DhuhrResolver = NO_PRAYER_TIMES): Date {
  const nextDay = addDays(missedDay, 1);
  return dhuhr(nextDay) ?? atLocalTime(nextDay, DEFAULT_MAKE_UP_CUTOFF_MINUTES);
}
