import { formatAyahRef, toArabicNumber } from "@/lib/arabic";

/**
 * The one copy/share format for Quran text (ayah actions, verse share and web text selection).
 * Text is canonical Unicode `text_uthmani` with per-ayah numbers, enclosed in ﴿ ﴾, followed by a
 * reference line in the UI language and the canonical open link. Display glyph data (`text_qcf2`)
 * never reaches this format.
 */
export const CANONICAL_ORIGIN = "https://hafizquran.app";

export type CopyLanguage = "en" | "ar";

export type QuranCopyRange = {
  surah: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ayahStart: number;
  ayahEnd: number;
};

/** Canonical link with ASCII numeric tokens, whatever the UI language. */
export function canonicalAyahLink(surah: number, ayah: number): string {
  return `${CANONICAL_ORIGIN}/open?surah=${surah}&ayah=${ayah}`;
}

/** Appends the ayah-end number in Arabic-Indic digits, as in the Mushaf. */
export function withAyahNumber(text: string, ayah: number): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed} ${toArabicNumber(ayah)}` : "";
}

/** "Al-Baqarah 2:255" / "البقرة ٢:٢٥٥", with a range as "2:255-257" / "٢:٢٥٥-٢٥٧". */
export function formatQuranReference(range: QuranCopyRange, language: CopyLanguage): string {
  const arabic = language === "ar";
  const name = (arabic ? range.surahNameArabic : range.surahNameEnglish) || range.surahNameArabic || range.surahNameEnglish;
  const start = formatAyahRef(arabic, range.surah, range.ayahStart);
  const ref =
    range.ayahEnd !== range.ayahStart ? `${start}-${arabic ? toArabicNumber(range.ayahEnd) : range.ayahEnd}` : start;
  return name ? `${name} ${ref}` : ref;
}

export function formatQuranCopy({
  text,
  ranges,
  language,
}: {
  text: string;
  ranges: readonly QuranCopyRange[];
  language: CopyLanguage;
}): string {
  const first = ranges[0];
  const references = ranges.map((range) => formatQuranReference(range, language)).join(language === "ar" ? "، " : "; ");
  const lines = [`﴿${text.trim()}﴾`];
  if (references) lines.push(references);
  if (first) lines.push(canonicalAyahLink(first.surah, first.ayahStart));
  return lines.join("\n");
}
