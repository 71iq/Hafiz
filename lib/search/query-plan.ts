import { normalizeReferenceInput, parseReference, type ReferenceParse } from "@/lib/search/reference";
import { stripSearchDiacritics } from "@/lib/search/highlight";
import type { SurahSearchFields } from "@/lib/search/surah-match";

export const MIN_SEARCH_CHARS = 2;

export type SearchQueryPlan = {
  reference: Exclude<ReferenceParse, { kind: "text" }> | null;
  runSearch: boolean;
  tooShort: boolean;
};

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

export function isSingleArabicWord(raw: string): boolean {
  return /^[\u0621-\u064A\u0671-\u06D3]+$/.test(stripSearchDiacritics(raw.trim()));
}

export function spacedRoot(root: string): string {
  return Array.from(stripSearchDiacritics(root)).join(" ");
}

export function distinctRoots(rows: readonly { root: string }[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const root = stripSearchDiacritics(row.root);
    if (root) seen.add(root);
  }
  return [...seen];
}
