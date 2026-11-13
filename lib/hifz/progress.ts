import type { DatabaseExecutor } from "@/lib/database/types";
import { localDateOf } from "@/lib/habit/dates";
import { loadPageCards, toPlanPage, type PageCard } from "@/lib/hifz/pages";
import { readHifzPlan } from "@/lib/hifz/plan";
import { pagesOfJuz } from "@/lib/hifz/units";

export type StrengthBands = Readonly<{ steady: number; fair: number; needsReview: number }>;

/**
 * MST-01: a page counts as memorized when it is sabqi or manzil and its last graded review was Good
 * or better. Declared pages count once their first check passes.
 */
export function isMemorized(card: PageCard): boolean {
  if (card.tier === "sabaq" || card.tier === "manzil.unverified") return false;
  const last = card.history.grades[card.history.grades.length - 1];
  return last !== undefined && last.rating >= 3;
}

/** MST-02: steady at recall 0.90 or more, fair from 0.75, needs review below. Accurate, never inflated (ETH-09). */
export function strengthBands(recalls: readonly number[]): StrengthBands {
  let steady = 0;
  let fair = 0;
  let needsReview = 0;
  for (const recall of recalls) {
    if (recall >= 0.9) steady += 1;
    else if (recall >= 0.75) fair += 1;
    else needsReview += 1;
  }
  return { steady, fair, needsReview };
}

/** MST-03: a juz is complete when every one of its pages is memorized. */
export function completedJuz(memorized: ReadonlySet<number>): number[] {
  const done: number[] = [];
  for (let juz = 1; juz <= 30; juz += 1) {
    if (pagesOfJuz(juz).every((page) => memorized.has(page))) done.push(juz);
  }
  return done;
}

export type HifzProgress = Readonly<{ memorizedPages: number; bands: StrengthBands; juzComplete: readonly number[] }>;

export async function loadHifzProgress(db: DatabaseExecutor, now = new Date()): Promise<HifzProgress | null> {
  const plan = await readHifzPlan(db);
  if (!plan) return null;
  const today = localDateOf(now);
  const cards = await loadPageCards(db, { today, plan });
  const memorized = cards.filter(isMemorized);
  const recalls = memorized.map((card) => toPlanPage(card, today, now).retrievability ?? 0);
  return {
    memorizedPages: memorized.length,
    bands: strengthBands(recalls),
    juzComplete: completedJuz(new Set(memorized.map((card) => card.page))),
  };
}
