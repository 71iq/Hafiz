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
 * Recitation is measured in twentieths of a page so the sums stay exact. An ayah card is about a
 * tenth of a page: the 604 Madani pages hold 6,236 ayat.
 */
export const PAGE_UNITS = 20;

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

export function recitationUnits(cardId: string): number {
  if (cardRole(cardId) === "study") return 0;
  if (cardId.startsWith("page:") || cardId.startsWith("chunk:")) return PAGE_UNITS;
  if (cardId.startsWith("half:")) return PAGE_UNITS / 2;
  if (cardId.startsWith("seam:")) return PAGE_UNITS / 4;
  return PAGE_UNITS / 10;
}

export type ReviewContribution = Readonly<{ cardId: string; durationMs: number | null }>;
export type WirdTally = Readonly<{ pageUnits: number; countedMs: number }>;

export function tallyReviews(
  reviews: readonly ReviewContribution[],
  options: { studyCounts: boolean },
): WirdTally {
  let pageUnits = 0;
  let countedMs = 0;
  for (const review of reviews) {
    const role = cardRole(review.cardId);
    if (role === "study" && !options.studyCounts) continue;
    pageUnits += recitationUnits(review.cardId);
    const duration = review.durationMs ?? 0;
    if (Number.isFinite(duration) && duration > 0) countedMs += Math.min(duration, MAX_COUNTED_REVIEW_MS);
  }
  return { pageUnits, countedMs };
}

export function meetsMinimum(tally: WirdTally, minimum: WirdMinimum): boolean {
  return (
    tally.pageUnits >= Math.round(minimum.pages * PAGE_UNITS) || tally.countedMs >= minimum.minutes * 60_000
  );
}

/** Progress toward the minimum as a fraction from 0 to 1, by whichever path is further along. */
export function minimumProgress(tally: WirdTally, minimum: WirdMinimum): number {
  const byPages = tally.pageUnits / Math.max(1, Math.round(minimum.pages * PAGE_UNITS));
  const byMinutes = tally.countedMs / Math.max(1, minimum.minutes * 60_000);
  return Math.min(1, Math.max(byPages, byMinutes));
}

const STUDY_SQL = "(card_id LIKE 'word:%' OR card_id LIKE 'qiraat:%' OR card_id LIKE 'asbab:%')";

/**
 * The same tally as tallyReviews, computed by SQLite over one day's review log, so a grade does not
 * load the day's rows. Bind [studyCounts (0 or 1), localDate]. Keep the weights in step with
 * recitationUnits; a test compares the two.
 */
export const DAY_TALLY_SQL = `SELECT
  COALESCE(SUM(CASE
    WHEN ${STUDY_SQL} THEN 0
    WHEN card_id LIKE 'page:%' OR card_id LIKE 'chunk:%' THEN ${PAGE_UNITS}
    WHEN card_id LIKE 'half:%' THEN ${PAGE_UNITS / 2}
    WHEN card_id LIKE 'seam:%' THEN ${PAGE_UNITS / 4}
    ELSE ${PAGE_UNITS / 10} END), 0) AS page_units,
  COALESCE(SUM(CASE
    WHEN ${STUDY_SQL} AND ? = 0 THEN 0
    ELSE MIN(MAX(COALESCE(duration_ms, 0), 0), ${MAX_COUNTED_REVIEW_MS}) END), 0) AS counted_ms
  FROM study_log WHERE local_date = ?`;
