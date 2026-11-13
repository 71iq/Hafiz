import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { insertNewStudyCard } from "@/lib/fsrs/queries";
import { fsrs } from "ts-fsrs";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { addDays, atLocalTime, localDateOf, weekdayOf, type LocalDate } from "@/lib/habit/dates";
import { buildDailyPlan, type DailyPlan, type PlanPage } from "@/lib/hifz/daily-plan";
import { isStudyDay, readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { tierFor, type GradeEvent, type PageHistory, type Tier } from "@/lib/hifz/tiers";
import { HIFZ_PAGES_DECK_ID, HIFZ_SABAQ_DECK_ID, isValidPage, pageCardId, parsePageUnit } from "@/lib/hifz/units";

/** PLN-05 seeds: 30 minutes per new page and 3 per review page, then learned per user. */
const SEED_MINUTES_PER_NEW_PAGE = 30;
const SEED_MINUTES_PER_REVIEW_PAGE = 3;
const T_NEW_KEY = "hifz_t_new";
export const T_REV_KEY = "hifz_t_rev";

const retrievabilityScheduler = fsrs();

export type PageCard = Readonly<{
  row: StudyCardRow;
  page: number;
  history: PageHistory;
  tier: Tier;
}>;

async function readPageRows(db: DatabaseExecutor): Promise<StudyCardRow[]> {
  return db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards
      WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL AND suspended_at IS NULL
      ORDER BY id`,
    [HIFZ_PAGES_DECK_ID],
  );
}

/** Pages that were memorized through sabaq in the app; every other page card was declared. */
async function readSabaqPages(db: DatabaseExecutor): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM study_cards WHERE deck_id = ? AND id LIKE 'chunk:%' AND deleted_at IS NULL",
    [HIFZ_SABAQ_DECK_ID],
  );
  const pages = new Set<number>();
  for (const row of rows) {
    const unit = parsePageUnit(row.id);
    if (unit) pages.add(unit.page);
  }
  return pages;
}

async function readPageGrades(db: DatabaseExecutor): Promise<Map<string, GradeEvent[]>> {
  const rows = await db.getAllAsync<{ card_id: string; rating: number; local_date: LocalDate | null; reviewed_at: string }>(
    "SELECT card_id, rating, local_date, reviewed_at FROM study_log WHERE card_id LIKE 'page:%' ORDER BY reviewed_at",
  );
  const grades = new Map<string, GradeEvent[]>();
  for (const row of rows) {
    if (row.rating < 1 || row.rating > 4) continue;
    const list = grades.get(row.card_id) ?? [];
    list.push({ date: row.local_date ?? localDateOf(new Date(row.reviewed_at)), rating: row.rating as GradeEvent["rating"] });
    grades.set(row.card_id, list);
  }
  return grades;
}

/** Every page card with its derived tier (TIER-01). The tier is recomputed from history, never read from the cache. */
export async function loadPageCards(db: DatabaseExecutor, { today, plan }: { today: LocalDate; plan: HifzPlan }): Promise<PageCard[]> {
  const [rows, sabaqPages, grades] = await Promise.all([readPageRows(db), readSabaqPages(db), readPageGrades(db)]);
  const cards: PageCard[] = [];
  for (const row of rows) {
    const unit = parsePageUnit(row.id);
    if (!unit || unit.kind !== "page") continue;
    const declared = !sabaqPages.has(unit.page);
    const history: PageHistory = {
      declared,
      firstFluentDate: declared ? null : localDateOf(new Date(row.created_at)),
      grades: grades.get(row.id) ?? [],
    };
    cards.push({ row, page: unit.page, history, tier: tierFor(history, today, plan) });
  }
  return cards;
}

function retrievability(row: StudyCardRow, now: Date): number | null {
  if (!row.last_review) return null;
  try {
    return retrievabilityScheduler.get_retrievability(
      {
        due: new Date(row.due),
        stability: row.stability,
        difficulty: row.difficulty,
        elapsed_days: row.elapsed_days,
        scheduled_days: row.scheduled_days,
        learning_steps: row.learning_steps,
        reps: row.reps,
        lapses: row.lapses,
        state: row.state,
        last_review: new Date(row.last_review),
      },
      now,
      false,
    );
  } catch {
    return null;
  }
}

/**
 * MST-01: a page counts as memorized when it is sabqi or manzil and its last graded review was Good
 * or better. Declared pages count once their first check passes. Home, Progress and the board use
 * this one definition.
 */
export function isMemorized(card: PageCard): boolean {
  if (card.tier === "sabaq" || card.tier === "manzil.unverified") return false;
  const last = card.history.grades[card.history.grades.length - 1];
  return last !== undefined && last.rating >= 3;
}

export function toPlanPage(card: PageCard, today: LocalDate, now: Date): PlanPage {
  const before = card.history.grades.filter((grade) => grade.date < today);
  return {
    cardId: card.row.id,
    page: card.page,
    tier: card.tier,
    lastReviewDate: before.length > 0 ? before[before.length - 1].date : null,
    reviewedToday: card.history.grades.some((grade) => grade.date === today),
    dueDate: localDateOf(new Date(card.row.due)),
    retrievability: retrievability(card.row, now),
  };
}

async function readMinutesPerPage(db: DatabaseExecutor): Promise<{ newPage: number; reviewPage: number }> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM user_settings WHERE key IN (?, ?)",
    [T_NEW_KEY, T_REV_KEY],
  );
  const values = new Map(rows.map((row) => [row.key, Number(row.value)]));
  const valid = (value: number | undefined, fallback: number) => (value && Number.isFinite(value) && value > 0 ? value : fallback);
  return {
    newPage: valid(values.get(T_NEW_KEY), SEED_MINUTES_PER_NEW_PAGE),
    reviewPage: valid(values.get(T_REV_KEY), SEED_MINUTES_PER_REVIEW_PAGE),
  };
}

const TODAY_PLAN_KEY = "device_hifz_today_plan";

type TodaySnapshot = { date: LocalDate; ids: string[]; newLines: number };

function parseSnapshot(value: string | undefined): TodaySnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed?.date !== "string" || !Array.isArray(parsed.ids) || typeof parsed.newLines !== "number") return null;
    return { date: parsed.date, ids: parsed.ids.filter((id: unknown): id is string => typeof id === "string"), newLines: parsed.newLines };
  } catch {
    return null;
  }
}

export type TodayWird = Readonly<{
  plan: HifzPlan;
  daily: DailyPlan;
  /** Pages still to review today, in order. */
  todo: readonly PlanPage[];
  /** Pages reviewed today. */
  done: readonly PlanPage[];
  newLines: number;
  remainingMinutes: number;
  minutesPerReviewPage: number;
  minutesPerNewPage: number;
  memorizedPages: number;
  /** A sabaq chunk was graded today, so today's new memorization is done. */
  sabaqDoneToday: boolean;
}>;

/**
 * Today's wird (4.3). The page list is fixed the first time it is built each day, on this device,
 * so it does not reshuffle as pages are reviewed; a plan change applies from the next day (PLAN-01).
 * Returns null when no plan is set up.
 */
export async function loadTodayWird(database: AppDatabase, now = new Date()): Promise<TodayWird | null> {
  const plan = await readHifzPlan(database);
  if (!plan) return null;
  const today = localDateOf(now);
  const [cards, minutes, snapshotRow, sabaqToday] = await Promise.all([
    loadPageCards(database, { today, plan }),
    readMinutesPerPage(database),
    database.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [TODAY_PLAN_KEY]),
    database.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM study_log WHERE card_id LIKE 'chunk:%' AND local_date = ?",
      [today],
    ),
  ]);
  const pages = cards.map((card) => toPlanPage(card, today, now));
  const daily = buildDailyPlan({
    pages,
    plan,
    today,
    studyDay: isStudyDay(plan, weekdayOf(today)),
    minutesPerNewPage: minutes.newPage,
    minutesPerReviewPage: minutes.reviewPage,
  });

  let snapshot = parseSnapshot(snapshotRow?.value);
  if (snapshot?.date !== today) {
    snapshot = { date: today, ids: daily.review.map((page) => page.cardId), newLines: daily.newLines };
    await database.runAsync(
      "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, ?, ?, NULL)",
      [TODAY_PLAN_KEY, JSON.stringify(snapshot), now.toISOString()],
    );
  }
  const byId = new Map(pages.map((page) => [page.cardId, page]));
  const todo = snapshot.ids.flatMap((id) => {
    const page = byId.get(id);
    return page && !page.reviewedToday ? [page] : [];
  });
  const done = pages.filter((page) => page.reviewedToday);
  return {
    plan,
    daily,
    todo,
    done,
    newLines: snapshot.newLines,
    remainingMinutes: todo.length * minutes.reviewPage,
    minutesPerReviewPage: minutes.reviewPage,
    minutesPerNewPage: minutes.newPage,
    memorizedPages: cards.filter(isMemorized).length,
    sabaqDoneToday: (sabaqToday?.count ?? 0) > 0,
  };
}

/**
 * ONB-04, SCH-04: declare pages already memorized. Each becomes a manzil page, unverified until its
 * first graded review, with first checks spread evenly over the first cycle (oldest declared first),
 * so nothing has to be tested all at once on day 1. Pages that already have a card are left alone.
 */
export async function declareMemorizedPages(
  database: AppDatabase,
  { pages, cycleDays, now = new Date() }: { pages: readonly number[]; cycleDays: number; now?: Date },
): Promise<number> {
  const unique = [...new Set(pages)].filter(isValidPage).sort((a, b) => a - b);
  if (unique.length === 0) return 0;
  const today = localDateOf(now);
  const at = now.toISOString();
  let created = 0;
  await database.withTransactionAsync(async (db) => {
    for (const [index, page] of unique.entries()) {
      const offset = Math.floor((index * cycleDays) / unique.length);
      const due = atLocalTime(addDays(today, offset), 0);
      if (await insertNewStudyCard(db, { id: pageCardId(page), deckId: HIFZ_PAGES_DECK_ID, due, tier: "manzil.unverified", now: at })) {
        created += 1;
      }
    }
  });
  return created;
}

/** The pages that have a page card, for the memorized-portion picker. */
export async function readMemorizedPageNumbers(db: DatabaseExecutor): Promise<Set<number>> {
  const rows = await readPageRows(db);
  return new Set(rows.flatMap((row) => {
    const unit = parsePageUnit(row.id);
    return unit?.kind === "page" ? [unit.page] : [];
  }));
}
