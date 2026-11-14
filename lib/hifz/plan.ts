import { z } from "zod";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";

/** Spec 3.3: the user's chosen method and pace. Stored as the synced setting hifz_plan. */
const HIFZ_PLAN_KEY = "hifz_plan";

export const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type Prayer = (typeof PRAYERS)[number];

const anchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prayer"), prayer: z.enum(PRAYERS), offsetMin: z.number().int().min(0).max(180) }),
  z.object({ kind: z.literal("clock"), minutes: z.number().int().min(0).max(24 * 60 - 1) }),
]);
export type Anchor = z.infer<typeof anchorSchema>;

/** SBQ-01: the range each sabaq repetition count can be set to. */
export const SABAQ_REPETITION_BOUNDS = {
  listen: { min: 1, max: 5 },
  looking: { min: 1, max: 30 },
  cleanInARow: { min: 1, max: 10 },
} as const;
export type SabaqRepetitionCount = keyof typeof SABAQ_REPETITION_BOUNDS;

const repetitionCount = (count: SabaqRepetitionCount) =>
  z.number().int().min(SABAQ_REPETITION_BOUNDS[count].min).max(SABAQ_REPETITION_BOUNDS[count].max);

const sabaqRepetitionsSchema = z.object({
  /** Step 2: how many times the reciter plays the new lines. */
  listen: repetitionCount("listen"),
  /** Step 4: readings while looking before reciting from memory. */
  looking: repetitionCount("looking"),
  /** Step 6: clean recitations of all the new lines in a row. */
  cleanInARow: repetitionCount("cleanInARow"),
});
export type SabaqRepetitions = z.infer<typeof sabaqRepetitionsSchema>;

export type SabaqRepetitionPreset = "looking_then_memory" | "twenty_times";

/**
 * SBQ-01 presets. The default is the "10 looking, then from memory" practice. The 20-times method is
 * attributed to Sh. 'Abd al-Muhsin al-Qasim and its exact wording is unverified. Its core is 20
 * readings while looking; the ayah-by-ayah chaining step covers its per-ayah linking, so listening
 * and the clean run keep their default counts.
 */
export const SABAQ_REPETITION_PRESETS: Readonly<Record<SabaqRepetitionPreset, Readonly<SabaqRepetitions>>> = {
  looking_then_memory: { listen: 3, looking: 10, cleanInARow: 3 },
  twenty_times: { listen: 3, looking: 20, cleanInARow: 3 },
};

/** The preset these counts match, or null when they are custom. */
export function sabaqRepetitionPresetOf(counts: SabaqRepetitions): SabaqRepetitionPreset | null {
  const presets = Object.keys(SABAQ_REPETITION_PRESETS) as SabaqRepetitionPreset[];
  return (
    presets.find((preset) => {
      const values = SABAQ_REPETITION_PRESETS[preset];
      return values.listen === counts.listen && values.looking === counts.looking && values.cleanInARow === counts.cleanInARow;
    }) ?? null
  );
}

const hifzPlanSchema = z.object({
  method: z.enum(["standard", "ottoman", "review_only"]),
  direction: z.enum(["juz_amma_first", "from_fatiha"]),
  newPerDay: z.number().min(0).max(2),
  sabqiDays: z.number().int().min(1).max(60),
  cycleDays: z.number().int().min(1).max(60),
  dailyBudgetMin: z.number().int().min(5).max(240),
  /** Days of the week (0 is Sunday) that schedule new memorization. Review happens every day. */
  studyDays: z.array(z.number().int().min(0).max(6)).max(7),
  /** Sabqi pages come back every k days: 1 full-time, 2 or 3 part-time (4.3.1). */
  sabqiEvery: z.number().int().min(1).max(3),
  anchor: anchorSchema,
  /** UNIT-02: the recitation unit and whether meanings are reviewed too. */
  unit: z.enum(["page", "half", "ayah"]),
  meanings: z.boolean(),
  /** Manzil target retention, 0.90 to 0.97 (4.1.2). */
  retention: z.number().min(0.9).max(0.97),
  /** PLN-04: new memorization first instead of last. */
  newFirst: z.boolean(),
  /** SBQ-01: repetition counts for the sabaq steps. */
  sabaqRepetitions: sabaqRepetitionsSchema,
});
export type HifzPlan = z.infer<typeof hifzPlanSchema>;

export const DEFAULT_HIFZ_PLAN: HifzPlan = {
  method: "standard",
  direction: "juz_amma_first",
  newPerDay: 0.5,
  sabqiDays: 14,
  cycleDays: 30,
  dailyBudgetMin: 30,
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  sabqiEvery: 1,
  anchor: { kind: "prayer", prayer: "fajr", offsetMin: 20 },
  unit: "page",
  meanings: false,
  retention: 0.95,
  newFirst: false,
  sabaqRepetitions: { ...SABAQ_REPETITION_PRESETS.looking_then_memory },
};

export type PlanPreset = "part_time_beginner" | "part_time_adult" | "full_time" | "maintenance" | "short_surahs";

/** 4.3.2 presets. */
const PLAN_PRESETS: Readonly<Record<PlanPreset, Partial<HifzPlan>>> = {
  part_time_beginner: { method: "standard", newPerDay: 0.25, sabqiEvery: 2, cycleDays: 30, dailyBudgetMin: 20 },
  part_time_adult: { method: "standard", newPerDay: 0.5, sabqiEvery: 1, cycleDays: 30, dailyBudgetMin: 30 },
  full_time: { method: "standard", newPerDay: 1, sabqiEvery: 1, sabqiDays: 14, cycleDays: 14, dailyBudgetMin: 90 },
  maintenance: { method: "review_only", newPerDay: 0, cycleDays: 30, dailyBudgetMin: 60 },
  short_surahs: { method: "standard", unit: "ayah", newPerDay: 0.25, sabqiDays: 7, cycleDays: 14, dailyBudgetMin: 10 },
};

export function applyPreset(plan: HifzPlan, preset: PlanPreset): HifzPlan {
  return { ...plan, ...PLAN_PRESETS[preset] };
}

/** The preset a saved plan was made from, when every field the preset sets still matches; else null. */
export function presetOf(plan: HifzPlan): PlanPreset | null {
  const presets = Object.keys(PLAN_PRESETS) as PlanPreset[];
  return (
    presets.find((preset) =>
      Object.entries(PLAN_PRESETS[preset]).every(([key, value]) => plan[key as keyof HifzPlan] === value),
    ) ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseHifzPlan(value: string | null | undefined): HifzPlan | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value);
    const stored: Record<string, unknown> = raw && typeof raw === "object" ? raw : {};
    // A plan saved before a count existed takes its default; a count out of range rejects the plan like any field.
    const counts = stored.sabaqRepetitions;
    const sabaqRepetitions =
      counts === undefined
        ? DEFAULT_HIFZ_PLAN.sabaqRepetitions
        : isRecord(counts)
          ? { ...DEFAULT_HIFZ_PLAN.sabaqRepetitions, ...counts }
          : counts;
    const parsed = hifzPlanSchema.safeParse({ ...DEFAULT_HIFZ_PLAN, ...stored, sabaqRepetitions });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The saved plan, or null when the user has not set one up. */
export async function readHifzPlan(db: DatabaseExecutor): Promise<HifzPlan | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [HIFZ_PLAN_KEY]);
  return parseHifzPlan(row?.value);
}

/** PLAN-01: a plan change applies from the next session and never deletes review history. */
export async function writeHifzPlan(database: AppDatabase, plan: HifzPlan): Promise<void> {
  await database.withTransactionAsync((db) => putHifzPlan(db, plan));
}

/** writeHifzPlan with the caller's executor, so the plan and its upload commit with the caller's other writes. */
export async function putHifzPlan(db: DatabaseExecutor, plan: HifzPlan): Promise<void> {
  const parsed = hifzPlanSchema.parse(plan);
  await putUserSetting(db, HIFZ_PLAN_KEY, JSON.stringify(parsed));
}

/** New memorization is scheduled on this weekday (0 is Sunday). */
export function isStudyDay(plan: HifzPlan, weekday: number): boolean {
  return plan.method !== "review_only" && plan.newPerDay > 0 && plan.studyDays.includes(weekday);
}
