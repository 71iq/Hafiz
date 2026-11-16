import { exactSurahAliasMatches, type SurahSearchFields } from "@/lib/search/surah-match";


export const SURAH_AYAH_COUNTS: readonly number[] = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77,
  227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55,
  78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36,
  25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
];
export const SURAH_COUNT = 114;
export const MUSHAF_PAGE_COUNT = 604;

export type InvalidReferenceReason = "surah-range" | "ayah-range" | "page-range" | "malformed";

export type ReferenceParse =
  | { kind: "ayah"; surah: number; ayah: number }
  | { kind: "surah"; surah: number }
  | { kind: "page"; page: number }
  | { kind: "surah-choices"; surahs: number[] }
  | { kind: "text"; text: string }
  | { kind: "invalid"; reason: InvalidReferenceReason };

export type ReferenceContext = "search" | "page" | "goto";

const DIGIT_MAP: Record<string, string> = {};
"٠١٢٣٤٥٦٧٨٩".split("").forEach((digit, index) => {
  DIGIT_MAP[digit] = String(index);
});
"۰۱۲۳۴۵۶۷۸۹".split("").forEach((digit, index) => {
  DIGIT_MAP[digit] = String(index);
});

export function normalizeReferenceInput(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (digit) => DIGIT_MAP[digit] ?? digit).trim();
}

function toInteger(token: string): number | null {
  if (!/^\d+$/.test(token)) return null;
  const value = Number(token);
  return Number.isSafeInteger(value) ? value : null;
}

export function isValidSurah(surah: number): boolean {
  return Number.isInteger(surah) && surah >= 1 && surah <= SURAH_COUNT;
}

export function isValidAyah(surah: number, ayah: number): boolean {
  return isValidSurah(surah) && Number.isInteger(ayah) && ayah >= 1 && ayah <= SURAH_AYAH_COUNTS[surah - 1];
}

export function isValidPage(page: number): boolean {
  return Number.isInteger(page) && page >= 1 && page <= MUSHAF_PAGE_COUNT;
}

function surahResult(value: number): ReferenceParse {
  return isValidSurah(value) ? { kind: "surah", surah: value } : { kind: "invalid", reason: "surah-range" };
}

function pageResult(value: number): ReferenceParse {
  return isValidPage(value) ? { kind: "page", page: value } : { kind: "invalid", reason: "page-range" };
}

function ayahResult(surah: number, ayah: number): ReferenceParse {
  if (!isValidSurah(surah)) return { kind: "invalid", reason: "surah-range" };
  if (!isValidAyah(surah, ayah)) return { kind: "invalid", reason: "ayah-range" };
  return { kind: "ayah", surah, ayah };
}

const PAGE_PREFIX = /^(?:page|p|صفحة|ص)\s*(.*)$/iu;
const REFERENCE_ATTEMPT = /^[+\-]?[\d٫.,:،/]/;

export function parseReference(
  input: string,
  options: { context?: ReferenceContext; surahs?: readonly SurahSearchFields[] } = {},
): ReferenceParse {
  const context = options.context ?? "search";
  const value = normalizeReferenceInput(input);
  if (!value) return { kind: "text", text: "" };

  const ayahMatch = /^(\d+):(\d+)$/.exec(value);
  if (ayahMatch) {
    const surah = toInteger(ayahMatch[1]);
    const ayah = toInteger(ayahMatch[2]);
    if (surah === null || ayah === null) return { kind: "invalid", reason: "malformed" };
    return ayahResult(surah, ayah);
  }

  const bare = toInteger(value);
  if (bare !== null) return context === "page" ? pageResult(bare) : surahResult(bare);

  const pageMatch = PAGE_PREFIX.exec(value);
  if (pageMatch) {
    const rest = pageMatch[1];
    const page = toInteger(rest);
    if (page !== null) return pageResult(page);
    if (rest === "" ? false : REFERENCE_ATTEMPT.test(rest)) return { kind: "invalid", reason: "malformed" };
  }

  if (REFERENCE_ATTEMPT.test(value)) return { kind: "invalid", reason: "malformed" };

  if (options.surahs?.length) {
    const matches = exactSurahAliasMatches(options.surahs, value);
    if (matches.length === 1) return { kind: "surah", surah: matches[0] };
    if (matches.length > 1) return { kind: "surah-choices", surahs: matches };
  }

  return { kind: "text", text: value };
}

export function parseAyahLinkParams(params: {
  surah?: string | string[] | null;
  ayah?: string | string[] | null;
  word?: string | string[] | null;
}):
  | { kind: "ayah"; surah: number; ayah: number; wordPos?: number }
  | { kind: "invalid"; reason: InvalidReferenceReason } {
  const single = (raw: string | string[] | null | undefined) => (Array.isArray(raw) ? null : (raw ?? null));
  const surahRaw = single(params.surah);
  const ayahRaw = single(params.ayah);
  if (surahRaw === null || ayahRaw === null) return { kind: "invalid", reason: "malformed" };
  const surah = toInteger(normalizeReferenceInput(surahRaw));
  const ayah = toInteger(normalizeReferenceInput(ayahRaw));
  if (surah === null || ayah === null) return { kind: "invalid", reason: "malformed" };
  const result = ayahResult(surah, ayah);
  if (result.kind !== "ayah") return result as { kind: "invalid"; reason: InvalidReferenceReason };
  const wordRaw = single(params.word);
  if (wordRaw === null || wordRaw === "") return { kind: "ayah", surah, ayah };
  const wordPos = toInteger(normalizeReferenceInput(wordRaw));
  if (wordPos === null || wordPos < 1) return { kind: "invalid", reason: "malformed" };
  return { kind: "ayah", surah, ayah, wordPos };
}
