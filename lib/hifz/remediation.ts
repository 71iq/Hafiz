import type { DatabaseExecutor } from "@/lib/database/types";
import { insertNewStudyCard, putCardRow, readDeckReviewSettings } from "@/lib/fsrs/queries";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { Rating, State, type Grade } from "@/lib/fsrs/scheduler";
import type { DeckReviewSettings, SchedulerStep, StudyCardRow } from "@/lib/fsrs/types";
import type { PageToken, RecitationPage } from "@/lib/hifz/page-data";
import { HIFZ_PAGES_DECK_ID, halfCardId, isValidPage, parsePageUnit, seamCardId } from "@/lib/hifz/units";
import { parseClozeCardId } from "@/lib/hifz/weak-spots";

export type Half = "a" | "b";

export type RemediationUnit =
  | { kind: "half"; row: StudyCardRow; page: number; half: Half }
  | { kind: "seam"; row: StudyCardRow; page: number }
  | { kind: "cloze"; row: StudyCardRow; surah: number; ayah: number; word: number };

const REMEDIATION_STEPS: SchedulerStep[] = ["10m", "1d"];

export function remediationPolicy(base: DeckReviewSettings): DeckReviewSettings {
  return { ...base, learningSteps: REMEDIATION_STEPS, relearningSteps: REMEDIATION_STEPS };
}

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

async function rateDerivedUnit(db: DatabaseExecutor, id: string, rating: Grade, now: Date): Promise<StudyCardRow> {
  const at = now.toISOString();
  let card = await readCard(db, id);
  if (!card) {
    await insertNewStudyCard(db, { id, deckId: HIFZ_PAGES_DECK_ID, due: now, now: at });
    card = await readCard(db, id);
    if (!card) throw new Error(`Could not create ${id}`);
  }
  const base = remediationPolicy(await readDeckReviewSettings(db, HIFZ_PAGES_DECK_ID));
  const policy = rating !== Rating.Again && card.state === State.New ? { ...base, learningSteps: [] } : base;
  const { updatedCard } = calculateReviewTransition({ card, rating, reviewedAt: now, reviewPolicy: policy });
  await putCardRow(db, updatedCard);
  return updatedCard;
}

export async function remediateHalf(db: DatabaseExecutor, { page, half, now }: { page: number; half: Half; now: Date }): Promise<StudyCardRow> {
  return rateDerivedUnit(db, halfCardId(page, half), Rating.Again, now);
}

export async function reviewSeam(db: DatabaseExecutor, { page, clean, now }: { page: number; clean: boolean; now: Date }): Promise<StudyCardRow> {
  return rateDerivedUnit(db, seamCardId(page), clean ? Rating.Good : Rating.Again, now);
}

export function hasSeamAfter(page: number): boolean {
  return isValidPage(page) && isValidPage(page + 1);
}

export async function loadDueRemediation(db: DatabaseExecutor, now: Date): Promise<RemediationUnit[]> {
  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards
     WHERE deck_id = ? AND due <= ?
       AND (((id LIKE 'half:%' OR id LIKE 'seam:%') AND (state IN (1, 3) OR learning_steps > 0)) OR id LIKE 'cloze:%')
       AND deleted_at IS NULL AND suspended_at IS NULL
     ORDER BY due, id`,
    [HIFZ_PAGES_DECK_ID, now.toISOString()],
  );
  const units: RemediationUnit[] = [];
  for (const row of rows) {
    const cloze = parseClozeCardId(row.id);
    if (cloze) {
      units.push({ kind: "cloze", row, ...cloze });
      continue;
    }
    const unit = parsePageUnit(row.id);
    if (unit?.kind === "half") units.push({ kind: "half", row, page: unit.page, half: unit.half });
    else if (unit?.kind === "seam" && hasSeamAfter(unit.page)) units.push({ kind: "seam", row, page: unit.page });
  }
  return units;
}

export async function countDueRemediation(db: DatabaseExecutor, now: Date): Promise<number> {
  return (await loadDueRemediation(db, now)).length;
}

export async function nextRemediationAt(db: DatabaseExecutor, now: Date): Promise<Date | null> {
  const row = await db.getFirstAsync<{ due: string }>(
    `SELECT due FROM study_cards
     WHERE deck_id = ? AND due > ?
       AND (((id LIKE 'half:%' OR id LIKE 'seam:%') AND (state IN (1, 3) OR learning_steps > 0)) OR id LIKE 'cloze:%')
       AND deleted_at IS NULL AND suspended_at IS NULL
     ORDER BY due LIMIT 1`,
    [HIFZ_PAGES_DECK_ID, now.toISOString()],
  );
  const at = row ? new Date(row.due) : null;
  return at && Number.isFinite(at.getTime()) ? at : null;
}
