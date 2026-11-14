import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { materializeAllSmartDeckCards, writeAllDecksFilter } from "@/lib/fsrs/smart-decks";
import { declareMemorizedPages } from "@/lib/hifz/pages";
import { putHifzPlan, readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { pagesOfJuz } from "@/lib/hifz/units";
import { applyUnitSwitch } from "@/lib/hifz/unit-applied";

/** Pages whose every ayah belongs to one of the surahs (a page shared with an unchosen surah is left out). */
async function pagesCoveredBySurahs(db: DatabaseExecutor, surahs: readonly number[]): Promise<number[]> {
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
async function surahsOnPages(db: DatabaseExecutor, pages: readonly number[]): Promise<number[]> {
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
 * Save a plan and the memorized portion (5.1 steps 2 to 5, UNIT-02). The plan and the switch of
 * recitation unit (7.6, lib/hifz/unit-switch) commit together. Page and half-page review first makes
 * page cards from fully reviewed ayah cards and stops the ayah deck adding new cards, then declares
 * the other memorized pages, unverified with first checks spread over the first cycle (ONB-04). Ayah
 * review restores the ayah cards page review set aside and keeps the existing ayah decks. The
 * similar-verse, qira'at and asbab decks follow the memorized surahs either way.
 */
export async function applyHifzSetup(
  db: AppDatabase,
  setup: HifzSetup,
): Promise<{ declaredPages: number; migratedPages: number }> {
  const { plan } = setup;
  const now = setup.now ?? new Date();
  let migratedPages = 0;
  await db.withTransactionAsync(async (tx) => {
    const previousPlanUnit = (await readHifzPlan(tx))?.unit ?? null;
    await putHifzPlan(tx, plan);
    // Only a change between page and ayah review switches the cards (lib/hifz/unit-applied).
    migratedPages = await applyUnitSwitch(tx, { unit: plan.unit, previousPlanUnit, now });
  });
  const pages = new Set<number>(await pagesCoveredBySurahs(db, setup.memorizedSurahs));
  for (const juz of setup.memorizedJuz) for (const page of pagesOfJuz(juz)) pages.add(page);
  const surahs = new Set<number>([...setup.memorizedSurahs, ...(await surahsOnPages(db, [...pages]))]);
  if (surahs.size > 0) await writeAllDecksFilter(db, { type: "surah", surahs: [...surahs].sort((a, b) => a - b) });

  if (plan.unit === "ayah") {
    await materializeAllSmartDeckCards(db);
    return { declaredPages: 0, migratedPages: 0 };
  }
  // Pages that now have a card, including those just made from ayah cards, are left alone.
  const declaredPages = await declareMemorizedPages(db, { pages: [...pages], cycleDays: plan.cycleDays, now });
  return { declaredPages, migratedPages };
}
