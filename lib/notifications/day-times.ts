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
  /**
   * The second sitting's time (REMIND-07), or null when it is off. It never follows the Ramadan time.
   * It may resolve at or before the anchor, or past midnight; the planner skips it then (reviewFitsDay).
   */
  reviewAt: Date | null;
  /**
   * 5.8.2: 3 hours before midnight, or after Isha when prayer times are set. After Isha it lands 20
   * minutes in, before quiet hours start, and it stays 30 minutes ahead of the late reminder.
   */
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
  /** REMIND-07: the second sitting, null or left out when it is off. */
  reviewAnchor?: ReminderAnchor | null;
  ramadanAnchor: RamadanAnchor | null;
  isRamadan: (date: LocalDate) => boolean;
}>;

/** 3 hours before local midnight, used without prayer times. */
const AT_RISK_MINUTES = 21 * 60;
const AT_RISK_AFTER_ISHA_MINUTES = 20;
const AT_RISK_LATEST_MINUTES = 22 * 60 + 45;
export const LATE_REMINDER_MINUTES = 23 * 60 + 15;
/** NOT-08 with prayer times: quiet from Isha + 1 hour until 30 minutes before Fajr. */
const QUIET_AFTER_ISHA_MINUTES = 60;
const QUIET_BEFORE_FAJR_MINUTES = 30;
/** NOT-08 without prayer times. */
const QUIET_START_MINUTES = 23 * 60;
const QUIET_END_MINUTES = 5 * 60;
const KAHF_MINUTES = 9 * 60;
const TARAWEEH_AFTER_ISHA_MINUTES = 90;
const SUHOOR_BEFORE_FAJR_MINUTES = 60;

function plus(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE);
}

function earlier(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function prayerAt(input: Pick<DayTimesInput, "clock" | "prayers">, date: LocalDate, prayer: PrayerName): Date {
  return input.prayers(date)?.[prayer] ?? input.clock.at(date, FALLBACK_PRAYER_MINUTES[prayer]);
}

/**
 * An anchor's instant on `date` without the Ramadan time: a clock minute, or minutes after the day's
 * prayer, from saved prayer times or the fallback clock times. A late prayer plus its offset can pass
 * midnight, so the result may fall on the next date.
 */
export function resolveAnchorAt(input: Pick<DayTimesInput, "clock" | "prayers">, date: LocalDate, anchor: ReminderAnchor): Date {
  if (anchor.kind === "clock") return input.clock.at(date, anchor.minutes);
  return plus(prayerAt(input, date, anchor.prayer), anchor.offsetMinutes);
}

function anchorTime(input: DayTimesInput, date: LocalDate): { at: Date; ramadan: boolean } {
  if (input.ramadanAnchor && input.isRamadan(date)) {
    if (input.ramadanAnchor === "after_taraweeh") {
      return { at: plus(prayerAt(input, date, "isha"), TARAWEEH_AFTER_ISHA_MINUTES), ramadan: true };
    }
    return { at: plus(prayerAt(input, date, "fajr"), -SUHOOR_BEFORE_FAJR_MINUTES), ramadan: true };
  }
  return { at: resolveAnchorAt(input, date, input.anchor), ramadan: false };
}

/**
 * REMIND-07: the second sitting belongs to a day only when it comes strictly after the main sitting and
 * both fall on that local date. Seasonal prayer times, a Ramadan time or a later edit of the main time
 * can break this on some days; the saved choice stays, and only those days go without the reminder.
 */
export function reviewFitsDay(clock: DayClock, date: LocalDate, mainAt: Date, reviewAt: Date): boolean {
  return reviewAt.getTime() > mainAt.getTime() && clock.dateOf(mainAt) === date && clock.dateOf(reviewAt) === date;
}

/**
 * NOT-08: no reminder between Isha + 1 hour and 30 minutes before Fajr. The clock times in the rule,
 * 23:00 and 05:00, apply only when prayer times are not set. With prayer times the at-risk reminder
 * (5.8.2) follows Isha so it is sent before quiet hours start, even in winter when Isha is early.
 */
export function buildDayTimes(input: DayTimesInput, date: LocalDate): ReminderDayTimes {
  const { clock } = input;
  const prayers = input.prayers(date);
  const anchor = anchorTime(input, date);
  const isha = prayers?.isha ?? null;
  const fajr = prayers?.fajr ?? null;

  const lateAt = clock.at(date, LATE_REMINDER_MINUTES);
  const atRiskAt = earlier(
    isha ? plus(isha, AT_RISK_AFTER_ISHA_MINUTES) : clock.at(date, AT_RISK_MINUTES),
    clock.at(date, AT_RISK_LATEST_MINUTES),
  );

  const quietStartsAt = isha ? plus(isha, QUIET_AFTER_ISHA_MINUTES) : clock.at(date, QUIET_START_MINUTES);
  const quietEndsAt = fajr ? plus(fajr, -QUIET_BEFORE_FAJR_MINUTES) : clock.at(date, QUIET_END_MINUTES);

  const nineAm = clock.at(date, KAHF_MINUTES);
  const nearNine = Math.abs(anchor.at.getTime() - nineAm.getTime()) < 30 * MINUTE;
  const kahfAt = nearNine ? clock.at(date, KAHF_MINUTES + 60) : nineAm;

  return {
    date,
    anchorAt: anchor.at,
    ramadanAnchor: anchor.ramadan,
    reviewAt: input.reviewAnchor ? resolveAnchorAt(input, date, input.reviewAnchor) : null,
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
