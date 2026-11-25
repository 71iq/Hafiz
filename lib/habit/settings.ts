import { z } from "zod";
import type { DatabaseExecutor } from "@/lib/database/types";
import { isLocalDate } from "@/lib/habit/dates";
import { parseWirdMinimum, type TallyOptions, type WirdMinimum } from "@/lib/habit/minimum";
import { parseHifzPlan } from "@/lib/hifz/plan";
import type { HabitPause, StreakGoal } from "@/lib/habit/types";

/** Synced habit settings (spec 7.6). `habit_` is an allowlist prefix; each `hifz_` key is listed on its own. */
export const HABIT_SETTING_KEYS = {
  minimum: "hifz_minimum_wird",
  studyCountsTowardMinimum: "hifz_meanings_count",
  goal: "habit_streak_goal",
  pause: "habit_pause",
  weekStart: "habit_week_start",
  /** 5.11 ZAY-02: Zayt can be turned off anywhere it appears. */
  hideZayt: "habit_hide_zayt",
  /** ERR-06: weak-spot markers in the reader are on unless turned off. */
  hideWeakSpots: "habit_hide_weak_spots",
} as const;

/** STR-13: a pause lasts at most 60 days. */
export const MAX_PAUSE_DAYS = 60;

const localDate = z.string().refine(isLocalDate);
const pauseSchema = z.object({ start: localDate, end: localDate }).refine((pause) => pause.start <= pause.end);
const goalSchema = z.object({ target: z.number().int().min(1).max(1000), start: localDate });

export type HabitSettings = Readonly<{
  minimum: WirdMinimum;
  /**
   * The retired "meanings count toward my wird" switch. It still weighs reviews dated before
   * STUDY_RULES_FROM; from then on study cards always count (SPEC 3.4).
   */
  studyCountsTowardMinimum: boolean;
  /** Retention's ayah cards count toward the minimum: the saved plan reviews by ayah. No plan means false. */
  retentionCounts: boolean;
  goal: StreakGoal | null;
  pause: HabitPause | null;
  /** 0 is Sunday. Null means the locale default (STR-28). */
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

/** The hifz plan's key, read with the habit settings because the plan's unit decides whether Retention counts. */
const PLAN_KEY = "hifz_plan";

export function parseHabitSettings(values: ReadonlyMap<string, string>): HabitSettings {
  const weekStart = Number(values.get(HABIT_SETTING_KEYS.weekStart));
  return {
    minimum: parseWirdMinimum(values.get(HABIT_SETTING_KEYS.minimum)),
    studyCountsTowardMinimum: values.get(HABIT_SETTING_KEYS.studyCountsTowardMinimum) === "true",
    retentionCounts: parseHifzPlan(values.get(PLAN_KEY))?.unit === "ayah",
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
  const keys = [...Object.values(HABIT_SETTING_KEYS), PLAN_KEY];
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM user_settings WHERE key IN (${keys.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
    keys,
  );
  return parseHabitSettings(new Map(rows.map((row) => [row.key, row.value])));
}

/** The tally's flags from the habit settings, so every caller weighs reviews the same way. */
export function tallyOptionsOf(settings: Pick<HabitSettings, "studyCountsTowardMinimum" | "retentionCounts">): TallyOptions {
  return { studyCounts: settings.studyCountsTowardMinimum, retentionCounts: settings.retentionCounts };
}

/** STR-28: Saturday in Arabic, Monday elsewhere, unless the user chose a day. */
export function effectiveWeekStart(settings: Pick<HabitSettings, "weekStart">, language: "en" | "ar"): number {
  if (settings.weekStart !== null) return settings.weekStart;
  return language === "ar" ? 6 : 1;
}
