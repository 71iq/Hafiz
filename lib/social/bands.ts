import type { HifzPlan } from "@/lib/hifz/plan";

export const LEVEL_BANDS = ["starting", "juz_amma", "juz_4_15", "juz_16_29", "hafiz"] as const;
export type LevelBand = (typeof LEVEL_BANDS)[number];

const PACE_BANDS = ["maintenance", "light", "half_page", "page_plus"] as const;
export type PaceBand = (typeof PACE_BANDS)[number];

const MUSHAF_PAGES = 604;
const PAGES_PER_JUZ = 20;

const AYAHS_PER_PAGE_ESTIMATE = 10.3;
export function approximatePagesFromAyahs(memorizedAyahs: number): number {
  if (!Number.isFinite(memorizedAyahs) || memorizedAyahs <= 0) return 0;
  return Math.min(MUSHAF_PAGES, memorizedAyahs / AYAHS_PER_PAGE_ESTIMATE);
}

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

export function paceBand(newPerDayPages: number): PaceBand {
  if (!Number.isFinite(newPerDayPages) || newPerDayPages <= 0) return "maintenance";
  if (newPerDayPages <= 1 / 3) return "light";
  if (newPerDayPages < 1) return "half_page";
  return "page_plus";
}

export function offsetBand(utcOffsetMinutes: number): number {
  return Math.round(utcOffsetMinutes / 120) + 0;
}

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

export function newPagesPerDay(plan: HifzPlan | null): number {
  if (!plan || plan.method === "review_only") return 0;
  return plan.newPerDay;
}
