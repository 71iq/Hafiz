import { toArabicNumber } from "@/lib/arabic";
import { normalizeDateDigits } from "@/lib/date";
import { formatAyahs, formatNumber, formatSurahs } from "@/lib/i18n/count";

type Language = "en" | "ar";

export type ScopeSurah = { number: number; name_arabic: string; name_english: string; ayah_count: number };
export type ScopeRange = { surah: number; ayahStart: number; ayahEnd: number };
export type JuzMapRow = { juz: number; surah: number; ayah_start: number; ayah_end: number };
export type RangeText = { from: string; to: string };

export type RangeTextResult =
  | { ok: true; ayahStart: number; ayahEnd: number }
  | { ok: false; reason: "invalid" | "order" };

/** A typed ayah range for one surah: whole numbers inside the surah, start not after end. */
export function validateRangeText(range: RangeText, ayahCount: number): RangeTextResult {
  const from = normalizeDateDigits(range.from.trim());
  const to = normalizeDateDigits(range.to.trim());
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) return { ok: false, reason: "invalid" };
  const ayahStart = Number(from);
  const ayahEnd = Number(to);
  if (ayahStart < 1 || ayahEnd < 1 || ayahStart > ayahCount || ayahEnd > ayahCount)
    return { ok: false, reason: "invalid" };
  if (ayahStart > ayahEnd) return { ok: false, reason: "order" };
  return { ok: true, ayahStart, ayahEnd };
}

function digits(n: number, language: Language): string {
  return language === "ar" ? toArabicNumber(n) : String(n);
}

export function surahDisplayName(surah: ScopeSurah, language: Language): string {
  return language === "ar" ? surah.name_arabic : surah.name_english;
}

/** "Full surah" is left to the caller; this is the "5-20" part of a partial range. */
export function formatAyahSpan(start: number, end: number, language: Language): string {
  return start === end ? digits(start, language) : `${digits(start, language)}-${digits(end, language)}`;
}

export type ScopeSummary = {
  /** Up to four names with partial ranges ("Al-Baqarah 1-50, Yasin"). */
  names: string;
  /** How many names were left out of `names`, for the "+{n} more" suffix. */
  moreCount: number;
  /** "3 surahs · 214 ayahs", from canonical ayah counts and the exact ranges. */
  size: string;
  ayahCount: number;
};

const SUMMARY_NAME_LIMIT = 4;

/** A readable summary of exact surah ranges. A range covering the whole surah shows the name alone. */
export function summarizeScopeRanges(
  ranges: readonly ScopeRange[],
  surahs: readonly ScopeSurah[],
  language: Language,
): ScopeSummary {
  const bySurah = new Map(surahs.map((surah) => [surah.number, surah]));
  const labels = ranges.map((range) => {
    const surah = bySurah.get(range.surah);
    if (!surah) return formatNumber(range.surah, language);
    const name = surahDisplayName(surah, language);
    const whole = range.ayahStart === 1 && range.ayahEnd === surah.ayah_count;
    return whole ? name : `${name} ${formatAyahSpan(range.ayahStart, range.ayahEnd, language)}`;
  });
  const ayahCount = ranges.reduce((sum, range) => sum + Math.max(0, range.ayahEnd - range.ayahStart + 1), 0);
  const surahCount = new Set(ranges.map((range) => range.surah)).size;
  // A middle dot reads as the Arabic zero beside Arabic-Indic digits, so Arabic uses its comma.
  const separator = language === "ar" ? "، " : " · ";
  return {
    names: labels.slice(0, SUMMARY_NAME_LIMIT).join(language === "ar" ? "، " : ", "),
    moreCount: Math.max(0, labels.length - SUMMARY_NAME_LIMIT),
    size: `${formatSurahs(surahCount, language)}${separator}${formatAyahs(ayahCount, language)}`,
    ayahCount,
  };
}

/**
 * The exact ayah ranges per surah that the chosen juz cover, from the juz map. Adjacent or
 * overlapping pieces of one surah are joined, so two juz that split a surah read as one range.
 */
export function juzScopeRanges(rows: readonly JuzMapRow[], juzNumbers: ReadonlySet<number>): ScopeRange[] {
  const pieces = rows
    .filter((row) => juzNumbers.has(row.juz))
    .map((row) => ({ surah: row.surah, ayahStart: row.ayah_start, ayahEnd: row.ayah_end }))
    .sort((a, b) => a.surah - b.surah || a.ayahStart - b.ayahStart);
  const merged: ScopeRange[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.surah === piece.surah && piece.ayahStart <= last.ayahEnd + 1) {
      last.ayahEnd = Math.max(last.ayahEnd, piece.ayahEnd);
    } else merged.push({ ...piece });
  }
  return merged;
}
