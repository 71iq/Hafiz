import type { DatabaseExecutor } from "@/lib/database/types";
import { insertNewStudyCard, putCardRow, readDeckReviewSettings } from "@/lib/fsrs/queries";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { Rating, type Grade } from "@/lib/fsrs/scheduler";
import type { DeckReviewSettings, SchedulerStep, StudyCardRow } from "@/lib/fsrs/types";
import type { PageToken, RecitationPage } from "@/lib/hifz/page-data";
import { HIFZ_PAGES_DECK_ID, halfCardId, isValidPage, parsePageUnit, seamCardId } from "@/lib/hifz/units";

export type Half = "a" | "b";

/** The units a page review can call up on their own: half pages (SCH-08) and seams (SCH-06). */
export type RemediationUnit =
  | { kind: "half"; row: StudyCardRow; page: number; half: Half }
  | { kind: "seam"; row: StudyCardRow; page: number };

/** Ten minutes, then the next day, then FSRS (SCH-08). Seams relearn the same way. */
const REMEDIATION_STEPS: SchedulerStep[] = ["10m", "1d"];

export function remediationPolicy(base: DeckReviewSettings): DeckReviewSettings {
  return { ...base, learningSteps: REMEDIATION_STEPS, relearningSteps: REMEDIATION_STEPS };
}

/** A page's lines in reading order, split in two; the first half takes the extra line of an odd count. */
export function halfLineNumbers(page: RecitationPage, half: Half): Set<number> {
  const numbers = page.lines.map((line) => line.lineNumber).sort((a, b) => a - b);
  const split = Math.ceil(numbers.length / 2);
  return new Set(half === "a" ? numbers.slice(0, split) : numbers.slice(split));
}

function lineOf(page: RecitationPage, token: PageToken): number | null {
  for (const line of page.lines) {
    if (line.tokens.includes(token)) return line.lineNumber;
  }
  for (const line of page.lines) {
    if (line.tokens.some((t) => t.surah === token.surah && t.ayah === token.ayah && t.wordPos === token.wordPos)) {
      return line.lineNumber;
    }
  }
  return null;
}

/**
 * SCH-08: the half of the page that holds every error of an attempt, or null when there are none or
 * they fall in both halves. A page with errors everywhere is the page's problem, not a half's.
 */
export function errorHalf(page: RecitationPage, errorTokens: readonly PageToken[]): Half | null {
  if (errorTokens.length === 0) return null;
  const first = halfLineNumbers(page, "a");
  let half: Half | null = null;
  for (const token of errorTokens) {
    const line = lineOf(page, token);
    if (line === null) return null;
    const side: Half = first.has(line) ? "a" : "b";
    if (half !== null && half !== side) return null;
    half = side;
  }
  return half;
}

async function readCard(db: DatabaseExecutor, id: string): Promise<StudyCardRow | null> {
  return db.getFirstAsync<StudyCardRow>("SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NULL", [id]);
}

/**
 * Apply a rating to a half-page or seam card that the page review already showed, without a review
 * log row: the recitation was logged once, as the page, and counts toward the wird once. Creates the
 * card on first use. Runs inside the page's grade transaction.
 */
async function rateDerivedUnit(db: DatabaseExecutor, id: string, rating: Grade, now: Date): Promise<StudyCardRow> {
  const at = now.toISOString();
  let card = await readCard(db, id);
  if (!card) {
    await insertNewStudyCard(db, { id, deckId: HIFZ_PAGES_DECK_ID, due: now, now: at });
    card = await readCard(db, id);
    if (!card) throw new Error(`Could not create ${id}`);
  }
  const base = remediationPolicy(await readDeckReviewSettings(db, HIFZ_PAGES_DECK_ID));
  // A clean seam needs no learning steps, so a seam that never lapsed never surfaces on its own.
  const policy = rating === Rating.Again ? base : { ...base, learningSteps: [] };
  const { updatedCard } = calculateReviewTransition({ card, rating, reviewedAt: now, reviewPolicy: policy });
  await putCardRow(db, updatedCard);
  return updatedCard;
}

/** SCH-08: the half failed with the page, so it relearns: due in 10 minutes, then the next day. */
export async function remediateHalf(db: DatabaseExecutor, { page, half, now }: { page: number; half: Half; now: Date }): Promise<StudyCardRow> {
  return rateDerivedUnit(db, halfCardId(page, half), Rating.Again, now);
}

/**
 * SCH-06: reciting into the next page reviews the seam. A clean transition after a Good or Easy page
 * is a Good review; a stumble is a lapse whatever the page's grade, so the seam surfaces on its own.
 */
export async function reviewSeam(db: DatabaseExecutor, { page, clean, now }: { page: number; clean: boolean; now: Date }): Promise<StudyCardRow> {
  return rateDerivedUnit(db, seamCardId(page), clean ? Rating.Good : Rating.Again, now);
}

/** The seam after page n leads into page n+1, so the last page has none. */
export function hasSeamAfter(page: number): boolean {
  return isValidPage(page) && isValidPage(page + 1);
}

/**
 * Half pages and seams surface on their own only while they work through their steps (10 minutes,
 * then the next day) and are due. FSRS marks the next-day step as a review card that is still on a
 * step, so both conditions count. Once they graduate, the page's own reviews cover them (SCH-06, SCH-08).
 */
export async function loadDueRemediation(db: DatabaseExecutor, now: Date): Promise<RemediationUnit[]> {
  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards
     WHERE deck_id = ? AND (id LIKE 'half:%' OR id LIKE 'seam:%') AND (state IN (1, 3) OR learning_steps > 0) AND due <= ?
       AND deleted_at IS NULL AND suspended_at IS NULL
     ORDER BY due, id`,
    [HIFZ_PAGES_DECK_ID, now.toISOString()],
  );
  const units: RemediationUnit[] = [];
  for (const row of rows) {
    const unit = parsePageUnit(row.id);
    if (unit?.kind === "half") units.push({ kind: "half", row, page: unit.page, half: unit.half });
    else if (unit?.kind === "seam" && hasSeamAfter(unit.page)) units.push({ kind: "seam", row, page: unit.page });
  }
  return units;
}

export async function countDueRemediation(db: DatabaseExecutor, now: Date): Promise<number> {
  return (await loadDueRemediation(db, now)).length;
}
