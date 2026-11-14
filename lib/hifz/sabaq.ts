import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import { insertNewStudyCard, newStudyCardRow, readDeckReviewSettings, type StartingSchedule } from "@/lib/fsrs/queries";
import { persistReviewTransition, readCurrentCard, type ReviewSaveResult } from "@/lib/fsrs/persist-review";
import { calculateReviewTransition, REVIEW_LEARN_AHEAD_MS } from "@/lib/fsrs/review-transition";
import type { ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import type { Grade } from "@/lib/fsrs/scheduler";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { addDays, atLocalTime, localDateOf, type LocalDate } from "@/lib/habit/dates";
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
  /** The chunk ends the page, so passing it adds the page to review. */
  completesPage: boolean;
}>;

function ayahLines(page: RecitationPage): PageLine[] {
  return page.lines.filter((line) => line.kind === "ayah" && line.tokens.length > 0);
}

function endsAyah(line: PageLine): boolean {
  return line.tokens[line.tokens.length - 1]?.isMarker ?? false;
}

/**
 * Choose today's chunk: the next lines of the first page in the plan's order that is not yet
 * memorized, about `wantLines` long and extended up to 2 lines so it ends at an ayah end.
 */
export async function nextSabaqTarget(
  db: DatabaseExecutor,
  { plan, wantLines, pageWords }: { plan: HifzPlan; wantLines: number; pageWords: (page: number) => PageWordsLines | null },
): Promise<SabaqTarget | null> {
  const [pageRows, chunkRows] = await Promise.all([
    db.getAllAsync<{ id: string }>("SELECT id FROM study_cards WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL", [HIFZ_PAGES_DECK_ID]),
    // SBQ-02: a chunk counts as memorized once its fluent check passed (Good or Easy at least once).
    // A chunk that only failed is offered again rather than skipped.
    db.getAllAsync<{ id: string }>(
      `SELECT c.id FROM study_cards AS c
        WHERE c.deck_id = ? AND c.id LIKE 'chunk:%' AND c.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM study_log AS l WHERE l.card_id = c.id AND l.rating >= 3)`,
      [HIFZ_SABAQ_DECK_ID],
    ),
  ]);
  const memorized = new Set(pageRows.flatMap((row) => {
    const unit = parsePageUnit(row.id);
    return unit?.kind === "page" ? [unit.page] : [];
  }));
  const page = newPageOrder(plan).find((candidate) => !memorized.has(candidate));
  if (page === undefined) return null;

  let doneThrough = 0;
  for (const row of chunkRows) {
    const unit = parsePageUnit(row.id);
    if (unit?.kind === "chunk" && unit.page === page) doneThrough = Math.max(doneThrough, unit.toLine);
  }
  const pageData = await loadRecitationPage(db, page, pageWords(page));
  const lines = ayahLines(pageData);
  const remaining = lines.filter((line) => line.lineNumber > doneThrough);
  if (remaining.length === 0) return null;
  let count = Math.max(1, Math.min(wantLines, remaining.length));
  let extended = 0;
  while (count < remaining.length && !endsAyah(remaining[count - 1]) && extended < 2) {
    count += 1;
    extended += 1;
  }
  const chunk = remaining.slice(0, count);
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
    lineNumbers: new Set(chunk.map((line) => line.lineNumber)),
    ayahs,
    linkAyahs: linkRows.reverse(),
    completesPage: chunk[chunk.length - 1].lineNumber === lines[lines.length - 1].lineNumber,
  };
}

/**
 * SBQ-03: the second look. A chunk card's reviews belong to the local day its fluent check first
 * passed. The sabaq policy's learning steps (10m, 1h) give a chunk passed Good a review about an hour
 * later, and the sabaq screen offers it as a short second look before new lines. After that day the
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

/**
 * The live chunk cards whose fluent check first passed on `today` (see SecondLook). A chunk that also
 * passed on an earlier day belongs to that day, and one that only failed today is not memorized yet:
 * the next sabaq offers it again as new lines.
 */
async function readTodaysChunks(
  db: DatabaseExecutor,
  today: LocalDate,
  now: Date,
): Promise<{ id: string; due: string; first_pass_at: string; last_review_at: string }[]> {
  return db.getAllAsync<{ id: string; due: string; first_pass_at: string; last_review_at: string }>(
    `SELECT c.id, c.due,
        (SELECT MIN(l.reviewed_at) FROM study_log AS l WHERE l.card_id = c.id AND l.rating >= 3 AND l.local_date = ?) AS first_pass_at,
        (SELECT MAX(l.reviewed_at) FROM study_log AS l WHERE l.card_id = c.id AND l.local_date = ?) AS last_review_at
      FROM study_cards AS c
      WHERE c.deck_id = ? AND c.id LIKE 'chunk:%' AND c.deleted_at IS NULL AND c.suspended_at IS NULL
        AND (c.buried_until IS NULL OR c.buried_until <= ?)
        AND EXISTS (SELECT 1 FROM study_log AS l WHERE l.card_id = c.id AND l.rating >= 3 AND l.local_date = ?)
        AND NOT EXISTS (SELECT 1 FROM study_log AS l WHERE l.card_id = c.id AND l.rating >= 3 AND l.local_date < ?)`,
    [today, today, HIFZ_SABAQ_DECK_ID, now.toISOString(), today, today],
  );
}

/**
 * SBQ-03 offers every chunk one second look later the day it passed, whatever FSRS scheduled: an
 * Easy check graduates the chunk to a later day, yet the look still belongs to today. Until the
 * first look, a chunk is offered by its due time or this long after its pass, whichever is sooner.
 * After the look, its own schedule decides, so a look graded Again comes back with its relearning step.
 */
const SECOND_LOOK_AFTER_MS = 60 * 60_000;

/** When a chunk that passed at `passedAt` is first offered, given the due time FSRS set. */
function firstLookAt(due: Date, passedAt: Date): Date {
  const latest = passedAt.getTime() + SECOND_LOOK_AFTER_MS;
  return due.getTime() < latest ? due : new Date(latest);
}

/** When a chunk is offered: its first look's time until it has had one, then its own due time. */
function lookAt(row: { due: string; first_pass_at: string; last_review_at: string }): Date {
  const due = new Date(row.due);
  const passedAt = new Date(row.first_pass_at);
  const looked = Date.parse(row.last_review_at) > passedAt.getTime();
  return looked || !Number.isFinite(passedAt.getTime()) ? due : firstLookAt(due, passedAt);
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
    extraWork,
  }: {
    id: string;
    plan: HifzPlan;
    rating: Grade;
    session: ReviewSessionRef | null;
    durationMs: number;
    now: Date;
    create: boolean;
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
      firstGradeInSession: true,
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
 * SBQ-02: after the fluent check, the chunk becomes a sabaq card with that grade as its first review,
 * and the page joins review (sabqi, due tomorrow) once its last chunk passes. One transaction.
 * In ayah review (UNIT-02) the page is reviewed as ayat instead: its card is set aside for a switch
 * to pages, and its ayat get ayah cards in the ayah deck (addSabaqPageToAyahReview).
 * `secondLookAt` is when the chunk's second look comes due, while that is still today (SBQ-03).
 */
export async function completeSabaqChunk(
  db: AppDatabase,
  {
    target,
    plan,
    rating,
    session,
    durationMs,
    now = new Date(),
  }: { target: SabaqTarget; plan: HifzPlan; rating: Grade; session: ReviewSessionRef | null; durationMs: number; now?: Date },
): Promise<ReviewSaveResult & { pageAdded: boolean; secondLookAt: Date | null }> {
  const id = chunkCardId(target.page, Math.max(1, target.fromLine), Math.min(LINES_PER_PAGE, target.toLine));
  const addsPage = target.completesPage && rating >= 3;
  // The stored plan decides, since the unit may have changed after the screen loaded its copy.
  const ayahReview = addsPage && ((await readHifzPlan(db))?.unit ?? plan.unit) === "ayah";
  // The ayah decks take in the page's ayat before the grade, so a failure here leaves the chunk
  // ungraded and safe to grade again.
  if (ayahReview) await coverPageInAyahReview(db, target.page);
  let pageAdded = false;
  // A chunk that failed its fluent check before is checked again on the same card.
  const result = await saveChunkGrade(db, {
    id,
    plan,
    rating,
    session,
    durationMs,
    now,
    create: true,
    extraWork: addsPage
      ? async (tx) => {
          const due = atLocalTime(addDays(localDateOf(now), 1), 0);
          const start = await pageStartFromChunks(tx, target.page, now);
          pageAdded = await insertNewStudyCard(tx, {
            id: pageCardId(target.page),
            deckId: HIFZ_PAGES_DECK_ID,
            due,
            tier: "sabqi",
            now: now.toISOString(),
            start,
          });
          if (ayahReview) await addSabaqPageToAyahReview(tx, { page: target.page, start, due, now });
        }
      : undefined,
  });
  const secondLookAt = rating >= 3 ? laterToday(firstLookAt(new Date(result.transition.updatedCard.due), now), now) : null;
  return { ...result, pageAdded, secondLookAt };
}

/**
 * Grade a second look (SBQ-03) as a review of its chunk card, through the same save as the fluent
 * check: it is logged, counts toward the wird and its make-up, and moves the chunk to its next step.
 * The chunk is not created again: a chunk deleted since the screen loaded fails with
 * StudyCardDeletedError.
 */
export async function saveSecondLook(
  db: AppDatabase,
  {
    cardId,
    plan,
    rating,
    session,
    durationMs,
    now = new Date(),
  }: { cardId: string; plan: HifzPlan; rating: Grade; session: ReviewSessionRef | null; durationMs: number; now?: Date },
): Promise<ReviewSaveResult> {
  if (parsePageUnit(cardId)?.kind !== "chunk") throw new Error(`Not a sabaq chunk: ${cardId}`);
  return saveChunkGrade(db, { id: cardId, plan, rating, session, durationMs, now, create: false });
}
