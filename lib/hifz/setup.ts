import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { readDeckReviewSettings, writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { materializeAllSmartDeckCards, SMART_DECK_IDS, writeAllDecksFilter } from "@/lib/fsrs/smart-decks";
import { declareMemorizedPages } from "@/lib/hifz/pages";
import { writeHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { pagesOfJuz } from "@/lib/hifz/units";

/** Pages whose every ayah belongs to one of the surahs (a page shared with an unchosen surah is left out). */
export async function pagesCoveredBySurahs(db: DatabaseExecutor, surahs: readonly number[]): Promise<number[]> {
  if (surahs.length === 0) return [];
  const chosen = new Set(surahs);
  const rows = await db.getAllAsync<{ v2_page: number; surah: number }>(
    "SELECT DISTINCT v2_page, surah FROM quran_text WHERE v2_page > 0 ORDER BY v2_page",
  );
  const bySurahs = new Map<number, Set<number>>();
  for (const row of rows) {
    const set = bySurahs.get(row.v2_page) ?? new Set<number>();
    set.add(row.surah);
    bySurahs.set(row.v2_page, set);
  }
  return [...bySurahs.entries()].filter(([, set]) => [...set].every((surah) => chosen.has(surah))).map(([page]) => page);
}

/** Surahs with at least one ayah on the pages, for scoping the similar-verse decks. */
export async function surahsOnPages(db: DatabaseExecutor, pages: readonly number[]): Promise<number[]> {
  if (pages.length === 0) return [];
  const placeholders = pages.map(() => "?").join(", ");
  const rows = await db.getAllAsync<{ surah: number }>(
    `SELECT DISTINCT surah FROM quran_text WHERE v2_page IN (${placeholders}) ORDER BY surah`,
    [...pages],
  );
  return rows.map((row) => row.surah);
}

export type HifzSetup = Readonly<{
  plan: HifzPlan;
  memorizedSurahs: readonly number[];
  memorizedJuz: readonly number[];
  now?: Date;
}>;

/**
 * Save a plan and the memorized portion (5.1 steps 2 to 5, UNIT-02). Page and half-page review
 * declares the memorized pages, unverified with first checks spread over the first cycle (ONB-04),
 * and stops the ayah deck adding new cards so the same portion is not reviewed twice. Ayah review
 * keeps the existing ayah decks. The similar-verse, qira'at and asbab decks follow the memorized
 * surahs either way.
 */
export async function applyHifzSetup(db: AppDatabase, setup: HifzSetup): Promise<{ declaredPages: number }> {
  const { plan } = setup;
  await writeHifzPlan(db, plan);
  const pages = new Set<number>(await pagesCoveredBySurahs(db, setup.memorizedSurahs));
  for (const juz of setup.memorizedJuz) for (const page of pagesOfJuz(juz)) pages.add(page);
  const surahs = new Set<number>([...setup.memorizedSurahs, ...(await surahsOnPages(db, [...pages]))]);
  if (surahs.size > 0) await writeAllDecksFilter(db, { type: "surah", surahs: [...surahs].sort((a, b) => a - b) });

  if (plan.unit === "ayah") {
    await materializeAllSmartDeckCards(db);
    return { declaredPages: 0 };
  }
  const retention = await readDeckReviewSettings(db, SMART_DECK_IDS.retention);
  if (retention.newCardsLimit !== 0) {
    await writeDeckReviewSettings(db, SMART_DECK_IDS.retention, { ...retention, newCardsLimit: 0 });
  }
  const declaredPages = await declareMemorizedPages(db, {
    pages: [...pages],
    cycleDays: plan.cycleDays,
    now: setup.now,
  });
  return { declaredPages };
}
