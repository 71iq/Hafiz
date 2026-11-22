import type { LocalDate } from "@/lib/habit/dates";
import type { DayPrayerTimes, PrayerName } from "@/lib/prayer/times";
import type { DayClock } from "@/lib/notifications/clock";
import { resolveAnchorAt, reviewFitsDay } from "@/lib/notifications/day-times";
import type { ReminderAnchor } from "@/lib/notifications/types";

/**
 * The second sitting for review (REMIND-07) is picked from the same chips as the main sitting: after
 * one of the five prayers (20 minutes after it), morning at 08:00 or evening at 20:00.
 */
export type SittingChip = PrayerName | "morning" | "evening";

/** Every chip in the order of a usual day, which is also the order "the next chip" follows. */
export const SITTING_CHIPS: readonly SittingChip[] = ["fajr", "morning", "dhuhr", "asr", "maghrib", "evening", "isha"];

const MORNING_MINUTES = 8 * 60;
const EVENING_MINUTES = 20 * 60;
/** The setup chips place a prayer sitting 20 minutes after the prayer (5.8.2). */
export const CHIP_PRAYER_OFFSET_MINUTES = 20;

export function chipAnchor(chip: SittingChip): ReminderAnchor {
  if (chip === "morning") return { kind: "clock", minutes: MORNING_MINUTES };
  if (chip === "evening") return { kind: "clock", minutes: EVENING_MINUTES };
  return { kind: "prayer", prayer: chip, offsetMinutes: CHIP_PRAYER_OFFSET_MINUTES };
}

/** The chip an anchor shows as: its prayer at any offset, or 08:00 and 20:00. Other clock times have none. */
export function chipOf(anchor: ReminderAnchor): SittingChip | null {
  if (anchor.kind === "prayer") return anchor.prayer;
  if (anchor.minutes === MORNING_MINUTES) return "morning";
  if (anchor.minutes === EVENING_MINUTES) return "evening";
  return null;
}

/**
 * The chips that can follow each main sitting on an ordinary day. This is an allowlist, not a promise:
 * at high latitudes and in some seasons prayer times change order (Fajr after 08:00 in a northern
 * winter, a Hanafi Asr after 20:00 in a far-western part of a wide time zone), so each candidate is
 * also checked against today's resolved times (reviewChipAllowed).
 */
const LATER_CHIPS: Readonly<Record<SittingChip, readonly SittingChip[]>> = {
  fajr: ["morning", "dhuhr", "asr", "maghrib", "evening", "isha"],
  morning: ["dhuhr", "asr", "maghrib", "evening", "isha"],
  dhuhr: ["asr", "maghrib", "evening", "isha"],
  asr: ["maghrib", "evening", "isha"],
  maghrib: ["isha"],
  evening: [],
  isha: [],
};

/** The second sitting offered first for each main sitting. A main time without a row starts from the first chip that passes. */
const DEFAULT_REVIEW_CHIP: Readonly<Partial<Record<SittingChip, SittingChip>>> = {
  fajr: "maghrib",
  morning: "maghrib",
  dhuhr: "maghrib",
  asr: "isha",
  maghrib: "isha",
};

/** A prayer main uses its prayer's row whatever its offset; any other clock time can be followed by every chip. */
export function reviewCandidates(main: ReminderAnchor): readonly SittingChip[] {
  const chip = chipOf(main);
  return chip ? LATER_CHIPS[chip] : SITTING_CHIPS;
}

export type SittingDay = Readonly<{
  clock: DayClock;
  /** Saved prayer times, or null for the fallback clock times. */
  prayers: (date: LocalDate) => DayPrayerTimes | null;
  date: LocalDate;
}>;

/**
 * The chip can be chosen today: it is a candidate for the main sitting, and today it resolves strictly
 * after the main sitting with both on today's date. The main time is the ordinary one: a Ramadan time
 * applies only when reminders are delivered, where the same rule skips the days it breaks.
 */
export function reviewChipAllowed(day: SittingDay, main: ReminderAnchor, chip: SittingChip): boolean {
  if (!reviewCandidates(main).includes(chip)) return false;
  return reviewFitsDay(
    day.clock,
    day.date,
    resolveAnchorAt(day, day.date, main),
    resolveAnchorAt(day, day.date, chipAnchor(chip)),
  );
}

/**
 * The second sitting the switch turns on with: the default for the main sitting when it passes today,
 * otherwise the next passing chip after it in day order, then the first passing chip. Null when none
 * passes, so the switch stays off.
 */
export function defaultReviewChip(day: SittingDay, main: ReminderAnchor): SittingChip | null {
  const passing = SITTING_CHIPS.filter((chip) => reviewChipAllowed(day, main, chip));
  const mainChip = chipOf(main);
  const preferred = mainChip ? DEFAULT_REVIEW_CHIP[mainChip] : undefined;
  if (!preferred) return passing[0] ?? null;
  const from = SITTING_CHIPS.indexOf(preferred);
  return passing.find((chip) => SITTING_CHIPS.indexOf(chip) >= from) ?? passing[0] ?? null;
}
