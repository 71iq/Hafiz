import type { LocalDate } from "@/lib/habit/dates";

const DAY_STATUSES = ["done", "made_up", "earned_back", "excused", "paused", "grace"] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export const EARNED_STATUSES = ["done", "made_up", "earned_back", "paused", "grace"] as const;
export type EarnedStatus = (typeof EARNED_STATUSES)[number];

export const EXCUSE_REASONS = ["illness", "travel", "menstruation", "other"] as const;
export type ExcuseReason = (typeof EXCUSE_REASONS)[number];

export const STATUS_PRECEDENCE: Readonly<Record<DayStatus, number>> = {
  done: 6,
  made_up: 5,
  earned_back: 4,
  excused: 3,
  paused: 2,
  grace: 1,
};

export const COUNTS_TOWARD_LENGTH: Readonly<Record<DayStatus, boolean>> = {
  done: true,
  made_up: true,
  earned_back: true,
  excused: true,
  paused: false,
  grace: true,
};

export const RECITED_STATUSES: ReadonlySet<DayStatus> = new Set<DayStatus>(["done", "made_up"]);

export type HabitDayRow = {
  local_date: LocalDate;
  status: DayStatus | null;
  earned_status: EarnedStatus | null;
  reason: ExcuseReason | null;
  excuse_updated_at: string | null;
  minimum_met: number;
  full_met: number;
  manzil_cycle_completed: number;
  source_session_id: string | null;
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

export type HabitDay = Readonly<{
  localDate: LocalDate;
  status: DayStatus;
  fullMet: boolean;
}>;

export type HabitPause = Readonly<{ start: LocalDate; end: LocalDate }>;
export type StreakGoal = Readonly<{ target: number; start: LocalDate }>;

export function toHabitDay(row: HabitDayRow): HabitDay | null {
  if (row.status === null) return null;
  return { localDate: row.local_date, status: row.status, fullMet: row.full_met === 1 };
}
