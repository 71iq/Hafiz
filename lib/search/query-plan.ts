import { normalizeReferenceInput, parseReference, type ReferenceParse } from "@/lib/search/reference";
import { stripSearchDiacritics } from "@/lib/search/highlight";
import type { SurahSearchFields } from "@/lib/search/surah-match";

/** Shortest text or root query Search runs (after removing diacritics). */
export const MIN_SEARCH_CHARS = 2;

export type SearchQueryPlan = {
  /** A reference to offer as a "Go to" row; null for ordinary words. */
  reference: Exclude<ReferenceParse, { kind: "text" }> | null;
  /** Whether the text or root search runs for this query. */
  runSearch: boolean;
  /** A word too short to search, while no reference applies. */
  tooShort: boolean;
};

/**
 * What one Search query means (C06). Numeric references ("2:255", "2", "page 300", "ص ٦٢") and
 * malformed ones only offer Go to; a surah name offers Go to and still searches the text, since the
 * name may also be a word the user is looking for. Ordinary words search as before.
 */
export function planSearchQuery(raw: string, surahs: readonly SurahSearchFields[] = []): SearchQueryPlan {
  const parsed = parseReference(raw, { context: "search", surahs });
  const reference = parsed.kind === "text" ? null : parsed;
  const numeric = /^\d+$/.test(normalizeReferenceInput(raw));
  const runSearch =
    parsed.kind === "text" || ((parsed.kind === "surah" || parsed.kind === "surah-choices") && !numeric);
  const length = stripSearchDiacritics(raw.trim()).length;
  return {
    reference,
    runSearch: runSearch && length >= MIN_SEARCH_CHARS,
    tooShort: !reference && length > 0 && length < MIN_SEARCH_CHARS,
  };
}

/** A single Arabic word without spaces, which a root search could expand. */
export function isSingleArabicWord(raw: string): boolean {
  return /^[\u0621-\u064A\u0671-\u06D3]+$/.test(stripSearchDiacritics(raw.trim()));
}

/** Root letters spaced for reading: "كتب" becomes "ك ت ب". */
export function spacedRoot(root: string): string {
  return Array.from(stripSearchDiacritics(root)).join(" ");
}

/** The distinct roots behind a set of root results, in first-seen order, compared without diacritics. */
export function distinctRoots(rows: readonly { root: string }[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const root = stripSearchDiacritics(row.root);
    if (root) seen.add(root);
  }
  return [...seen];
}
