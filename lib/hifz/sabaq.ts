import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { insertNewStudyCard, newStudyCardRow, readDeckReviewSettings } from "@/lib/fsrs/queries";
import { persistReviewTransition, readCurrentCard, type ReviewSaveResult } from "@/lib/fsrs/persist-review";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import type { ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import type { Grade } from "@/lib/fsrs/scheduler";
import { addDays, atLocalTime, localDateOf } from "@/lib/habit/dates";
import { loadRecitationPage, type PageLine, type PageWordsLines, type RecitationPage } from "@/lib/hifz/page-data";
import type { HifzPlan } from "@/lib/hifz/plan";
import { pagePolicy } from "@/lib/hifz/tiers";
import {
  chunkCardId,
  HIFZ_PAGES_DECK_ID,
  HIFZ_SABAQ_DECK_ID,
  LINES_PER_PAGE,
  PAGE_COUNT,
  pageCardId,
  pagesOfJuz,
  parsePageUnit,
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
 * SBQ-02: after the fluent check, the chunk becomes a sabaq card with that grade as its first review,
 * and the page joins review (sabqi, due tomorrow) once its last chunk passes. One transaction.
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
): Promise<ReviewSaveResult & { pageAdded: boolean }> {
  const at = now.toISOString();
  const id = chunkCardId(target.page, Math.max(1, target.fromLine), Math.min(LINES_PER_PAGE, target.toLine));
  const base = await readDeckReviewSettings(db, HIFZ_SABAQ_DECK_ID);
  const addsPage = target.completesPage && rating >= 3;
  let pageAdded = false;
  const result = await persistReviewTransition({
    db,
    cardId: id,
    // A chunk that failed its fluent check before is checked again on the same card. A new chunk is
    // created in the grade's own transaction, so a failed save leaves nothing behind; creating it does
    // nothing when the card already exists.
    beforeWork: async (tx) => {
      await insertNewStudyCard(tx, { id, deckId: HIFZ_SABAQ_DECK_ID, due: now, tier: "sabaq", now: at });
    },
    // Read inside the transaction: sync or another save of this chunk may have graded it since the
    // check started, and calculating from an earlier read would overwrite that newer schedule.
    transition: async (tx) => {
      const card =
        (await readCurrentCard(tx, id)) ?? newStudyCardRow({ id, deckId: HIFZ_SABAQ_DECK_ID, due: now, tier: "sabaq", now: at });
      return calculateReviewTransition({ card, rating, reviewedAt: now, reviewPolicy: pagePolicy("sabaq", plan, base) });
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
    extraWork: addsPage
      ? async (tx) => {
          pageAdded = await insertNewStudyCard(tx, {
            id: pageCardId(target.page),
            deckId: HIFZ_PAGES_DECK_ID,
            due: atLocalTime(addDays(localDateOf(now), 1), 0),
            tier: "sabqi",
            now: at,
          });
        }
      : undefined,
  });
  return { ...result, pageAdded };
}
