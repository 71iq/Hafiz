import type { LocalDate } from "@/lib/habit/dates";

/**
 * How a local day counts toward the wird streak.
 * done: the minimum wird was recited that day.
 * made_up: the day was missed and made up before Dhuhr the next day (Muslim 747).
 * earned_back: the day was missed and restored by earn-back.
 * excused: illness, travel, menstruation or another excuse marked by the user (Bukhari 2996).
 * paused: inside a pause the user set. Keeps the streak without growing it.
 * grace: an earned grace day covered an unplanned miss.
 */
export const DAY_STATUSES = ["done", "made_up", "earned_back", "excused", "paused", "grace"] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

/** Statuses the app records. They only ever rise in precedence and are never withdrawn. */
export const EARNED_STATUSES = ["done", "made_up", "earned_back", "paused", "grace"] as const;
export type EarnedStatus = (typeof EARNED_STATUSES)[number];

export const EXCUSE_REASONS = ["illness", "travel", "menstruation", "other"] as const;
export type ExcuseReason = (typeof EXCUSE_REASONS)[number];

/** DB-02 precedence: done > made_up > earned_back > excused > paused > grace. */
export const STATUS_PRECEDENCE: Readonly<Record<DayStatus, number>> = {
  done: 6,
  made_up: 5,
  earned_back: 4,
  excused: 3,
  paused: 2,
  grace: 1,
};

/** Statuses that add a day to the streak length. A paused day keeps the streak without growing it. */
export const COUNTS_TOWARD_LENGTH: Readonly<Record<DayStatus, boolean>> = {
  done: true,
  made_up: true,
  earned_back: true,
  excused: true,
  paused: false,
  grace: true,
};

/** Days earned by recitation: they count for earn-back. */
export const RECITED_STATUSES: ReadonlySet<DayStatus> = new Set<DayStatus>(["done", "made_up"]);

/**
 * One local day of the habit, as stored. Flags are SQLite integers.
 *
 * A day has two independent parts so devices always converge (DB-02):
 * - `earned_status`, what the app recorded, which only rises in precedence;
 * - the excuse, `reason` with `excuse_updated_at`, which the user can set and withdraw (last write wins).
 * `status` is the effective status of the two, null when nothing covers the day.
 */
export type HabitDayRow = {
  local_date: LocalDate;
  status: DayStatus | null;
  earned_status: EarnedStatus | null;
  /** The live excuse, or null when the day was never excused or the excuse was withdrawn. */
  reason: ExcuseReason | null;
  /** When the excuse was last set or withdrawn. */
  excuse_updated_at: string | null;
  minimum_met: number;
  full_met: number;
  manzil_cycle_completed: number;
  source_session_id: string | null;
  /** For made_up: the review that completed yesterday's make-up. Later reviews today count for today. */
  credited_through: string | null;
  tz: string | null;
  created_at: string;
  updated_at: string;
};

export function effectiveStatus(earned: EarnedStatus | null, reason: ExcuseReason | null): DayStatus | null {
  if (reason === null) return earned;
  if (earned === null) return "excused";
  return STATUS_PRECEDENCE[earned] > STATUS_PRECEDENCE.excused ? earned : "excused";
}

/** The parts of a covered day that streak and plan logic read. */
export type HabitDay = Readonly<{
  localDate: LocalDate;
  status: DayStatus;
  fullMet: boolean;
}>;

export type HabitPause = Readonly<{ start: LocalDate; end: LocalDate }>;
export type StreakGoal = Readonly<{ target: number; start: LocalDate }>;

/** The day as streak logic sees it, or null when nothing covers it. */
export function toHabitDay(row: HabitDayRow): HabitDay | null {
  if (row.status === null) return null;
  return { localDate: row.local_date, status: row.status, fullMet: row.full_met === 1 };
}
