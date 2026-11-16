import { z } from "zod";
import type { DatabaseExecutor } from "@/lib/database/types";
import { isLocalDate } from "@/lib/habit/dates";
import { parseWirdMinimum, type WirdMinimum } from "@/lib/habit/minimum";
import type { HabitPause, StreakGoal } from "@/lib/habit/types";

export const HABIT_SETTING_KEYS = {
  minimum: "hifz_minimum_wird",
  studyCountsTowardMinimum: "hifz_meanings_count",
  goal: "habit_streak_goal",
  pause: "habit_pause",
  weekStart: "habit_week_start",
  hideZayt: "habit_hide_zayt",
  hideWeakSpots: "habit_hide_weak_spots",
} as const;

export const MAX_PAUSE_DAYS = 60;

const localDate = z.string().refine(isLocalDate);
const pauseSchema = z.object({ start: localDate, end: localDate }).refine((pause) => pause.start <= pause.end);
const goalSchema = z.object({ target: z.number().int().min(1).max(1000), start: localDate });

export type HabitSettings = Readonly<{
  minimum: WirdMinimum;
  studyCountsTowardMinimum: boolean;
  goal: StreakGoal | null;
  pause: HabitPause | null;
  weekStart: number | null;
  showZayt: boolean;
  showWeakSpots: boolean;
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

export function parseHabitSettings(values: ReadonlyMap<string, string>): HabitSettings {
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
    showWeakSpots: values.get(HABIT_SETTING_KEYS.hideWeakSpots) !== "true",
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

export function effectiveWeekStart(settings: Pick<HabitSettings, "weekStart">, language: "en" | "ar"): number {
  if (settings.weekStart !== null) return settings.weekStart;
  return language === "ar" ? 6 : 1;
}
