import { localDateOf, type LocalDate } from "@/lib/habit/dates";

/**
 * Wall-clock conversions for reminder planning. The app uses the device zone; tests pass a clock
 * for a named zone so plans can be checked in any zone and across daylight-saving changes.
 */
export type DayClock = Readonly<{
  /** The instant of a wall-clock minute on a local date. Minutes may run past midnight or below 0. */
  at: (date: LocalDate, minutes: number) => Date;
  dateOf: (at: Date) => LocalDate;
  /** Minutes since local midnight of the instant's own date. */
  minutesOf: (at: Date) => number;
  /** 0 is Sunday. */
  weekdayOf: (date: LocalDate) => number;
}>;

export const deviceClock: DayClock = {
  at: (date, minutes) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day, 0, minutes, 0, 0);
  },
  dateOf: localDateOf,
  minutesOf: (at) => at.getHours() * 60 + at.getMinutes(),
  weekdayOf: (date) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  },
};

/** "05:20" style 24-hour time for a minute of the day. */
export function formatClockMinutes(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  return `${String(hours).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
