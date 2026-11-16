import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { materializeAllSmartDeckCards, writeAllDecksFilter } from "@/lib/fsrs/smart-decks";
import { declareMemorizedPages } from "@/lib/hifz/pages";
import { putHifzPlan, readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { pagesOfJuz } from "@/lib/hifz/units";
import { applyUnitSwitch } from "@/lib/hifz/unit-applied";

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
  const declaredPages = await declareMemorizedPages(db, { pages: [...pages], cycleDays: plan.cycleDays, now });
  return { declaredPages, migratedPages };
}
