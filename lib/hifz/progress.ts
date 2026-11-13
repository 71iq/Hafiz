import type { DatabaseExecutor } from "@/lib/database/types";
import { addDays, localDateOf } from "@/lib/habit/dates";
import { isMemorized, loadPageCards, toPlanPage, type PageCard } from "@/lib/hifz/pages";
import { readHifzPlan } from "@/lib/hifz/plan";
import { pagesOfJuz } from "@/lib/hifz/units";

export type StrengthBands = Readonly<{ steady: number; fair: number; needsReview: number }>;


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

/** MST-05: 5 memorized pages not reviewed in the last 14 days, picked at random. */
const MONTHLY_CHECK_PAGES = 5;
const MONTHLY_CHECK_UNREVIEWED_DAYS = 14;
const MONTHLY_CHECK_KEY = "device_monthly_check";

export function monthlyCheckCandidates(cards: readonly PageCard[], today: string): PageCard[] {
  const cutoff = addDays(today, -MONTHLY_CHECK_UNREVIEWED_DAYS);
  return cards.filter((card) => {
    if (!isMemorized(card)) return false;
    const last = card.history.grades[card.history.grades.length - 1];
    return last !== undefined && last.date < cutoff;
  });
}

export function pickMonthlyCheck(cards: readonly PageCard[], random: () => number = Math.random): PageCard[] {
  const pool = [...cards];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, MONTHLY_CHECK_PAGES);
}

/** The check is offered once per calendar month, when there are enough pages to check. */
export function monthlyCheckDue(lastMonth: string | null, today: string, candidates: number): boolean {
  return candidates >= MONTHLY_CHECK_PAGES && lastMonth !== today.slice(0, 7);
}

export async function loadMonthlyCheckDue(db: DatabaseExecutor, now = new Date()): Promise<boolean> {
  const plan = await readHifzPlan(db);
  if (!plan) return false;
  const today = localDateOf(now);
  const [cards, last] = await Promise.all([
    loadPageCards(db, { today, plan }),
    db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [MONTHLY_CHECK_KEY]),
  ]);
  return monthlyCheckDue(last?.value ?? null, today, monthlyCheckCandidates(cards, today).length);
}

/** Record this month's check as done or declined, so it is offered again next month. */
export async function markMonthlyCheck(db: DatabaseExecutor, now = new Date()): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, ?, ?, NULL)", [
    MONTHLY_CHECK_KEY,
    localDateOf(now).slice(0, 7),
    now.toISOString(),
  ]);
}
