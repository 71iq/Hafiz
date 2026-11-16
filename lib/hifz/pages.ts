import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { insertNewStudyCard } from "@/lib/fsrs/queries";
import { REVIEW_LEARN_AHEAD_MS } from "@/lib/fsrs/review-transition";
import { State } from "@/lib/fsrs/scheduler";
import { fsrs } from "ts-fsrs";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { addDays, atLocalTime, localDateOf, weekdayOf, type LocalDate } from "@/lib/habit/dates";
import { buildDailyPlan, type DailyPlan, type PlanPage } from "@/lib/hifz/daily-plan";
import { isStudyDay, readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { tierFor, type GradeEvent, type PageHistory, type Tier } from "@/lib/hifz/tiers";
import { compareSyncTimestamps } from "@/lib/database/sync-timestamps";
import { chunkCardPrefix, HIFZ_PAGES_DECK_ID, isValidPage, pageCardId, parsePageUnit } from "@/lib/hifz/units";

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

type SabaqPasses = ReadonlyMap<number, ReadonlyMap<number, LocalDate>>;

async function readSabaqPasses(db: DatabaseExecutor, onlyPages?: readonly number[]): Promise<SabaqPasses> {
  const ranges = onlyPages?.map((page) => {
    const prefix = chunkCardPrefix(page);
    return [prefix, `${prefix.slice(0, -1)};`] as const;
  });
  if (ranges?.length === 0) return new Map();
  const filter = ranges ? `(${ranges.map(() => "(card_id >= ? AND card_id < ?)").join(" OR ")})` : "card_id LIKE 'chunk:%'";
  const rows = await db.getAllAsync<{ card_id: string; reviewed_at: string; local_date: LocalDate | null }>(
    `SELECT card_id, reviewed_at, local_date FROM study_log WHERE ${filter} AND rating >= 3`,
    ranges?.flatMap(([from, to]) => [from, to]) ?? [],
  );
  const passes = new Map<number, Map<number, LocalDate>>();
  for (const row of rows) {
    const unit = parsePageUnit(row.card_id);
    const instant = Date.parse(row.reviewed_at);
    if (unit?.kind !== "chunk" || !Number.isFinite(instant)) continue;
    const byInstant = passes.get(unit.page) ?? new Map<number, LocalDate>();
    byInstant.set(instant, row.local_date ?? localDateOf(new Date(instant)));
    passes.set(unit.page, byInstant);
  }
  return passes;
}

async function readPageGrades(db: DatabaseExecutor): Promise<Map<string, GradeEvent[]>> {
  return gradesByCard(
    await db.getAllAsync<{ card_id: string; rating: number; local_date: LocalDate | null; reviewed_at: string }>(
      "SELECT card_id, rating, local_date, reviewed_at FROM study_log WHERE card_id LIKE 'page:%'",
    ),
  );
}

function gradesByCard(
  rows: readonly { card_id: string; rating: number; local_date: LocalDate | null; reviewed_at: string }[],
): Map<string, GradeEvent[]> {
  const ordered = rows
    .map((row) => ({ row, at: Date.parse(row.reviewed_at) }))
    .sort((a, b) => a.at - b.at || compareSyncTimestamps(a.row.reviewed_at, b.row.reviewed_at));
  const grades = new Map<string, GradeEvent[]>();
  for (const { row } of ordered) {
    if (row.rating < 1 || row.rating > 4) continue;
    const list = grades.get(row.card_id) ?? [];
    list.push({ date: row.local_date ?? localDateOf(new Date(row.reviewed_at)), rating: row.rating as GradeEvent["rating"] });
    grades.set(row.card_id, list);
  }
  return grades;
}

export async function derivePageTiers(
  db: DatabaseExecutor,
  cardIds: readonly string[],
  { today, plan }: { today: LocalDate; plan: Pick<HifzPlan, "sabqiDays"> },
): Promise<Map<string, Tier>> {
  const tiers = new Map<string, Tier>();
  if (cardIds.length === 0) return tiers;
  const placeholders = cardIds.map(() => "?").join(", ");
  const [rows, sabaq, logs] = await Promise.all([
    db.getAllAsync<StudyCardRow>(`SELECT * FROM study_cards WHERE id IN (${placeholders}) AND deleted_at IS NULL`, [...cardIds]),
    readSabaqPasses(db, pagesOf(cardIds)),
    db.getAllAsync<{ card_id: string; rating: number; local_date: LocalDate | null; reviewed_at: string }>(
      `SELECT card_id, rating, local_date, reviewed_at FROM study_log WHERE card_id IN (${placeholders})`,
      [...cardIds],
    ),
  ]);
  const grades = gradesByCard(logs);
  for (const row of rows) {
    const unit = parsePageUnit(row.id);
    if (unit?.kind !== "page") continue;
    tiers.set(row.id, tierFor(pageHistory(row, unit.page, sabaq, grades), today, plan));
  }
  return tiers;
}

function pagesOf(cardIds: readonly string[]): number[] {
  const pages = new Set<number>();
  for (const id of cardIds) {
    const unit = parsePageUnit(id);
    if (unit?.kind === "page") pages.add(unit.page);
  }
  return [...pages];
}

function pageHistory(row: StudyCardRow, page: number, sabaq: SabaqPasses, grades: Map<string, GradeEvent[]>): PageHistory {
  const created = Date.parse(row.created_at);
  const firstFluentDate = Number.isFinite(created) ? (sabaq.get(page)?.get(created) ?? null) : null;
  const own = grades.get(row.id) ?? [];
  const fromAyahReviews = firstFluentDate === null && own.length === 0 && row.last_review !== null;
  return { declared: firstFluentDate === null && !fromAyahReviews, firstFluentDate, fromAyahReviews, grades: own };
}

export async function loadPageCard(
  db: DatabaseExecutor,
  cardId: string,
  { today, plan }: { today: LocalDate; plan: Pick<HifzPlan, "sabqiDays"> },
): Promise<PageCard | null> {
  const unit = parsePageUnit(cardId);
  if (unit?.kind !== "page") return null;
  const [row, sabaq, logs] = await Promise.all([
    db.getFirstAsync<StudyCardRow>("SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NULL", [cardId]),
    readSabaqPasses(db, [unit.page]),
    db.getAllAsync<{ card_id: string; rating: number; local_date: LocalDate | null; reviewed_at: string }>(
      "SELECT card_id, rating, local_date, reviewed_at FROM study_log WHERE card_id = ?",
      [cardId],
    ),
  ]);
  if (!row) return null;
  const history = pageHistory(row, unit.page, sabaq, gradesByCard(logs));
  return { row, page: unit.page, history, tier: tierFor(history, today, plan) };
}

export async function loadPageCards(db: DatabaseExecutor, { today, plan }: { today: LocalDate; plan: HifzPlan }): Promise<PageCard[]> {
  const [rows, sabaq, grades] = await Promise.all([readPageRows(db), readSabaqPasses(db), readPageGrades(db)]);
  const cards: PageCard[] = [];
  for (const row of rows) {
    const unit = parsePageUnit(row.id);
    if (!unit || unit.kind !== "page") continue;
    const history = pageHistory(row, unit.page, sabaq, grades);
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

export function isMemorized(card: PageCard): boolean {
  if (card.tier === "sabaq" || card.tier === "manzil.unverified") return false;
  const last = card.history.grades[card.history.grades.length - 1];
  if (last === undefined) return card.history.fromAyahReviews === true || card.history.firstFluentDate !== null;
  return last.rating >= 3;
}

export function toPlanPage(card: PageCard, today: LocalDate, now: Date): PlanPage {
  const before = card.history.grades.filter((grade) => grade.date < today);
  const ayahReviewed =
    before.length === 0 && card.history.fromAyahReviews && card.row.last_review ? localDateOf(new Date(card.row.last_review)) : null;
  return {
    cardId: card.row.id,
    page: card.page,
    tier: card.tier,
    lastReviewDate: before.length > 0 ? before[before.length - 1].date : ayahReviewed && ayahReviewed <= today ? ayahReviewed : null,
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

function learningStepDue(row: StudyCardRow, now: Date): boolean {
  return (
    (row.state === State.Learning || row.state === State.Relearning) &&
    Date.parse(row.due) <= now.getTime() + REVIEW_LEARN_AHEAD_MS
  );
}

const TODAY_PLAN_KEY = "device_hifz_today_plan";

type TodaySnapshot = { date: LocalDate; ids: string[]; newLines: number; unit: HifzPlan["unit"] | null };

function parseSnapshot(value: string | undefined): TodaySnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed?.date !== "string" || !Array.isArray(parsed.ids) || typeof parsed.newLines !== "number") return null;
    return {
      date: parsed.date,
      ids: parsed.ids.filter((id: unknown): id is string => typeof id === "string"),
      newLines: parsed.newLines,
      unit: typeof parsed.unit === "string" ? parsed.unit : null,
    };
  } catch {
    return null;
  }
}

export function passedLineCount(chunkIds: readonly string[]): number {
  const lines = new Set<string>();
  for (const id of chunkIds) {
    const unit = parsePageUnit(id);
    if (unit?.kind !== "chunk") continue;
    for (let line = unit.fromLine; line <= unit.toLine; line += 1) lines.add(`${unit.page}:${line}`);
  }
  return lines.size;
}

export type TodayWird = Readonly<{
  plan: HifzPlan;
  daily: DailyPlan;
  todo: readonly PlanPage[];
  done: readonly PlanPage[];
  total: number;
  nextStepAt: Date | null;
  newLines: number;
  remainingMinutes: number;
  minutesPerReviewPage: number;
  minutesPerNewPage: number;
  memorizedPages: number;
  sabaqLinesToday: number;
  cards: readonly PageCard[];
  sabaqDoneToday: boolean;
}>;

export function newMemorizationOpen(wird: Pick<TodayWird, "newLines" | "daily">): boolean {
  return wird.newLines > 0 && !wird.daily.backlog;
}

export function reviewLeftToday(
  wird: Pick<TodayWird, "todo"> & { plan: Pick<HifzPlan, "unit"> },
  { remediationDue, ayahReviewsDue }: { remediationDue: number; ayahReviewsDue: number },
): boolean {
  return wird.todo.length + remediationDue + (wird.plan.unit === "ayah" ? ayahReviewsDue : 0) > 0;
}

export async function loadTodayWird(database: AppDatabase, now = new Date()): Promise<TodayWird | null> {
  const plan = await readHifzPlan(database);
  if (!plan) return null;
  const today = localDateOf(now);
  const [cards, minutes, snapshotRow, sabaqToday] = await Promise.all([
    loadPageCards(database, { today, plan }),
    readMinutesPerPage(database),
    database.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [TODAY_PLAN_KEY]),
    database.getAllAsync<{ card_id: string }>(
      "SELECT DISTINCT card_id FROM study_log WHERE card_id LIKE 'chunk:%' AND local_date = ? AND rating >= 3",
      [today],
    ),
  ]);
  const pages = plan.unit === "ayah" ? [] : cards.map((card) => toPlanPage(card, today, now));
  const daily = buildDailyPlan({
    pages,
    plan,
    today,
    studyDay: isStudyDay(plan, weekdayOf(today)),
    minutesPerNewPage: minutes.newPage,
    minutesPerReviewPage: minutes.reviewPage,
  });

  let snapshot = parseSnapshot(snapshotRow?.value);
  if (snapshot?.date !== today || snapshot.unit !== plan.unit) {
    snapshot = { date: today, ids: daily.review.map((page) => page.cardId), newLines: daily.newLines, unit: plan.unit };
    await database.runAsync(
      "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, ?, ?, NULL)",
      [TODAY_PLAN_KEY, JSON.stringify(snapshot), now.toISOString()],
    );
  }
  const linesToday = passedLineCount(sabaqToday.map((row) => row.card_id));
  const byId = new Map(pages.map((page) => [page.cardId, page]));
  const planned = snapshot.ids.flatMap((id) => {
    const page = byId.get(id);
    return page && !page.reviewedToday ? [page] : [];
  });
  const steps = cards
    .filter((card) => learningStepDue(card.row, now))
    .sort((a, b) => Date.parse(a.row.due) - Date.parse(b.row.due) || a.page - b.page)
    .flatMap((card) => {
      const page = byId.get(card.row.id);
      return page?.reviewedToday ? [page] : [];
    });
  const todo = [...planned, ...steps];
  const listed = new Set(snapshot.ids);
  const done = pages.filter((page) => page.reviewedToday && listed.has(page.cardId));
  const reviewedToday = new Set(pages.filter((page) => page.reviewedToday).map((page) => page.cardId));
  const nextStepAt =
    cards
      .filter(
        (card) =>
          reviewedToday.has(card.row.id) &&
          (card.row.state === State.Learning || card.row.state === State.Relearning) &&
          !learningStepDue(card.row, now) &&
          localDateOf(new Date(card.row.due)) === today,
      )
      .map((card) => new Date(card.row.due))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return {
    plan,
    daily,
    todo,
    done,
    total: done.length + planned.length,
    nextStepAt,
    newLines: snapshot.newLines,
    remainingMinutes: todo.length * minutes.reviewPage,
    minutesPerReviewPage: minutes.reviewPage,
    minutesPerNewPage: minutes.newPage,
    memorizedPages: cards.filter(isMemorized).length,
    cards,
    sabaqLinesToday: linesToday,
    sabaqDoneToday: snapshot.newLines > 0 ? linesToday >= snapshot.newLines : linesToday > 0,
  };
}

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
    if (created > 0) await ensureManzilCycleStart(db, today);
  });
  return created;
}

export const MANZIL_CYCLE_START_KEY = "hifz_manzil_cycle_start";

export async function ensureManzilCycleStart(db: DatabaseExecutor, fallback: LocalDate): Promise<LocalDate> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ? AND deleted_at IS NULL",
    [MANZIL_CYCLE_START_KEY],
  );
  if (row?.value) return row.value;
  await putUserSetting(db, MANZIL_CYCLE_START_KEY, fallback);
  return fallback;
}

export async function readMemorizedPageNumbers(db: DatabaseExecutor): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ id: string; suspended_at: string | null }>(
    `SELECT id, suspended_at FROM study_cards
      WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL`,
    [HIFZ_PAGES_DECK_ID],
  );
  return new Set(rows.flatMap((row) => {
    if (row.suspended_at && Date.parse(row.suspended_at) !== 0) return [];
    const unit = parsePageUnit(row.id);
    return unit?.kind === "page" ? [unit.page] : [];
  }));
}
