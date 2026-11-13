/**
 * Review units (spec 3.1). Locations are stored canonically as surah:ayah[:word]; pages are a lookup
 * in the current page source, the 604-page QCF2 Madani layout (UNIT-01).
 */
const PAGE_LAYOUT = "madani15";
export const PAGE_COUNT = 604;
export const LINES_PER_PAGE = 15;

/** The page deck holds page, half-page and seam cards for memorized pages (3.4). */
export const HIFZ_PAGES_DECK_ID = "hifz-pages";
/** The sabaq deck holds today's new memorization chunks. */
export const HIFZ_SABAQ_DECK_ID = "hifz-sabaq";

export type PageUnit =
  | { kind: "page"; page: number }
  | { kind: "half"; page: number; half: "a" | "b" }
  | { kind: "seam"; page: number }
  | { kind: "chunk"; page: number; fromLine: number; toLine: number };

export function isValidPage(page: number): boolean {
  return Number.isInteger(page) && page >= 1 && page <= PAGE_COUNT;
}

export function pageCardId(page: number): string {
  return `page:${PAGE_LAYOUT}:${page}`;
}

export function halfCardId(page: number, half: "a" | "b"): string {
  return `half:${PAGE_LAYOUT}:${page}:${half}`;
}

export function seamCardId(page: number): string {
  return `seam:${PAGE_LAYOUT}:${page}`;
}

export function chunkCardId(page: number, fromLine: number, toLine: number): string {
  return `chunk:${PAGE_LAYOUT}:${page}:${fromLine}-${toLine}`;
}

export function parsePageUnit(cardId: string): PageUnit | null {
  const parts = cardId.split(":");
  if (parts.length < 3 || parts[1] !== PAGE_LAYOUT) return null;
  const page = Number(parts[2]);
  if (!isValidPage(page)) return null;
  switch (parts[0]) {
    case "page":
      return parts.length === 3 ? { kind: "page", page } : null;
    case "seam":
      return parts.length === 3 ? { kind: "seam", page } : null;
    case "half":
      return parts.length === 4 && (parts[3] === "a" || parts[3] === "b") ? { kind: "half", page, half: parts[3] } : null;
    case "chunk": {
      const match = parts.length === 4 ? /^(\d+)-(\d+)$/.exec(parts[3]) : null;
      if (!match) return null;
      const fromLine = Number(match[1]);
      const toLine = Number(match[2]);
      if (fromLine < 1 || toLine > LINES_PER_PAGE || fromLine > toLine) return null;
      return { kind: "chunk", page, fromLine, toLine };
    }
    default:
      return null;
  }
}

/** UNIT-03 aggregate views: Madani 15-line juz boundaries by page, juz 1 has 21 pages, juz 30 has 23. */
export function juzOfPage(page: number): number {
  if (page <= 21) return 1;
  if (page >= 582) return 30;
  return Math.min(29, Math.floor((page - 22) / 20) + 2);
}

export function pagesOfJuz(juz: number): number[] {
  const first = juz === 1 ? 1 : juz === 30 ? 582 : 22 + (juz - 2) * 20;
  const last = juz === 1 ? 21 : juz === 30 ? PAGE_COUNT : first + 19;
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
