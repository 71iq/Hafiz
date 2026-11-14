import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import { insertNewStudyCard, newStudyCardRow, readDeckReviewSettings, type StartingSchedule } from "@/lib/fsrs/queries";
import { persistReviewTransition, readCurrentCard, type ReviewSaveResult } from "@/lib/fsrs/persist-review";
import { calculateReviewTransition, REVIEW_LEARN_AHEAD_MS } from "@/lib/fsrs/review-transition";
import type { ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import { Rating, type Grade } from "@/lib/fsrs/scheduler";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { addDays, atLocalTime, localDateOf, type LocalDate } from "@/lib/habit/dates";
import { sabaqStepFlags } from "@/lib/habit/minimum";
import { loadRecitationPage, type PageLine, type PageWordsLines, type RecitationPage } from "@/lib/hifz/page-data";
import { readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { pagePolicy } from "@/lib/hifz/tiers";
import { addSabaqPageToAyahReview, coverPageInAyahReview } from "@/lib/hifz/unit-switch";
import {
  chunkCardId,
  chunkCardPrefix,
  HIFZ_PAGES_DECK_ID,
  HIFZ_SABAQ_DECK_ID,
  LINES_PER_PAGE,
  PAGE_COUNT,
  pageCardId,
  pagesOfJuz,
  parsePageUnit,
  type PageUnit,
} from "@/lib/hifz/units";

/**
 * The order new pages are memorized in (3.3). Juz 'Amma first goes from the end of juz 30 back to
 * its start (short surahs first), then juz 29 the same way, then from al-Baqarah onward. The
 * Ottoman method takes the r-th page from the end of every juz in round r (Harahap 2023).
 */
export function newPageOrder(plan: Pick<HifzPlan, "method" | "direction">): number[] {
  if (plan.method === "ottoman") {
    const order: number[] = [];
    for (let round = 0; round < 23; round += 1) {
      for (let juz = 1; juz <= 30; juz += 1) {
        const pages = pagesOfJuz(juz);
        const page = pages[pages.length - 1 - round];
        if (page !== undefined) order.push(page);
      }
    }
    return order;
  }
  if (plan.direction === "from_fatiha") return Array.from({ length: PAGE_COUNT }, (_, i) => i + 1);
  const juz30 = pagesOfJuz(30).reverse();
  const juz29 = pagesOfJuz(29).reverse();
  const rest = Array.from({ length: pagesOfJuz(29)[0] - 1 }, (_, i) => i + 1);
  return [...juz30, ...juz29, ...rest];
}

export type SabaqTarget = Readonly<{
  page: number;
  pageData: RecitationPage;
  fromLine: number;
  toLine: number;
  lineNumbers: ReadonlySet<number>;
  /** The ayat in the chunk, in order. */
  ayahs: readonly { surah: number; ayah: number }[];
  /** The last two ayat recited before the chunk, for the link step (4.4.1 step 7). */
  linkAyahs: readonly { surah: number; ayah: number }[];
  /**
   * With the chunk, every line of the page was memorized when the target was chosen. The grade that
   * adds the page checks again in its own transaction (addPageIfComplete), since a failed second look
   * since then can uncover lines.
   */
  completesPage: boolean;
}>;

function ayahLines(page: RecitationPage): PageLine[] {
  return page.lines.filter((line) => line.kind === "ayah" && line.tokens.length > 0);
}

function endsAyah(line: PageLine): boolean {
  return line.tokens[line.tokens.length - 1]?.isMarker ?? false;
}

/**
 * SBQ-02: the live chunk cards counted as memorized, those whose latest review passed (Good or Easy):
 * the clean run (step 6), a passed fluent check or a passed second look. A chunk whose fluent check or
 * second look failed after that is offered again as new lines. Reviews are ordered by instant, since
 * synced timestamps can carry different offsets; a tie counts as passed. `prefix` limits it to ids
 * starting with it, such as one page's chunks (chunkCardPrefix).
 */
async function readDoneChunks(db: DatabaseExecutor, prefix: string): Promise<Extract<PageUnit, { kind: "chunk" }>[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM study_cards AS c
      WHERE c.deck_id = ? AND c.id >= ? AND c.id < ? AND c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM study_log AS l WHERE l.card_id = c.id AND l.rating >= 3)
        AND NOT EXISTS (
          SELECT 1 FROM study_log AS f
          WHERE f.card_id = c.id AND f.rating < 3
            AND julianday(f.reviewed_at) > (SELECT MAX(julianday(p.reviewed_at)) FROM study_log AS p WHERE p.card_id = c.id AND p.rating >= 3)
        )`,
    // Every id that starts with the prefix sorts at or after it and before the prefix with its last
    // character raised by one.
    [HIFZ_SABAQ_DECK_ID, prefix, `${prefix.slice(0, -1)}${String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)}`],
  );
  return rows.flatMap((row) => {
    const unit = parsePageUnit(row.id);
    return unit?.kind === "chunk" ? [unit] : [];
  });
}

/** Whether a line lies in one of the chunks. */
function coveredBy(chunks: readonly Extract<PageUnit, { kind: "chunk" }>[], lineNumber: number): boolean {
  return chunks.some((chunk) => lineNumber >= chunk.fromLine && lineNumber <= chunk.toLine);
}

/**
 * Choose today's chunk: the first lines not yet memorized on the first page in the plan's order
 * that is not yet memorized, about `wantLines` long and extended up to 2 lines so it ends at an
 * ayah end. A chunk never runs into lines already memorized.
 */
export async function nextSabaqTarget(
  db: DatabaseExecutor,
  { plan, wantLines, pageWords }: { plan: HifzPlan; wantLines: number; pageWords: (page: number) => PageWordsLines | null },
): Promise<SabaqTarget | null> {
  const pageRows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM study_cards WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL",
    [HIFZ_PAGES_DECK_ID],
  );
  const memorized = new Set(pageRows.flatMap((row) => {
    const unit = parsePageUnit(row.id);
    return unit?.kind === "page" ? [unit.page] : [];
  }));
  const page = newPageOrder(plan).find((candidate) => !memorized.has(candidate));
  if (page === undefined) return null;

  const done = await readDoneChunks(db, chunkCardPrefix(page));
  const covered = (line: PageLine) => coveredBy(done, line.lineNumber);
  const pageData = await loadRecitationPage(db, page, pageWords(page));
  const lines = ayahLines(pageData);
  // The first lines not memorized, up to the next memorized ones: a chunk whose check or look failed
  // after a later chunk passed is offered again in its place.
  const start = lines.findIndex((line) => !covered(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && covered(line));
  const remaining = lines.slice(start, end < 0 ? lines.length : end);
  let count = Math.max(1, Math.min(wantLines, remaining.length));
  let extended = 0;
  while (count < remaining.length && !endsAyah(remaining[count - 1]) && extended < 2) {
    count += 1;
    extended += 1;
  }
  const chunk = remaining.slice(0, count);
  const chunkLines = new Set(chunk.map((line) => line.lineNumber));
  const ayahKeys = new Set<string>();
  const ayahs: { surah: number; ayah: number }[] = [];
  for (const token of chunk.flatMap((line) => line.tokens)) {
    const key = `${token.surah}:${token.ayah}`;
    if (!ayahKeys.has(key)) {
      ayahKeys.add(key);
      ayahs.push({ surah: token.surah, ayah: token.ayah });
    }
  }
  const first = ayahs[0];
  const linkRows = first
    ? await db.getAllAsync<{ surah: number; ayah: number }>(
        `SELECT surah, ayah FROM quran_text WHERE (surah < ? OR (surah = ? AND ayah < ?)) ORDER BY surah DESC, ayah DESC LIMIT 2`,
        [first.surah, first.surah, first.ayah],
      )
    : [];
  return {
    page,
    pageData,
    fromLine: chunk[0].lineNumber,
    toLine: chunk[chunk.length - 1].lineNumber,
    lineNumbers: chunkLines,
    ayahs,
    linkAyahs: linkRows.reverse(),
    completesPage: lines.every((line) => chunkLines.has(line.lineNumber) || covered(line)),
  };
}

/**
 * SBQ-03: the second look. A chunk card's reviews belong to the local day it was learned, the day
 * its clean run (step 6) passed. The sabaq screen offers it as a short second look before new lines,
 * about an hour after its lesson, or sooner when the lesson's last grade set an earlier step: a failed
 * fluent check comes back with its relearning step. After that day the
 * chunk card is never offered again, whatever FSRS scheduled: once the page is complete its page
 * card carries the review (SBQ-02), and until then the page is still being memorized. So the flows
 * that show cards leave chunk cards out: Review all and Home's deck counts read the review decks, the
 * wird reads page cards, and remediation reads half pages, seams and gap cards.
 */
export type SecondLook = Readonly<{
  cardId: string;
  page: number;
  fromLine: number;
  toLine: number;
  pageData: RecitationPage;
  /** The chunk's ayah lines, as the lesson showed them. */
  lineNumbers: ReadonlySet<number>;
}>;

export type SecondLooks = Readonly<{
  /** Today's chunks that are due now, the earliest due first. */
  due: readonly SecondLook[];
  /** When the next of today's chunks comes due, while that is still today; null when none will. */
  nextAt: Date | null;
}>;

/**
 * A chunk's second look comes due at `due` (a review queue's learn-ahead window early), offered only
 * while it is still the day of `now`. Null when it is due already or only on a later day.
 */
function laterToday(due: Date, now: Date): Date | null {
  return due.getTime() - REVIEW_LEARN_AHEAD_MS > now.getTime() && localDateOf(due) === localDateOf(now) ? due : null;
}

/** A chunk learned today, with the instants its lesson ended and it was last reviewed. */
type TodaysChunk = Readonly<{ id: string; due: string; lessonEndAt: number; lastReviewAt: number }>;

/**
 * The live chunk cards learned on `today` (see SecondLook): those with a completed step 6 today, a
 * pass with no review before it or right after a failed one (sabaqStepFlags, the rule the wird day
 * uses). A chunk whose latest review before today passed belongs to that day; one that failed then
 * and was learned again today belongs to today.
 *
 * A chunk's lesson is its latest learning today, that completed step, with the reviews saved in the
 * same review session after it: the fluent check. So a chunk learned again after a failed check, in
 * a later lesson, gets its look from that lesson. A lesson from before step 6 saved anything is only
 * its fluent check. Reviews are ordered by instant, since synced timestamps can carry different offsets.
 */
async function readTodaysChunks(db: DatabaseExecutor, today: LocalDate, now: Date): Promise<TodaysChunk[]> {
  const cards = await db.getAllAsync<{ id: string; due: string }>(
    `SELECT c.id, c.due FROM study_cards AS c
      WHERE c.deck_id = ? AND c.id LIKE 'chunk:%' AND c.deleted_at IS NULL AND c.suspended_at IS NULL
        AND (c.buried_until IS NULL OR c.buried_until <= ?)
        AND EXISTS (SELECT 1 FROM study_log AS l WHERE l.card_id = c.id AND l.rating >= 3 AND l.local_date = ?)`,
    [HIFZ_SABAQ_DECK_ID, now.toISOString(), today],
  );
  if (cards.length === 0) return [];
  const logs = await db.getAllAsync<{ card_id: string; rating: number; reviewed_at: string; local_date: LocalDate | null; session_id: string | null }>(
    `SELECT card_id, rating, reviewed_at, local_date, session_id FROM study_log WHERE card_id IN (${cards.map(() => "?").join(", ")})`,
    cards.map((card) => card.id),
  );
  type Review = { at: number; rating: number; day: LocalDate; session: string | null };
  const reviewsByCard = new Map<string, Review[]>();
  for (const log of logs) {
    const at = Date.parse(log.reviewed_at);
    if (!Number.isFinite(at)) continue;
    const reviews = reviewsByCard.get(log.card_id) ?? [];
    reviews.push({ at, rating: log.rating, day: log.local_date ?? localDateOf(new Date(at)), session: log.session_id });
    reviewsByCard.set(log.card_id, reviews);
  }
  const chunks: TodaysChunk[] = [];
  for (const card of cards) {
    const reviews = (reviewsByCard.get(card.id) ?? []).sort((a, b) => a.at - b.at);
    const steps = sabaqStepFlags(reviews);
    const todays = reviews.filter((review) => review.day === today);
    const learned = reviews.filter((review, index) => steps[index] && review.day === today).at(-1);
    if (!learned) continue;
    const lesson = todays.filter(
      (review) => review === learned || (learned.session !== null && review.session === learned.session && review.at >= learned.at),
    );
    chunks.push({
      id: card.id,
      due: card.due,
      lessonEndAt: Math.max(...lesson.map((review) => review.at)),
      lastReviewAt: todays[todays.length - 1].at,
    });
  }
  return chunks;
}

/**
 * SBQ-03 offers every chunk one second look later the day it was learned, whatever FSRS scheduled:
 * a passed fluent check graduates the chunk to a later day, yet the look still belongs to today.
 * Until the first look, a chunk is offered by its due time or this long after its lesson, whichever
 * is sooner, so a failed check comes back with its relearning step. After the look, its own schedule
 * decides, so a look graded Again comes back with its relearning step too.
 */
const SECOND_LOOK_AFTER_MS = 60 * 60_000;

/** When a chunk whose lesson ended at `lessonEnd` is first offered, given the due time FSRS set. */
function firstLookAt(due: Date, lessonEnd: Date): Date {
  const latest = lessonEnd.getTime() + SECOND_LOOK_AFTER_MS;
  return due.getTime() < latest ? due : new Date(latest);
}

/** When a chunk is offered: its first look's time until it has had one, then its own due time. */
function lookAt(chunk: TodaysChunk): Date {
  const due = new Date(chunk.due);
  return chunk.lastReviewAt > chunk.lessonEndAt ? due : firstLookAt(due, new Date(chunk.lessonEndAt));
}

/**
 * Today's second looks (SBQ-03): the chunks that passed today and are due now, as a review queue
 * counts due (within its learn-ahead window), and when the next one comes due later today. A look
 * that is skipped is not written anywhere, so it stays due and is offered again for the rest of the day.
 */
type DueChunk = { id: string; unit: Extract<PageUnit, { kind: "chunk" }>; at: number };

/** Today's chunks split into those due now, earliest first, and when the next comes due later today. */
async function readSecondLookSchedule(db: DatabaseExecutor, now: Date): Promise<{ due: DueChunk[]; nextAt: Date | null }> {
  const rows = await readTodaysChunks(db, localDateOf(now), now);
  const due: DueChunk[] = [];
  let nextAt: Date | null = null;
  for (const row of rows) {
    const unit = parsePageUnit(row.id);
    const at = lookAt(row);
    if (unit?.kind !== "chunk" || !Number.isFinite(at.getTime())) continue;
    if (at.getTime() <= now.getTime() + REVIEW_LEARN_AHEAD_MS) due.push({ id: row.id, unit, at: at.getTime() });
    else {
      const later = laterToday(at, now);
      if (later && (!nextAt || later < nextAt)) nextAt = later;
    }
  }
  due.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { due, nextAt };
}

/**
 * How many second looks are due now and when the next one comes later today, for Home's cue.
 * `nextAt` is its time as the done step promised it; `offeredAt` is a review queue's learn-ahead
 * window before that, the moment loadSecondLooks starts offering it.
 */
export async function countSecondLooks(
  db: DatabaseExecutor,
  now = new Date(),
): Promise<{ due: number; nextAt: Date | null; offeredAt: Date | null }> {
  const { due, nextAt } = await readSecondLookSchedule(db, now);
  return { due: due.length, nextAt, offeredAt: nextAt ? new Date(nextAt.getTime() - REVIEW_LEARN_AHEAD_MS) : null };
}

export async function loadSecondLooks(
  db: DatabaseExecutor,
  { now = new Date(), pageWords }: { now?: Date; pageWords: (page: number) => PageWordsLines | null },
): Promise<SecondLooks> {
  const { due, nextAt } = await readSecondLookSchedule(db, now);
  const pages = new Map<number, RecitationPage>();
  const looks: SecondLook[] = [];
  for (const { id, unit } of due) {
    const pageData = pages.get(unit.page) ?? (await loadRecitationPage(db, unit.page, pageWords(unit.page)));
    pages.set(unit.page, pageData);
    const lineNumbers = new Set(
      ayahLines(pageData)
        .filter((line) => line.lineNumber >= unit.fromLine && line.lineNumber <= unit.toLine)
        .map((line) => line.lineNumber),
    );
    looks.push({ cardId: id, page: unit.page, fromLine: unit.fromLine, toLine: unit.toLine, pageData, lineNumbers });
  }
  return { due: looks, nextAt };
}

/**
 * Save one grade of a chunk card through the review path every card uses (DB-01): the card, its
 * review log, the wird day and its make-up attribution commit together. The card is read inside the
 * transaction, since sync or another save of this chunk may have graded it since the screen loaded,
 * and calculating from an earlier read would overwrite that newer schedule. With `create`, a missing
 * card is created in the same transaction, so a failed save leaves nothing behind.
 */
async function saveChunkGrade(
  db: AppDatabase,
  {
    id,
    plan,
    rating,
    session,
    durationMs,
    now,
    create,
    firstGradeInSession = true,
    extraWork,
  }: {
    id: string;
    plan: HifzPlan;
    rating: Grade;
    session: ReviewSessionRef | null;
    durationMs: number;
    now: Date;
    create: boolean;
    firstGradeInSession?: boolean;
    extraWork?: (tx: DatabaseExecutor) => Promise<void>;
  },
): Promise<ReviewSaveResult> {
  const at = now.toISOString();
  const base = await readDeckReviewSettings(db, HIFZ_SABAQ_DECK_ID);
  const created = (): StudyCardRow => newStudyCardRow({ id, deckId: HIFZ_SABAQ_DECK_ID, due: now, tier: "sabaq", now: at });
  return persistReviewTransition({
    db,
    cardId: id,
    // Creating it does nothing when the card already exists.
    beforeWork: create
      ? async (tx) => {
          await insertNewStudyCard(tx, { id, deckId: HIFZ_SABAQ_DECK_ID, due: now, tier: "sabaq", now: at });
        }
      : undefined,
    transition: async (tx) => {
      const current = await readCurrentCard(tx, id);
      if (!current && !create) throw new StudyCardDeletedError();
      return calculateReviewTransition({ card: current ?? created(), rating, reviewedAt: now, reviewPolicy: pagePolicy("sabaq", plan, base) });
    },
    context: {
      session,
      firstGradeInSession,
      durationMs,
      supportLevel: 4,
      proposedRating: null,
      grader: "self",
      errors: [],
    },
    extraWork,
  });
}

/**
 * SBQ-02: a page memorized through sabaq starts from its chunks' ratings rather than as an empty
 * card. Read inside the grade's transaction, after the final chunk's own review is written, so every
 * chunk of the page counts. The page is as strong as its weakest chunk: the lowest stability, with
 * the chunks' mean difficulty, last reviewed now and due tomorrow as a sabqi page. Null when no
 * graded chunk is left, and the page starts empty as before.
 */
async function pageStartFromChunks(tx: DatabaseExecutor, page: number, now: Date): Promise<StartingSchedule | null> {
  const prefix = chunkCardPrefix(page);
  const row = await tx.getFirstAsync<{ stability: number | null; difficulty: number | null }>(
    `SELECT MIN(stability) AS stability, AVG(difficulty) AS difficulty FROM study_cards
      WHERE deck_id = ? AND id >= ? AND id < ? AND deleted_at IS NULL AND state <> 0 AND stability > 0`,
    [HIFZ_SABAQ_DECK_ID, prefix, `${prefix.slice(0, -1)};`],
  );
  if (!row?.stability || !row.difficulty) return null;
  return { stability: row.stability, difficulty: row.difficulty, lastReview: now.toISOString(), scheduledDays: 1 };
}

/**
 * SBQ-02: once every ayah line of the page lies in a memorized chunk (readDoneChunks), the page joins
 * review, sabqi and due tomorrow, unless it has a live card already. Runs inside a chunk grade's
 * transaction after its review is written, so the coverage it reads is the committed one: a failed
 * second look since the screen chose its lines keeps the page out, and a passed one that covers the
 * last lines adds it. In ayah review (UNIT-02) the page is reviewed as ayat instead: the ayah decks
 * take in its surahs, its card is set aside for a switch to pages, and its ayat get ayah cards
 * (addSabaqPageToAyahReview). `pageLines` are the page's ayah line numbers as the lesson laid them
 * out, the numbering its chunk ids use. Returns whether it added the page.
 */
async function addPageIfComplete(
  tx: DatabaseExecutor,
  {
    page,
    pageLines,
    plan,
    now,
    completedOn = localDateOf(now),
  }: {
    page: number;
    pageLines: readonly number[];
    plan: HifzPlan;
    now: Date;
    /** The local day the page was completed, which its first due day follows; the day of `now` by default. */
    completedOn?: LocalDate;
  },
): Promise<boolean> {
  if (pageLines.length === 0) return false;
  const live = await tx.getFirstAsync<{ found: number }>("SELECT 1 AS found FROM study_cards WHERE id = ? AND deleted_at IS NULL", [pageCardId(page)]);
  if (live) return false;
  const done = await readDoneChunks(tx, chunkCardPrefix(page));
  if (!pageLines.every((lineNumber) => coveredBy(done, lineNumber))) return false;
  // The stored plan decides, since the unit may have changed after the screen loaded its copy.
  const ayahReview = ((await readHifzPlan(tx))?.unit ?? plan.unit) === "ayah";
  if (ayahReview) await coverPageInAyahReview(tx, page);
  const due = atLocalTime(addDays(completedOn, 1), 0);
  const start = await pageStartFromChunks(tx, page, now);
  const added = await insertNewStudyCard(tx, { id: pageCardId(page), deckId: HIFZ_PAGES_DECK_ID, due, tier: "sabqi", now: now.toISOString(), start });
  if (ayahReview) await addSabaqPageToAyahReview(tx, { page, start, due, now });
  return added;
}

function pageLineNumbers(pageData: RecitationPage): number[] {
  return ayahLines(pageData).map((line) => line.lineNumber);
}

/**
 * SBQ-02 after sync or a restore: the pages, in the plan's order, whose ayah lines are all memorized
 * but that have no page card. A grade adds its page from the chunks this device has, so two devices
 * whose chunks complete the page only once merged each add nothing, and sabaq would stay on a page
 * with nothing left to offer. Each page is dated to the grade that completed it, the latest of its
 * chunks' completed steps 6 (sabaqStepFlags), so it keeps its sabaq provenance (readSabaqPasses) and
 * its first review date. One transaction each, which checks the coverage again. Returns the number
 * of pages added.
 */
export async function addCoveredSabaqPages(
  db: AppDatabase,
  { plan, pageWords }: { plan: HifzPlan; pageWords: (page: number) => PageWordsLines | null },
): Promise<number> {
  const order = newPageOrder(plan);
  let added = 0;
  // Each pass adds the first unmemorized page or stops, so this runs at most once per page.
  for (let pass = 0; pass < PAGE_COUNT; pass += 1) {
    const pageRows = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM study_cards WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL",
      [HIFZ_PAGES_DECK_ID],
    );
    const memorized = new Set(pageRows.flatMap((row) => {
      const unit = parsePageUnit(row.id);
      return unit?.kind === "page" ? [unit.page] : [];
    }));
    const page = order.find((candidate) => !memorized.has(candidate));
    if (page === undefined) return added;
    const done = await readDoneChunks(db, chunkCardPrefix(page));
    if (done.length === 0) return added;
    const pageLines = pageLineNumbers(await loadRecitationPage(db, page, pageWords(page)));
    if (pageLines.length === 0 || !pageLines.every((lineNumber) => coveredBy(done, lineNumber))) return added;
    const ids = done.map((chunk) => chunkCardId(chunk.page, chunk.fromLine, chunk.toLine));
    const logs = await db.getAllAsync<{ card_id: string; rating: number; reviewed_at: string; local_date: LocalDate | null }>(
      `SELECT card_id, rating, reviewed_at, local_date FROM study_log WHERE card_id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    // The completing grade: the latest of the chunks' completed steps, with the local day stored on
    // it, which stays right after the person changes time zone.
    let completed: { at: number; day: LocalDate } | null = null;
    for (const id of ids) {
      const reviews = logs
        .filter((log) => log.card_id === id)
        .map((log) => {
          const at = Date.parse(log.reviewed_at);
          return { at, rating: log.rating, day: log.local_date ?? (Number.isFinite(at) ? localDateOf(new Date(at)) : null) };
        })
        .filter((review) => Number.isFinite(review.at))
        .sort((a, b) => a.at - b.at);
      const steps = sabaqStepFlags(reviews);
      const learned = reviews.filter((_, index) => steps[index]).at(-1);
      if (learned?.day && (completed === null || learned.at > completed.at)) completed = { at: learned.at, day: learned.day };
    }
    if (completed === null) return added;
    const { at: completedAt, day: completedOn } = completed;
    let pageAdded = false;
    await db.withTransactionAsync(async (tx) => {
      pageAdded = await addPageIfComplete(tx, { page, pageLines, plan, now: new Date(completedAt), completedOn });
    });
    if (!pageAdded) return added;
    added += 1;
  }
  return added;
}

type ChunkSaveInput = { target: SabaqTarget; plan: HifzPlan; session: ReviewSessionRef | null; durationMs: number; now?: Date };

function targetCardId(target: SabaqTarget): string {
  return chunkCardId(target.page, Math.max(1, target.fromLine), Math.min(LINES_PER_PAGE, target.toLine));
}

/**
 * Grade the target's chunk card, creating it when it is missing. A chunk learned again after a failed
 * check or look is graded on the same card. When the grade leaves every line of the page memorized,
 * the page joins review in the same transaction (addPageIfComplete).
 */
async function saveTargetChunk(
  db: AppDatabase,
  {
    target,
    plan,
    rating,
    session,
    durationMs,
    now,
    firstGradeInSession,
  }: Required<ChunkSaveInput> & { rating: Grade; firstGradeInSession: boolean },
): Promise<ReviewSaveResult & { pageAdded: boolean }> {
  let pageAdded = false;
  const result = await saveChunkGrade(db, {
    id: targetCardId(target),
    plan,
    rating,
    session,
    durationMs,
    now,
    create: true,
    firstGradeInSession,
    extraWork: async (tx) => {
      pageAdded = await addPageIfComplete(tx, { page: target.page, pageLines: pageLineNumbers(target.pageData), plan, now });
    },
  });
  return { ...result, pageAdded };
}

/**
 * SBQ-02, 4.4.1 step 6: once the whole chunk is recited cleanly the set number of times in a row, the
 * chunk becomes a sabaq card with Good as its first review, and when it completes its page the page
 * joins review in the same transaction. The review counts for the wird day (STR-01), so a lesson
 * left after step 6 keeps its lines and its credit. `durationMs` is the lesson's time so far.
 */
export async function saveSabaqCleanRun(
  db: AppDatabase,
  { target, plan, session, durationMs, now = new Date() }: ChunkSaveInput,
): Promise<ReviewSaveResult & { pageAdded: boolean }> {
  return saveTargetChunk(db, {
    target,
    plan,
    rating: Rating.Good,
    session,
    durationMs,
    now,
    firstGradeInSession: true,
  });
}

/**
 * The fluent check (4.4.1 step 8): a second review of the chunk card step 6 created, with the
 * person's grade. When step 6 left no card, such as one deleted since, the check creates it. Step 6
 * normally added the page already; the check adds it only when it is still missing and its lines are
 * all memorized (addPageIfComplete). `secondLookAt` is when the chunk's second look comes due,
 * while that is still today (SBQ-03); after a failed check that is its relearning step.
 * `secondLookNow` says the look is offered already, as after a check graded Again, whose relearning
 * step falls inside the learn-ahead window.
 */
export async function completeSabaqChunk(
  db: AppDatabase,
  { target, plan, rating, session, durationMs, now = new Date() }: ChunkSaveInput & { rating: Grade },
): Promise<ReviewSaveResult & { pageAdded: boolean; secondLookAt: Date | null; secondLookNow: boolean }> {
  const id = targetCardId(target);
  const missing = (await readCurrentCard(db, id)) === null;
  // Step 6 graded the card in this session already, so the session counts it once.
  const gradedInSession =
    !missing &&
    session !== null &&
    (await db.getFirstAsync<{ found: number }>("SELECT 1 AS found FROM study_log WHERE card_id = ? AND session_id = ? LIMIT 1", [id, session.id])) !== null;
  const result = await saveTargetChunk(db, {
    target,
    plan,
    rating,
    session,
    durationMs,
    now,
    firstGradeInSession: !gradedInSession,
  });
  // The done step promises the look as loadSecondLooks will offer it: the check ends the lesson, so
  // it is counted from now (see lookAt). The grade is committed by now, so a failed read only leaves
  // the look unpromised; failing here would offer the saved grade again.
  let look: Date | null = null;
  try {
    const learned = (await readTodaysChunks(db, localDateOf(now), now)).find((chunk) => chunk.id === id);
    look = learned ? lookAt(learned) : null;
  } catch (lookError) {
    console.warn("[Sabaq] Could not read the second look after the check:", lookError);
  }
  const secondLookAt = look ? laterToday(look, now) : null;
  // As readSecondLookSchedule counts a look due now.
  const secondLookNow = look !== null && look.getTime() <= now.getTime() + REVIEW_LEARN_AHEAD_MS;
  return { ...result, secondLookAt, secondLookNow };
}

/**
 * Grade a second look (SBQ-03) as a review of its chunk card, through the same save as the fluent
 * check: it is logged, counts toward the wird and its make-up, and moves the chunk to its next step.
 * A passed look that leaves every line of its page memorized adds the page (addPageIfComplete), as
 * after a chunk whose check failed is passed at its relearning look. `pageData` is the look's page
 * as loadSecondLooks laid it out. The chunk is not created again: a chunk deleted since the screen
 * loaded fails with StudyCardDeletedError.
 */
export async function saveSecondLook(
  db: AppDatabase,
  {
    cardId,
    pageData,
    plan,
    rating,
    session,
    durationMs,
    now = new Date(),
  }: { cardId: string; pageData: RecitationPage; plan: HifzPlan; rating: Grade; session: ReviewSessionRef | null; durationMs: number; now?: Date },
): Promise<ReviewSaveResult & { pageAdded: boolean }> {
  const unit = parsePageUnit(cardId);
  if (unit?.kind !== "chunk") throw new Error(`Not a sabaq chunk: ${cardId}`);
  if (pageData.page !== unit.page) throw new Error(`Page ${pageData.page} is not the page of ${cardId}`);
  let pageAdded = false;
  const result = await saveChunkGrade(db, {
    id: cardId,
    plan,
    rating,
    session,
    durationMs,
    now,
    create: false,
    extraWork: async (tx) => {
      pageAdded = await addPageIfComplete(tx, { page: unit.page, pageLines: pageLineNumbers(pageData), plan, now });
    },
  });
  return { ...result, pageAdded };
}
