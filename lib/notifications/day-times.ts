import { DEFAULT_MAKE_UP_CUTOFF_MINUTES } from "@/lib/habit/cutoff";
import { addDays, type LocalDate } from "@/lib/habit/dates";
import { FALLBACK_PRAYER_MINUTES, type DayPrayerTimes, type PrayerName } from "@/lib/prayer/times";
import type { DayClock } from "@/lib/notifications/clock";
import type { RamadanAnchor, ReminderAnchor } from "@/lib/notifications/types";

const MINUTE = 60_000;

/** Every reminder time for one local date, as instants. */
export type ReminderDayTimes = Readonly<{
  date: LocalDate;
  /** The wird reminder time (ANC-01). */
  anchorAt: Date;
  /** The anchor is a Ramadan time the user chose (NOT-10), which may fall in quiet hours. */
  ramadanAnchor: boolean;
  /** 5.8.2: max(midnight - 3 h, Isha), kept 30 minutes ahead of the late reminder. */
  atRiskAt: Date;
  /** 5.8.2: 23:15 local. */
  lateAt: Date;
  /** Friday al-Kahf: 09:00, or 10:00 when the wird reminder is near 09:00. */
  kahfAt: Date;
  /** NOT-08: quiet hours end this morning and start again this evening. */
  quietEndsAt: Date;
  quietStartsAt: Date;
  /** Local midnight that ends the date (NOT-06). */
  endsAt: Date;
  prayerTimesSet: boolean;
}>;

export type DayTimesInput = Readonly<{
  clock: DayClock;
  prayers: (date: LocalDate) => DayPrayerTimes | null;
  anchor: ReminderAnchor;
  ramadanAnchor: RamadanAnchor | null;
  isRamadan: (date: LocalDate) => boolean;
}>;

const AT_RISK_EARLIEST_MINUTES = 21 * 60;
const AT_RISK_LATEST_MINUTES = 22 * 60 + 45;
const LATE_REMINDER_MINUTES = 23 * 60 + 15;
const QUIET_START_MINUTES = 23 * 60;
const QUIET_END_MINUTES = 5 * 60;
const KAHF_MINUTES = 9 * 60;
const TARAWEEH_AFTER_ISHA_MINUTES = 90;
const SUHOOR_BEFORE_FAJR_MINUTES = 60;

function plus(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE);
}

function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function earlier(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function prayerAt(input: Pick<DayTimesInput, "clock" | "prayers">, date: LocalDate, prayer: PrayerName): Date {
  return input.prayers(date)?.[prayer] ?? input.clock.at(date, FALLBACK_PRAYER_MINUTES[prayer]);
}

function anchorTime(input: DayTimesInput, date: LocalDate): { at: Date; ramadan: boolean } {
  if (input.ramadanAnchor && input.isRamadan(date)) {
    if (input.ramadanAnchor === "after_taraweeh") {
      return { at: plus(prayerAt(input, date, "isha"), TARAWEEH_AFTER_ISHA_MINUTES), ramadan: true };
    }
    return { at: plus(prayerAt(input, date, "fajr"), -SUHOOR_BEFORE_FAJR_MINUTES), ramadan: true };
  }
  const { anchor } = input;
  if (anchor.kind === "clock") return { at: input.clock.at(date, anchor.minutes), ramadan: false };
  return { at: plus(prayerAt(input, date, anchor.prayer), anchor.offsetMinutes), ramadan: false };
}

/**
 * NOT-08 reads "Isha + 1 hour (or 23:00)" and "30 minutes before Fajr (or 05:00)". The quiet window
 * is the narrower reading, from the later of the two evening times to the earlier of the two
 * morning times. That keeps the 21:00 at-risk reminder (5.8.2) out of quiet hours in winter, when
 * Isha + 1 hour is early evening, and keeps a Fajr + 20 reminder in summer.
 */
export function buildDayTimes(input: DayTimesInput, date: LocalDate): ReminderDayTimes {
  const { clock } = input;
  const prayers = input.prayers(date);
  const anchor = anchorTime(input, date);
  const isha = prayers?.isha ?? null;
  const fajr = prayers?.fajr ?? null;

  const lateAt = clock.at(date, LATE_REMINDER_MINUTES);
  const atRiskBase = later(clock.at(date, AT_RISK_EARLIEST_MINUTES), isha ?? clock.at(date, 0));
  const atRiskAt = earlier(atRiskBase, clock.at(date, AT_RISK_LATEST_MINUTES));

  const quietStartsAt = isha
    ? later(plus(isha, 60), clock.at(date, QUIET_START_MINUTES))
    : clock.at(date, QUIET_START_MINUTES);
  const quietEndsAt = fajr ? earlier(plus(fajr, -30), clock.at(date, QUIET_END_MINUTES)) : clock.at(date, QUIET_END_MINUTES);

  const nineAm = clock.at(date, KAHF_MINUTES);
  const nearNine = Math.abs(anchor.at.getTime() - nineAm.getTime()) < 30 * MINUTE;
  const kahfAt = nearNine ? clock.at(date, KAHF_MINUTES + 60) : nineAm;

  return {
    date,
    anchorAt: anchor.at,
    ramadanAnchor: anchor.ramadan,
    atRiskAt,
    lateAt,
    kahfAt,
    quietEndsAt,
    quietStartsAt,
    endsAt: clock.at(addDays(date, 1), 0),
    prayerTimesSet: prayers !== null,
  };
}

export function isQuietAt(times: ReminderDayTimes, at: Date): boolean {
  return at.getTime() < times.quietEndsAt.getTime() || at.getTime() >= times.quietStartsAt.getTime();
}

/** STR-07 with the planner's clock: Dhuhr the next day, or 12:30. */
export function makeUpCutoff(input: Pick<DayTimesInput, "clock" | "prayers">, missedDay: LocalDate): Date {
  const nextDay = addDays(missedDay, 1);
  return input.prayers(nextDay)?.dhuhr ?? input.clock.at(nextDay, DEFAULT_MAKE_UP_CUTOFF_MINUTES);
}
