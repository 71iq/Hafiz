import { z } from "zod";
import type { DatabaseExecutor } from "@/lib/database/types";
import { isLocalDate } from "@/lib/habit/dates";
import { parseWirdMinimum, type WirdMinimum } from "@/lib/habit/minimum";
import type { HabitPause, StreakGoal } from "@/lib/habit/types";

/** Synced habit settings (spec 7.6). Keys under `habit_` and `hifz_` are on the sync allowlist. */
export const HABIT_SETTING_KEYS = {
  minimum: "hifz_minimum_wird",
  studyCountsTowardMinimum: "hifz_meanings_count",
  goal: "habit_streak_goal",
  pause: "habit_pause",
  weekStart: "habit_week_start",
  /** 5.11 ZAY-02: Zayt can be turned off anywhere it appears. */
  hideZayt: "habit_hide_zayt",
} as const;

/** STR-13: a pause lasts at most 60 days. */
export const MAX_PAUSE_DAYS = 60;

const localDate = z.string().refine(isLocalDate);
const pauseSchema = z.object({ start: localDate, end: localDate }).refine((pause) => pause.start <= pause.end);
const goalSchema = z.object({ target: z.number().int().min(1).max(1000), start: localDate });

export type HabitSettings = Readonly<{
  minimum: WirdMinimum;
  studyCountsTowardMinimum: boolean;
  goal: StreakGoal | null;
  pause: HabitPause | null;
  /** 0 is Sunday. Null means the locale default (STR-28). */
  weekStart: number | null;
  showZayt: boolean;
}>;

function parseJson<T>(value: string | undefined, schema: z.ZodType<T>): T | null {
  if (!value) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseHabitSettings(values: ReadonlyMap<string, string>): HabitSettings {
  const weekStart = Number(values.get(HABIT_SETTING_KEYS.weekStart));
  return {
    minimum: parseWirdMinimum(values.get(HABIT_SETTING_KEYS.minimum)),
    studyCountsTowardMinimum: values.get(HABIT_SETTING_KEYS.studyCountsTowardMinimum) === "true",
    goal: parseJson(values.get(HABIT_SETTING_KEYS.goal), goalSchema),
    pause: parseJson(values.get(HABIT_SETTING_KEYS.pause), pauseSchema),
    weekStart: Number.isInteger(weekStart) && weekStart >= 0 && weekStart <= 6 && values.has(HABIT_SETTING_KEYS.weekStart)
      ? weekStart
      : null,
    showZayt: values.get(HABIT_SETTING_KEYS.hideZayt) !== "true",
  };
}

export async function readHabitSettings(db: DatabaseExecutor): Promise<HabitSettings> {
  const keys = Object.values(HABIT_SETTING_KEYS);
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM user_settings WHERE key IN (${keys.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
    keys,
  );
  return parseHabitSettings(new Map(rows.map((row) => [row.key, row.value])));
}

/** STR-28: Saturday in Arabic, Monday elsewhere, unless the user chose a day. */
export function effectiveWeekStart(settings: Pick<HabitSettings, "weekStart">, language: "en" | "ar"): number {
  if (settings.weekStart !== null) return settings.weekStart;
  return language === "ar" ? 6 : 1;
}
