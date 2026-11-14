import { z } from "zod";

/**
 * STR-01, PLN-06: the minimum wird is the smallest action that keeps the streak. By default, one
 * page of graded recitation or 5 minutes of graded review, whichever comes first.
 */
export type WirdMinimum = Readonly<{ pages: number; minutes: number }>;

export const DEFAULT_WIRD_MINIMUM: WirdMinimum = { pages: 1, minutes: 5 };
export const WIRD_MINIMUM_PAGE_OPTIONS = [0.5, 1, 2, 3] as const;
export const WIRD_MINIMUM_MINUTE_OPTIONS = [3, 5, 10, 15] as const;

const wirdMinimumSchema = z.object({
  pages: z.number().min(0.25).max(20),
  minutes: z.number().int().min(1).max(120),
});

export function parseWirdMinimum(value: string | null | undefined): WirdMinimum {
  if (!value) return DEFAULT_WIRD_MINIMUM;
  try {
    const parsed = wirdMinimumSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : DEFAULT_WIRD_MINIMUM;
  } catch {
    return DEFAULT_WIRD_MINIMUM;
  }
}

/**
 * Recitation is measured in sixtieths of a page so every weight is whole and the sums stay exact:
 * halves, seam quarters, ayah tenths and sabaq chunk lines (fifteenths) all divide 60, so chunks
 * that cover a page add up to exactly one page. An ayah card is about a tenth of a page: the 604
 * Madani pages hold 6,236 ayat.
 */
export const PAGE_UNITS = 60;

/** Lines on a Madani page (lib/hifz/units LINES_PER_PAGE): a sabaq chunk counts by its share of one. */
const LINES_PER_PAGE = 15;
/** One line's weight, 4 sixtieths. */
const LINE_UNITS = PAGE_UNITS / LINES_PER_PAGE;

/** A single review's time counts toward the minutes path up to this cap, so an idle screen cannot. */
const MAX_COUNTED_REVIEW_MS = 10 * 60_000;

export type CardRole = "recitation" | "study";

/**
 * Recitation cards test memorization: pages, half pages, seams, sabaq chunks, ayat and similar
 * verses. Study cards (word meanings, qira'at, reasons of revelation) count only when the user turns
 * on "meanings count toward my wird" (UNIT-02), and then only by time.
 */
function cardRole(cardId: string): CardRole {
  if (cardId.startsWith("word:") || cardId.startsWith("qiraat:") || cardId.startsWith("asbab:")) return "study";
  return "recitation";
}

/**
 * A sabaq chunk's weight, by its lines: its id ends in "from-to" (lib/hifz/units chunkCardId). Four
 * lines are 16 sixtieths, so a short second look (SBQ-03) is not a page of recitation (STR-01).
 * Null for an id that does not end in its lines; it counts as a page, as before.
 */
function chunkUnits(cardId: string): number | null {
  const match = /^(\d+)-(\d+)$/.exec(cardId.slice(cardId.lastIndexOf(":") + 1));
  if (!match) return null;
  const lines = Number(match[2]) - Number(match[1]) + 1;
  return Math.max(1, Math.min(PAGE_UNITS, lines * LINE_UNITS));
}

export function recitationUnits(cardId: string): number {
  if (cardRole(cardId) === "study") return 0;
  if (cardId.startsWith("chunk:")) return chunkUnits(cardId) ?? PAGE_UNITS;
  if (cardId.startsWith("page:")) return PAGE_UNITS;
  if (cardId.startsWith("half:")) return PAGE_UNITS / 2;
  if (cardId.startsWith("seam:")) return PAGE_UNITS / 4;
  return PAGE_UNITS / 10;
}

/**
 * `sabaqStep`: the review is a sabaq chunk's completed step 6 (SBQ-02): a passing review of the chunk
 * card with no review before it, or right after a failed one. That is the pass that memorized the
 * chunk, the first time or again after a failed fluent check or look, the same rule by which
 * nextSabaqTarget counts a chunk as memorized. STR-01 counts it as a wird day on its own, however
 * short the chunk. A pass after a pass (the fluent check, a second look) adds no step of its own.
 */
export type ReviewContribution = Readonly<{ cardId: string; durationMs: number | null; sabaqStep?: boolean }>;

/**
 * Which of one chunk card's reviews, sorted by instant, are completed steps 6 (see ReviewContribution),
 * as DAY_TALLY_SQL reads them: a pass with no earlier review, or whose latest earlier review failed.
 * Reviews at the same earlier instant count as passed if any of them passed.
 */
export function sabaqStepFlags(reviews: readonly { at: number; rating: number }[]): boolean[] {
  // The best rating at the latest instant before the current one, or null before the first review.
  let priorBest: number | null = null;
  let groupAt = Number.NaN;
  let groupBest = 0;
  return reviews.map((review) => {
    if (review.at !== groupAt) {
      if (!Number.isNaN(groupAt)) priorBest = groupBest;
      groupAt = review.at;
      groupBest = review.rating;
    } else {
      groupBest = Math.max(groupBest, review.rating);
    }
    return review.rating >= 3 && (priorBest === null || priorBest < 3);
  });
}
export type WirdTally = Readonly<{ pageUnits: number; countedMs: number; sabaqStep: boolean }>;

export function tallyReviews(
  reviews: readonly ReviewContribution[],
  options: { studyCounts: boolean },
): WirdTally {
  let pageUnits = 0;
  let countedMs = 0;
  let sabaqStep = false;
  for (const review of reviews) {
    if (review.sabaqStep) sabaqStep = true;
    const role = cardRole(review.cardId);
    if (role === "study" && !options.studyCounts) continue;
    pageUnits += recitationUnits(review.cardId);
    const duration = review.durationMs ?? 0;
    if (Number.isFinite(duration) && duration > 0) countedMs += Math.min(duration, MAX_COUNTED_REVIEW_MS);
  }
  return { pageUnits, countedMs, sabaqStep };
}

/** STR-01: a page of graded recitation, the minutes of graded review, or a completed sabaq step 6. */
export function meetsMinimum(tally: WirdTally, minimum: WirdMinimum): boolean {
  return (
    tally.sabaqStep ||
    tally.pageUnits >= Math.round(minimum.pages * PAGE_UNITS) ||
    tally.countedMs >= minimum.minutes * 60_000
  );
}

/** Progress toward the minimum as a fraction from 0 to 1, by whichever path is further along. */
export function minimumProgress(tally: WirdTally, minimum: WirdMinimum): number {
  if (tally.sabaqStep) return 1;
  const byPages = tally.pageUnits / Math.max(1, Math.round(minimum.pages * PAGE_UNITS));
  const byMinutes = tally.countedMs / Math.max(1, minimum.minutes * 60_000);
  return Math.min(1, Math.max(byPages, byMinutes));
}

const STUDY_SQL = "(card_id LIKE 'word:%' OR card_id LIKE 'qiraat:%' OR card_id LIKE 'asbab:%')";

// chunkUnits in SQL. lines_seg is the id after its last ':' (the right trim stops at the last ':').
// It is "from-to" when it is digits, one '-', digits.
const LINES_SEG_SQL = "replace(card_id, rtrim(card_id, replace(card_id, ':', '')), '')";
const CHUNK_LINES_OK_SQL =
  "(lines_seg GLOB '[0-9]*-[0-9]*' AND NOT lines_seg GLOB '*[^-0-9]*' AND length(lines_seg) - length(replace(lines_seg, '-', '')) = 1)";
const CHUNK_UNITS_SQL = `MAX(1, MIN(${PAGE_UNITS}, (CAST(substr(lines_seg, instr(lines_seg, '-') + 1) AS INTEGER) - CAST(substr(lines_seg, 1, instr(lines_seg, '-') - 1) AS INTEGER) + 1) * ${LINE_UNITS}))`;

const TALLY_SELECT = `SELECT
  COALESCE(SUM(CASE
    WHEN ${STUDY_SQL} THEN 0
    WHEN card_id LIKE 'chunk:%' AND ${CHUNK_LINES_OK_SQL} THEN ${CHUNK_UNITS_SQL}
    WHEN card_id LIKE 'page:%' OR card_id LIKE 'chunk:%' THEN ${PAGE_UNITS}
    WHEN card_id LIKE 'half:%' THEN ${PAGE_UNITS / 2}
    WHEN card_id LIKE 'seam:%' THEN ${PAGE_UNITS / 4}
    ELSE ${PAGE_UNITS / 10} END), 0) AS page_units,
  COALESCE(SUM(CASE
    WHEN ${STUDY_SQL} AND ? = 0 THEN 0
    ELSE MIN(MAX(COALESCE(duration_ms, 0), 0), ${MAX_COUNTED_REVIEW_MS}) END), 0) AS counted_ms,
  COALESCE(MAX(CASE
    WHEN card_id LIKE 'chunk:%' AND rating >= 3 AND COALESCE((
      SELECT prior.rating FROM study_log AS prior
      WHERE prior.card_id = tallied.card_id AND julianday(prior.reviewed_at) < julianday(tallied.reviewed_at)
      ORDER BY julianday(prior.reviewed_at) DESC, prior.rating DESC LIMIT 1
    ), 0) < 3 THEN 1 ELSE 0 END), 0) AS sabaq_step
  FROM (SELECT card_id, rating, reviewed_at, duration_ms, local_date, makeup_for, ${LINES_SEG_SQL} AS lines_seg FROM study_log) AS tallied`;

/**
 * The same tally as tallyReviews, computed by SQLite, so a grade does not load the day's rows. Keep
 * the weights in step with recitationUnits; a test compares the two.
 * - DAY_TALLY_SQL: a day's own reviews, without those graded toward a make-up. Bind
 *   [studyCounts (0 or 1), localDate].
 * - MAKEUP_TALLY_SQL: the reviews graded toward making up a missed day (STR-08). Bind
 *   [studyCounts (0 or 1), missedDay].
 */
export const DAY_TALLY_SQL = `${TALLY_SELECT} WHERE local_date = ? AND makeup_for IS NULL`;
export const MAKEUP_TALLY_SQL = `${TALLY_SELECT} WHERE makeup_for = ?`;
