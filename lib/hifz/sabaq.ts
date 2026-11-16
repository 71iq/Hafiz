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
  ayahs: readonly { surah: number; ayah: number }[];
  linkAyahs: readonly { surah: number; ayah: number }[];
  completesPage: boolean;
  assigned: boolean;
}>;

export type AssignedSabaq = Readonly<{ page: number; fromLine: number; toLine: number }>;

function ayahLines(page: RecitationPage): PageLine[] {
  return page.lines.filter((line) => line.kind === "ayah" && line.tokens.length > 0);
}

function endsAyah(line: PageLine): boolean {
  return line.tokens[line.tokens.length - 1]?.isMarker ?? false;
}

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
    [HIFZ_SABAQ_DECK_ID, prefix, `${prefix.slice(0, -1)}${String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)}`],
  );
  return rows.flatMap((row) => {
    const unit = parsePageUnit(row.id);
    return unit?.kind === "chunk" ? [unit] : [];
  });
}

function coveredBy(chunks: readonly Extract<PageUnit, { kind: "chunk" }>[], lineNumber: number): boolean {
  return chunks.some((chunk) => lineNumber >= chunk.fromLine && lineNumber <= chunk.toLine);
}

async function readMemorizedPages(db: DatabaseExecutor): Promise<Set<number>> {
  const pageRows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM study_cards WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL",
    [HIFZ_PAGES_DECK_ID],
  );
  return new Set(pageRows.flatMap((row) => {
    const unit = parsePageUnit(row.id);
    return unit?.kind === "page" ? [unit.page] : [];
  }));
}

export async function nextSabaqTarget(
  db: DatabaseExecutor,
  {
    plan,
    wantLines,
    pageWords,
    assigned = null,
  }: {
    plan: HifzPlan;
    wantLines: number;
    pageWords: (page: number) => PageWordsLines | null;
    assigned?: AssignedSabaq | null;
  },
): Promise<SabaqTarget | null> {
  const memorized = await readMemorizedPages(db);
  if (assigned && !memorized.has(assigned.page)) {
    const target = await chunkTarget(db, { page: assigned.page, wantLines, pageWords, range: assigned });
    if (target) return target;
  }
  const page = newPageOrder(plan).find((candidate) => !memorized.has(candidate));
  if (page === undefined) return null;
  return chunkTarget(db, { page, wantLines, pageWords, range: null });
}

export async function assignedSabaqOpen(
  db: DatabaseExecutor,
  assigned: AssignedSabaq,
  pageWords: PageWordsLines | null = null,
): Promise<boolean> {
  if ((await readMemorizedPages(db)).has(assigned.page)) return false;
  const done = await readDoneChunks(db, chunkCardPrefix(assigned.page));
  const lines = ayahLines(await loadRecitationPage(db, assigned.page, pageWords));
  return lines.some((line) => inRange(assigned, line) && !coveredBy(done, line.lineNumber));
}

function inRange(range: AssignedSabaq | null, line: PageLine): boolean {
  return range === null || (line.lineNumber >= range.fromLine && line.lineNumber <= range.toLine);
}

async function chunkTarget(
  db: DatabaseExecutor,
  {
    page,
    wantLines,
    pageWords,
    range,
  }: { page: number; wantLines: number; pageWords: (page: number) => PageWordsLines | null; range: AssignedSabaq | null },
): Promise<SabaqTarget | null> {
  const done = await readDoneChunks(db, chunkCardPrefix(page));
  const covered = (line: PageLine) => coveredBy(done, line.lineNumber);
  const pageData = await loadRecitationPage(db, page, pageWords(page));
  const lines = ayahLines(pageData);
  const start = lines.findIndex((line) => inRange(range, line) && !covered(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && (covered(line) || !inRange(range, line)));
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
    assigned: range !== null,
  };
}

export type SecondLook = Readonly<{
  cardId: string;
  page: number;
  fromLine: number;
  toLine: number;
  pageData: RecitationPage;
  lineNumbers: ReadonlySet<number>;
}>;

export type SecondLooks = Readonly<{
  due: readonly SecondLook[];
  nextAt: Date | null;
}>;

function laterToday(due: Date, now: Date): Date | null {
  return due.getTime() - REVIEW_LEARN_AHEAD_MS > now.getTime() && localDateOf(due) === localDateOf(now) ? due : null;
}

type TodaysChunk = Readonly<{ id: string; due: string; lessonEndAt: number; lastReviewAt: number }>;

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

const SECOND_LOOK_AFTER_MS = 60 * 60_000;

function firstLookAt(due: Date, lessonEnd: Date): Date {
  const latest = lessonEnd.getTime() + SECOND_LOOK_AFTER_MS;
  return due.getTime() < latest ? due : new Date(latest);
}

function lookAt(chunk: TodaysChunk): Date {
  const due = new Date(chunk.due);
  return chunk.lastReviewAt > chunk.lessonEndAt ? due : firstLookAt(due, new Date(chunk.lessonEndAt));
}

type DueChunk = { id: string; unit: Extract<PageUnit, { kind: "chunk" }>; at: number };

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
    completedOn?: LocalDate;
  },
): Promise<boolean> {
  if (pageLines.length === 0) return false;
  const live = await tx.getFirstAsync<{ found: number }>("SELECT 1 AS found FROM study_cards WHERE id = ? AND deleted_at IS NULL", [pageCardId(page)]);
  if (live) return false;
  const done = await readDoneChunks(tx, chunkCardPrefix(page));
  if (!pageLines.every((lineNumber) => coveredBy(done, lineNumber))) return false;
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

export async function addCoveredSabaqPages(
  db: AppDatabase,
  { plan, pageWords }: { plan: HifzPlan; pageWords: (page: number) => PageWordsLines | null },
): Promise<number> {
  const order = newPageOrder(plan);
  let added = 0;
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

export async function completeSabaqChunk(
  db: AppDatabase,
  { target, plan, rating, session, durationMs, now = new Date() }: ChunkSaveInput & { rating: Grade },
): Promise<ReviewSaveResult & { pageAdded: boolean; secondLookAt: Date | null; secondLookNow: boolean }> {
  const id = targetCardId(target);
  const missing = (await readCurrentCard(db, id)) === null;
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
  let look: Date | null = null;
  try {
    const learned = (await readTodaysChunks(db, localDateOf(now), now)).find((chunk) => chunk.id === id);
    look = learned ? lookAt(learned) : null;
  } catch (lookError) {
    console.warn("[Sabaq] Could not read the second look after the check:", lookError);
  }
  const secondLookAt = look ? laterToday(look, now) : null;
  const secondLookNow = look !== null && look.getTime() <= now.getTime() + REVIEW_LEARN_AHEAD_MS;
  return { ...result, secondLookAt, secondLookNow };
}

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
