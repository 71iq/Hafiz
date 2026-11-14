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

/** Passing chunk grades by page, each page's keyed by the grade's instant, with its stored local date. */
type SabaqPasses = ReadonlyMap<number, ReadonlyMap<number, LocalDate>>;

/**
 * The passing chunk grades of the given pages, or of every page. A page was memorized through sabaq
 * in the app only when one of these grades created its page card: the chunk that completed the page
 * passed, and the page card was created in that grade's transaction with the same instant (SBQ-02).
 * Every other page card was declared, in setup or My memorization, even when some of its lines have
 * chunk cards: a failed chunk, or a passing chunk that did not complete the page, is no fluent check
 * of the page. The grade's stored local date is the page's fluent date, so later travel does not
 * move it.
 */
async function readSabaqPasses(db: DatabaseExecutor, onlyPages?: readonly number[]): Promise<SabaqPasses> {
  // A grade reads only its own pages' chunk logs, through the card id index; the full scan is for
  // loading every page. Each page's chunk ids sort between its prefix and the prefix with ':' raised to ';'.
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

/**
 * Each card's grades in the order they happened. Stored timestamps can carry different offsets after
 * sync, so the order is by instant, never by the text: "10:00+02:00" comes before "08:10Z".
 */
function gradesByCard(
  rows: readonly { card_id: string; rating: number; local_date: LocalDate | null; reviewed_at: string }[],
): Map<string, GradeEvent[]> {
  const ordered = rows
    .map((row) => ({ row, at: Date.parse(row.reviewed_at) }))
    // Millisecond order first; equal or unparsable instants fall back to the exact comparison.
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

/**
 * The derived tier of a few page cards (TIER-01), reading only their own history. For checks that
 * run inside a grade, where loading every page would cost a read of the whole review log.
 */
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

/** The page numbers of page card ids. */
function pagesOf(cardIds: readonly string[]): number[] {
  const pages = new Set<number>();
  for (const id of cardIds) {
    const unit = parsePageUnit(id);
    if (unit?.kind === "page") pages.add(unit.page);
  }
  return [...pages];
}

/**
 * A page card's history. It came from sabaq only when a passing chunk grade of its page has the
 * card's creation instant (see readSabaqPasses); otherwise it was declared and stays declared.
 */
function pageHistory(row: StudyCardRow, page: number, sabaq: SabaqPasses, grades: Map<string, GradeEvent[]>): PageHistory {
  const created = Date.parse(row.created_at);
  const firstFluentDate = Number.isFinite(created) ? (sabaq.get(page)?.get(created) ?? null) : null;
  const own = grades.get(row.id) ?? [];
  // UNIT-02: a card with a last review but no grades of its own started from its reviewed ayah cards.
  const fromAyahReviews = firstFluentDate === null && own.length === 0 && row.last_review !== null;
  return { declared: firstFluentDate === null && !fromAyahReviews, firstFluentDate, fromAyahReviews, grades: own };
}

/**
 * One page card as it is now, with its history and derived tier (TIER-01), read with the caller's
 * executor. A grade reads it inside its own transaction, since sync can merge reviews from another
 * device after the screen loaded the page. Null when the card is gone.
 */
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

/** Every page card with its derived tier (TIER-01). The tier is recomputed from history, never read from the cache. */
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

/**
 * MST-01: a page counts as memorized when it is sabqi or manzil and its last graded review was Good
 * or better. Declared pages count once their first check passes. Home, Progress and the board use
 * this one definition.
 */
export function isMemorized(card: PageCard): boolean {
  if (card.tier === "sabaq" || card.tier === "manzil.unverified") return false;
  const last = card.history.grades[card.history.grades.length - 1];
  // A page made from reviewed ayah cards counts until its own first grade decides, as those ayat did.
  if (last === undefined) return card.history.fromAyahReviews === true;
  return last.rating >= 3;
}

export function toPlanPage(card: PageCard, today: LocalDate, now: Date): PlanPage {
  const before = card.history.grades.filter((grade) => grade.date < today);
  // UNIT-02: a page made from its reviewed ayah cards was last reviewed with them, so its manzil floor
  // counts from that date instead of treating it as never reviewed.
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

/**
 * A page card on a learning or relearning step that is due now, within the learn-ahead window the
 * session requeue and the flashcard queues use (REVIEW_LEARN_AHEAD_MS). A page graded Again today is
 * on such a step (10 minutes for sabqi and manzil), so it comes back the same day.
 */
function learningStepDue(row: StudyCardRow, now: Date): boolean {
  return (
    (row.state === State.Learning || row.state === State.Relearning) &&
    Date.parse(row.due) <= now.getTime() + REVIEW_LEARN_AHEAD_MS
  );
}

const TODAY_PLAN_KEY = "device_hifz_today_plan";

/** Today's page list as first built on this device, for the recitation unit it was built under. */
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

/**
 * The lines covered by passed chunks, counting each page line once. Two devices can pass
 * overlapping chunks of a page, such as lines 1-4 and 1-6, which cover 6 lines, not 10.
 */
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
  /**
   * Pages still to review today, in order: the day's planned pages not reviewed yet, then pages
   * reviewed today whose learning or relearning step is due (see learningStepDue). Those stay in done.
   */
  todo: readonly PlanPage[];
  /** Pages reviewed today. A page stays here while a learning step brings it back into todo. */
  done: readonly PlanPage[];
  /** Pages in today's wird, each counted once: done, plus planned pages not reviewed yet. */
  total: number;
  /** When the next learning step of a page reviewed today comes due later today, or null. */
  nextStepAt: Date | null;
  newLines: number;
  remainingMinutes: number;
  minutesPerReviewPage: number;
  minutesPerNewPage: number;
  memorizedPages: number;
  /** Lines whose fluent check passed today. */
  sabaqLinesToday: number;
  /** Every page card with its tier, so callers do not read the review history again. */
  cards: readonly PageCard[];
  /** Today's new memorization is done: the lines passed today reach the day's allocation. */
  sabaqDoneToday: boolean;
}>;

/**
 * PLN-02: new memorization is open today only on a day with new lines and without a review backlog.
 * Home offers "Memorize new lines" and the sabaq screen offers a new chunk by this one rule; a
 * second look from earlier today is offered either way.
 */
export function newMemorizationOpen(wird: Pick<TodayWird, "newLines" | "daily">): boolean {
  return wird.newLines > 0 && !wird.daily.backlog;
}

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
    database.getAllAsync<{ card_id: string }>(
      "SELECT DISTINCT card_id FROM study_log WHERE card_id LIKE 'chunk:%' AND local_date = ? AND rating >= 3",
      [today],
    ),
  ]);
  // UNIT-02: ayah review has no page tasks. A switch sets every page card aside, but a page card
  // still live (synced from a device that had not switched yet) stays out of the day's list too.
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
  // A switch of recitation unit changes which cards are active (lib/hifz/unit-switch), so a list
  // built under another unit is built again; otherwise the list holds for the day (PLAN-01).
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
  // Coverage and pending steps are separate: a page reviewed today stays done for the day's share,
  // and a learning step that comes due brings it back after the planned pages, soonest due first.
  const steps = cards
    .filter((card) => learningStepDue(card.row, now))
    .sort((a, b) => Date.parse(a.row.due) - Date.parse(b.row.due) || a.page - b.page)
    .flatMap((card) => {
      const page = byId.get(card.row.id);
      return page?.reviewedToday ? [page] : [];
    });
  const todo = [...planned, ...steps];
  const done = pages.filter((page) => page.reviewedToday);
  // A step not due yet brings its page back later today; Home refreshes then (useTodayWird).
  const reviewedToday = new Set(done.map((page) => page.cardId));
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
    // Today's new memorization is done once the lines passed today reach the day's allocation.
    sabaqDoneToday: snapshot.newLines > 0 ? linesToday >= snapshot.newLines : linesToday > 0,
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
    // MST-04: the first manzil cycle starts on the day pages are first declared, stored as a calendar
    // date so later travel does not move it.
    if (created > 0) await ensureManzilCycleStart(db, today);
  });
  return created;
}

/** MST-04: the synced calendar date the current manzil cycle started on. */
export const MANZIL_CYCLE_START_KEY = "hifz_manzil_cycle_start";

/**
 * The stored manzil cycle start, or `fallback` stored as the start when none is stored yet. Pass a
 * transaction so the setting and its queued upload commit with the caller's other writes.
 */
export async function ensureManzilCycleStart(db: DatabaseExecutor, fallback: LocalDate): Promise<LocalDate> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ? AND deleted_at IS NULL",
    [MANZIL_CYCLE_START_KEY],
  );
  if (row?.value) return row.value;
  await putUserSetting(db, MANZIL_CYCLE_START_KEY, fallback);
  return fallback;
}

/** The pages that have a page card, for the memorized-portion picker. */
export async function readMemorizedPageNumbers(db: DatabaseExecutor): Promise<Set<number>> {
  const rows = await readPageRows(db);
  return new Set(rows.flatMap((row) => {
    const unit = parsePageUnit(row.id);
    return unit?.kind === "page" ? [unit.page] : [];
  }));
}
