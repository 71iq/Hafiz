import type { HifzPlan } from "@/lib/hifz/plan";

/**
 * Matching bands for halaqa and board placement (spec 5.7.3, 8.13). The client reports its bands and
 * UTC offset; the server picks the group (MAT-03). Keep these rules in step with private.offset_band
 * and the band checks in supabase/migrations/20261113120000_learning_consistency.sql.
 */
export const LEVEL_BANDS = ["starting", "juz_amma", "juz_4_15", "juz_16_29", "hafiz"] as const;
export type LevelBand = (typeof LEVEL_BANDS)[number];

const PACE_BANDS = ["maintenance", "light", "half_page", "page_plus"] as const;
export type PaceBand = (typeof PACE_BANDS)[number];

/** Madani mushaf: 604 pages, about 20 pages per juz. */
const MUSHAF_PAGES = 604;
const PAGES_PER_JUZ = 20;

/**
 * Pages from memorized ayah cards, for ayah learners, who have no page cards (UNIT-02). 6,236 ayat
 * over 604 pages is about 10.3 ayat a page. Every caller goes through this one function so the
 * approximation has a single place to change.
 */
const AYAHS_PER_PAGE_ESTIMATE = 10.3;
export function approximatePagesFromAyahs(memorizedAyahs: number): number {
  if (!Number.isFinite(memorizedAyahs) || memorizedAyahs <= 0) return 0;
  return Math.min(MUSHAF_PAGES, memorizedAyahs / AYAHS_PER_PAGE_ESTIMATE);
}

/**
 * Memorized pages for the level band. Page learners count memorized page cards (MST-01, the same
 * definition Home and Progress use). Ayah cards are converted with the estimate above. Someone with
 * both counts whichever is larger, since the two may cover the same pages.
 */
export function memorizedPagesFromCards(input: { memorizedPageCards: number; memorizedAyahCards: number }): number {
  const pages = Number.isFinite(input.memorizedPageCards) ? Math.max(0, input.memorizedPageCards) : 0;
  return Math.min(MUSHAF_PAGES, Math.max(pages, approximatePagesFromAyahs(input.memorizedAyahCards)));
}

export function levelBand(memorizedPages: number): LevelBand {
  const pages = Number.isFinite(memorizedPages) ? Math.max(0, memorizedPages) : 0;
  const juz = pages / PAGES_PER_JUZ;
  if (juz < 1) return "starting";
  if (juz <= 3) return "juz_amma";
  if (juz <= 15) return "juz_4_15";
  if (pages < MUSHAF_PAGES) return "juz_16_29";
  return "hafiz";
}

/** New pages a day from the hifz plan. No plan, or no new memorization, is maintenance. */
export function paceBand(newPerDayPages: number): PaceBand {
  if (!Number.isFinite(newPerDayPages) || newPerDayPages <= 0) return "maintenance";
  if (newPerDayPages <= 1 / 3) return "light";
  if (newPerDayPages < 1) return "half_page";
  return "page_plus";
}

/** Two-hour offset buckets. Halves round up, as Math.round does; `+ 0` turns -0 into 0. */
export function offsetBand(utcOffsetMinutes: number): number {
  return Math.round(utcOffsetMinutes / 120) + 0;
}

/** Minutes east of UTC for this device at a given instant, within the server's -12 h to +14 h range. */
export function deviceUtcOffsetMinutes(at: Date = new Date()): number {
  const minutes = -at.getTimezoneOffset() + 0;
  return Math.max(-720, Math.min(840, minutes));
}

export type SocialBands = Readonly<{
  levelBand: LevelBand;
  paceBand: PaceBand;
  utcOffsetMinutes: number;
}>;

export function socialBands(input: {
  memorizedPages: number;
  newPerDayPages: number;
  utcOffsetMinutes: number;
}): SocialBands {
  return {
    levelBand: levelBand(input.memorizedPages),
    paceBand: paceBand(input.newPerDayPages),
    utcOffsetMinutes: input.utcOffsetMinutes,
  };
}

/**
 * New pages a day from a hifz plan parsed by lib/hifz/plan.ts. No plan, or a review-only plan, adds
 * no new memorization, which is maintenance pace.
 */
export function newPagesPerDay(plan: HifzPlan | null): number {
  if (!plan || plan.method === "review_only") return 0;
  return plan.newPerDay;
}
